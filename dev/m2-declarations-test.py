#!/usr/bin/env python3
"""Regression checks for declaration provenance, closed expressions and dependencies."""

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

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("declarations", ROOT / "dev/m2-declarations.py")
declarations = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(declarations)
LIVE = "--live" in sys.argv
if LIVE:
    sys.argv.remove("--live")


class DeclarationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inventory, _, _ = declarations.parity.verify(ROOT / "dev/m2-init", ROOT)
        cls.original = declarations.decoded((ROOT / "dev/m2-declarations/declarations.json").read_bytes())
        cls.pin = declarations.decoded((ROOT / "dev/m2-declarations/pin.json").read_bytes())

    def setUp(self):
        self.value = copy.deepcopy(self.original)

    def row(self, name):
        return next(row for row in self.value["declarations"] if row["name"] == name)

    def rejects(self, reason):
        with self.assertRaisesRegex(declarations.parity.InventoryError, reason):
            declarations.validate(self.value, self.inventory)

    def test_snapshot_has_real_bodies_and_actual_axioms(self):
        declarations.verify(ROOT / "dev/m2-declarations", ROOT / "dev/m2-init")
        self.assertEqual(len(self.value["declarations"]), 44)
        self.assertEqual(self.row("Nat.add_zero")["kind"], "theorem")
        self.assertIsNotNone(self.row("Nat.add_zero")["value"])
        self.assertEqual(declarations.summary(self.value, self.pin)["axioms_in_closure"],
                         ["Classical.choice", "Quot.sound", "propext"])
        self.assertFalse(declarations.summary(self.value, self.pin)["translation_attempted"])
        self.assertEqual(declarations.summary(self.value, self.pin)["veil_kernel_rechecks"], 0)

    def test_complete_private_module_provenance(self):
        self.assertEqual(len(self.value["modules"]), 631)
        self.assertEqual(len(self.pin["module_artifacts"]), 3 * 631)
        self.assertEqual(len(self.inventory["declarations"]), 51980)
        self.assertEqual(len(self.inventory["modules"]), 628)

    def test_missing_definition_and_proof_bodies(self):
        for name in ("id", "Nat.add_zero"):
            with self.subTest(name=name):
                self.value = copy.deepcopy(self.original)
                self.row(name)["value"] = None
                self.rejects("missing declaration body")

    def test_unknown_forms_and_schema_fields(self):
        for tag in ("fvar", "mvar", "mdata", "unrecognized"):
            with self.subTest(tag=tag):
                self.value = copy.deepcopy(self.original)
                self.row("id")["nodes"][0] = [tag, "x"]
                self.rejects("unknown expression form")
        self.value = copy.deepcopy(self.original)
        self.value["translation_successes"] = 1
        self.rejects("invalid export fields")

    def test_forward_reference_and_cycle(self):
        self.row("id")["nodes"][0] = ["app", 0, 0]
        self.rejects("forward reference or cycle")

    def test_boolean_is_not_a_node_index(self):
        self.row("id")["type"] = True
        self.rejects("invalid expression root")

    def test_loose_bound_variable(self):
        node = next(node for node in self.row("id")["nodes"] if node[0] == "bvar")
        node[1] = 10000
        self.rejects("loose bound variable")

    def test_unreachable_node(self):
        self.row("id")["nodes"].append(["sort", ["zero"]])
        self.rejects("unreachable expression nodes")

    def test_undeclared_and_metavariable_universes(self):
        for universe in (["param", "missing"], ["mvar", "u"]):
            with self.subTest(universe=universe):
                self.value = copy.deepcopy(self.original)
                node = next(node for node in self.row("id")["nodes"] if node[0] == "sort")
                node[1] = universe
                self.rejects("undeclared universe|unknown universe")

    def test_constant_universe_arity(self):
        node = next(node for row in self.value["declarations"] for node in row["nodes"] if node[0] == "const")
        node[2].append(["zero"])
        self.rejects("constant universe arity")

    def test_dependency_list_is_derived(self):
        self.row("Nat.add_zero")["dependencies"] = []
        self.rejects("dependency list differs")

    def test_missing_dependency_declaration(self):
        self.value["declarations"] = [row for row in self.value["declarations"] if row["name"] != "Nat"]
        self.rejects("missing dependency")

    def test_duplicate_declaration(self):
        self.value["declarations"].append(copy.deepcopy(self.value["declarations"][-1]))
        self.rejects("duplicate or unsorted")

    def test_requested_name_must_belong_to_denominator(self):
        self.value["requested"] = ["Invented.name"]
        self.rejects("outside the pinned denominator")

    def test_missing_requested_name(self):
        self.value["declarations"] = [row for row in self.value["declarations"] if row["name"] != "id"]
        self.rejects("requested declaration is missing")

    def test_unrelated_declaration(self):
        self.value["requested"].remove("id")
        self.rejects("unrelated declaration")

    def test_module_scope(self):
        self.value["modules"].append("Lean")
        self.rejects("private module set")

    def test_owner_is_pinned(self):
        self.row("id")["module"] = "Init"
        self.rejects("metadata differs")
        self.value = copy.deepcopy(self.original)
        row = self.row("id")
        row["kind"] = "theorem"
        row["details"] = {"mutual": ["id"]}
        self.rejects("declaration kind changed")

    def test_constructor_index(self):
        self.row("Nat.zero")["details"]["index"] = 7
        self.rejects("constructor metadata differs")
        # A constructor that no inductive of the closure lists is caught only
        # by the owner check of the constructor branch.
        self.value = copy.deepcopy(self.original)
        self.row("True")["details"]["constructors"] = []
        self.row("True")["dependencies"] = ["True"]
        self.row("True.intro")["details"]["inductive"] = "Iff"
        self.row("True.intro")["dependencies"] = ["Iff", "True"]
        self.rejects("constructor is absent")

    def test_recursor_fields(self):
        self.row("Nat.rec")["details"]["rules"][0]["fields"] += 1
        self.rejects("recursor constructor metadata differs")

    def test_projection_bounds(self):
        node = next(node for row in self.value["declarations"] for node in row["nodes"] if node[0] == "proj")
        node[2] = 9999
        self.rejects("projection field is out of range")

    def test_literals_are_exact_and_bring_type_dependencies(self):
        row = {"name": "fixture", "module": "Init", "kind": "definition", "levels": [], "private": False,
               "type": 0, "value": 1, "details": {"safety": "safe", "hints": ["abbrev"], "mutual": []},
               "nodes": [["const", "Nat", []], ["nat", str(2**100)]], "dependencies": ["Nat"]}
        declarations.declaration(row, ["Init"])
        for literal in (42, "01", "-1", "1.0"):
            row["nodes"][1][1] = literal
            with self.assertRaisesRegex(declarations.parity.InventoryError, "exact natural literal"):
                declarations.declaration(row, ["Init"])
        row["nodes"] = [["sort", ["zero"]], ["string", "λ\n雪"]]
        row["dependencies"] = ["String"]
        declarations.declaration(row, ["Init"])
        row["dependencies"] = []
        with self.assertRaisesRegex(declarations.parity.InventoryError, "dependency list differs"):
            declarations.declaration(row, ["Init"])

    def write(self, directory, value=None, pin=None):
        (directory / "declarations.json").write_bytes(declarations.encoded(self.value if value is None else value))
        (directory / "pin.json").write_bytes(declarations.encoded(self.pin if pin is None else pin))

    def test_changed_body_and_source_pins(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            self.value["requested"].reverse()
            self.write(path)
            with self.assertRaises(declarations.parity.InventoryError):
                declarations.verify(path, ROOT / "dev/m2-init")
            pin = copy.deepcopy(self.pin)
            pin["source_sha256"]["meta/ExportDeclarations.lean"] = "0" * 64
            self.write(path, self.original, pin)
            with self.assertRaisesRegex(declarations.parity.InventoryError, "source changed"):
                declarations.verify(path, ROOT / "dev/m2-init")
            for field, replacement, reason in (
                    ("declarations_sha256", "0" * 64, "declaration fingerprint changed"),
                    ("declarations", len(self.original["declarations"]) + 1, "closure count changed"),
                    ("inventory_sha256", "0" * 64, "changed inventory_sha256 pin"),
                    ("toolchain", "leanprover/lean4:fixture", "changed toolchain pin"),
                    ("lean_version", "fixture", "changed lean_version pin")):
                with self.subTest(field=field):
                    pin = copy.deepcopy(self.pin)
                    pin[field] = replacement
                    self.write(path, self.original, pin)
                    with self.assertRaisesRegex(declarations.parity.InventoryError, reason):
                        declarations.verify(path, ROOT / "dev/m2-init")
            # A stored snapshot must be canonical bytes, not reformatted JSON.
            (path / "declarations.json").write_bytes(json.dumps(self.original, indent=1).encode())
            (path / "pin.json").write_bytes(declarations.encoded(self.pin))
            with self.assertRaisesRegex(declarations.parity.InventoryError, "noncanonical"):
                declarations.verify(path, ROOT / "dev/m2-init")

    def test_missing_private_artifact_pin(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            pin = copy.deepcopy(self.pin)
            del pin["module_artifacts"]["lib/lean/Init/Prelude.olean.private"]
            self.write(path, pin=pin)
            with self.assertRaisesRegex(declarations.parity.InventoryError, "artifact set changed"):
                declarations.verify(path, ROOT / "dev/m2-init")
            pin = copy.deepcopy(self.pin)
            pin["module_artifacts"]["lib/lean/Init/Prelude.olean"] = "0" * 64
            self.write(path, pin=pin)
            with self.assertRaisesRegex(declarations.parity.InventoryError,
                                        "exported module fingerprint differs"):
                declarations.verify(path, ROOT / "dev/m2-init")

    def test_live_reproduction_rejects_self_consistent_rewrite(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            node = next(node for node in self.row("id")["nodes"] if node[0] == "lam")
            node[1] = "changedBinder"
            pin = copy.deepcopy(self.pin)
            pin["declarations_sha256"] = declarations.digest(declarations.encoded(self.value))
            self.write(path, pin=pin)
            declarations.verify(path, ROOT / "dev/m2-init")
            with mock.patch.object(declarations, "export", return_value=(self.original, self.pin)):
                with self.assertRaisesRegex(declarations.parity.InventoryError, "live declaration export differs"):
                    declarations.verify(path, ROOT / "dev/m2-init", live=True)

    def test_failed_export_and_existing_destination_do_not_publish(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "snapshot"
            with mock.patch.object(declarations, "export", side_effect=declarations.parity.InventoryError("failed")):
                with self.assertRaisesRegex(declarations.parity.InventoryError, "failed"):
                    declarations.snapshot(destination, ["id"], ROOT / "dev/m2-init")
            self.assertFalse(destination.exists())
            destination.mkdir()
            marker = destination / "retain"
            marker.write_text("user data")
            with mock.patch.object(declarations, "export") as export:
                with self.assertRaisesRegex(declarations.parity.InventoryError, "already exists"):
                    declarations.snapshot(destination, ["id"], ROOT / "dev/m2-init")
                export.assert_not_called()
            self.assertEqual(marker.read_text(), "user data")

    def test_duplicate_json_keys(self):
        with self.assertRaisesRegex(declarations.parity.InventoryError, "duplicate JSON"):
            declarations.decoded('{"schema":1,"schema":1}')

    def test_malformed_exporter_output_is_rejected(self):
        for value in (None, {}, {**self.original, "declarations": None},
                      {**self.original, "declarations": [{}]},
                      {**self.original, "modules": ["Init", "Init"]}):
            with self.subTest(value=type(value).__name__):
                with self.assertRaises(declarations.parity.InventoryError):
                    declarations.normalize(value)

    def test_export_pins_private_data_and_scrubs_search_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            sysroot = Path(temporary)
            lib = sysroot / "lib/lean"
            lib.mkdir(parents=True)
            (lib / "Init.olean").write_bytes(b"exported")
            private = lib / "Init.olean.private"
            private.write_bytes(b"private proof body")
            row = copy.deepcopy(self.row("id"))
            row["module"] = "Init"
            raw = {**self.original, "modules": ["Init"], "requested": ["id"], "declarations": [row]}
            inventory = {"modules": ["Init"], "declarations": [
                {key: row[key] for key in ("name", "module", "kind", "levels", "private")}]}
            inventory_pin = {"toolchain": "leanprover/lean4:v4.33.0-rc1", "lean_version": "fixture",
                             "inventory_sha256": "1" * 64, "module_oleans": {
                                 "lib/lean/Init.olean": declarations.digest(b"exported")}}

            def command(argv, cwd, env):
                self.assertNotIn("LEAN_PATH", env)
                self.assertNotIn("LEAN_SRC_PATH", env)
                self.assertNotIn("LEAN_SYSROOT", env)
                self.assertEqual(argv[:4], ["elan", "run", inventory_pin["toolchain"], "lean"])
                if argv[-1] == "--print-prefix":
                    return str(sysroot).encode()
                self.assertEqual(argv[4:], ["--run", "ExportDeclarations.lean", "id"])
                return declarations.encoded(raw)

            with mock.patch.object(declarations.parity, "verify", return_value=(inventory, inventory_pin, {})), \
                    mock.patch.object(declarations.parity, "command", side_effect=command), \
                    mock.patch.dict(os.environ, {"LEAN_PATH": "substitute", "LEAN_SRC_PATH": "substitute",
                                                 "LEAN_SYSROOT": "substitute"}):
                _, pin = declarations.export(["id"], ROOT / "dev/m2-init")
            self.assertEqual(pin["module_artifacts"]["lib/lean/Init.olean.private"],
                             declarations.digest(private.read_bytes()))
            self.assertIsNone(pin["module_artifacts"]["lib/lean/Init.olean.server"])

            def change_artifact(argv, cwd, env):
                result = command(argv, cwd, env)
                if "--run" in argv:
                    private.write_bytes(b"changed during export")
                return result

            with mock.patch.object(declarations.parity, "verify", return_value=(inventory, inventory_pin, {})), \
                    mock.patch.object(declarations.parity, "command", side_effect=change_artifact):
                with self.assertRaisesRegex(declarations.parity.InventoryError, "artifact changed during export"):
                    declarations.export(["id"], ROOT / "dev/m2-init")

            def refuse_run(argv, cwd, env):
                self.assertNotIn("--run", argv)
                return command(argv, cwd, env)

            altered = copy.deepcopy(inventory_pin)
            altered["module_oleans"]["lib/lean/Init.olean"] = "0" * 64
            with mock.patch.object(declarations.parity, "verify", return_value=(inventory, altered, {})), \
                    mock.patch.object(declarations.parity, "command", side_effect=refuse_run):
                with self.assertRaisesRegex(declarations.parity.InventoryError,
                                            "exported module artifact changed"):
                    declarations.export(["id"], ROOT / "dev/m2-init")

    def test_cli_status(self):
        for args, expected in ((["verify"], 0), (["verify", "--snapshot", "/nonexistent/veil-snapshot"], 2)):
            completed = subprocess.run([sys.executable, "-I", str(ROOT / "dev/m2-declarations.py"), *args],
                                       capture_output=True, text=True, timeout=30)
            self.assertEqual(completed.returncode, expected, completed.stdout + completed.stderr)


@unittest.skipUnless(LIVE, "pass --live to elaborate the codec cases and reproduce the snapshot")
class LiveTests(unittest.TestCase):
    def test_snapshot_reproduces(self):
        declarations.verify(ROOT / "dev/m2-declarations", ROOT / "dev/m2-init", live=True)

    def test_lean_expression_codec(self):
        source = (ROOT / "meta/ExportDeclarations.lean").read_text()
        source += "\n" + (ROOT / "meta/test/DeclarationExportCases.lean").read_text()
        env = os.environ.copy()
        env.pop("LEAN_PATH", None)
        env.pop("LEAN_SRC_PATH", None)
        env.pop("LEAN_SYSROOT", None)
        toolchain = (ROOT / "meta/lean-toolchain").read_text().strip()
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "CodecCases.lean"
            path.write_text(source)
            raw = declarations.parity.command(["elan", "run", toolchain, "lean", str(path)], ROOT / "meta", env)
        result = json.loads(raw)
        flags = {key: value for key, value in result.items() if key not in {"nodes", "references"}}
        self.assertEqual(len(flags), 8)
        self.assertTrue(all(value is True for value in flags.values()), flags)
        self.assertEqual({node[0] for node in result["nodes"]},
                         {"bvar", "sort", "const", "app", "lam", "forall", "let", "nat", "string", "proj"})
        self.assertIn(["nat", str(2**100)], result["nodes"])
        self.assertIn(["string", "λ\n雪"], result["nodes"])
        self.assertTrue({"Nat", "String"} <= set(result["references"]))


if __name__ == "__main__":
    unittest.main()
