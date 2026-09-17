#!/usr/bin/env python3
"""Regression tests for the frozen M2 denominator and its open baseline."""

import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


SPEC = importlib.util.spec_from_file_location("m2_parity", Path(__file__).with_name("m2-parity.py"))
m2 = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m2)


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "meta").mkdir()
        (self.root / "meta/lean-toolchain").write_text("leanprover/lean4:v4.33.0-rc1\n")
        (self.root / "meta/ExportInit.lean").write_text("-- test exporter\n")
        self.directory = self.root / "baseline"
        self.directory.mkdir()
        self.value = m2.inventory({
            "schema": 1, "root": "Init", "import_level": "exported",
            "modules": ["Init.Prelude", "Init"],
            "declarations": [
                {"name": name, "module": "Init.Prelude", "kind": kind,
                 "levels": levels, "private": private}
                for name, kind, levels, private in [
                    ("Nat", "inductive", [], False),
                    ("Nat.zero", "constructor", [], False),
                    ("Nat.rec", "recursor", ["u"], False),
                    ("_private.Init.Prelude.0.hidden", "definition", [], True),
                ]
            ],
        })
        self.pin = {
            "schema": 1, "toolchain": "leanprover/lean4:v4.33.0-rc1",
            "lean_version": "Lean test fixture",
            "exporter_sha256": m2.digest((self.root / "meta/ExportInit.lean").read_bytes()),
            "inventory_sha256": m2.digest(m2.inventory_bytes(self.value)),
            "declarations": 4,
            "module_oleans": {"lib/lean/Init.olean": "a" * 64,
                              "lib/lean/Init/Prelude.olean": "b" * 64},
        }
        self.report = m2.baseline(self.value, self.pin["inventory_sha256"])
        self.write()

    def write(self):
        (self.directory / "inventory.jsonl").write_bytes(m2.inventory_bytes(self.value))
        (self.directory / "pin.json").write_bytes(m2.encoded(self.pin))
        (self.directory / "baseline.json").write_bytes(m2.encoded(self.report))

    def verify(self, **kwargs):
        return m2.verify(self.directory, self.root, **kwargs)

    def test_every_kind_and_private_name_stays_in_denominator(self):
        value, pin, report = self.verify()
        self.assertEqual(report["denominator"], 4)
        self.assertIn("_private.Init.Prelude.0.hidden", report["translation_gap"]["names"])
        self.assertEqual(report["kernel_rechecks"], 0)
        self.assertEqual(report["translation_attempts"], 0)
        self.assertEqual(m2.summary(value, pin, report), {
            "toolchain": "leanprover/lean4:v4.33.0-rc1",
            "inventory_sha256": self.pin["inventory_sha256"],
            "modules": 2,
            "declarations": 4,
            "exported_kinds": {"constructor": 1, "definition": 1,
                               "inductive": 1, "recursor": 1},
            "translation_attempts": 0,
            "kernel_rechecks": 0,
            "translation_gaps": 4,
            "parity_percent": 0,
            "parity_gate_passed": False,
        })

    def test_duplicate_name_and_empty_denominator_are_rejected(self):
        for rows in ([], self.value["declarations"] * 2):
            with self.subTest(rows=len(rows)), self.assertRaises(m2.InventoryError):
                m2.inventory({**self.value, "declarations": rows})

    def test_fresh_init_scope_is_required(self):
        for changes in ({"root": "Lean"}, {"import_level": "private"},
                        {"schema": True}, {"modules": []},
                        {"modules": ["Init", "Lean.Environment"]},
                        {"modules": ["Init", "Init/../../Lean"]},
                        {"modules": ["Init", "Init"]}):
            with self.subTest(changes=changes), self.assertRaises(m2.InventoryError):
                m2.inventory({**self.value, **changes})
        with self.subTest(changes="root module absent"), \
                self.assertRaisesRegex(m2.InventoryError, "outside Init"):
            m2.inventory({**self.value, "modules": ["Init.Prelude"]})

    def test_declaration_metadata_is_validated(self):
        for changes in ({"name": ""}, {"module": "Lean"}, {"kind": "unknown"},
                        {"levels": ["u", "u"]}, {"private": 0}, {"unexpected": 1}):
            value = copy.deepcopy(self.value)
            value["declarations"][0].update(changes)
            with self.subTest(changes=changes), self.assertRaises(m2.InventoryError):
                m2.inventory(value)

    def test_dropped_name_cannot_keep_old_fingerprint(self):
        self.value["declarations"].pop()
        self.write()
        with self.assertRaisesRegex(m2.InventoryError, "fingerprint"):
            self.verify()

    def test_rehashed_inventory_cannot_keep_old_denominator(self):
        self.value["declarations"].pop()
        self.pin["inventory_sha256"] = m2.digest(m2.inventory_bytes(self.value))
        self.write()
        with self.assertRaisesRegex(m2.InventoryError, "denominator"):
            self.verify()

    def test_report_cannot_drop_duplicate_or_add_a_name(self):
        original = self.report["translation_gap"]["names"]
        for names in (original[:-1], original + [original[0]], original + ["Bogus"]):
            self.report["translation_gap"]["names"] = names
            self.write()
            with self.subTest(names=names), self.assertRaisesRegex(m2.InventoryError, "every declaration"):
                self.verify()

    def test_baseline_cannot_claim_success_or_attempts(self):
        original = copy.deepcopy(self.report)
        for field, value in (("successes", 1), ("parity_percent", 95),
                             ("parity_gate_passed", True), ("unclassified", 1),
                             ("translation_attempts", 1), ("kernel_rechecks", 1),
                             ("required_percent", 0), ("schema", True)):
            self.report = {**original, field: value}
            self.write()
            with self.subTest(field=field), self.assertRaises(m2.InventoryError):
                self.verify()

    def test_baseline_cannot_relabel_unsupported_names_as_kernel_bugs(self):
        self.report["translation_gap"]["reason"] = "kernel bug"
        self.write()
        with self.assertRaises(m2.InventoryError):
            self.verify()

    def test_source_and_toolchain_pins_are_checked(self):
        for name in ("ExportInit.lean", "lean-toolchain"):
            path = self.root / "meta" / name
            before = path.read_bytes()
            path.write_bytes(before + b"changed\n")
            with self.subTest(name=name), self.assertRaises(m2.InventoryError):
                self.verify()
            path.write_bytes(before)
        banner = self.pin["lean_version"]
        for value in ("", 1):
            self.pin["lean_version"] = value
            self.write()
            with self.subTest(lean_version=value), \
                    self.assertRaisesRegex(m2.InventoryError, "Lean version"):
                self.verify()
        self.pin["lean_version"] = banner
        self.write()

    def test_module_artifact_set_and_hash_shape_are_checked(self):
        original = copy.deepcopy(self.pin["module_oleans"])
        for artifacts in ({}, {**original, "lib/lean/Lean.olean": "c" * 64},
                          {**original, "lib/lean/Init.olean": "bad"}):
            self.pin["module_oleans"] = artifacts
            self.write()
            with self.subTest(artifacts=artifacts), self.assertRaises(m2.InventoryError):
                self.verify()

    def test_noncanonical_order_is_rejected(self):
        path = self.directory / "inventory.jsonl"
        lines = path.read_bytes().splitlines(keepends=True)
        path.write_bytes(lines[0] + b"".join(reversed(lines[1:])))
        with self.assertRaisesRegex(m2.InventoryError, "canonical order"):
            self.verify()

    def test_duplicate_json_keys_are_rejected(self):
        with self.assertRaisesRegex(m2.InventoryError, "duplicate JSON key"):
            m2.decoded(b'{"successes":0,"successes":51980}')

    def test_live_comparison_rejects_self_consistent_smaller_inventory(self):
        full = copy.deepcopy(self.value)
        pin = copy.deepcopy(self.pin)
        self.value["declarations"].pop()
        self.pin["inventory_sha256"] = m2.digest(m2.inventory_bytes(self.value))
        self.pin["declarations"] = 3
        self.report = m2.baseline(self.value, self.pin["inventory_sha256"])
        self.write()
        self.verify()  # Offline integrity cannot establish the original denominator.
        with mock.patch.object(m2, "export", return_value=(full, pin)):
            with self.assertRaisesRegex(m2.InventoryError, "live Init"):
                self.verify(live=True)

    def test_live_comparison_rejects_changed_olean_with_same_names(self):
        pin = copy.deepcopy(self.pin)
        pin["module_oleans"]["lib/lean/Init.olean"] = "c" * 64
        with mock.patch.object(m2, "export", return_value=(self.value, pin)):
            with self.assertRaisesRegex(m2.InventoryError, "live Lean artifacts"):
                self.verify(live=True)

    def test_snapshot_refuses_overwrite_and_leaves_no_failed_snapshot(self):
        with mock.patch.object(m2, "export", side_effect=m2.InventoryError("export failed")) as exporter:
            with self.assertRaisesRegex(m2.InventoryError, "already exists"):
                m2.snapshot(self.directory, self.root)
            exporter.assert_not_called()
            with self.assertRaisesRegex(m2.InventoryError, "export failed"):
                m2.snapshot(self.root / "new", self.root)
            self.assertFalse((self.root / "new").exists())

    def test_snapshot_writes_a_verifiable_record(self):
        with mock.patch.object(m2, "export", return_value=(self.value, self.pin)):
            result = m2.snapshot(self.root / "new", self.root)
        self.assertEqual(result, m2.verify(self.root / "new", self.root))
        inconsistent = {**self.pin, "declarations": self.pin["declarations"] - 1}
        with mock.patch.object(m2, "export", return_value=(self.value, inconsistent)):
            with self.assertRaisesRegex(m2.InventoryError, "denominator changed"):
                m2.snapshot(self.root / "unverified", self.root)
        self.assertFalse((self.root / "unverified").exists())

    def test_export_scrubs_search_paths_and_uses_exact_toolchain(self):
        for name in self.pin["module_oleans"]:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"test olean")
        responses = [str(self.root).encode(), b"Lean fixture", m2.encoded(self.value)]
        with mock.patch.dict(os.environ, {"LEAN_PATH": "/shadow", "LEAN_SRC_PATH": "/shadow"}):
            with mock.patch.object(m2, "command", side_effect=responses) as runner:
                value, pin = m2.export(self.root)
        self.assertEqual(value, self.value)
        self.assertEqual(pin["module_oleans"]["lib/lean/Init.olean"], m2.digest(b"test olean"))
        for call in runner.call_args_list:
            argv, cwd, env = call.args
            self.assertEqual(argv[:4], ["elan", "run", "leanprover/lean4:v4.33.0-rc1", "lean"])
            self.assertEqual(cwd, self.root / "meta")
            self.assertNotIn("LEAN_PATH", env)
            self.assertNotIn("LEAN_SRC_PATH", env)

    def test_export_failures_are_not_accepted_as_empty_inventories(self):
        for code, stdout, stderr in ((1, b"{}", b"failed"), (-9, b"", b""),
                                      (0, b"{}", b"warning")):
            result = subprocess.CompletedProcess(["lean"], code, stdout, stderr)
            with mock.patch.object(m2.subprocess, "run", return_value=result):
                with self.subTest(code=code), self.assertRaises(m2.InventoryError):
                    m2.command(["lean"], self.root, {})


class PinnedIntegrationTests(unittest.TestCase):
    def test_committed_inventory_and_baseline(self):
        value, pin, report = m2.verify(m2.ROOT / "dev/m2-init")
        names = set(report["translation_gap"]["names"])
        self.assertEqual(len(names), 51980)
        self.assertEqual(len(value["modules"]), 628)
        self.assertTrue({"Nat", "Nat.add", "Quot.sound", "Classical.choice"} <= names)
        self.assertNotIn("Lean.Environment", names)
        self.assertTrue(any(row["private"] for row in value["declarations"]))
        self.assertEqual(pin["inventory_sha256"],
                         "80dd1223088490394b6177e7b5fb8aa9e43b57799b9c8fa70504a2d4eb6e0cf4")

    def test_cli_distinguishes_integrity_success_open_gate_and_error(self):
        for args, status in ((["verify"], 0), (["gate"], 1),
                             (["verify", "--inventory", "/nonexistent/veil-m2"], 2)):
            completed = subprocess.run([sys.executable, "-I", str(m2.ROOT / "dev/m2-parity.py"), *args],
                                       capture_output=True, timeout=30, check=False)
            with self.subTest(args=args):
                self.assertEqual(completed.returncode, status, completed.stderr)
                if status < 2:
                    printed = json.loads(completed.stdout)
                    self.assertFalse(printed["parity_gate_passed"])
                    self.assertEqual(printed["declarations"], 51980)
                    self.assertEqual(printed["translation_gaps"], 51980)
                else:
                    self.assertIn(b"M2 inventory:", completed.stderr)


if __name__ == "__main__":
    unittest.main()
