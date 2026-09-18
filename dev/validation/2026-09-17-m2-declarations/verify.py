#!/usr/bin/env python3
"""Check retained validation captures and the exact source files they describe."""
import hashlib
import json
from pathlib import Path
import sys

record = Path(__file__).resolve().parent
root = record.parents[2]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


KINDS = {"axiom": 3, "constructor": 11, "definition": 16, "inductive": 10,
         "quotient": 2, "recursor": 1, "theorem": 1}
TRUSTED_LINES = "TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK\n"


def verify():
    results = json.loads((record / "results.json").read_text())
    for name, expected in results["sources"].items():
        if sha(root / name) != expected:
            return f"source hash changed: {name}"
    for label, check in results["checks"].items():
        for suffix, expected in check["sha256"].items():
            if sha(record / f"{label}.{suffix}") != expected:
                return f"capture hash changed: {label}.{suffix}"
        manifest = json.loads((record / f"{label}.json").read_text())
        if manifest["status"] != "complete" or manifest["exitCode"] != check["expected_exit_code"]:
            return f"capture did not finish with its expected status: {label}"
        if len(manifest["commands"]) != 1:
            return f"unexpected command count: {label}"
        command = manifest["commands"][0]
        if (command["timedOut"] or command["spawnError"] or command["argv"] != check["argv"]
                or command["exitCode"] != check["expected_exit_code"] or command["signal"] != 0):
            return f"capture command failed or changed: {label}"
    review = results.get("review", {})
    for name, expected in review.items():
        if sha(record / name) != expected:
            return f"review hash changed: {name}"
    expected_files = {"README.md", "results.json", "verify.py"} | {
        f"{label}.{suffix}" for label, check in results["checks"].items()
        for suffix in check["sha256"]} | set(review)
    for path in sorted(record.iterdir()):
        if path.is_file() and path.name not in expected_files:
            return f"unexpected record file: {path.name}"
    for name in sorted(expected_files):
        if not (record / name).is_file():
            return f"missing record file: {name}"
    snapshot = json.loads((record / "snapshot.stdout").read_text())
    if snapshot["declarations"] != 44 or snapshot["kinds"] != KINDS:
        return "snapshot summary changed"
    if (record / "trusted-lines.stdout").read_text() != TRUSTED_LINES:
        return "trusted-lines result changed"
    if not (record / "house.stdout").read_text().endswith("HOUSE OK\n"):
        return "house result changed"
    if not (record / "declarations.stderr").read_text().endswith("OK\n"):
        return "declaration regression suite did not pass"
    if "Ran 32 tests" not in (record / "declarations.stderr").read_text():
        return "declaration test count changed"
    if "Ran 21 tests" not in (record / "parity-tests.stderr").read_text():
        return "parity test count changed"
    gate = json.loads((record / "parity-gate.stdout").read_text())
    if gate["declarations"] != 51980 or gate["translation_attempts"] != 0 or gate["parity_gate_passed"]:
        return "parity baseline changed"
    return None


if __name__ == "__main__":
    try:
        failure = verify()
    except (OSError, ValueError, KeyError, TypeError) as error:
        failure = str(error)
    if failure:
        print(f"Declaration validation record: {failure}", file=sys.stderr)
        sys.exit(1)
    print("Declaration validation record: source and capture hashes match; six checks verified.")
