#!/usr/bin/env python3
"""Translation, refusal, artifact integrity and real kernel regression checks."""

import copy
import importlib.util
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("translate", ROOT / "dev/m2-translate.py")
translate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(translate)
LIVE = "--live" in sys.argv
if LIVE:
    sys.argv.remove("--live")
SNAPSHOT = ROOT / "dev/m2-declarations"
INVENTORY = ROOT / "dev/m2-init"
CHECKER = ROOT / "_build/default/bin/kanon.exe"
IntegrityError = translate.parity.InventoryError


def definition(name, nodes, ty, body, dependencies):
    return {"name": name, "kind": "definition", "module": "Init.Prelude", "levels": [],
            "private": False, "type": ty, "value": body, "nodes": nodes,
            "details": {"safety": "safe", "hints": ["regular", 1], "mutual": [name]},
            "dependencies": sorted({name, *dependencies})}


def identity(name="identity"):
    return definition(name, [["const", "Nat", []], ["bvar", 0],
                            ["forall", "same", "implicit", 0, 0],
                            ["lam", "same", "implicit", 0, 1]], 2, 3, ["Nat"])


class TranslationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original = translate.decoded((SNAPSHOT / "declarations.json").read_bytes())
        cls.pinned_inputs = translate.inputs(SNAPSHOT, INVENTORY, ROOT)

    def setUp(self):
        self.value = copy.deepcopy(self.original)

    def row(self, name):
        return next(row for row in self.value["declarations"] if row["name"] == name)

    def synthetic(self, *rows):
        # Exercise structurally validated declarations without presenting these
        # synthetic rows as exports from Lean's pinned Init environment.
        for row in rows:
            translate.declarations.declaration(row, self.value["modules"])
            self.value["declarations"].append(row)
        return translate.Translator(self.value)

    def rejects(self, name, reason):
        with self.assertRaisesRegex(translate.Gap, reason):
            translate.Translator(self.value).compile(name)

    def test_sample_covers_every_name_and_shares_family_artifact(self):
        rows, artifacts, provenance = self.pinned_inputs
        self.assertEqual(len(rows), 44)
        self.assertEqual(provenance["inventory_declarations"], 51980)
        self.assertEqual([r["name"] for r in rows if r["artifact"]], ["Nat", "Nat.succ", "Nat.zero"])
        self.assertEqual(len(artifacts), 1)
        self.assertEqual(len({r["artifact"] for r in rows if r["artifact"]}), 1)
        self.assertTrue(all(r["reason"] for r in rows if not r["artifact"]))
        self.assertEqual(next(iter(artifacts.values()))["declarations"], ["Nat", "Nat.succ", "Nat.zero"])

    def test_order_independent_and_injective_names(self):
        expected = translate.Translator(self.value).plan()
        self.value["declarations"].reverse()
        self.assertEqual(translate.Translator(self.value).plan(), expected)
        names = ["Nat", "Nat.zero", "Nat_zero", "Type", "b0", "v4e6174", "α", "\" --"]
        self.assertEqual(len({translate.symbol(n) for n in names}), len(names))
        for name in names:
            self.assertRegex(translate.symbol(name), r"^v[0-9a-f]+$")

    def test_closed_universe_max_and_imax(self):
        zero, one = ["zero"], ["succ", ["zero"]]
        self.assertEqual(translate.closed_level(["max", one, zero]), 1)
        self.assertEqual(translate.closed_level(["imax", one, zero]), 0)
        self.assertEqual(translate.closed_level(["imax", zero, one]), 1)
        with self.assertRaisesRegex(translate.Gap, "prenex"):
            translate.closed_level(["param", "u"])

    def test_polymorphic_prop_quotient_axiom_and_recursor_gaps(self):
        for name, reason in (("id", "prenex"), ("True", "Prop"),
                             ("Quot", "prenex"), ("propext", "axiom"),
                             ("Nat.rec", "prenex"), ("Nat.add_zero", "theorem")):
            with self.subTest(name=name):
                self.rejects(name, reason)
        self.row("Quot")["levels"] = []
        self.rejects("Quot", "quotient")
        self.row("Nat.rec")["levels"] = []
        self.rejects("Nat.rec", "recursor")

    def test_recursive_definition_is_a_gap(self):
        row = definition("loop", [["const", "Nat", []], ["const", "loop", []]],
                         0, 1, ["Nat"])
        self.synthetic(row)
        self.rejects("loop", "recursive definitions")

    def test_family_shape_and_safety_restrictions(self):
        for field, value, reason in (("parameters", 1, "unparameterized"),
                                     ("indices", 1, "unindexed"), ("nested", 1, "families"),
                                     ("mutual", ["Nat", "True"], "single"),
                                     ("unsafe", True, "unsafe"), ("reflexive", True, "reflexive"),
                                     ("constructors", [], "empty families")):
            with self.subTest(field=field):
                self.value = copy.deepcopy(self.original)
                self.row("Nat")["details"][field] = value
                self.rejects("Nat", reason)

    def test_constructor_return_and_field_restrictions(self):
        self.row("Nat.succ")["nodes"][0] = ["sort", ["succ", ["zero"]]]
        self.rejects("Nat", "constant type")
        self.value = copy.deepcopy(self.original)
        self.row("Nat.zero")["nodes"][0] = ["const", "True", []]
        self.rejects("Nat", "return its unindexed family")
        self.value = copy.deepcopy(self.original)
        self.row("Nat.succ")["details"]["fields"] = 2
        self.rejects("Nat", "return its unindexed family")
        for name, field, value in (("Nat.succ", "details", True), ("Nat.zero", "levels", ["u"])):
            with self.subTest(name=name, field=field):
                self.value = copy.deepcopy(self.original)
                if field == "levels":
                    self.row(name)["levels"] = value
                else:
                    self.row(name)["details"]["unsafe"] = value
                self.rejects("Nat", "polymorphic or unsafe constructor")

    def test_definition_safety_and_opacity(self):
        for field, value, reason in (("safety", "unsafe", "unsafe"),
                                     ("safety", "partial", "partial"),
                                     ("hints", ["opaque"], "opaque"),
                                     ("mutual", ["identity", "other"], "mutual")):
            with self.subTest(field=field, value=value):
                row = identity()
                row["details"][field] = value
                self.value = copy.deepcopy(self.original)
                self.value["declarations"].append(row)
                self.rejects("identity", reason)

    def test_dependency_cycles_and_unsupported_dependencies(self):
        first, second = identity("first"), identity("second")
        first["dependencies"].append("second")
        second["dependencies"].append("first")
        self.value["declarations"] += [first, second]
        self.rejects("first", "recursive declaration dependency")
        self.value = copy.deepcopy(self.original)
        row = definition("useId", [["const", "id", [["succ", ["zero"]]]]], 0, 0, ["id"])
        self.value["declarations"].append(row)
        self.rejects("useId", "universe instantiation")
        row = definition("badDependency", [["const", "True", []]], 0, 0, ["True"])
        self.synthetic(row)
        self.rejects("badDependency", "dependency True: Prop")

    def test_dependency_depth_bound_refuses_a_long_chain(self):
        # Each definition depends on the next one, so the closure is deeper than
        # the documented dependency limit without holding a cycle.
        names = [f"chain{index}" for index in range(200)]
        rows = []
        for index, name in enumerate(names):
            successor = names[index + 1] if index + 1 < len(names) else "Nat"
            rows.append(definition(name, [["const", successor, []], ["bvar", 0],
                                          ["forall", "same", "implicit", 0, 0],
                                          ["lam", "same", "implicit", 0, 1]], 2, 3,
                                   [successor]))
        self.synthetic(*rows)
        self.rejects(names[0], "dependency depth")

    def test_expression_refusals_and_limits(self):
        for node, reason in ((["bvar", 0], "loose"), (["string", "text"], "string"),
                             (["proj", "PProd", 0, 0], "proj"), (["nat", "65"], "literal"),
                             (["nat", "1" * 5000], "literal")):
            with self.subTest(reason=reason):
                with self.assertRaisesRegex(translate.Gap, reason):
                    translate.Expressions({"nodes": [node]}).render(0)
        nodes = [["const", "Nat", []]]
        for index in range(150):
            nodes.append(["app", index, 0])
        with self.assertRaisesRegex(translate.Gap, "depth"):
            translate.Expressions({"nodes": nodes}).render(len(nodes) - 1)
        nodes = [["const", "Nat", []]]
        for index in range(20):
            nodes.append(["app", index, index])
        with self.assertRaisesRegex(translate.Gap, "source limit"):
            translate.Expressions({"nodes": nodes}).render(len(nodes) - 1)

    def test_accumulated_byte_budget_refuses_slow_growth(self):
        # A doubling application tower under nested lambdas keeps every single
        # result below the per-expression limit, and passes the 4 MiB total.
        nodes = [["const", "Nat", []]]
        for _ in range(14):
            nodes.append(["app", len(nodes) - 1, len(nodes) - 1])
        for _ in range(24):
            nodes.append(["lam", "x", "explicit", 0, len(nodes) - 1])
        expression = translate.Expressions({"nodes": nodes})
        with self.assertRaisesRegex(translate.Gap, "byte limit"):
            expression.render(len(nodes) - 1)
        self.assertGreater(expression.bytes, 16 * translate.MAX_SOURCE)

    def test_application_with_a_lambda_head_renders_a_beta_redex(self):
        # The translator restricts no application head, so a lambda head gives a
        # beta-redex. Veil refuses that form, which makes the candidate a gap.
        row = definition("redex", [["const", "Nat", []], ["bvar", 0],
                                   ["lam", "x", "explicit", 0, 1],
                                   ["app", 2, 0]], 0, 3, ["Nat"])
        source = self.synthetic(row).compile("redex")["source"]
        nat = translate.symbol("Nat")
        self.assertIn(f"((fun (b0 : {nat}) => b0) {nat})", source)

    def test_committed_sample_artifacts_match_this_translator(self):
        sample = ROOT / "dev/m2-translation"
        report = translate.decoded((sample / "results.json").read_bytes())
        self.assertEqual(report["summary"], {"snapshot_declarations": 44, "rechecked": 3,
                                            "translation_gaps": 41, "parity_credited": 0})
        _, artifacts, _ = self.pinned_inputs
        self.assertEqual(set(report["artifacts"]), set(artifacts))
        for path, unit in artifacts.items():
            self.assertEqual((sample / path).read_bytes(), unit["source"].encode("utf-8"))

    def test_type_binder_refusal(self):
        nodes = [["sort", ["succ", ["zero"]]], ["bvar", 0], ["lam", "A", "explicit", 0, 1]]
        with self.assertRaisesRegex(translate.Gap, "erasure translation"):
            translate.Expressions({"nodes": nodes}).render(2)

    def test_cache_limit_and_cli_integrity_error(self):
        expression = translate.Expressions({"nodes": [["const", "Nat", []]]})
        expression.cache = {(index, 1): "cached" for index in range(4096)}
        with self.assertRaisesRegex(translate.Gap, "node limit"):
            expression.render(0)
        with tempfile.TemporaryDirectory() as temporary, mock.patch("sys.stderr", new_callable=io.StringIO) as stderr:
            result = translate.main(["record", "--output", temporary])
            self.assertEqual(result, 2)
            self.assertIn("destination already exists", stderr.getvalue())
            self.assertNotIn("Traceback", stderr.getvalue())

    def test_binders_do_not_capture_outer_variables(self):
        row = definition("outer", [["const", "Nat", []], ["bvar", 1],
                                  ["forall", "x", "explicit", 0, 0],
                                  ["forall", "x", "explicit", 0, 2],
                                  ["lam", "x", "explicit", 0, 1],
                                  ["lam", "x", "explicit", 0, 4]], 3, 5, ["Nat"])
        source = self.synthetic(row).compile("outer")["source"]
        self.assertIn("(fun (b0 : v4e6174) => (fun (b1 : v4e6174) => b0))", source)

    def stage_mock_record(self, directory):
        rows, artifacts, provenance = self.pinned_inputs
        captures = {}
        for path, unit in artifacts.items():
            (directory / path).write_text(unit["source"])
            captures[path] = []
            for label, command in translate.CHECKS:
                captures[path].append({"argv": [*command, path], "exit_code": 0})
                for stream in ("stdout", "stderr"):
                    (directory / f"{path}.{label}.{stream}").write_bytes(b"")
        report = translate.assemble(directory, rows, artifacts, provenance, "a" * 64, captures)
        (directory / "results.json").write_bytes(translate.encoded(report))
        return report

    def verify_cached(self, directory):
        with mock.patch.object(translate, "inputs", return_value=self.pinned_inputs):
            return translate.verify(directory, SNAPSHOT, INVENTORY)

    def test_record_rejects_unrelated_source_even_with_rehashed_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            report = self.stage_mock_record(directory)
            path = next(iter(report["artifacts"]))
            (directory / path).write_text("def unrelated : Nat := 0\n")
            report["files_sha256"][path] = translate.digest((directory / path).read_bytes())
            (directory / "results.json").write_bytes(translate.encoded(report))
            with self.assertRaisesRegex(IntegrityError, "translated source differs"):
                self.verify_cached(directory)

    def test_record_rejects_counts_omissions_and_provenance_tampering(self):
        for field in ("summary", "results", "inventory_sha256", "snapshot_sha256", "source_sha256"):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                report = self.stage_mock_record(directory)
                report[field] = None
                (directory / "results.json").write_bytes(translate.encoded(report))
                with self.assertRaisesRegex(IntegrityError, "record or fingerprint"):
                    self.verify_cached(directory)

    def test_record_rejects_recheck_status_command_and_capture_changes(self):
        for mode in ("boolean", "command", "capture", "missing", "extra", "noncanonical", "symlink"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                report = self.stage_mock_record(directory)
                artifact = next(iter(report["artifacts"]))
                path = directory / f"{artifact}.check.stdout"
                if mode == "boolean":
                    report["artifacts"][artifact]["checks"][0]["exit_code"] = False
                elif mode == "command":
                    report["artifacts"][artifact]["checks"][0]["argv"] = ["--version"]
                elif mode == "capture":
                    path.write_bytes(b"changed\n")
                elif mode == "missing":
                    path.unlink()
                elif mode == "extra":
                    (directory / "extra").write_text("unexpected")
                elif mode == "symlink":
                    path.unlink()
                    path.symlink_to(directory / artifact)
                raw = translate.encoded(report) + (b"\n" if mode == "noncanonical" else b"")
                (directory / "results.json").write_bytes(raw)
                with self.assertRaises((IntegrityError, OSError)):
                    self.verify_cached(directory)

    def test_failed_check_erasure_or_axiom_disclosure_cannot_succeed(self):
        labels = [name for name, _ in translate.CHECKS]
        for label in (*labels, "check-stderr"):
            with self.subTest(label=label), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                report = self.stage_mock_record(directory)
                artifact = next(iter(report["artifacts"]))
                captures = {artifact: report["artifacts"][artifact]["checks"]}
                if label == "axioms":
                    (directory / f"{artifact}.axioms.stdout").write_bytes(b"addedAxiom\n")
                elif label == "check-stderr":
                    # A checker that warns on stderr keeps exit 0 on all three
                    # commands. The empty-stderr requirement must still refuse it.
                    (directory / f"{artifact}.check.stderr").write_bytes(b"warning\n")
                    self.assertTrue(all(check["exit_code"] == 0
                                        for check in captures[artifact]))
                else:
                    index = labels.index(label)
                    captures[artifact][index]["exit_code"] = 1
                rows, artifacts, provenance = self.pinned_inputs
                result = translate.assemble(directory, rows, artifacts, provenance, "a" * 64, captures)
                self.assertEqual(result["summary"]["rechecked"], 0)
                self.assertEqual(result["summary"]["translation_gaps"], 44)
                self.assertEqual(result["summary"]["parity_credited"], 0)

    def test_infrastructure_failure_is_not_a_translation_gap(self):
        for failure in (subprocess.CompletedProcess([], -9, b"", b""),
                        subprocess.CompletedProcess([], 64, b"", b"")):
            with mock.patch.object(translate.subprocess, "run", return_value=failure):
                with self.assertRaisesRegex(IntegrityError, "infrastructure"):
                    translate.check_artifact(CHECKER, ROOT, "unused.kan")
        with mock.patch.object(translate.subprocess, "run", side_effect=subprocess.TimeoutExpired([], 30)):
            with self.assertRaises(subprocess.TimeoutExpired):
                translate.check_artifact(CHECKER, ROOT, "unused.kan")

    def test_existing_destination_is_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "keep"
            path.mkdir()
            with self.assertRaisesRegex(IntegrityError, "already exists"):
                translate.record(path, SNAPSHOT, INVENTORY, CHECKER)

    @unittest.skipUnless(LIVE, "requires --live and a built Veil checker")
    def test_pinned_sample_record_and_live_recheck(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / "record"
            report = translate.record(directory, SNAPSHOT, INVENTORY, CHECKER)
            self.assertEqual(report["summary"], {"snapshot_declarations": 44, "rechecked": 3,
                                                "translation_gaps": 41, "parity_credited": 0})
            self.assertEqual(translate.verify(directory, SNAPSHOT, INVENTORY, checker=CHECKER), report)

    @unittest.skipUnless(LIVE, "requires --live and a built Veil checker")
    def test_generated_lambdas_application_let_and_literal_compute(self):
        value = definition("use", [["const", "Nat", []], ["nat", "2"], ["bvar", 0],
                                   ["const", "identity", []], ["app", 3, 2],
                                   ["let", "identity", 0, 1, 4, False]], 0, 5, ["Nat", "identity"])
        source = self.synthetic(identity(), value).compile("use")["source"]
        # A type indexed by the translated natural forces conversion to compare
        # the computed result with two explicit successor constructors.
        nat, zero, succ = (translate.symbol(n) for n in ("Nat", "Nat.zero", "Nat.succ"))
        use = translate.symbol("use")
        source += (f"\nmu Witness : (0 n : {nat}) -> Type 0 with\n"
                   f"| two : Witness ({succ} ({succ} {zero}))\n"
                   f"def proof : Witness {use} := two\n")
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "translated.kan").write_text(source)
            checks = translate.check_artifact(CHECKER, directory, "translated.kan")
            self.assertTrue(all(check["exit_code"] == 0 for check in checks),
                            (directory / "translated.kan.check.stderr").read_text())
            self.assertEqual((directory / "translated.kan.axioms.stdout").read_bytes(), b"")
            bad = source.replace(f"| two : Witness ({succ} ({succ} {zero}))",
                                 f"| two : Witness {zero}")
            (directory / "translated.kan").write_text(bad)
            negative = translate.check_artifact(CHECKER, directory, "translated.kan")
            self.assertEqual(negative[0]["exit_code"], 1)

    @unittest.skipUnless(LIVE, "requires --live and a built Veil checker")
    def test_live_verification_rejects_fabricated_empty_capture(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / "record"
            translate.record(directory, SNAPSHOT, INVENTORY, CHECKER)
            with mock.patch.object(translate, "check_artifact", return_value=[]):
                with self.assertRaisesRegex(IntegrityError, "live checker status"):
                    translate.verify(directory, SNAPSHOT, INVENTORY, checker=CHECKER)


if __name__ == "__main__":
    unittest.main()
