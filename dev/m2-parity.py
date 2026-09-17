#!/usr/bin/env python3
"""Freeze and verify the exported Lean Init denominator before translation."""

import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parent.parent
KINDS = {"axiom", "definition", "theorem", "opaque", "quotient", "inductive",
         "constructor", "recursor"}
GAP = "Lean-to-Veil declaration translation is not implemented."
MODULE = re.compile(r"Init(?:\.[A-Za-z0-9_']+)*\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")


class InventoryError(Exception):
    """An invalid inventory or a failed inventory command."""


def require(condition, message):
    if not condition:
        raise InventoryError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":")) + "\n").encode("utf-8")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f"duplicate JSON key: {key}")
        result[key] = value
    return result


def decoded(data):
    return json.loads(data, object_pairs_hook=unique_object)


def keys(value, expected, label):
    require(isinstance(value, dict) and set(value) == set(expected),
            f"invalid {label} fields")


def strings(value, label):
    require(isinstance(value, list) and all(
        isinstance(item, str) and item and "\n" not in item and "\r" not in item
        for item in value), f"invalid {label}")
    require(len(set(value)) == len(value), f"duplicate {label}")


def inventory(raw):
    keys(raw, {"schema", "root", "import_level", "modules", "declarations"},
         "export")
    require(type(raw["schema"]) is int and raw["schema"] == 1,
            "unsupported export schema")
    require(raw["root"] == "Init" and raw["import_level"] == "exported",
            "inventory must import Init at exported level")
    modules = raw["modules"]
    strings(modules, "modules")
    require("Init" in modules and all(MODULE.fullmatch(name) for name in modules),
            "inventory contains a module outside Init")
    rows = raw["declarations"]
    require(isinstance(rows, list) and rows, "empty declaration denominator")
    for row in rows:
        keys(row, {"name", "module", "kind", "levels", "private"}, "declaration")
        strings([row["name"]], "declaration name")
        require(row["module"] is None or row["module"] in modules,
                f"unknown module for {row['name']}")
        require(isinstance(row["kind"], str) and row["kind"] in KINDS,
                f"unknown exported kind for {row['name']}")
        strings(row["levels"], "universe parameters")
        require(type(row["private"]) is bool, "invalid private flag")
    strings([row["name"] for row in rows], "declaration names")
    return {**raw, "modules": sorted(modules),
            "declarations": sorted(rows, key=lambda row: row["name"])}


def inventory_bytes(value):
    header = {key: item for key, item in value.items() if key != "declarations"}
    return encoded(header) + b"".join(encoded(row) for row in value["declarations"])


def read_inventory(data):
    lines = data.splitlines()
    require(len(lines) > 1, "empty inventory")
    header = decoded(lines[0])
    keys(header, {"schema", "root", "import_level", "modules"}, "inventory header")
    value = inventory({**header, "declarations": [decoded(line) for line in lines[1:]]})
    require(inventory_bytes(value) == data, "inventory is not in canonical order")
    return value


def baseline(value, inventory_sha256):
    names = [row["name"] for row in value["declarations"]]
    return {
        "schema": 1,
        "inventory_sha256": inventory_sha256,
        "denominator": len(names),
        "translation_attempts": 0,
        "kernel_rechecks": 0,
        "successes": 0,
        "unclassified": 0,
        "parity_percent": 0,
        "required_percent": 95,
        "parity_gate_passed": False,
        "translation_gap": {"reason": GAP, "names": names},
    }


def command(argv, cwd, env):
    completed = subprocess.run(argv, cwd=cwd, env=env, capture_output=True,
                               timeout=180, check=False)
    require(completed.returncode == 0,
            f"command failed ({completed.returncode}): {argv!r}\n"
            + completed.stderr.decode("utf-8", errors="replace")[-2000:]
            + completed.stdout.decode("utf-8", errors="replace")[:1000])
    require(not completed.stderr, f"unexpected stderr from {argv!r}")
    return completed.stdout


def export(root):
    toolchain = (root / "meta/lean-toolchain").read_text().strip()
    require(re.fullmatch(r"leanprover/lean4:v[0-9][A-Za-z0-9.\-]*", toolchain),
            "Lean toolchain must be a pinned release")
    env = os.environ.copy()
    # Local search paths must not substitute project modules for the pinned Init.
    env.pop("LEAN_PATH", None)
    env.pop("LEAN_SRC_PATH", None)
    prefix = ["elan", "run", toolchain, "lean"]
    cwd = root / "meta"
    sysroot = Path(command(prefix + ["--print-prefix"], cwd, env).decode().strip())
    version = command(prefix + ["--version"], cwd, env).decode().strip()
    raw = command(prefix + ["--run", "ExportInit.lean"], cwd, env)
    value = inventory(decoded(raw))
    artifacts = {}
    for module in value["modules"]:
        relative = "lib/lean/" + module.replace(".", "/") + ".olean"
        artifacts[relative] = digest((sysroot / relative).read_bytes())
    pin = {
        "schema": 1,
        "toolchain": toolchain,
        "lean_version": version,
        "exporter_sha256": digest((cwd / "ExportInit.lean").read_bytes()),
        "inventory_sha256": digest(inventory_bytes(value)),
        "declarations": len(value["declarations"]),
        "module_oleans": artifacts,
    }
    return value, pin


def verify(directory, root=ROOT, live=False):
    data = (directory / "inventory.jsonl").read_bytes()
    value = read_inventory(data)
    pin = decoded((directory / "pin.json").read_bytes())
    keys(pin, {"schema", "toolchain", "lean_version", "exporter_sha256",
               "inventory_sha256", "declarations", "module_oleans"}, "pin")
    require(type(pin["schema"]) is int and pin["schema"] == 1,
            "unsupported pin schema")
    require(pin["toolchain"] == (root / "meta/lean-toolchain").read_text().strip(),
            "Lean toolchain changed")
    require(isinstance(pin["lean_version"], str) and pin["lean_version"],
            "missing Lean version")
    require(pin["exporter_sha256"] == digest((root / "meta/ExportInit.lean").read_bytes()),
            "inventory exporter changed")
    require(pin["inventory_sha256"] == digest(data), "inventory fingerprint changed")
    require(type(pin["declarations"]) is int
            and pin["declarations"] == len(value["declarations"]),
            "declaration denominator changed")
    artifacts = pin["module_oleans"]
    expected = {"lib/lean/" + name.replace(".", "/") + ".olean"
                for name in value["modules"]}
    require(isinstance(artifacts, dict) and set(artifacts) == expected,
            "module artifact set changed")
    require(all(isinstance(sha, str) and SHA256.fullmatch(sha)
                for sha in artifacts.values()), "invalid module fingerprint")
    report = decoded((directory / "baseline.json").read_bytes())
    require(encoded(report) == encoded(baseline(value, digest(data))),
            "baseline must account for every declaration as an unattempted translation gap")
    if live:
        actual, actual_pin = export(root)
        require(inventory_bytes(actual) == data, "live Init declaration inventory changed")
        require(actual_pin == pin, "live Lean artifacts changed")
    return value, pin, report


def snapshot(directory, root=ROOT):
    require(not directory.exists(), "snapshot destination already exists")
    require(directory.parent.is_dir(), "snapshot parent directory does not exist")
    value, pin = export(root)
    report = baseline(value, pin["inventory_sha256"])
    with tempfile.TemporaryDirectory(prefix=".m2-init-", dir=directory.parent) as temporary:
        stage = Path(temporary) / "snapshot"
        stage.mkdir()
        (stage / "inventory.jsonl").write_bytes(inventory_bytes(value))
        (stage / "pin.json").write_bytes(encoded(pin))
        (stage / "baseline.json").write_bytes(encoded(report))
        verify(stage, root)
        require(not directory.exists(), "snapshot destination appeared during export")
        stage.rename(directory)
    return value, pin, report


def summary(value, pin, report):
    return {
        "toolchain": pin["toolchain"],
        "inventory_sha256": pin["inventory_sha256"],
        "modules": len(value["modules"]),
        "declarations": report["denominator"],
        "exported_kinds": dict(sorted(Counter(row["kind"]
                                             for row in value["declarations"]).items())),
        "translation_attempts": report["translation_attempts"],
        "kernel_rechecks": report["kernel_rechecks"],
        "translation_gaps": len(report["translation_gap"]["names"]),
        "parity_percent": report["parity_percent"],
        "parity_gate_passed": report["parity_gate_passed"],
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    freeze = sub.add_parser("snapshot", help="create a new pinned baseline directory")
    freeze.add_argument("--output", type=Path, required=True)
    for action in ("verify", "gate"):
        check = sub.add_parser(action, help="verify baseline integrity" if action == "verify"
                               else "report the open 95 percent parity gate (exit 1)")
        check.add_argument("--inventory", type=Path, default=ROOT / "dev/m2-init")
        check.add_argument("--live", action="store_true", help="re-export from pinned Lean")
    args = parser.parse_args(argv)
    try:
        result = (snapshot(args.output) if args.action == "snapshot"
                  else verify(args.inventory, live=args.live))
        print(json.dumps(summary(*result), sort_keys=True))
        return 1 if args.action == "gate" else 0
    except (InventoryError, OSError, ValueError, subprocess.TimeoutExpired) as error:
        print(f"M2 inventory: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
