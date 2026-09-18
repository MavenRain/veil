#!/usr/bin/env python3
"""Translate bounded monomorphic Lean data and proofs with Veil re-check evidence."""

import argparse
from collections import Counter
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("veil_declarations", ROOT / "dev/m2-declarations.py")
declarations = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(declarations)
parity = declarations.parity
require, encoded, decoded, digest = parity.require, parity.encoded, parity.decoded, parity.digest
MAX_DEPTH = 128
MAX_SOURCE = 262144
MAX_LITERAL = 64
CHECKS = (("check", ["check", "--print"]), ("erased", ["check", "--erased"]),
          ("axioms", ["axioms"]))


class Gap(Exception):
    """A supported export that this translator cannot yet lower."""


def admit(condition, reason):
    if not condition:
        raise Gap(reason)


def symbol(name):
    # Injective, lexer-safe names, disjoint from local binders and builtins.
    return "v" + name.encode("utf-8").hex()


def closed_level(value, fuel=MAX_DEPTH):
    admit(fuel > 0, "universe depth exceeds translator limit")
    tag = value[0]
    if tag == "zero":
        result = 0
    elif tag == "succ":
        result = 1 + closed_level(value[1], fuel - 1)
    elif tag in ("max", "imax"):
        left, right = (closed_level(child, fuel - 1) for child in value[1:])
        result = 0 if tag == "imax" and right == 0 else max(left, right)
    else:
        raise Gap("universe parameters need prenex polymorphism")
    admit(result <= 255, "universe exceeds translator limit")
    return result


class Expressions:
    def __init__(self, row):
        self.nodes = row["nodes"]
        self.cache = {}
        self.bytes = 0

    def render(self, index, depth=0, fuel=MAX_DEPTH):
        admit(fuel > 0, "expression depth exceeds translator limit")
        key = (index, depth)
        if key in self.cache:
            return self.cache[key]
        admit(len(self.cache) < 4096, "expression expansion exceeds node limit")
        node = self.nodes[index]
        tag = node[0]

        def child(child_index, under=0):
            return self.render(child_index, depth + under, fuel - 1)

        if tag == "bvar":
            admit(node[1] < depth, "loose bound variable")
            result = f"b{depth - node[1] - 1}"
        elif tag == "sort":
            level = closed_level(node[1])
            result = "Prop" if level == 0 else f"(Type {level - 1})"
        elif tag == "const":
            admit(not node[2], "constant universe instantiation is not implemented")
            result = symbol(node[1])
        elif tag == "app":
            result = f"({child(node[1])} {child(node[2])})"
        elif tag in ("lam", "forall"):
            admit(self.nodes[node[3]][0] != "sort", "type-valued binders need erasure translation")
            binder = f"(b{depth} : {child(node[3])})"
            body = child(node[4], 1)
            result = f"(fun {binder} => {body})" if tag == "lam" else f"({binder} -> {body})"
        elif tag == "let":
            result = (f"(let b{depth} : {child(node[2])} := {child(node[3])} "
                      f"in {child(node[4], 1)})")
        elif tag == "nat":
            admit(len(node[1]) <= 2 and int(node[1]) <= MAX_LITERAL,
                  "natural literal exceeds unary translation limit")
            result = symbol("Nat.zero")
            for _ in range(int(node[1])):
                result = f"({symbol('Nat.succ')} {result})"
        else:
            raise Gap(f"{tag} expressions are not implemented")
        size = len(result.encode("utf-8"))
        admit(size <= MAX_SOURCE, "expression exceeds source limit")
        self.bytes += size
        admit(self.bytes <= 16 * MAX_SOURCE, "expression expansion exceeds byte limit")
        admit(len(self.cache) < 4096, "expression expansion exceeds node limit")
        self.cache[key] = result
        return result


class Translator:
    def __init__(self, snapshot):
        self.rows = {row["name"]: row for row in snapshot["declarations"]}
        self.units = {}
        self.failures = {}

    def owner(self, name):
        row = self.rows[name]
        return row["details"]["inductive"] if row["kind"] == "constructor" else name

    def compile(self, name, stack=()):
        name = self.owner(name)
        if name in self.units:
            return self.units[name]
        if name in self.failures:
            raise Gap(self.failures[name])
        try:
            admit(len(stack) < MAX_DEPTH, "dependency depth exceeds translator limit")
            admit(name not in stack, f"recursive declaration dependency: {name}")
            row = self.rows[name]
            admit(not row["levels"], "universe parameters need prenex polymorphism")
            details = row["details"]
            if row["kind"] == "inductive":
                admit(details["mutual"] == [name] and details["parameters"] == 0
                      and details["indices"] == 0 and details["nested"] == 0,
                      "only single, unparameterized, unindexed families are implemented")
                admit(not details["unsafe"] and not details["reflexive"],
                      "unsafe or reflexive family is not implemented")
                members = [name, *details["constructors"]]
                family_type = row["nodes"][row["type"]]
                admit(family_type[0] == "sort", "family type must be a closed sort")
                body = f"mu {symbol(name)} : {Expressions(row).render(row['type'])} with\n"
                for constructor in details["constructors"]:
                    ctor = self.rows[constructor]
                    admit(not ctor["levels"] and not ctor["details"]["unsafe"],
                          "polymorphic or unsafe constructor is not implemented")
                    # Restrict fields to closed constants. This pins the simple
                    # strictly-positive family subset before asking Veil to check it.
                    index, fields = ctor["type"], 0
                    while ctor["nodes"][index][0] == "forall":
                        node = ctor["nodes"][index]
                        admit(ctor["nodes"][node[3]][0] == "const",
                              "constructor field must have a constant type")
                        fields += 1
                        index = node[4]
                    admit(ctor["nodes"][index] == ["const", name, []]
                          and fields == ctor["details"]["fields"],
                          "constructor must return its unindexed family")
                    body += f"| {symbol(constructor)} : {Expressions(ctor).render(ctor['type'])}\n"
            elif row["kind"] in ("definition", "theorem"):
                if row["kind"] == "definition":
                    admit(details["safety"] == "safe", "unsafe or partial definition is not implemented")
                    admit(details["hints"] != ["opaque"], "opaque definitions are not implemented")
                admit(details["mutual"] in ([], [name]), "mutual definitions or theorems are not implemented")
                admit(not any(node[0] == "const" and node[1] == name for node in row["nodes"]),
                      "recursive definitions or theorems need recursor translation")
                members = [name]
                expr = Expressions(row)
                ty = expr.render(row["type"])
                body = ""
                if row["kind"] == "theorem":
                    # The kernel checks that the advertised theorem type really
                    # inhabits Prop. Guard names cannot collide with translated
                    # globals (v...) or local binders (b...). Both definitions
                    # erase; no opaque body or proof is replaced by an axiom.
                    body = f"def p{name.encode('utf-8').hex()} : Prop := {ty}\n"
                body += f"def {symbol(name)} : {ty} := {expr.render(row['value'])}\n"
            else:
                raise Gap(f"{row['kind']} declarations are not implemented")
            dependencies = sorted(set().union(*(set(self.rows[n]["dependencies"])
                                                for n in members)) - set(members))
            closure = {}
            for dependency in dependencies:
                try:
                    unit = self.compile(dependency, (*stack, name))
                except Gap as error:
                    raise Gap(f"dependency {dependency}: {error}") from error
                for ancestor in unit["closure"]:
                    closure[ancestor] = None
            closure[name] = None
            source = "\n".join(self.units[n]["body"] if n != name else body for n in closure)
            admit(len(source.encode("utf-8")) <= MAX_SOURCE, "dependency closure exceeds source limit")
            unit = {"members": members, "closure": list(closure), "body": body, "source": source}
            self.units[name] = unit
            return unit
        except Gap as error:
            self.failures[name] = str(error)
            raise

    def plan(self):
        results = []
        for name, row in sorted(self.rows.items()):
            try:
                self.compile(name)
                artifact = digest(self.owner(name).encode("utf-8")) + ".kan"
                result = {"artifact": artifact, "reason": None}
            except Gap as error:
                result = {"artifact": None, "reason": str(error)}
            results.append({"name": name, "declaration_sha256": digest(encoded(row)), **result})
        artifacts = {}
        for name, unit in sorted(self.units.items()):
            artifact = digest(name.encode("utf-8")) + ".kan"
            members = sorted(n for owner in unit["closure"] for n in self.units[owner]["members"])
            artifacts[artifact] = {"source": unit["source"], "declarations": members}
        return results, artifacts


def source_hashes(root):
    paths = {*declarations.SOURCES, "dev/m2-translate.py", "dev/dunecho.sh", "dune", "dune-project"}
    for directory in ("lib", "surface", "wasm", "bin"):
        paths.update(str(path.relative_to(root)) for path in (root / directory).iterdir()
                     if path.is_file() and (path.suffix in (".ml", ".mli") or path.name == "dune"))
    return {path: digest((root / path).read_bytes()) for path in sorted(paths)}


def inputs(snapshot_dir, inventory_dir, root):
    snapshot, pin = declarations.verify(snapshot_dir, inventory_dir, root)
    inventory, _, _ = parity.verify(inventory_dir, root)
    rows, artifacts = Translator(snapshot).plan()
    return rows, artifacts, {"schema": 1, "scope": "monomorphic-prototype",
                            "inventory_sha256": pin["inventory_sha256"],
                            "inventory_declarations": len(inventory["declarations"]),
                            "snapshot_sha256": {name: digest((snapshot_dir / name).read_bytes())
                                                for name in ("declarations.json", "pin.json")},
                            "source_sha256": source_hashes(root)}


def check_artifact(checker, directory, artifact):
    checks = []
    for label, command in CHECKS:
        argv = [*command, artifact]
        completed = subprocess.run([str(checker), *argv], cwd=directory,
                                   capture_output=True, timeout=30, check=False)
        require(completed.returncode in (0, 1),
                f"checker infrastructure failure: exit {completed.returncode} for {argv}")
        for stream in ("stdout", "stderr"):
            (directory / f"{artifact}.{label}.{stream}").write_bytes(getattr(completed, stream))
        checks.append({"argv": argv, "exit_code": completed.returncode})
    return checks


def assemble(directory, rows, artifacts, provenance, checker_sha256, captures):
    require(isinstance(checker_sha256, str) and parity.SHA256.fullmatch(checker_sha256),
            "invalid checker fingerprint")
    require(isinstance(captures, dict) and set(captures) == set(artifacts), "checker artifact set changed")
    files, outcomes = {}, {}
    for artifact, unit in artifacts.items():
        source = (directory / artifact).read_bytes()
        require(source == unit["source"].encode("utf-8"), "translated source differs from Lean input")
        files[artifact] = digest(source)
        checks = captures[artifact]
        require(isinstance(checks, list) and len(checks) == len(CHECKS), "missing checker evidence")
        passed = True
        for check, (label, command) in zip(checks, CHECKS):
            parity.keys(check, {"argv", "exit_code"}, "checker evidence")
            require(check["argv"] == [*command, artifact], "checker command changed")
            require(type(check["exit_code"]) is int and check["exit_code"] in (0, 1),
                    "invalid checker exit status")
            streams = {}
            for stream in ("stdout", "stderr"):
                path = f"{artifact}.{label}.{stream}"
                streams[stream] = (directory / path).read_bytes()
                files[path] = digest(streams[stream])
            passed = passed and check["exit_code"] == 0 and not streams["stderr"]
            if label == "axioms":
                passed = passed and not streams["stdout"]
        outcomes[artifact] = passed
    results = []
    for row in rows:
        artifact = row["artifact"]
        passed = artifact is not None and outcomes[artifact]
        reason = row["reason"] if artifact is None else (None if passed else
                 "generated candidate failed kernel, erasure or empty-axiom checks")
        results.append({**row, "status": "rechecked" if passed else "translation gap", "reason": reason})
    counts = Counter(row["status"] for row in results)
    return {**provenance, "checker_sha256": checker_sha256, "results": results,
            "artifacts": {path: {"declarations": unit["declarations"], "checks": captures[path]}
                          for path, unit in artifacts.items()}, "files_sha256": files,
            "summary": {"snapshot_declarations": len(rows), "rechecked": counts["rechecked"],
                        "translation_gaps": counts["translation gap"], "parity_credited": 0}}


def record(directory, snapshot_dir, inventory_dir, checker, root=ROOT):
    require(not os.path.lexists(directory), "translation destination already exists")
    require(directory.parent.is_dir(), "translation parent directory does not exist")
    rows, artifacts, provenance = inputs(snapshot_dir, inventory_dir, root)
    checker = checker.resolve(strict=True)
    checker_hash = digest(checker.read_bytes())
    with tempfile.TemporaryDirectory(prefix=".m2-translation-", dir=directory.parent) as temporary:
        stage = Path(temporary) / "record"
        stage.mkdir()
        captures = {}
        for path, unit in artifacts.items():
            (stage / path).write_text(unit["source"], encoding="utf-8")
            captures[path] = check_artifact(checker, stage, path)
        require(digest(checker.read_bytes()) == checker_hash, "checker changed during translation")
        require(inputs(snapshot_dir, inventory_dir, root) == (rows, artifacts, provenance),
                "translation input or source changed during checks")
        report = assemble(stage, rows, artifacts, provenance, checker_hash, captures)
        (stage / "results.json").write_bytes(encoded(report))
        verify(stage, snapshot_dir, inventory_dir, root=root)
        require(not os.path.lexists(directory), "translation destination appeared during checks")
        stage.rename(directory)
    return report


def verify(directory, snapshot_dir, inventory_dir, root=ROOT, checker=None):
    rows, artifacts, provenance = inputs(snapshot_dir, inventory_dir, root)
    require(directory.is_dir() and not directory.is_symlink(), "invalid translation directory")
    paths = list(directory.iterdir())
    require(all(path.is_file() and not path.is_symlink() for path in paths), "nonregular record file")
    raw = (directory / "results.json").read_bytes()
    report = decoded(raw)
    require(isinstance(report, dict) and isinstance(report.get("artifacts"), dict), "invalid translation record")
    captures = {}
    for path, artifact in report["artifacts"].items():
        parity.keys(artifact, {"declarations", "checks"}, "translation artifact")
        captures[path] = artifact["checks"]
    actual = assemble(directory, rows, artifacts, provenance, report.get("checker_sha256"), captures)
    require(raw == encoded(actual), "translation record or fingerprint changed")
    require({path.name for path in paths} == {"results.json", *actual["files_sha256"]},
            "translation record file set changed")
    if checker is not None:
        checker = checker.resolve(strict=True)
        checker_hash = digest(checker.read_bytes())
        with tempfile.TemporaryDirectory(prefix="veil-m2-recheck-") as temporary:
            stage = Path(temporary)
            for path, unit in artifacts.items():
                (stage / path).write_text(unit["source"], encoding="utf-8")
                require(check_artifact(checker, stage, path) == captures[path], "live checker status differs")
                for label, _ in CHECKS:
                    for stream in ("stdout", "stderr"):
                        filename = f"{path}.{label}.{stream}"
                        require(digest((stage / filename).read_bytes()) == actual["files_sha256"][filename],
                                "live checker output differs")
        require(digest(checker.read_bytes()) == checker_hash, "checker changed during live verification")
        require(inputs(snapshot_dir, inventory_dir, root) == (rows, artifacts, provenance),
                "translation input or source changed during live verification")
    return actual


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    create = sub.add_parser("record")
    create.add_argument("--output", required=True, type=Path)
    check = sub.add_parser("verify")
    check.add_argument("--record", type=Path, default=ROOT / "dev/m2-translation")
    check.add_argument("--live", action="store_true")
    for command in (create, check):
        command.add_argument("--snapshot", type=Path, default=ROOT / "dev/m2-declarations")
        command.add_argument("--inventory", type=Path, default=ROOT / "dev/m2-init")
        command.add_argument("--checker", type=Path, default=ROOT / "_build/default/bin/kanon.exe")
    args = parser.parse_args(argv)
    try:
        if args.command == "record":
            report = record(args.output, args.snapshot, args.inventory, args.checker)
        else:
            report = verify(args.record, args.snapshot, args.inventory,
                            checker=args.checker if args.live else None)
        print(encoded(report["summary"]).decode(), end="")
        return 0
    except (parity.InventoryError, OSError, ValueError, RecursionError, subprocess.SubprocessError) as error:
        print(f"m2-translate: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
