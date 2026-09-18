#!/usr/bin/env python3
"""Export pinned Lean declaration bodies and their dependency closure for M2."""

import argparse
from collections import Counter
import importlib.util
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("veil_parity", ROOT / "dev/m2-parity.py")
parity = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(parity)
require, keys, strings = parity.require, parity.keys, parity.strings
encoded, decoded, digest = parity.encoded, parity.decoded, parity.digest
SOURCES = ("meta/ExportDeclarations.lean", "dev/m2-declarations.py", "dev/m2-parity.py")
BODY_KINDS = {"definition", "theorem", "opaque"}


def natural(value):
    return type(value) is int and value >= 0


def name(value):
    require(isinstance(value, str) and value and not any(c in value for c in "\n\r\0"),
            "invalid declaration or universe name")
    return value


def level(value, parameters, fuel=512):
    require(fuel > 0 and isinstance(value, list) and value, "invalid universe expression")
    tag = value[0]
    require(isinstance(tag, str), "invalid universe tag")
    arities = {"zero": 1, "succ": 2, "max": 3, "imax": 3, "param": 2}
    require(tag in arities and len(value) == arities[tag], "unknown universe form or arity")
    if tag == "param":
        require(name(value[1]) in parameters, "undeclared universe parameter")
    else:
        for child in value[1:]:
            level(child, parameters, fuel - 1)


def details(row):
    value, kind = row["details"], row["kind"]
    fields = {
        "axiom": {"unsafe"},
        "definition": {"safety", "hints", "mutual"},
        "theorem": {"mutual"},
        "opaque": {"unsafe", "mutual"},
        "quotient": {"form"},
        "inductive": {"parameters", "indices", "mutual", "constructors", "nested",
                      "recursive", "unsafe", "reflexive"},
        "constructor": {"inductive", "index", "parameters", "fields", "unsafe"},
        "recursor": {"mutual", "parameters", "indices", "motives", "minors", "rules", "k", "unsafe"},
    }
    keys(value, fields[kind], f"{kind} details")
    refs, roots = set(), []
    for field, item in value.items():
        if field in {"unsafe", "recursive", "reflexive", "k"}:
            require(type(item) is bool, f"invalid {field} flag")
        elif field in {"parameters", "indices", "nested", "index", "fields", "motives", "minors"}:
            require(natural(item), f"invalid {field} count")
        elif field in {"mutual", "constructors"}:
            strings(item, field)
            refs.update(name(entry) for entry in item)
        elif field == "inductive":
            refs.add(name(item))
    if kind == "definition":
        require(value["safety"] in ("safe", "unsafe", "partial"), "invalid definition safety")
        hints = value["hints"]
        require(isinstance(hints, list) and
                (hints in (["opaque"], ["abbrev"]) or
                 (len(hints) == 2 and hints[0] == "regular" and natural(hints[1])
                  and hints[1] < 2**32)), "invalid reducibility hints")
    if kind == "quotient":
        require(value["form"] in ("type", "ctor", "lift", "ind"), "invalid quotient form")
    if kind == "recursor":
        require(isinstance(value["rules"], list), "invalid recursor rules")
        constructors = []
        for rule in value["rules"]:
            keys(rule, {"constructor", "fields", "rhs"}, "recursor rule")
            constructors.append(name(rule["constructor"]))
            require(natural(rule["fields"]), "invalid recursor field count")
            roots.append(rule["rhs"])
        require(len(constructors) == len(set(constructors)), "duplicate recursor rule")
        refs.update(constructors)
    return refs, roots


def declaration(row, modules):
    keys(row, {"name", "module", "kind", "levels", "private", "type", "value", "details",
               "nodes", "dependencies"}, "declaration")
    name(row["name"])
    require(isinstance(row["module"], str) and row["module"] in modules, "unknown owning module")
    require(isinstance(row["kind"], str) and row["kind"] in parity.KINDS, "unknown declaration kind")
    strings(row["levels"], "universe parameters")
    require(type(row["private"]) is bool, "invalid private flag")
    require((row["value"] is not None) == (row["kind"] in BODY_KINDS),
            "missing declaration body or body on a non-definition")
    refs, roots = details(row)
    roots += [row["type"]] + ([] if row["value"] is None else [row["value"]])
    nodes = row["nodes"]
    require(isinstance(nodes, list) and 0 < len(nodes) <= 100000, "invalid expression node count")
    require(all(natural(index) and index < len(nodes) for index in roots), "invalid expression root")
    needs, edges = [], []
    arities = {"bvar": 2, "sort": 2, "const": 3, "app": 3, "lam": 5,
               "forall": 5, "let": 6, "nat": 2, "string": 2, "proj": 4}
    for index, node in enumerate(nodes):
        require(isinstance(node, list) and node and isinstance(node[0], str), "invalid expression node")
        tag = node[0]
        require(tag in arities and len(node) == arities[tag], "unknown expression form or arity")
        children, depth = [], 0
        if tag == "bvar":
            require(natural(node[1]), "invalid bound variable")
            depth = node[1] + 1
        elif tag == "sort":
            level(node[1], row["levels"])
        elif tag == "const":
            refs.add(name(node[1]))
            require(isinstance(node[2], list), "invalid constant universes")
            for universe in node[2]:
                level(universe, row["levels"])
        elif tag == "app":
            children = node[1:]
        elif tag in {"lam", "forall"}:
            require(isinstance(node[1], str) and node[2] in
                    ("explicit", "implicit", "strict_implicit", "instance"), "invalid binder")
            children = node[3:]
        elif tag == "let":
            require(isinstance(node[1], str) and type(node[5]) is bool, "invalid let binder")
            children = node[2:5]
        elif tag == "nat":
            require(isinstance(node[1], str) and re.fullmatch(r"0|[1-9][0-9]*", node[1]),
                    "invalid exact natural literal")
            refs.add("Nat")
        elif tag == "string":
            require(isinstance(node[1], str), "invalid string literal")
            refs.add("String")
        elif tag == "proj":
            refs.add(name(node[1]))
            require(natural(node[2]), "invalid projection field")
            children = [node[3]]
        require(all(natural(child) and child < index for child in children),
                "expression graph contains a forward reference or cycle")
        if children:
            depths = [needs[child] for child in children]
            if tag in {"lam", "forall", "let"}:
                depths[-1] = max(0, depths[-1] - 1)
            depth = max(depths)
        needs.append(depth)
        edges.append(children)
    require(all(needs[index] == 0 for index in roots), "loose bound variable in declaration")
    reachable, pending = set(), list(roots)
    while pending:
        index = pending.pop()
        if index not in reachable:
            reachable.add(index)
            pending.extend(edges[index])
    require(len(reachable) == len(nodes), "unreachable expression nodes")
    strings(row["dependencies"], "dependencies")
    require(row["dependencies"] == sorted(refs), "dependency list differs from expressions and structure")


def validate(value, inventory):
    keys(value, {"schema", "root", "import_level", "requested", "modules", "declarations"}, "export")
    require(type(value["schema"]) is int and value["schema"] == 1 and value["root"] == "Init"
            and value["import_level"] == "private", "invalid declaration export scope")
    strings(value["modules"], "imported modules")
    require(value["modules"] == sorted(value["modules"]) and
            all(parity.MODULE.fullmatch(module) for module in value["modules"]) and
            set(inventory["modules"]) <= set(value["modules"]),
            "private module set must contain the exported Init modules")
    strings(value["requested"], "requested declarations")
    require(value["requested"] and value["requested"] == sorted(value["requested"]), "invalid requested order")
    exported = {row["name"]: row for row in inventory["declarations"]}
    require(set(value["requested"]) <= exported.keys(), "requested name is outside the pinned denominator")
    rows = value["declarations"]
    require(isinstance(rows, list) and 0 < len(rows) <= 4096, "invalid declaration closure size")
    for row in rows:
        declaration(row, value["modules"])
    names = [row["name"] for row in rows]
    require(names == sorted(set(names)), "duplicate or unsorted declarations")
    by_name = dict(zip(names, rows))
    require(set(value["requested"]) <= by_name.keys(), "requested declaration is missing")
    for row in rows:
        require(set(row["dependencies"]) <= by_name.keys(), "missing dependency from closure")
        if row["name"] in exported:
            old = exported[row["name"]]
            require(all(row[field] == old[field] for field in ("module", "levels", "private")),
                    "exported declaration metadata differs from inventory")
            require(row["kind"] == old["kind"] or
                    (old["kind"] == "axiom" and row["kind"] in BODY_KINDS), "declaration kind changed")
        for node in row["nodes"]:
            if node[0] == "const":
                require(len(node[2]) == len(by_name[node[1]]["levels"]), "constant universe arity differs")
            elif node[0] == "proj":
                owner = by_name[node[1]]
                require(owner["kind"] == "inductive" and len(owner["details"]["constructors"]) == 1,
                        "projection target is not a structure")
                constructor = by_name[owner["details"]["constructors"][0]]
                require(constructor["kind"] == "constructor" and
                        node[2] < constructor["details"]["fields"], "projection field is out of range")
        payload = row["details"]
        if row["kind"] == "inductive":
            for index, ctor in enumerate(payload["constructors"]):
                constructor = by_name[ctor]
                require(constructor["kind"] == "constructor" and
                        constructor["details"]["inductive"] == row["name"] and
                        constructor["details"]["index"] == index and
                        constructor["details"]["parameters"] == payload["parameters"],
                        "inductive constructor metadata differs")
        elif row["kind"] == "constructor":
            owner = by_name[payload["inductive"]]
            require(owner["kind"] == "inductive" and row["name"] in owner["details"]["constructors"],
                    "constructor is absent from its inductive")
        elif row["kind"] == "recursor":
            require(all(by_name[owner]["kind"] == "inductive" for owner in payload["mutual"]),
                    "recursor has a non-inductive owner")
            for rule in payload["rules"]:
                ctor = by_name[rule["constructor"]]
                require(ctor["kind"] == "constructor" and ctor["details"]["fields"] == rule["fields"]
                        and ctor["details"]["inductive"] in payload["mutual"],
                        "recursor constructor metadata differs")
    reachable, pending = set(), list(value["requested"])
    while pending:
        current = pending.pop()
        if current not in reachable:
            reachable.add(current)
            pending.extend(by_name[current]["dependencies"])
    require(reachable == by_name.keys(), "unrelated declaration added to closure")
    return value


def normalize(value):
    # Only exporter output is normalized. Stored snapshots must already be canonical.
    keys(value, {"schema", "root", "import_level", "requested", "modules", "declarations"}, "export")
    strings(value["modules"], "imported modules")
    strings(value["requested"], "requested declarations")
    require(isinstance(value["declarations"], list), "invalid declaration list")
    for row in value["declarations"]:
        require(isinstance(row, dict) and "name" in row and "dependencies" in row,
                "invalid exporter declaration")
        name(row["name"])
        require(isinstance(row["dependencies"], list), "invalid exporter dependencies")
        for dependency in row["dependencies"]:
            name(dependency)
    value["modules"] = sorted(value["modules"])
    value["requested"] = sorted(value["requested"])
    value["declarations"].sort(key=lambda row: row["name"])
    for row in value["declarations"]:
        row["dependencies"] = sorted(set(row["dependencies"]))
    return value


def artifact_names(modules):
    return ["lib/lean/" + module.replace(".", "/") + suffix
            for module in modules for suffix in (".olean", ".olean.server", ".olean.private")]


def export(requested, inventory_dir, root=ROOT):
    inventory, inventory_pin, _ = parity.verify(inventory_dir, root, live=True)
    strings(requested, "requested declarations")
    require(requested and set(requested) <= {row["name"] for row in inventory["declarations"]},
            "requested name is outside the pinned denominator")
    env = os.environ.copy()
    env.pop("LEAN_PATH", None)
    env.pop("LEAN_SRC_PATH", None)
    # LEAN_SYSROOT redirects the loaded oleans, while --print-prefix ignores it.
    env.pop("LEAN_SYSROOT", None)
    prefix = ["elan", "run", inventory_pin["toolchain"], "lean"]
    cwd = root / "meta"
    sysroot = Path(parity.command(prefix + ["--print-prefix"], cwd, env).decode().strip())
    # Private imports may load Init modules absent from the exported environment.
    # Hash installed Init candidates before export, then retain only imported ones.
    base = sysroot / "lib/lean"
    candidates = [base / "Init.olean", *(base / "Init").rglob("*.olean")]
    installed_modules = [str(path.relative_to(base))[:-len(".olean")].replace(os.sep, ".")
                         for path in candidates]
    available = {}
    for relative in artifact_names(installed_modules):
        path = sysroot / relative
        available[relative] = digest(path.read_bytes()) if path.exists() else None
    for relative, sha in inventory_pin["module_oleans"].items():
        require(available.get(relative) == sha, "exported module artifact changed")
    source_hashes = {path: digest((root / path).read_bytes()) for path in SOURCES}
    raw = parity.command(prefix + ["--run", "ExportDeclarations.lean", *sorted(requested)], cwd, env)
    value = validate(normalize(decoded(raw)), inventory)
    required = artifact_names(value["modules"])
    require(set(required) <= available.keys(), "private module artifact missing before export")
    artifacts = {relative: available[relative] for relative in required}
    # Refuse a toolchain or source change while the export was in flight.
    for relative, sha in artifacts.items():
        path = sysroot / relative
        require((digest(path.read_bytes()) if path.exists() else None) == sha,
                "module artifact changed during export")
    require(source_hashes == {path: digest((root / path).read_bytes()) for path in SOURCES},
            "export source changed during export")
    pin = {"schema": 1, "inventory_sha256": inventory_pin["inventory_sha256"],
           "toolchain": inventory_pin["toolchain"], "lean_version": inventory_pin["lean_version"],
           "source_sha256": source_hashes, "module_artifacts": artifacts,
           "declarations_sha256": digest(encoded(value)), "declarations": len(value["declarations"])}
    return value, pin


def verify(directory, inventory_dir, root=ROOT, live=False):
    inventory, inventory_pin, _ = parity.verify(inventory_dir, root)
    data = (directory / "declarations.json").read_bytes()
    value = validate(decoded(data), inventory)
    require(data == encoded(value), "noncanonical declaration snapshot")
    pin = decoded((directory / "pin.json").read_bytes())
    keys(pin, {"schema", "inventory_sha256", "toolchain", "lean_version", "source_sha256",
               "module_artifacts", "declarations_sha256", "declarations"}, "declaration pin")
    require(type(pin["schema"]) is int and pin["schema"] == 1, "invalid pin schema")
    for field in ("inventory_sha256", "toolchain", "lean_version"):
        require(pin[field] == inventory_pin[field], f"changed {field} pin")
    require(pin["source_sha256"] == {path: digest((root / path).read_bytes()) for path in SOURCES},
            "declaration export source changed")
    require(pin["declarations_sha256"] == digest(data), "declaration fingerprint changed")
    require(type(pin["declarations"]) is int and pin["declarations"] == len(value["declarations"]),
            "declaration closure count changed")
    artifacts = pin["module_artifacts"]
    require(isinstance(artifacts, dict) and set(artifacts) == set(artifact_names(value["modules"])),
            "module artifact set changed")
    require(all(sha is None or (isinstance(sha, str) and parity.SHA256.fullmatch(sha))
                for sha in artifacts.values()), "invalid module artifact hash")
    require(all(artifacts[relative] is not None for relative in artifacts if relative.endswith(".olean")),
            "missing module olean fingerprint")
    for relative, sha in inventory_pin["module_oleans"].items():
        require(artifacts[relative] == sha, "exported module fingerprint differs")
    if live:
        actual, actual_pin = export(value["requested"], inventory_dir, root)
        require(encoded(actual) == data and actual_pin == pin, "live declaration export differs")
    return value, pin


def snapshot(directory, requested, inventory_dir, root=ROOT):
    require(not os.path.lexists(directory), "snapshot destination already exists")
    require(directory.parent.is_dir(), "snapshot parent directory does not exist")
    value, pin = export(requested, inventory_dir, root)
    with tempfile.TemporaryDirectory(prefix=".m2-declarations-", dir=directory.parent) as temporary:
        stage = Path(temporary) / "snapshot"
        stage.mkdir()
        (stage / "declarations.json").write_bytes(encoded(value))
        (stage / "pin.json").write_bytes(encoded(pin))
        verify(stage, inventory_dir, root)
        require(not os.path.lexists(directory), "snapshot destination appeared during export")
        stage.rename(directory)
    return value, pin


def summary(value, pin):
    return {"inventory_sha256": pin["inventory_sha256"], "requested": value["requested"],
            "declarations": len(value["declarations"]), "kinds": dict(Counter(
                row["kind"] for row in value["declarations"])),
            "axioms_in_closure": [row["name"] for row in value["declarations"] if row["kind"] == "axiom"],
            "declarations_sha256": pin["declarations_sha256"],
            "translation_attempted": False, "veil_kernel_rechecks": 0}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    create = sub.add_parser("snapshot")
    create.add_argument("--output", type=Path, required=True)
    create.add_argument("--name", action="append", required=True)
    check = sub.add_parser("verify")
    check.add_argument("--snapshot", type=Path, default=ROOT / "dev/m2-declarations")
    check.add_argument("--live", action="store_true")
    for command in (create, check):
        command.add_argument("--inventory", type=Path, default=ROOT / "dev/m2-init")
    args = parser.parse_args(argv)
    try:
        if args.command == "snapshot":
            value, pin = snapshot(args.output, args.name, args.inventory)
        else:
            value, pin = verify(args.snapshot, args.inventory, live=args.live)
        print(encoded(summary(value, pin)).decode(), end="")
        return 0
    except (parity.InventoryError, OSError, ValueError, RecursionError, subprocess.SubprocessError) as error:
        print(f"M2 declaration export: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
