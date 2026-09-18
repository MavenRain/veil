#!/usr/bin/env python3
"""Verify the let-headed application record and its source bindings."""

import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys

RECORD = Path(__file__).resolve().parent
ROOT = RECORD.parents[2]
SPEC = importlib.util.spec_from_file_location("translation", ROOT / "dev/m2-translate.py")
translation = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(translation)
BASE = "d32b81208d4c9283e38f3d940f790939ab9d2e61"
WORKSPACE = "/Users/oobi/Documents/gpt3/veil-m2-let"
CHECKER_SHA256 = "ba114dff6ab0e6f38753321393c0502c76b4937ff9896989ee962498e94a4ed0"
COMMANDS = {
    "translation-tests": (["python3", "-I", "dev/m2-translate-test.py", "--live"], 0),
    "declaration-tests": (["python3", "-I", "dev/m2-declarations-test.py"], 0),
    "record": (["python3", "-I", "dev/m2-translate.py", "record", "--output",
                ".kanon-exec/m2-translation-let-candidate"], 0),
    "live": (["python3", "-I", "dev/m2-translate.py", "verify", "--live"], 0),
    "house": (["zsh", "dev/house.sh"], 0),
    "trusted-lines": (["zsh", "dev/trusted-lines.sh"], 0),
    "parity-gate": (["python3", "-I", "dev/m2-parity.py", "gate"], 1),
}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sources():
    paths = set(translation.source_hashes(ROOT))
    paths.update(("README.md", "dev/M2-BUILD-LOG.md", "dev/M2-READINESS.md", "dev/M2-PARITY.md",
                  "dev/M2-DECLARATIONS.md", "dev/M2-TRANSLATION.md", "dev/m2-translate-test.py",
                  "dev/m2-declarations-test.py", "dev/house.sh", "dev/house-catchalls.py",
                  "dev/trusted-lines.sh"))
    paths.update(str(path.relative_to(ROOT))
                 for directory in ("dev/m2-init", "dev/m2-declarations", "dev/m2-translation")
                 for path in (ROOT / directory).iterdir() if path.is_file())
    paths.update(str(path.relative_to(ROOT)) for path in (ROOT / "test").iterdir()
                 if path.is_file() and path.suffix == ".ml")
    paths.update(str((RECORD / name).relative_to(ROOT)) for name in ("README.md", "verify.py"))
    return sorted(paths)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def verify():
    results = json.loads((RECORD / "results.json").read_text())
    review = results.get("review", {})
    require(set(results) - {"review"} == {"base", "workspace", "checks", "sources"},
            "unexpected record schema")
    require(isinstance(review, dict)
            and all(isinstance(name, str) and isinstance(value, str)
                    for name, value in review.items()), "invalid review block")
    for name, expected in review.items():
        require(sha(RECORD / name) == expected, f"review hash changed: {name}")
    require(results["base"] == BASE, "base changed")
    require(results["workspace"] == WORKSPACE, "workspace changed")
    require(set(results["sources"]) == set(sources()), "source set changed")
    for name, expected in results["sources"].items():
        require(sha(ROOT / name) == expected, f"source hash changed: {name}")
    require(set(results["checks"]) == set(COMMANDS), "capture set changed")
    expected_files = {"README.md", "results.json", "verify.py"} | set(review)
    for label, (argv, expected_exit) in COMMANDS.items():
        check = results["checks"][label]
        require(set(check) == {"argv", "expected_exit_code", "sha256"}, "invalid capture schema")
        require(check["argv"] == argv and type(check["expected_exit_code"]) is int
                and check["expected_exit_code"] == expected_exit, f"check changed: {label}")
        require(set(check["sha256"]) == {"json", "stdout", "stderr"}, "capture stream set changed")
        for suffix, expected in check["sha256"].items():
            filename = f"{label}.{suffix}"
            expected_files.add(filename)
            require(sha(RECORD / filename) == expected, f"capture hash changed: {filename}")
        manifest = json.loads((RECORD / f"{label}.json").read_text())
        require(manifest["status"] == "complete" and type(manifest["exitCode"]) is int
                and manifest["exitCode"] == expected_exit and len(manifest["commands"]) == 1,
                f"incomplete capture: {label}")
        command = manifest["commands"][0]
        require(command["argv"] == argv and command["cwd"] == WORKSPACE
                and type(command["exitCode"]) is int and command["exitCode"] == expected_exit
                and type(command["signal"]) is int and command["signal"] == 0
                and command["timedOut"] is False and command["spawnError"] == "",
                f"capture command failed or changed: {label}")
        for stream in ("stdout", "stderr"):
            content = (RECORD / f"{label}.{stream}").read_bytes()
            require(command[stream]["bytes"] == len(content), f"capture byte count changed: {label}")
    paths = list(RECORD.iterdir())
    require({path.name for path in paths} == expected_files
            and all(path.is_file() and not path.is_symlink() for path in paths), "record file set changed")
    sample = translation.verify(ROOT / "dev/m2-translation", ROOT / "dev/m2-declarations", ROOT / "dev/m2-init")
    summary = {"snapshot_declarations": 44, "rechecked": 5, "translation_gaps": 39, "parity_credited": 0}
    require(sample["summary"] == summary, "sample summary changed")
    require(sample["checker_sha256"] == CHECKER_SHA256,
            "reused checker fingerprint pin changed")
    for label in ("record", "live"):
        require(json.loads((RECORD / f"{label}.stdout").read_text()) == summary, f"{label} summary changed")
    for label, total, ending in (("translation-tests", 48, "OK\n"),
                                  ("declaration-tests", 32, "OK (skipped=2)\n")):
        text = (RECORD / f"{label}.stderr").read_text()
        require(re.search(rf"\nRan {total} tests in [0-9.]+s\n", text) is not None
                and text.endswith(ending), f"test verdict changed: {label}")
    require((RECORD / "house.stdout").read_text().endswith("HOUSE OK\n"), "house verdict changed")
    require((RECORD / "trusted-lines.stdout").read_text() ==
            "TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK\n", "trusted lines changed")
    gate = json.loads((RECORD / "parity-gate.stdout").read_text())
    require(gate["declarations"] == 51980 and gate["translation_attempts"] == 0
            and gate["kernel_rechecks"] == 0 and gate["parity_gate_passed"] is False, "parity baseline changed")
    return "Let-headed application validation: seven captures, source hashes and five sample rechecks verified."


if __name__ == "__main__":
    try:
        print(verify())
    except (translation.parity.InventoryError, OSError, ValueError, KeyError, TypeError) as error:
        print(f"Let-headed application validation: {error}", file=sys.stderr)
        sys.exit(1)
