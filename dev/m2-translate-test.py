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


def generic_identity(name="genericIdentity", level=None):
    level = ["succ", ["zero"]] if level is None else level
    return definition(name, [["sort", level], ["bvar", 0], ["bvar", 1],
                             ["forall", "same", "explicit", 1, 2],
                             ["forall", "same", "implicit", 0, 3],
                             ["lam", "same", "explicit", 1, 1],
                              ["lam", "same", "implicit", 0, 5]], 4, 6, [])


def sort_alias(name, level=None, target=None):
    level = ["succ", ["zero"]] if level is None else level
    value = ["sort", level] if target is None else ["const", target, []]
    return definition(name, [["sort", ["succ", level]], value], 0, 1,
                      [] if target is None else [target])


def aliased_identity(name, alias, side="both", level=None):
    level = ["succ", ["zero"]] if level is None else level
    if side == "both":
        row = generic_identity(name, level)
        row["nodes"][0] = ["const", alias, []]
        row["dependencies"] = sorted([name, alias])
        return row
    return definition(name, [
        ["sort", level], ["const", alias, []], ["bvar", 0], ["bvar", 1],
        ["forall", "same", "explicit", 2, 3],
        ["forall", "same", "implicit", 1 if side in ("type", "both") else 0, 4],
        ["lam", "same", "explicit", 2, 2],
        ["lam", "same", "implicit", 1 if side in ("value", "both") else 0, 6]],
        5, 7, [alias])


def select_first(name="selectFirst"):
    # Two stacked closed-sort binders over two data binders. The value keeps
    # the first data argument, so both type binders stay in dependent scope.
    return definition(name, [
        ["sort", ["succ", ["zero"]]], ["bvar", 1], ["bvar", 3],
        ["forall", "same", "explicit", 1, 2],
        ["forall", "same", "explicit", 1, 3],
        ["forall", "same", "implicit", 0, 4],
        ["forall", "same", "implicit", 0, 5],
        ["lam", "same", "explicit", 1, 1],
        ["lam", "same", "explicit", 1, 7],
        ["lam", "same", "implicit", 0, 8],
         ["lam", "same", "implicit", 0, 9]], 6, 10, [])


def let_sort_identity(name="letSortIdentity", side="both", level=None):
    level = ["succ", ["zero"]] if level is None else level
    return definition(name, [
        ["sort", level], ["sort", ["succ", level]], ["bvar", 0], ["bvar", 1],
        ["let", "same", 1, 0, 2, False],
        ["forall", "same", "explicit", 2, 3],
        ["forall", "same", "implicit", 4 if side in ("type", "both") else 0, 5],
        ["lam", "same", "explicit", 2, 2],
        ["lam", "same", "implicit", 4 if side in ("value", "both") else 0, 7]],
        6, 8, [])


def theorem(name, nodes, ty, body, dependencies):
    row = definition(name, nodes, ty, body, dependencies)
    row["kind"] = "theorem"
    row["details"] = {"mutual": [name]}
    return row


def empty_family(name, level):
    return {"name": name, "kind": "inductive", "module": "Init.Prelude", "levels": [],
            "private": False, "type": 0, "value": None, "nodes": [["sort", level]],
            "details": {"parameters": 0, "indices": 0, "mutual": [name], "constructors": [],
                        "nested": 0, "recursive": False, "unsafe": False, "reflexive": False},
            "dependencies": [name]}


def alias_family(name, alias, level):
    family = {"name": name, "kind": "inductive", "module": "Init.Prelude", "levels": [],
              "private": False, "type": 0, "value": None, "nodes": [["sort", level]],
              "details": {"parameters": 0, "indices": 0, "mutual": [name],
                          "constructors": [f"{name}.mk"], "nested": 0,
                          "recursive": False, "unsafe": False, "reflexive": False},
              "dependencies": sorted([name, f"{name}.mk"])}
    constructor = {"name": f"{name}.mk", "kind": "constructor", "module": "Init.Prelude",
                   "levels": [], "private": False, "type": 2, "value": None,
                   "nodes": [["const", alias, []], ["const", name, []],
                             ["forall", "field", "explicit", 0, 1]],
                   "details": {"fields": 1, "index": 0, "inductive": name,
                               "parameters": 0, "unsafe": False},
                   "dependencies": sorted([name, alias])}
    return family, constructor


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

    def check_synthetic_source(self, source, accepted=True):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            path = directory / "aliases.kan"
            path.write_text(source)
            checks = translate.check_artifact(CHECKER, directory, path.name)
            if not accepted:
                self.assertEqual([check["exit_code"] for check in checks[:2]], [1, 1])
                for label in ("check", "erased"):
                    self.assertTrue((directory / f"aliases.kan.{label}.stderr").read_bytes())
                return None
            self.assertEqual([check["exit_code"] for check in checks], [0, 0, 0],
                             (directory / "aliases.kan.check.stderr").read_text())
            for label, _ in translate.CHECKS:
                self.assertEqual((directory / f"aliases.kan.{label}.stderr").read_bytes(), b"")
            outputs = {label: (directory / f"aliases.kan.{label}.stdout").read_text()
                       for label, _ in translate.CHECKS}
            self.assertEqual(outputs["axioms"], "")
            return outputs

    def test_sample_covers_every_name_and_shares_family_artifact(self):
        rows, artifacts, provenance = self.pinned_inputs
        self.assertEqual(len(rows), 44)
        self.assertEqual(provenance["inventory_declarations"], 51980)
        self.assertEqual([r["name"] for r in rows if r["artifact"]],
                         ["Nat", "Nat.succ", "Nat.zero", "True", "True.intro"])
        self.assertEqual(len(artifacts), 2)
        self.assertEqual(len({r["artifact"] for r in rows if r["artifact"]}), 2)
        self.assertTrue(all(r["reason"] for r in rows if not r["artifact"]))
        self.assertEqual(sorted(unit["declarations"] for unit in artifacts.values()),
                         [["Nat", "Nat.succ", "Nat.zero"], ["True", "True.intro"]])

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

    def test_polymorphic_quotient_axiom_and_recursor_gaps(self):
        for name, reason in (("id", "prenex"), ("Iff", "unparameterized"),
                             ("Quot", "prenex"), ("propext", "axiom"),
                             ("Nat.rec", "prenex"), ("Nat.add_zero", "universe instantiation")):
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
                                     ("unsafe", True, "unsafe"), ("reflexive", True, "reflexive")):
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
        row = definition("badDependency", [["const", "Iff", []]], 0, 0, ["Iff"])
        self.synthetic(row)
        self.rejects("badDependency", "dependency Iff: only single")

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

    def test_lambda_application_keeps_the_argument_type_check(self):
        # Even this ill-typed argument must survive lowering for Veil to reject.
        row = definition("redex", [["const", "Nat", []], ["bvar", 0],
                                    ["lam", "x", "explicit", 0, 1],
                                    ["app", 2, 0]], 0, 3, ["Nat"])
        source = self.synthetic(row).compile("redex")["source"]
        nat = translate.symbol("Nat")
        self.assertIn(f"(let b0 : {nat} := {nat} in b0)", source)

    def test_lambda_application_keeps_sort_checks_and_refuses_deep_spines(self):
        for level in (["zero"], ["succ", ["zero"]]):
            nodes = [["sort", level], ["bvar", 0], ["lam", "A", "explicit", 0, 1],
                     ["app", 2, 0]]
            with self.subTest(level=level):
                sort = "Prop" if level == ["zero"] else "(Type 0)"
                self.assertEqual(translate.Expressions({"nodes": nodes}).render(3),
                                 f"(let b0 : {sort} := {sort} in b0)")
        nodes = [["const", "Nat", []], ["bvar", 0], ["lam", "x", "explicit", 0, 1]]
        for _ in range(translate.MAX_DEPTH):
            nodes.append(["app", len(nodes) - 1, 0])
        with self.assertRaisesRegex(translate.Gap, "expression depth"):
            translate.Expressions({"nodes": nodes}).render(len(nodes) - 1)

    def test_lambda_application_respects_body_depth_and_source_limits(self):
        nodes = [["const", "Nat", []], ["bvar", 0], ["lam", "x", "explicit", 0, 1],
                 ["app", 2, 1]]
        # The caller's b0 is valid, but the lambda body still needs one more
        # depth step. Scanning the application spine cannot reset its fuel.
        expression = translate.Expressions({"nodes": nodes})
        with self.assertRaisesRegex(translate.Gap, "expression depth"):
            expression.render(3, depth=1, fuel=2)
        self.assertEqual(expression.render(3, depth=1, fuel=3),
                         f"(let b1 : {translate.symbol('Nat')} := b0 in b1)")
        with mock.patch.object(translate, "MAX_SOURCE", 25):
            with self.assertRaisesRegex(translate.Gap, "expression exceeds source limit"):
                translate.Expressions({"nodes": nodes}).render(3, depth=1)

    def test_lambda_application_lowers_a_two_binder_spine_and_surplus_argument(self):
        # Two binders consume the first two arguments in order. The surplus
        # argument applies to the body, inside the let chain.
        nodes = [["const", "Nat", []], ["const", "Bool", []], ["const", "one", []],
                 ["const", "two", []], ["const", "three", []], ["bvar", 1],
                 ["lam", "y", "explicit", 1, 5], ["lam", "x", "explicit", 0, 6],
                 ["app", 7, 2], ["app", 8, 3], ["app", 9, 4]]
        nat, boolean = translate.symbol("Nat"), translate.symbol("Bool")
        one, two = translate.symbol("one"), translate.symbol("two")
        three = translate.symbol("three")
        self.assertEqual(translate.Expressions({"nodes": nodes}).render(10),
                         f"(let b0 : {nat} := {one} in "
                         f"(let b1 : {boolean} := {two} in (b0 {three})))")

    def test_lambda_application_lowers_a_partial_application(self):
        # Three binders and two arguments keep the third binder a lambda, and
        # its body still names the first consumed binder.
        nodes = [["const", "Nat", []], ["const", "Bool", []], ["const", "Unit", []],
                 ["const", "one", []], ["const", "two", []], ["bvar", 2],
                 ["lam", "z", "explicit", 2, 5], ["lam", "y", "explicit", 1, 6],
                 ["lam", "x", "explicit", 0, 7], ["app", 8, 3], ["app", 9, 4]]
        nat, boolean = translate.symbol("Nat"), translate.symbol("Bool")
        unit, one, two = (translate.symbol("Unit"), translate.symbol("one"),
                          translate.symbol("two"))
        self.assertEqual(translate.Expressions({"nodes": nodes}).render(10),
                         f"(let b0 : {nat} := {one} in (let b1 : {boolean} := {two} in "
                         f"(fun (b2 : {unit}) => b0)))")

    def test_lambda_application_renders_a_dependent_later_domain(self):
        # The second domain depends on the first binder, so it renders at the
        # depth of that binder, not at the caller's depth.
        nodes = [["const", "Nat", []], ["const", "Fam", []], ["bvar", 0],
                 ["app", 1, 2], ["const", "one", []], ["const", "two", []],
                 ["bvar", 1], ["lam", "y", "explicit", 3, 6],
                 ["lam", "x", "explicit", 0, 7], ["app", 8, 4], ["app", 9, 5]]
        nat, family = translate.symbol("Nat"), translate.symbol("Fam")
        one, two = translate.symbol("one"), translate.symbol("two")
        self.assertEqual(translate.Expressions({"nodes": nodes}).render(10),
                         f"(let b0 : {nat} := {one} in "
                         f"(let b1 : ({family} b0) := {two} in b0))")

    def test_lambda_application_pins_the_spine_fuel_boundary(self):
        # A shared two-argument spine holds the accept and refuse boundary of
        # the spine scan. One less fuel unit must refuse, not reuse a cached
        # result of a deeper scan.
        nodes = [["const", "Nat", []], ["app", 0, 0], ["app", 1, 0], ["bvar", 2],
                 ["app", 1, 2]]
        with self.assertRaisesRegex(translate.Gap, "expression depth"):
            translate.Expressions({"nodes": nodes}).render(4, 0, 3)
        nat = translate.symbol("Nat")
        self.assertEqual(translate.Expressions({"nodes": nodes}).render(4, 0, 4),
                         f"(({nat} {nat}) (({nat} {nat}) {nat}))")

    def test_let_application_preserves_caller_scope_and_dependent_domains(self):
        nodes = [["const", "Nat", []], ["const", "Family", []], ["bvar", 0],
                 ["app", 1, 2], ["nat", "0"], ["lam", "same", "explicit", 3, 2],
                 ["let", "same", 0, 4, 5, False], ["app", 6, 2]]
        nat, family, zero = (translate.symbol(n) for n in ("Nat", "Family", "Nat.zero"))
        self.assertEqual(translate.Expressions({"nodes": nodes}).render(7, depth=1),
                         f"(let b1 : {nat} := {zero} in "
                         f"(let b2 : ({family} b1) := b0 in b2))")
        # The declared type of a let renders one level below the caller, so
        # it names the binding that precedes it.
        nested = [["const", "Nat", []], ["const", "Family", []],
                  ["const", "one", []], ["const", "arg", []], ["bvar", 0],
                  ["app", 1, 4], ["bvar", 0], ["bvar", 0],
                  ["let", "w", 5, 6, 7, False],
                  ["let", "z", 0, 2, 8, False], ["app", 9, 3]]
        one, argument = (translate.symbol(n) for n in ("one", "arg"))
        self.assertEqual(translate.Expressions({"nodes": nested}).render(10),
                         f"(let b0 : {nat} := {one} in "
                         f"(let b1 : ({family} b0) := b0 in (b1 {argument})))")

    def test_let_application_consumes_inner_arguments_before_outer_arguments(self):
        # The inner argument sees the let binder. The outer one sees only the caller.
        nodes = [["const", "Nat", []], ["bvar", 0], ["bvar", 1], ["nat", "0"],
                 ["lam", "same", "explicit", 0, 1], ["lam", "same", "explicit", 0, 4],
                 ["app", 5, 1], ["let", "same", 0, 3, 6, False], ["app", 7, 1]]
        nat, zero = (translate.symbol(n) for n in ("Nat", "Nat.zero"))
        self.assertEqual(translate.Expressions({"nodes": nodes}).render(8, depth=1),
                         f"(let b1 : {nat} := {zero} in (let b2 : {nat} := b1 in "
                         f"(let b3 : {nat} := b0 in b3)))")

    def test_let_application_keeps_partial_and_surplus_applications(self):
        nat, one, two, three = (translate.symbol(n) for n in ("Nat", "one", "two", "three"))
        nodes = [["const", "Nat", []], ["const", "one", []], ["const", "two", []],
                 ["const", "three", []], ["bvar", 1], ["lam", "y", "explicit", 0, 4],
                 ["lam", "x", "explicit", 0, 5], ["let", "n", 0, 1, 6, False],
                 ["app", 7, 2], ["app", 8, 3], ["app", 9, 1]]
        self.assertEqual(translate.Expressions({"nodes": nodes}).render(8),
                         f"(let b0 : {nat} := {one} in (let b1 : {nat} := {two} in "
                         f"(fun (b2 : {nat}) => b1)))")
        self.assertEqual(translate.Expressions({"nodes": nodes}).render(10),
                         f"(let b0 : {nat} := {one} in (let b1 : {nat} := {two} in "
                         f"(let b2 : {nat} := {three} in (b1 {one}))))")

    def test_let_application_orders_three_surplus_arguments(self):
        # The spine stops on a head that consumes no argument. The three
        # surplus arguments keep their application order.
        nodes = [["const", "Nat", []], ["const", "one", []], ["const", "a", []],
                 ["const", "b", []], ["const", "c", []],
                 ["let", "z", 0, 1, 0, False],
                 ["app", 5, 2], ["app", 6, 3], ["app", 7, 4]]
        nat, one = (translate.symbol(n) for n in ("Nat", "one"))
        first, second, third = (translate.symbol(n) for n in ("a", "b", "c"))
        self.assertEqual(translate.Expressions({"nodes": nodes}).render(8),
                         f"(let b0 : {nat} := {one} in "
                         f"((({nat} {first}) {second}) {third}))")

    def test_let_type_sort_binders_keep_their_values_for_checking(self):
        # Even ill-typed sort values remain in both lowering paths so that
        # the checker, including the erasure command, rejects the candidate.
        nodes = [["sort", ["zero"]], ["const", "Nat", []], ["bvar", 0],
                 ["let", "t", 0, 1, 2, False], ["app", 3, 1]]
        nat = translate.symbol("Nat")
        self.assertEqual(translate.Expressions({"nodes": nodes}).render(4),
                         f"(let b0 : Prop := {nat} in (b0 {nat}))")
        self.assertEqual(translate.Expressions({"nodes": nodes}).render(3),
                         f"(let b0 : Prop := {nat} in b0)")
        admitted = [["const", "Nat", []], ["const", "one", []], ["bvar", 0],
                    ["let", "t", 0, 1, 2, False], ["app", 3, 1]]
        nat, one = (translate.symbol(n) for n in ("Nat", "one"))
        self.assertEqual(translate.Expressions({"nodes": admitted}).render(4),
                         f"(let b0 : {nat} := {one} in (b0 {one}))")
        self.assertEqual(translate.Expressions({"nodes": admitted}).render(3),
                         f"(let b0 : {nat} := {one} in b0)")

    def test_let_application_retains_depth_source_and_sort_limits(self):
        nodes = [["const", "Nat", []], ["bvar", 0], ["lam", "x", "explicit", 0, 1],
                 ["let", "x", 0, 1, 2, False], ["app", 3, 1]]
        expression = translate.Expressions({"nodes": nodes})
        with self.assertRaisesRegex(translate.Gap, "expression depth"):
            expression.render(4, depth=1, fuel=3)
        nat = translate.symbol("Nat")
        self.assertEqual(expression.render(4, depth=1, fuel=4),
                         f"(let b1 : {nat} := b0 in (let b2 : {nat} := b0 in b2))")
        with mock.patch.object(translate, "MAX_SOURCE", 50):
            with self.assertRaisesRegex(translate.Gap, "source limit"):
                translate.Expressions({"nodes": nodes}).render(4, depth=1)
        deep = ["zero"]
        for _ in range(translate.MAX_DEPTH):
            deep = ["succ", deep]
        for level, reason in ((["param", "u"], "prenex polymorphism"),
                              (deep, "universe depth")):
            nodes[0] = ["sort", level]
            with self.subTest(reason=reason), self.assertRaisesRegex(translate.Gap, reason):
                translate.Expressions({"nodes": nodes}).render(4, depth=1)

    def test_committed_sample_artifacts_match_this_translator(self):
        sample = ROOT / "dev/m2-translation"
        report = translate.decoded((sample / "results.json").read_bytes())
        self.assertEqual(report["summary"], {"snapshot_declarations": 44, "rechecked": 5,
                                            "translation_gaps": 39, "parity_credited": 0})
        _, artifacts, _ = self.pinned_inputs
        self.assertEqual(set(report["artifacts"]), set(artifacts))
        for path, unit in artifacts.items():
            self.assertEqual((sample / path).read_bytes(), unit["source"].encode("utf-8"))

    def test_closed_sort_binders_erase_and_keep_dependent_scopes(self):
        zero, one = ["zero"], ["succ", ["zero"]]
        for level, domain in ((zero, "Prop"), (one, "(Type 0)"),
                              (["succ", one], "(Type 1)"),
                              (["imax", one, zero], "Prop")):
            row = generic_identity(level=level)
            with self.subTest(level=level):
                source = self.synthetic(row).compile(row["name"])["source"]
                self.assertIn(f"((0 b0 : {domain}) -> ((b1 : b0) -> b0))", source)
                self.assertIn(f"(fun (0 b0 : {domain}) => (fun (b1 : b0) => b1))", source)

    def test_closed_sort_binders_keep_universe_and_expression_limits(self):
        deep = ["zero"]
        for _ in range(translate.MAX_DEPTH):
            deep = ["succ", deep]
        for level, reason in ((["param", "u"], "prenex polymorphism"),
                              (deep, "universe depth")):
            row = generic_identity(level=level)
            with self.assertRaisesRegex(translate.Gap, reason):
                translate.Expressions(row).render(row["value"])
        row = generic_identity()
        with self.assertRaisesRegex(translate.Gap, "expression depth"):
            translate.Expressions(row).render(row["value"], fuel=2)
        with mock.patch.object(translate, "MAX_SOURCE", 20):
            with self.assertRaisesRegex(translate.Gap, "source limit"):
                translate.Expressions(row).render(row["value"])

    def test_closed_sort_binder_visibility_does_not_change_quantity(self):
        for visibility in ("explicit", "implicit", "strict_implicit", "instance"):
            row = generic_identity()
            row["nodes"][4][2] = row["nodes"][6][2] = visibility
            with self.subTest(visibility=visibility):
                source = self.synthetic(row).compile(row["name"])["source"]
                self.assertIn("(0 b0 : (Type 0))", source)
                self.assertIn("(b1 : b0)", source)

    def test_nested_closed_sort_binders_erase_at_every_depth(self):
        row = select_first()
        expression = translate.Expressions(row)
        self.assertEqual(expression.render(row["type"]),
                         "((0 b0 : (Type 0)) -> ((0 b1 : (Type 0)) -> "
                         "((b2 : b0) -> ((b3 : b1) -> b0))))")
        self.assertEqual(expression.render(row["value"]),
                         "(fun (0 b0 : (Type 0)) => (fun (0 b1 : (Type 0)) => "
                         "(fun (b2 : b0) => (fun (b3 : b1) => b2))))")
        source = self.synthetic(row).compile(row["name"])["source"]
        self.assertIn("(0 b1 : (Type 0))", source)

    def test_type_and_value_binder_quantities_must_agree(self):
        nodes = [["const", "Nat", []], ["sort", ["succ", ["zero"]]],
                 ["bvar", 0], ["bvar", 1],
                 ["forall", "same", "explicit", 2, 3],
                 ["forall", "same", "implicit", 1, 4],
                 ["lam", "same", "explicit", 2, 2],
                 ["lam", "same", "implicit", 1, 6]]
        for side, index in (("value", 7), ("type", 5)):
            # Nat is a data family, not an alias of Type. These incompatible
            # domains must still give different quantities.
            row = definition(f"alias{side}Binder", copy.deepcopy(nodes), 5, 7, ["Nat"])
            row["nodes"][index][3] = 0
            with self.subTest(side=side):
                with self.assertRaisesRegex(translate.Gap, "binder quantity differs"):
                    self.synthetic(row).compile(row["name"])

    def test_sort_alias_binders_resolve_both_telescopes(self):
        for level in (["zero"], ["succ", ["zero"]], ["succ", ["succ", ["zero"]]]):
            for side in ("type", "value", "both"):
                with self.subTest(level=level, side=side):
                    base = sort_alias("SortBase", level)
                    alias = sort_alias("SortAlias", level, "SortBase")
                    row = aliased_identity("aliasIdentity", "SortAlias", side, level)
                    unit = self.synthetic(base, alias, row).compile(row["name"])
                    self.assertEqual(unit["closure"], ["SortBase", "SortAlias", row["name"]])
                    self.assertEqual(unit["body"].count("(0 b0 :"), 2)
                    self.assertIn(f"(0 b0 : {translate.symbol('SortAlias')})", unit["body"])
                    self.assertNotIn("(0 b1 :", unit["body"])

    def test_sort_aliases_preserve_nested_scopes_and_data_quantities(self):
        alias = sort_alias("SortAlias")
        row = select_first("aliasedSelect")
        row["nodes"][0] = ["const", "SortAlias", []]
        row["dependencies"].append("SortAlias")
        row["dependencies"].sort()
        unit = self.synthetic(alias, row).compile(row["name"])
        self.assertEqual(unit["body"].count("(0 b0 :"), 2)
        self.assertEqual(unit["body"].count("(0 b1 :"), 2)
        self.assertIn("(fun (b2 : b0) => (fun (b3 : b1) => b2))", unit["body"])
        data = definition("NatAlias", [["sort", ["succ", ["zero"]]],
                                      ["const", "Nat", []]], 0, 1, ["Nat"])
        row = identity("dataAliasIdentity")
        row["nodes"][0] = ["const", "NatAlias", []]
        row["dependencies"] = sorted([row["name"], "NatAlias"])
        body = self.synthetic(data, row).compile(row["name"])["body"]
        self.assertNotIn("(0 b0 :", body)
        self.assertIn(f"(fun (b0 : {translate.symbol('NatAlias')}) => b0)", body)
        family, constructor = alias_family("AliasBox", "SortAlias",
                                           ["succ", ["succ", ["zero"]]])
        unit = self.synthetic(family, constructor).compile("AliasBox")
        self.assertIn(f"| {translate.symbol('AliasBox.mk')} : "
                      f"((0 b0 : {translate.symbol('SortAlias')}) -> "
                      f"{translate.symbol('AliasBox')})", unit["body"])

    def test_sort_alias_cycles_and_depth_are_bounded(self):
        a, b = sort_alias("AliasA", target="AliasB"), sort_alias("AliasB", target="AliasA")
        row = aliased_identity("cyclicAlias", "AliasA")
        with self.assertRaisesRegex(translate.Gap, "recursive constant alias"):
            self.synthetic(a, b, row).compile(row["name"])
        rows = [sort_alias("Alias0")]
        for index in range(1, translate.MAX_DEPTH):
            rows.append(sort_alias(f"Alias{index}", target=f"Alias{index - 1}"))
        expression = translate.Expressions(
            {"nodes": [["const", rows[-2]["name"], []], ["const", rows[-1]["name"], []]]},
            {row["name"]: row for row in rows})
        self.assertTrue(expression.sort_domain(0))
        self.assertIs(expression.sort_domain(1), False)
        chain = aliased_identity("deepChainIdentity", rows[-1]["name"])
        translator = self.synthetic(*rows, chain)
        for alias in rows:
            translator.compile(alias["name"])
        body = translator.compile(chain["name"])["body"]
        self.assertIn(f"(b0 : {translate.symbol(rows[-1]['name'])})", body)
        self.assertNotIn("(0 b0 :", body)

    def test_sort_aliases_do_not_bypass_unsupported_dependencies(self):
        for label, change, reason in (
                ("opaque", lambda r: r["details"].update(hints=["opaque"]), "opaque"),
                ("unsafe", lambda r: r["details"].update(safety="unsafe"), "unsafe"),
                ("polymorphic", lambda r: r.update(levels=["u"]), "prenex"),
                ("mutual", lambda r: r["details"].update(mutual=["Alias", "other"]), "mutual")):
            alias = sort_alias("Alias")
            change(alias)
            if label == "mutual":
                alias["dependencies"].append("other")
            row = aliased_identity("unsupportedAlias", "Alias")
            with self.subTest(label=label):
                resolver = translate.Expressions(
                    {"nodes": [["const", "Alias", []]]}, {"Alias": alias})
                self.assertIs(resolver.sort_domain(0), False)
                with self.assertRaisesRegex(translate.Gap, reason):
                    self.synthetic(alias, row).compile(row["name"])
        deep = ["zero"]
        for _ in range(translate.MAX_DEPTH):
            deep = ["succ", deep]
        alias = sort_alias("DeepAlias", deep)
        row = aliased_identity("deepAlias", "DeepAlias")
        with self.assertRaisesRegex(translate.Gap, "universe depth"):
            self.synthetic(alias, row).compile(row["name"])

    def test_sort_alias_resolution_does_not_reduce_applications_or_free_locals(self):
        alias = sort_alias("SortAlias")
        rows = {alias["name"]: alias}
        expression = translate.Expressions({"nodes": [
            ["const", "SortAlias", []], ["app", 0, 0], ["bvar", 0],
            ["let", "same", 0, 0, 2, False], ["const", "SortAlias", [["zero"]]]]}, rows)
        self.assertTrue(expression.sort_domain(0))
        self.assertTrue(expression.sort_domain(3))
        for index in (1, 2, 4):
            self.assertFalse(expression.sort_domain(index))

    def test_sort_let_domains_resolve_both_telescopes(self):
        for level in (["zero"], ["succ", ["zero"]], ["succ", ["succ", ["zero"]]]):
            for side in ("type", "value", "both"):
                with self.subTest(level=level, side=side):
                    row = let_sort_identity(side=side, level=level)
                    body = self.synthetic(row).compile(row["name"])["body"]
                    self.assertEqual(body.count("(0 b0 :"), 2)
                    self.assertIn("(let b0 :", body)
                    self.assertNotIn("(0 b1 :", body)

    def test_sort_let_values_keep_their_scope_under_shadowing(self):
        expression = translate.Expressions({"nodes": [
            ["sort", ["succ", ["zero"]]], ["sort", ["succ", ["succ", ["zero"]]]],
            ["const", "Nat", []], ["bvar", 0], ["bvar", 1],
            ["let", "same", 0, 2, 4, False], ["let", "same", 1, 0, 5, False],
            ["let", "same", 0, 2, 3, False], ["let", "same", 1, 0, 7, False],
            ["let", "same", 1, 3, 3, False], ["let", "same", 1, 0, 9, False],
            ["let", "same", 1, 0, 4, False]]})
        self.assertTrue(expression.sort_domain(6))
        self.assertFalse(expression.sort_domain(8))
        self.assertTrue(expression.sort_domain(10))
        self.assertFalse(expression.sort_domain(11))
        alias = sort_alias("LooseAlias")
        alias["nodes"][1] = ["bvar", 0]
        expression.rows[alias["name"]] = alias
        expression.nodes.extend([["const", "LooseAlias", []],
                                 ["let", "same", 1, 0, 12, False]])
        self.assertFalse(expression.sort_domain(13))

    def test_sort_let_inspection_budget_counts_lets_and_variable_lookups(self):
        row = let_sort_identity()
        expression = translate.Expressions(row)
        with mock.patch.object(translate, "MAX_DEPTH", 3):
            self.assertTrue(expression.sort_domain(4))
        with mock.patch.object(translate, "MAX_DEPTH", 2):
            self.assertFalse(expression.sort_domain(4))
        nodes = [["sort", ["zero"]], ["sort", ["succ", ["zero"]]]]
        index = 0
        for _ in range(translate.MAX_DEPTH - 1):
            nodes.append(["let", "unused", 1, 0, index, False])
            index = len(nodes) - 1
        expression = translate.Expressions({"nodes": nodes})
        self.assertTrue(expression.sort_domain(index))
        nodes.append(["let", "unused", 1, 0, index, False])
        self.assertFalse(expression.sort_domain(len(nodes) - 1))

    def test_sort_let_aliases_keep_safety_cycles_and_universe_limits(self):
        row = let_sort_identity()
        row["nodes"][0] = ["const", "Alias", []]
        alias = sort_alias("Alias")
        expression = translate.Expressions(row, {alias["name"]: alias})
        self.assertTrue(expression.sort_domain(4))
        for change in (lambda r: r["details"].update(safety="unsafe"),
                       lambda r: r["details"].update(hints=["opaque"]),
                       lambda r: r.update(levels=["u"]),
                       lambda r: r["details"].update(mutual=["Alias", "other"]),
                       lambda r: r.update(kind="axiom")):
            invalid = copy.deepcopy(alias)
            change(invalid)
            expression.rows["Alias"] = invalid
            self.assertFalse(expression.sort_domain(4))
        alias["nodes"] = [["sort", ["succ", ["succ", ["zero"]]]],
                          ["const", "Alias", []], ["bvar", 0],
                          ["let", "same", 0, 1, 2, False]]
        alias["value"] = 3
        expression.rows["Alias"] = alias
        with self.assertRaisesRegex(translate.Gap, "recursive constant alias"):
            expression.sort_domain(4)
        deep = ["zero"]
        for _ in range(translate.MAX_DEPTH):
            deep = ["succ", deep]
        for level, reason in ((["param", "u"], "prenex polymorphism"), (deep, "universe depth")):
            with self.assertRaisesRegex(translate.Gap, reason):
                translate.Expressions(let_sort_identity(level=level)).sort_domain(4)

    def test_sort_let_type_and_value_binders_must_resolve_together(self):
        # A genuine erasure mismatch: the type telescope's binder domain is a
        # local let closing over a sort (True through the let chain), and the
        # paired value telescope's binder domain is a plain constant with no
        # let at all (a data name, so False). No side of `side=` in
        # let_sort_identity can produce this, because its excluded domain
        # index still points at a literal sort. quantities_agree must still
        # catch a mismatch that only a let on one side, and nothing at all
        # on the other, can create.
        level = ["succ", ["zero"]]
        row = definition("letQuantityMismatch", [
            ["sort", level], ["sort", ["succ", level]], ["bvar", 0],
            ["let", "same", 1, 0, 2, False], ["const", "Nat", []], ["bvar", 0],
            ["forall", "same", "explicit", 3, 5], ["lam", "same", "explicit", 4, 5]],
            6, 7, ["Nat"])
        self.synthetic(row)
        self.rejects("letQuantityMismatch", "binder quantity differs")

    @unittest.skipUnless(LIVE, "requires --live and a built Veil checker")
    def test_sort_let_binders_compute_and_erase(self):
        for side in ("type", "value", "both"):
            with self.subTest(side=side):
                generic = let_sort_identity(side=side)
                result = definition("letResult", [
                    ["const", "Nat", []], ["nat", "2"],
                    ["const", generic["name"], []], ["app", 2, 0], ["app", 3, 1]],
                    0, 4, ["Nat", generic["name"]])
                source = self.synthetic(generic, result).compile("letResult")["source"]
                nat, zero, succ = (translate.symbol(n) for n in ("Nat", "Nat.zero", "Nat.succ"))
                two = f"({succ} ({succ} {zero}))"
                source += (f"\nmu Witness : (0 n : {nat}) -> Type 0 with\n"
                           f"| two : Witness {two}\n"
                           f"def computed : Witness {translate.symbol('letResult')} := two\n")
                erased = self.check_synthetic_source(source)["erased"]
                self.assertIn(f"fun {translate.symbol(generic['name'])} (union any) : union any := KVar 0\n",
                              erased)
                self.assertNotIn("KLet", erased)
                self.check_synthetic_source(source.replace(f"| two : Witness {two}",
                                                          f"| two : Witness {zero}"), accepted=False)

    @unittest.skipUnless(LIVE, "requires --live and a built Veil checker")
    def test_sort_let_aliases_check_nested_scopes_and_data_arguments(self):
        shadowed = [["sort", ["succ", ["zero"]]], ["sort", ["succ", ["succ", ["zero"]]]],
                    ["const", "Nat", []], ["bvar", 1],
                    ["let", "same", 0, 2, 3, False], ["let", "same", 1, 0, 4, False]]
        captured = [["sort", ["succ", ["zero"]]], ["sort", ["succ", ["succ", ["zero"]]]],
                    ["bvar", 0], ["let", "same", 1, 2, 2, False],
                    ["let", "same", 1, 0, 3, False]]
        for label, nodes, dependencies in (("shadowed", shadowed, ["Nat"]), ("captured", captured, [])):
            with self.subTest(scope=label):
                alias = definition("ScopedSort", nodes, 1, len(nodes) - 1, dependencies)
                data_nodes = copy.deepcopy(shadowed)
                data_nodes[3] = ["bvar", 0]
                data = definition("ScopedData", data_nodes, 0, 5, ["Nat"])
                generic = aliased_identity("scopedIdentity", "ScopedSort")
                identity_row = identity("scopedDataIdentity")
                identity_row["nodes"][0] = ["const", "ScopedData", []]
                identity_row["dependencies"] = sorted([identity_row["name"], "ScopedData"])
                result = definition("scopedResult", [
                    ["const", "Nat", []], ["const", "Nat.zero", []],
                    ["const", generic["name"], []], ["const", identity_row["name"], []],
                    ["app", 3, 1], ["app", 2, 0], ["app", 5, 4]],
                    0, 6, ["Nat", "Nat.zero", generic["name"], identity_row["name"]])
                translator = self.synthetic(alias, data, generic, identity_row, result)
                source = translator.compile(result["name"])["source"]
                nat, zero = (translate.symbol(n) for n in ("Nat", "Nat.zero"))
                source += (f"\nmu Witness : (0 n : {nat}) -> Type 0 with\n"
                           f"| zero : Witness {zero}\n"
                           f"def computed : Witness {translate.symbol(result['name'])} := zero\n")
                erased = self.check_synthetic_source(source)["erased"]
                self.assertIn(f"fun {translate.symbol(identity_row['name'])} (union mu<{nat}>) : union mu<{nat}> := KVar 0\n",
                              erased)

    @unittest.skipUnless(LIVE, "requires --live and a built Veil checker")
    def test_sort_let_binders_preserve_proofs_and_higher_sorts(self):
        for level in (["zero"], ["succ", ["succ", ["zero"]]]):
            with self.subTest(level=level):
                generic = let_sort_identity(level=level)
                if level == ["zero"]:
                    generic["kind"], generic["details"] = "theorem", {"mutual": [generic["name"]]}
                    result = theorem("letProof", [
                        ["const", "True", []], ["const", "True.intro", []],
                        ["const", generic["name"], []], ["app", 2, 0], ["app", 3, 1]],
                        0, 4, ["True", "True.intro", generic["name"]])
                else:
                    result = definition("letType", [
                        ["sort", ["succ", ["zero"]]], ["const", "Nat", []],
                        ["const", generic["name"], []], ["app", 2, 0], ["app", 3, 1]],
                        0, 4, ["Nat", generic["name"]])
                source = self.synthetic(generic, result).compile(result["name"])["source"]
                erased = self.check_synthetic_source(source)["erased"]
                self.assertIn(f"erased {translate.symbol(result['name'])}\n", erased)

    @unittest.skipUnless(LIVE, "requires --live and a built Veil checker")
    def test_sort_let_domains_check_unused_values_and_declared_types(self):
        for value, level, accepted in (("Nat", ["succ", ["zero"]], True),
                                       ("Nat.zero", ["succ", ["zero"]], False),
                                       ("Nat", ["succ", ["succ", ["zero"]]], False)):
            with self.subTest(value=value, level=level):
                row = definition("unusedLetIdentity", [
                    ["sort", level], ["const", value, []], ["bvar", 0], ["bvar", 1],
                    ["let", "unused", 0, 1, 0, False],
                    ["forall", "x", "explicit", 2, 3], ["forall", "A", "implicit", 4, 5],
                    ["lam", "x", "explicit", 2, 2], ["lam", "A", "implicit", 4, 7]],
                    6, 8, [value])
                source = self.synthetic(row).compile(row["name"])["source"]
                self.assertIn("(let b0 :", source)
                self.check_synthetic_source(source, accepted=accepted)

    @unittest.skipUnless(LIVE, "requires --live and a built Veil checker")
    def test_sort_alias_data_binders_compute_and_erase(self):
        for side in ("type", "value", "both"):
            with self.subTest(side=side):
                alias = sort_alias("SortAlias", target="SortBase")
                generic = aliased_identity("aliasIdentity", "SortAlias", side)
                select = select_first("aliasSelect")
                select["nodes"][0] = ["const", "SortAlias", []]
                select["dependencies"] = sorted([select["name"], "SortAlias"])
                natural = definition("Natural", [["sort", ["succ", ["zero"]]],
                                                ["const", "Nat", []]], 0, 1, ["Nat"])
                data = identity("dataIdentity")
                data["nodes"][0] = ["const", "Natural", []]
                data["dependencies"] = sorted([data["name"], "Natural"])
                partial = definition("aliasPartial", [
                    ["const", "Nat", []], ["forall", "x", "explicit", 0, 0],
                    ["const", "aliasIdentity", []], ["app", 2, 0]], 1, 3, ["Nat", "aliasIdentity"])
                result = definition("aliasResult", [
                    ["const", "Nat", []], ["nat", "2"], ["const", "dataIdentity", []],
                    ["app", 2, 1], ["const", "aliasPartial", []], ["app", 4, 3],
                    ["const", "aliasSelect", []], ["app", 6, 0], ["app", 7, 0],
                    ["app", 8, 5], ["nat", "3"], ["app", 9, 10]],
                    0, 11, ["Nat", "dataIdentity", "aliasPartial", "aliasSelect"])
                translator = self.synthetic(sort_alias("SortBase"), alias, generic, select,
                                            natural, data, partial, result)
                source = translator.compile("aliasResult")["source"]
                nat, zero, succ = (translate.symbol(n) for n in ("Nat", "Nat.zero", "Nat.succ"))
                two = f"({succ} ({succ} {zero}))"
                source += (f"\nmu Witness : (0 n : {nat}) -> Type 0 with\n"
                           f"| two : Witness {two}\n"
                           f"def computed : Witness {translate.symbol('aliasResult')} := two\n")
                erased = self.check_synthetic_source(source)["erased"]
                self.assertIn(f"fun {translate.symbol('aliasIdentity')} (union any) : union any := KVar 0\n",
                              erased)
                self.assertIn(f"fun {translate.symbol('aliasSelect')} (union any, union any) : union any := KVar 1\n",
                              erased)
                self.assertIn(f"fun {translate.symbol('dataIdentity')} (union mu<{nat}>) : union mu<{nat}> := KVar 0\n",
                              erased)
                for name in ("SortBase", "SortAlias", "Natural"):
                    self.assertIn(f"erased {translate.symbol(name)}\n", erased)
                self.check_synthetic_source(source.replace(f"| two : Witness {two}",
                                                          f"| two : Witness {zero}"), accepted=False)

    @unittest.skipUnless(LIVE, "requires --live and a built Veil checker")
    def test_sort_alias_propositions_preserve_proofs(self):
        level = ["zero"]
        alias = sort_alias("Propositions", level)
        proof = aliased_identity("aliasProof", "Propositions", "value", level)
        proof["kind"], proof["details"] = "theorem", {"mutual": [proof["name"]]}
        applied = theorem("appliedAliasProof", [
            ["const", "True", []], ["const", "True.intro", []], ["const", "aliasProof", []],
            ["app", 2, 0], ["app", 3, 1]], 0, 4, ["True", "True.intro", "aliasProof"])
        consumer = definition("aliasProofResult", [
            ["const", "Nat", []], ["const", "True", []], ["const", "appliedAliasProof", []],
            ["nat", "2"], ["lam", "p", "explicit", 1, 3], ["app", 4, 2]],
            0, 5, ["Nat", "True", "appliedAliasProof"])
        source = self.synthetic(alias, proof, applied, consumer).compile("aliasProofResult")["source"]
        nat, zero, succ = (translate.symbol(n) for n in ("Nat", "Nat.zero", "Nat.succ"))
        two = f"({succ} ({succ} {zero}))"
        source += (f"\nmu Witness : (0 n : {nat}) -> Type 0 with\n"
                   f"| two : Witness {two}\n"
                   f"def computed : Witness {translate.symbol('aliasProofResult')} := two\n")
        erased = self.check_synthetic_source(source)["erased"]
        for name in ("Propositions", "aliasProof", "appliedAliasProof"):
            self.assertIn(f"erased {translate.symbol(name)}\n", erased)
        self.assertNotIn("KLet", erased)
        self.check_synthetic_source(source.replace(f"| two : Witness {two}",
                                                  f"| two : Witness {zero}"), accepted=False)

    @unittest.skipUnless(LIVE, "requires --live and a built Veil checker")
    def test_sort_alias_higher_universes_retain_checked_type_results(self):
        level = ["succ", ["succ", ["zero"]]]
        alias = sort_alias("HigherSort", level)
        generic = aliased_identity("higherIdentity", "HigherSort", "type", level)
        result = definition("higherResult", [
            ["sort", ["succ", ["zero"]]], ["const", "Nat", []],
            ["const", "higherIdentity", []], ["app", 2, 0], ["app", 3, 1]],
            0, 4, ["Nat", "higherIdentity"])
        source = self.synthetic(alias, generic, result).compile("higherResult")["source"]
        outputs = self.check_synthetic_source(source)
        self.assertIn(f"erased {translate.symbol('higherResult')}\n", outputs["erased"])
        source += (f"def typeWitness : {translate.symbol('higherResult')} := "
                   f"{translate.symbol('Nat.zero')}\n")
        self.check_synthetic_source(source)
        self.check_synthetic_source(source.replace(":= " + translate.symbol('Nat.zero'),
                                                  ":= (Type 0)"), accepted=False)

    @unittest.skipUnless(LIVE, "requires --live and a built Veil checker")
    def test_sort_aliases_check_unused_arguments_and_alias_definitions(self):
        alias = sort_alias("SortAlias")
        ignored = definition("aliasUnused", [
            ["const", "SortAlias", []], ["const", "Nat", []], ["nat", "2"],
            ["forall", "same", "implicit", 0, 1], ["lam", "same", "implicit", 0, 2]],
            3, 4, ["SortAlias", "Nat"])
        source = self.synthetic(alias, ignored).compile("aliasUnused")["source"]
        nat, zero = translate.symbol("Nat"), translate.symbol("Nat.zero")
        prefix = f"\ndef used : {nat} := {translate.symbol('aliasUnused')} "
        self.check_synthetic_source(source + prefix + nat + "\n")
        for argument in (zero, "(Type 0)", "(Type 1)"):
            with self.subTest(argument=argument):
                self.check_synthetic_source(source + prefix + argument + "\n", accepted=False)
        # Alias bodies remain checked, even when the consumer ignores its input.
        bad = source.replace(f"def {translate.symbol('SortAlias')} : (Type 1)",
                             f"def {translate.symbol('SortAlias')} : (Type 0)")
        self.assertNotEqual(source, bad)
        self.check_synthetic_source(bad + prefix + nat + "\n", accepted=False)
        family, constructor = alias_family("AliasBox", "SortAlias",
                                           ["succ", ["succ", ["zero"]]])
        family_source = self.synthetic(family, constructor).compile("AliasBox")["source"]
        self.assertIn(f"(0 b0 : {translate.symbol('SortAlias')})", family_source)
        erased = self.check_synthetic_source(family_source)["erased"]
        self.assertIn(f"erased {translate.symbol('SortAlias')}\n", erased)

    def test_prop_sort_preserves_closed_levels(self):
        zero, one = ["zero"], ["succ", ["zero"]]
        for level, expected in ((zero, "Prop"), (one, "(Type 0)"),
                                (["succ", one], "(Type 1)"),
                                (["imax", ["succ", one], zero], "Prop"),
                                (["max", one, zero], "(Type 0)")):
            with self.subTest(level=level):
                self.assertEqual(translate.Expressions({"nodes": [["sort", level]]}).render(0), expected)

    def test_empty_prop_and_data_families(self):
        for level, expected in ((["zero"], "Prop"), (["succ", ["zero"]], "(Type 0)")):
            with self.subTest(level=level):
                self.value = copy.deepcopy(self.original)
                unit = self.synthetic(empty_family("Empty", level)).compile("Empty")
                self.assertEqual(unit["source"], f"mu {translate.symbol('Empty')} : {expected} with\n")
                self.assertEqual(unit["members"], ["Empty"])

    def test_theorem_guard_names_do_not_capture_translated_names(self):
        names = ["proof", "p70726f6f66", "Prop", "b0", "α"]
        rows = [theorem(name, [["const", "True", []], ["const", "True.intro", []]],
                        0, 1, ["True", "True.intro"]) for name in names]
        translator = self.synthetic(*rows)
        guards = {"p" + name.encode("utf-8").hex() for name in names}
        self.assertEqual(len(guards), len(names))
        self.assertTrue(guards.isdisjoint({translate.symbol(name) for name in names}))
        for name in names:
            source = translator.compile(name)["source"]
            self.assertIn(f"def p{name.encode('utf-8').hex()} : Prop := {translate.symbol('True')}", source)

    def test_theorem_recursion_mutual_and_opaque_dependencies_remain_gaps(self):
        loop = theorem("loopProof", [["const", "True", []], ["const", "loopProof", []]],
                       0, 1, ["True"])
        self.synthetic(loop)
        self.rejects("loopProof", "recursive definitions or theorems")
        other = theorem("mutualProof", [["const", "True", []], ["const", "True.intro", []]],
                        0, 1, ["True", "True.intro"])
        other["details"]["mutual"].append("loopProof")
        other["dependencies"].append("loopProof")
        other["dependencies"].sort()
        self.synthetic(other)
        self.rejects("mutualProof", "mutual definitions or theorems")
        opaque = theorem("opaqueProof", [["const", "True", []], ["const", "True.intro", []]],
                         0, 1, ["True", "True.intro"])
        opaque["kind"] = "opaque"
        opaque["details"]["unsafe"] = False
        dependent = theorem("useOpaque", [["const", "True", []], ["const", "opaqueProof", []]],
                            0, 1, ["True", "opaqueProof"])
        self.synthetic(opaque, dependent)
        self.rejects("useOpaque", "dependency opaqueProof: opaque")

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
        variants = [(path, label) for path in self.pinned_inputs[1] for label in (*labels, "check-stderr")]
        for artifact, label in variants:
            with self.subTest(artifact=artifact, label=label), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                report = self.stage_mock_record(directory)
                captures = {path: unit["checks"] for path, unit in report["artifacts"].items()}
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
                expected = {"Nat", "Nat.zero", "Nat.succ", "True", "True.intro"}
                expected -= set(report["artifacts"][artifact]["declarations"])
                self.assertEqual({row["name"] for row in result["results"] if row["status"] == "rechecked"},
                                 expected)
                self.assertEqual(result["summary"]["rechecked"], len(expected))
                self.assertEqual(result["summary"]["translation_gaps"], 44 - len(expected))
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
            self.assertEqual(report["summary"], {"snapshot_declarations": 44, "rechecked": 5,
                                                "translation_gaps": 39, "parity_credited": 0})
            self.assertEqual(translate.verify(directory, SNAPSHOT, INVENTORY, checker=CHECKER), report)

    @unittest.skipUnless(LIVE, "requires --live and a built Veil checker")
    def test_closed_proofs_erase_while_proof_consumers_compute(self):
        proof = theorem("truthProof", [["const", "True", []], ["const", "True.intro", []]],
                        0, 1, ["True", "True.intro"])
        proof_id = theorem("proofIdentity", [["const", "True", []], ["bvar", 0],
                                             ["forall", "p", "explicit", 0, 0],
                                             ["lam", "p", "explicit", 0, 1]], 2, 3, ["True"])
        proof_let = theorem("proofLet", [["const", "True", []], ["const", "truthProof", []],
                                        ["bvar", 0], ["let", "p", 0, 1, 2, False]],
                            0, 3, ["True", "truthProof"])
        consume = definition("consumeProof", [["const", "True", []], ["const", "Nat", []],
                                              ["nat", "2"], ["forall", "p", "explicit", 0, 1],
                                              ["lam", "p", "explicit", 0, 2]], 3, 4, ["True", "Nat"])
        result = definition("proofResult", [["const", "Nat", []], ["const", "consumeProof", []],
                                            ["const", "proofIdentity", []], ["const", "proofLet", []],
                                            ["app", 2, 3], ["app", 1, 4]],
                            0, 5, ["Nat", "consumeProof", "proofIdentity", "proofLet"])
        source = self.synthetic(proof, proof_id, proof_let, consume, result).compile("proofResult")["source"]
        nat, zero, succ = (translate.symbol(n) for n in ("Nat", "Nat.zero", "Nat.succ"))
        source += (f"\nmu Witness : (0 n : {nat}) -> Type 0 with\n"
                   f"| two : Witness ({succ} ({succ} {zero}))\n"
                   f"def computed : Witness {translate.symbol('proofResult')} := two\n")
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            path = directory / "proofs.kan"
            path.write_text(source)
            checks = translate.check_artifact(CHECKER, directory, path.name)
            self.assertTrue(all(check["exit_code"] == 0 for check in checks),
                            (directory / "proofs.kan.check.stderr").read_text())
            erased = (directory / "proofs.kan.erased.stdout").read_text()
            for name in ("truthProof", "proofIdentity", "proofLet"):
                self.assertIn(f"erased {translate.symbol(name)}\n", erased)
                self.assertIn(f"erased p{name.encode('utf-8').hex()}\n", erased)
            self.assertIn(f"fun {translate.symbol('consumeProof')} () :", erased)
            self.assertIn(f"KTail (KGlobal {translate.symbol('consumeProof')}) []", erased)
            self.assertEqual((directory / "proofs.kan.axioms.stdout").read_bytes(), b"")
            path.write_text(source.replace(f"| two : Witness ({succ} ({succ} {zero}))",
                                           f"| two : Witness {zero}"))
            self.assertEqual(translate.check_artifact(CHECKER, directory, path.name)[0]["exit_code"], 1)

    @unittest.skipUnless(LIVE, "requires --live and a built Veil checker")
    def test_theorem_guard_rejects_data_but_ordinary_definitions_pass(self):
        row = theorem("notAProof", [["const", "Nat", []], ["const", "Nat.zero", []]],
                      0, 1, ["Nat", "Nat.zero"])
        source = self.synthetic(row).compile("notAProof")["source"]
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            path = directory / "guard.kan"
            path.write_text(source)
            checks = translate.check_artifact(CHECKER, directory, path.name)
            self.assertEqual([check["exit_code"] for check in checks[:2]], [1, 1])
            self.assertIn("expected universe is 0", (directory / "guard.kan.check.stderr").read_text())
            # Removing the theorem-only guard admits this as an ordinary data
            # definition, so the negative leg exercises the guard itself.
            guard = f"def p{row['name'].encode('utf-8').hex()} : Prop := {translate.symbol('Nat')}\n"
            self.assertEqual(source.count(guard), 1)
            path.write_text(source.replace(guard, ""))
            self.assertTrue(all(check["exit_code"] == 0
                                for check in translate.check_artifact(CHECKER, directory, path.name)))

    @unittest.skipUnless(LIVE, "requires --live and a built Veil checker")
    def test_empty_families_check_and_a_false_proof_is_rejected(self):
        empty_prop = empty_family("EmptyProp", ["zero"])
        empty_data = empty_family("EmptyData", ["succ", ["zero"]])
        bad_proof = theorem("falseProof", [["const", "EmptyProp", []], ["const", "True.intro", []]],
                            0, 1, ["EmptyProp", "True.intro"])
        translator = self.synthetic(empty_prop, empty_data, bad_proof)
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            path = directory / "empty.kan"
            for name in ("EmptyProp", "EmptyData"):
                path.write_text(translator.compile(name)["source"])
                self.assertTrue(all(check["exit_code"] == 0
                                    for check in translate.check_artifact(CHECKER, directory, path.name)))
            path.write_text(translator.compile("falseProof")["source"])
            self.assertEqual(translate.check_artifact(CHECKER, directory, path.name)[0]["exit_code"], 1)

    @unittest.skipUnless(LIVE, "requires --live and a built Veil checker")
    def test_closed_sort_data_binders_compute_and_erase(self):
        generic = generic_identity()
        select = select_first()
        forwarded = definition("forwarded", [
            ["sort", ["succ", ["zero"]]], ["bvar", 0], ["bvar", 1],
            ["forall", "same", "explicit", 1, 2],
            ["forall", "same", "implicit", 0, 3],
            ["const", "genericIdentity", []], ["app", 5, 2], ["app", 6, 1],
            ["lam", "same", "explicit", 1, 7], ["lam", "same", "implicit", 0, 8]],
            4, 9, ["genericIdentity"])
        partial = definition("partialGeneric", [
            ["const", "Nat", []], ["forall", "x", "explicit", 0, 0],
            ["const", "forwarded", []], ["app", 2, 0]], 1, 3, ["Nat", "forwarded"])
        result = definition("genericResult", [
            ["const", "Nat", []], ["const", "partialGeneric", []], ["nat", "2"],
            ["app", 1, 2], ["forall", "x", "explicit", 0, 0], ["const", "partialGeneric", []],
            ["const", "selectFirst", []], ["app", 6, 0], ["app", 7, 4],
            ["app", 8, 3], ["app", 9, 5]],
            0, 10, ["Nat", "partialGeneric", "selectFirst"])
        translator = self.synthetic(generic, select, forwarded, partial, result)
        nat, zero, succ = (translate.symbol(n) for n in ("Nat", "Nat.zero", "Nat.succ"))
        two = f"({succ} ({succ} {zero}))"
        source = translator.compile("genericResult")["source"]
        source += (f"\nmu Witness : (0 n : {nat}) -> Type 0 with\n"
                   f"| two : Witness {two}\n"
                   f"def computed : Witness {translate.symbol('genericResult')} := two\n")
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            path = directory / "generic.kan"
            path.write_text(source)
            checks = translate.check_artifact(CHECKER, directory, path.name)
            self.assertEqual([check["exit_code"] for check in checks], [0, 0, 0],
                             (directory / "generic.kan.check.stderr").read_text())
            erased = (directory / "generic.kan.erased.stdout").read_text()
            self.assertIn(f"fun {translate.symbol('genericIdentity')} (union any) : union any := KVar 0\n",
                          erased)
            self.assertIn(f"fun {translate.symbol('selectFirst')} (union any, union any) : union any := KVar 1\n",
                          erased)
            self.assertEqual((directory / "generic.kan.axioms.stdout").read_bytes(), b"")
            for label, _ in translate.CHECKS:
                self.assertEqual((directory / f"generic.kan.{label}.stderr").read_bytes(), b"")
            path.write_text(source.replace(f"| two : Witness {two}", f"| two : Witness {zero}"))
            self.assertEqual(translate.check_artifact(CHECKER, directory, path.name)[0]["exit_code"], 1)

    @unittest.skipUnless(LIVE, "requires --live and a built Veil checker")
    def test_closed_sort_proposition_binders_preserve_proofs(self):
        proof = generic_identity("genericProof", ["zero"])
        proof["kind"], proof["details"] = "theorem", {"mutual": ["genericProof"]}
        applied = theorem("appliedProof", [
            ["const", "True", []], ["const", "True.intro", []],
            ["const", "genericProof", []], ["app", 2, 0], ["app", 3, 1]],
            0, 4, ["True", "True.intro", "genericProof"])
        consumer = definition("proofResult", [
            ["const", "Nat", []], ["const", "True", []], ["const", "appliedProof", []],
            ["nat", "2"], ["lam", "p", "explicit", 1, 3], ["app", 4, 2]],
            0, 5, ["Nat", "True", "appliedProof"])
        translator = self.synthetic(proof, applied, consumer)
        source = translator.compile("proofResult")["source"]
        nat, zero, succ = (translate.symbol(n) for n in ("Nat", "Nat.zero", "Nat.succ"))
        two = f"({succ} ({succ} {zero}))"
        source += (f"\nmu Witness : (0 n : {nat}) -> Type 0 with\n"
                   f"| two : Witness {two}\n"
                   f"def computed : Witness {translate.symbol('proofResult')} := two\n")
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            path = directory / "generic-proof.kan"
            path.write_text(source)
            checks = translate.check_artifact(CHECKER, directory, path.name)
            self.assertEqual([check["exit_code"] for check in checks], [0, 0, 0],
                             (directory / "generic-proof.kan.check.stderr").read_text())
            erased = (directory / "generic-proof.kan.erased.stdout").read_text()
            for name in ("genericProof", "appliedProof"):
                self.assertIn(f"erased {translate.symbol(name)}\n", erased)
                self.assertIn(f"erased p{name.encode('utf-8').hex()}\n", erased)
            self.assertNotIn("KLet", erased)
            self.assertEqual((directory / "generic-proof.kan.axioms.stdout").read_bytes(), b"")
            path.write_text(source.replace(f"| two : Witness {two}", f"| two : Witness {zero}"))
            self.assertEqual(translate.check_artifact(CHECKER, directory, path.name)[0]["exit_code"], 1)

    @unittest.skipUnless(LIVE, "requires --live and a built Veil checker")
    def test_closed_sort_binders_check_universes_and_unused_arguments(self):
        high = generic_identity("highIdentity", ["succ", ["succ", ["zero"]]])
        unused = definition("unusedType", [
            ["sort", ["succ", ["zero"]]], ["const", "Nat", []], ["nat", "2"],
            ["forall", "A", "explicit", 0, 1], ["lam", "A", "explicit", 0, 2]],
            3, 4, ["Nat"])
        self.synthetic(generic_identity(), high, unused)
        translator = translate.Translator(self.value)
        nat, zero = (translate.symbol(n) for n in ("Nat", "Nat.zero"))
        generic, high_name, unused_name = (translate.symbol(n) for n in
                                           ("genericIdentity", "highIdentity", "unusedType"))
        cases = (
            ("highIdentity", f"def alias : Type 0 := {high_name} (Type 0) {nat}\n"
                             f"def typed : alias := {zero}\n",
             f"def alias : Type 0 := {high_name} (Type 1) {nat}\n"),
            ("genericIdentity", f"def good : {nat} := {generic} {nat} {zero}\n",
             f"def bad : {nat} := {generic} {zero} {zero}\n"),
            ("genericIdentity", f"def good : {nat} := {generic} {nat} {zero}\n",
             f"def bad : {nat} := {generic} {nat} {nat}\n"),
            ("unusedType", f"def good : {nat} := {unused_name} {nat}\n",
             f"def bad : {nat} := {unused_name} {zero}\n"),
        )
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            path = directory / "generic-types.kan"
            for name, good, bad in cases:
                with self.subTest(name=name, bad=bad):
                    source = translator.compile("Nat")["source"] + translator.compile(name)["body"]
                    path.write_text(source + good)
                    checks = translate.check_artifact(CHECKER, directory, path.name)
                    self.assertEqual([check["exit_code"] for check in checks], [0, 0, 0],
                                     (directory / "generic-types.kan.check.stderr").read_text())
                    self.assertEqual((directory / "generic-types.kan.axioms.stdout").read_bytes(), b"")
                    path.write_text(source + bad)
                    checks = translate.check_artifact(CHECKER, directory, path.name)
                    self.assertEqual([check["exit_code"] for check in checks[:2]], [1, 1])

    @unittest.skipUnless(LIVE, "requires --live and a built Veil checker")
    def test_direct_type_applications_and_type_lets_compute(self):
        identity_nodes = [["sort", ["succ", ["zero"]]], ["bvar", 0],
                          ["lam", "same", "explicit", 1, 1],
                          ["lam", "same", "implicit", 0, 2]]
        direct = definition("directType", identity_nodes + [
            ["const", "Nat", []], ["nat", "2"], ["app", 3, 4], ["app", 6, 5]],
            4, 7, ["Nat"])
        plain = definition("typeLet", [
            ["sort", ["succ", ["zero"]]], ["const", "Nat", []], ["nat", "2"],
            ["bvar", 0], ["let", "same", 3, 2, 3, False],
            ["let", "same", 0, 1, 4, False]], 1, 5, ["Nat"])
        headed = definition("typeLetHead", [
            ["sort", ["succ", ["zero"]]], ["const", "Nat", []], ["nat", "2"],
            ["bvar", 0], ["lam", "same", "explicit", 3, 3],
            ["let", "same", 0, 1, 4, False], ["app", 5, 2]], 1, 6, ["Nat"])
        partial = definition("typePartial", identity_nodes + [
            ["const", "Nat", []], ["forall", "x", "explicit", 4, 4], ["app", 3, 4]],
            5, 6, ["Nat"])
        translator = self.synthetic(direct, plain, headed, partial)
        nat, zero, succ = (translate.symbol(n) for n in ("Nat", "Nat.zero", "Nat.succ"))
        two = f"({succ} ({succ} {zero}))"
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            path = directory / "type-lets.kan"
            for name, lets in (("directType", 1), ("typeLet", 1), ("typeLetHead", 1),
                               ("typePartial", 0)):
                with self.subTest(name=name):
                    value = translate.symbol(name)
                    if name == "typePartial":
                        value = f"({value} {two})"
                    source = translator.compile(name)["source"]
                    source += (f"\nmu Witness : (0 n : {nat}) -> Type 0 with\n"
                               f"| two : Witness {two}\n"
                               f"def computed : Witness {value} := two\n")
                    path.write_text(source)
                    checks = translate.check_artifact(CHECKER, directory, path.name)
                    self.assertEqual([check["exit_code"] for check in checks], [0, 0, 0],
                                     (directory / f"{path.name}.check.stderr").read_text())
                    erased = (directory / f"{path.name}.erased.stdout").read_text()
                    self.assertEqual(erased.count("KLet"), lets, erased)
                    self.assertEqual((directory / f"{path.name}.axioms.stdout").read_bytes(), b"")
                    path.write_text(source.replace(f"| two : Witness {two}",
                                                   f"| two : Witness {zero}"))
                    checks = translate.check_artifact(CHECKER, directory, path.name)
                    self.assertEqual([check["exit_code"] for check in checks[:2]], [1, 1])

    @unittest.skipUnless(LIVE, "requires --live and a built Veil checker")
    def test_type_lets_preserve_outer_scope_and_higher_sorts(self):
        direct = generic_identity("forwardType")
        direct["nodes"] += [["app", 6, 2], ["app", 7, 1],
                            ["lam", "same", "explicit", 1, 8],
                            ["lam", "same", "implicit", 0, 9]]
        direct["value"] = 10
        alias = definition("aliasForward", [
            ["sort", ["succ", ["zero"]]], ["bvar", 0], ["bvar", 1],
            ["forall", "same", "explicit", 1, 2], ["forall", "same", "implicit", 0, 3],
            ["let", "same", 1, 2, 1, False], ["let", "same", 0, 2, 5, False],
            ["lam", "same", "explicit", 1, 6], ["lam", "same", "implicit", 0, 7]],
            4, 8, [])
        high = definition("directHigh", [
            ["sort", ["succ", ["succ", ["zero"]]]], ["bvar", 0],
            ["lam", "same", "explicit", 1, 1], ["lam", "same", "implicit", 0, 2],
            ["sort", ["succ", ["zero"]]], ["const", "Nat", []],
            ["app", 3, 4], ["app", 6, 5]], 4, 7, ["Nat"])
        translator = self.synthetic(direct, alias, high)
        nat, zero, succ = (translate.symbol(n) for n in ("Nat", "Nat.zero", "Nat.succ"))
        two = f"({succ} ({succ} {zero}))"
        source = translator.compile("Nat")["source"]
        source += "".join(translator.compile(name)["body"] for name in
                          ("forwardType", "aliasForward", "directHigh"))
        source += (f"\nmu Witness : (0 n : {nat}) -> Type 0 with\n"
                   f"| two : Witness {two}\n"
                   f"def typed : {translate.symbol('directHigh')} := {zero}\n")
        for name in ("forwardType", "aliasForward"):
            source += f"def {name}Check : Witness ({translate.symbol(name)} {nat} {two}) := two\n"
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            path = directory / "type-scopes.kan"
            path.write_text(source)
            checks = translate.check_artifact(CHECKER, directory, path.name)
            self.assertEqual([check["exit_code"] for check in checks], [0, 0, 0],
                             (directory / f"{path.name}.check.stderr").read_text())
            erased = (directory / f"{path.name}.erased.stdout").read_text()
            for name in ("forwardType", "aliasForward"):
                self.assertIn(f"fun {translate.symbol(name)} (union any) : union any :=", erased)
            self.assertIn(f"erased {translate.symbol('directHigh')}\n", erased)
            self.assertEqual(erased.count("KLet"), 2, erased)
            self.assertEqual((directory / f"{path.name}.axioms.stdout").read_bytes(), b"")
            path.write_text(source.replace(f"| two : Witness {two}", f"| two : Witness {zero}"))
            checks = translate.check_artifact(CHECKER, directory, path.name)
            self.assertEqual([check["exit_code"] for check in checks[:2]], [1, 1])

    @unittest.skipUnless(LIVE, "requires --live and a built Veil checker")
    def test_type_let_propositions_and_direct_proofs_erase(self):
        direct = theorem("directProof", [
            ["sort", ["zero"]], ["bvar", 0], ["lam", "same", "explicit", 1, 1],
            ["lam", "same", "implicit", 0, 2],
            ["const", "True", []], ["const", "True.intro", []],
            ["app", 3, 4], ["app", 6, 5]], 4, 7, ["True", "True.intro"])
        plain = theorem("propLet", [
            ["sort", ["zero"]], ["const", "True", []], ["const", "True.intro", []],
            ["bvar", 0], ["let", "same", 3, 2, 3, False],
            ["let", "same", 0, 1, 4, False]], 1, 5, ["True", "True.intro"])
        headed = theorem("propLetHead", [
            ["sort", ["zero"]], ["const", "True", []], ["const", "True.intro", []],
            ["bvar", 0], ["lam", "same", "explicit", 3, 3],
            ["let", "same", 0, 1, 4, False], ["app", 5, 2]], 1, 6, ["True", "True.intro"])
        translator = self.synthetic(direct, plain, headed)
        nat, zero, succ = (translate.symbol(n) for n in ("Nat", "Nat.zero", "Nat.succ"))
        two = f"({succ} ({succ} {zero}))"
        source = translator.compile("Nat")["source"] + translator.compile("True")["source"]
        source += "".join(translator.compile(name)["body"] for name in
                          ("directProof", "propLet", "propLetHead"))
        source += (f"def result : {nat} := let p : {translate.symbol('True')} := "
                   f"{translate.symbol('propLetHead')} in {two}\n"
                   f"mu Witness : (0 n : {nat}) -> Type 0 with\n"
                   f"| two : Witness {two}\ndef computed : Witness result := two\n")
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            path = directory / "prop-lets.kan"
            path.write_text(source)
            checks = translate.check_artifact(CHECKER, directory, path.name)
            self.assertEqual([check["exit_code"] for check in checks], [0, 0, 0],
                             (directory / f"{path.name}.check.stderr").read_text())
            erased = (directory / f"{path.name}.erased.stdout").read_text()
            self.assertNotIn("KLet", erased)
            for name in ("directProof", "propLet", "propLetHead"):
                self.assertIn(f"erased {translate.symbol(name)}\n", erased)
                self.assertIn(f"erased p{name.encode('utf-8').hex()}\n", erased)
            self.assertEqual((directory / f"{path.name}.axioms.stdout").read_bytes(), b"")
            path.write_text(source.replace(f"| two : Witness {two}", f"| two : Witness {zero}"))
            checks = translate.check_artifact(CHECKER, directory, path.name)
            self.assertEqual([check["exit_code"] for check in checks[:2]], [1, 1])

    @unittest.skipUnless(LIVE, "requires --live and a built Veil checker")
    def test_type_lets_check_even_unused_arguments_and_values(self):
        for level, good, bad in ((["succ", ["zero"]], ["const", "Nat", []], ["nat", "0"]),
                                  (["zero"], ["const", "True", []], ["const", "Nat", []]),
                                  (["succ", ["succ", ["zero"]]],
                                   ["sort", ["succ", ["zero"]]],
                                   ["sort", ["succ", ["succ", ["zero"]]]])):
            for form in ("let", "lambda", "head"):
                for valid, value in ((True, good), (False, bad)):
                    with self.subTest(level=level, form=form, valid=valid):
                        nodes = [["sort", level], value, ["const", "Nat", []], ["nat", "2"]]
                        if form == "let":
                            nodes += [["let", "same", 0, 1, 3, False]]
                        elif form == "lambda":
                            nodes += [["lam", "same", "explicit", 0, 3], ["app", 4, 1]]
                        else:
                            nodes += [["bvar", 0], ["lam", "x", "explicit", 2, 4],
                                      ["let", "same", 0, 1, 5, False], ["app", 6, 3]]
                        row = definition("checkedType", nodes, 2, len(nodes) - 1,
                                         ["Nat", *(["True"] if value == ["const", "True", []] else [])])
                        snapshot = copy.deepcopy(self.original)
                        translate.declarations.declaration(row, snapshot["modules"])
                        snapshot["declarations"].append(row)
                        source = translate.Translator(snapshot).compile("checkedType")["source"]
                        with tempfile.TemporaryDirectory() as temporary:
                            directory = Path(temporary)
                            path = directory / "unused-type.kan"
                            path.write_text(source)
                            checks = translate.check_artifact(CHECKER, directory, path.name)
                            self.assertEqual([check["exit_code"] for check in checks[:2]],
                                             [0, 0] if valid else [1, 1],
                                             (directory / f"{path.name}.check.stderr").read_text())
                            if valid:
                                self.assertEqual(checks[2]["exit_code"], 0)
                                self.assertEqual((directory / f"{path.name}.axioms.stdout").read_bytes(), b"")

    @unittest.skipUnless(LIVE, "requires --live and a built Veil checker")
    def test_type_let_kernel_quantities_and_normalized_domains(self):
        nat = translate.symbol("Nat")
        zero = translate.symbol("Nat.zero")
        prefix = translate.Translator(self.value).compile("Nat")["source"]
        prefix += (f"def Family : (n : {nat}) -> Type 0 := fun (n : {nat}) => {nat}\n"
                   "def UniverseAlias : Type 1 := Type 0\n")
        cases = (
            ("def alias : (0 A : Type 0) -> (x : A) -> A := "
             "fun (0 A : Type 0) => fun (x : A) => "
             "let B : UniverseAlias := A in let y : B := x in y\n", True),
            (f"def once : (1 x : {nat}) -> {nat} := fun (1 x : {nat}) => "
             "let A : Type 0 := Family x in let y : A := x in y\n", True),
            (f"def lost : (1 x : {nat}) -> {nat} := fun (1 x : {nat}) => "
             f"let A : Type 0 := Family x in {zero}\n", False),
            (f"def twice : (1 x : {nat}) -> {nat} := fun (1 x : {nat}) => "
             "let A : Type 0 := Family x in let y : A := x in x\n", False),
            (f"def erasedRead : (0 x : {nat}) -> {nat} := fun (0 x : {nat}) => "
             f"let y : {nat} := x in y\n", False),
            (f"def runtimeType : (A : Type 0) -> {nat} := fun (A : Type 0) => {zero}\n"
             f"def erasedType : {nat} := let A : Type 0 := {nat} in runtimeType A\n", False),
        )
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            path = directory / "type-let-quantities.kan"
            for body, valid in cases:
                with self.subTest(body=body):
                    path.write_text(prefix + body)
                    checks = translate.check_artifact(CHECKER, directory, path.name)
                    self.assertEqual([check["exit_code"] for check in checks[:2]],
                                     [0, 0] if valid else [1, 1],
                                     (directory / f"{path.name}.check.stderr").read_text())
                    if valid:
                        self.assertEqual(checks[2]["exit_code"], 0)
                        self.assertEqual((directory / f"{path.name}.axioms.stdout").read_bytes(), b"")

    @unittest.skipUnless(LIVE, "requires --live and a built Veil checker")
    def test_lambda_applications_compute_without_capturing_variables(self):
        direct = definition("betaDirect", [["const", "Nat", []], ["bvar", 0], ["nat", "2"],
                                            ["lam", "x", "explicit", 0, 1], ["app", 3, 2]],
                            0, 4, ["Nat"])
        capture = definition("betaCapture", [["const", "Nat", []], ["bvar", 0], ["nat", "0"],
                                              ["forall", "x", "explicit", 0, 0],
                                              ["lam", "same", "explicit", 0, 1],
                                              ["lam", "same", "explicit", 0, 4],
                                              ["app", 5, 2], ["app", 6, 1],
                                              ["lam", "same", "explicit", 0, 7]],
                             3, 8, ["Nat"])
        partial = definition("betaPartial", [["const", "Nat", []], ["bvar", 1], ["nat", "2"],
                                              ["forall", "x", "explicit", 0, 0],
                                              ["lam", "same", "explicit", 0, 1],
                                              ["lam", "same", "explicit", 0, 4], ["app", 5, 2]],
                             3, 6, ["Nat"])
        higher = definition("betaHigher", [["const", "Nat", []], ["bvar", 0], ["nat", "2"],
                                            ["forall", "x", "explicit", 0, 0],
                                            ["lam", "x", "explicit", 0, 1],
                                            ["lam", "f", "explicit", 3, 1],
                                            ["app", 5, 4], ["app", 6, 2]],
                            0, 7, ["Nat"])
        nested = definition("betaNested", [["const", "Nat", []], ["bvar", 0],
                                            ["lam", "x", "explicit", 0, 1], ["nat", "2"],
                                            ["app", 2, 3], ["app", 2, 1],
                                            ["lam", "x", "explicit", 0, 5], ["app", 6, 4]],
                            0, 7, ["Nat"])
        translator = self.synthetic(direct, capture, partial, higher, nested)
        nat, zero, succ = (translate.symbol(n) for n in ("Nat", "Nat.zero", "Nat.succ"))
        two = f"({succ} ({succ} {zero}))"
        for row, argument in ((direct, ""), (capture, two), (partial, zero), (higher, ""), (nested, "")):
            with self.subTest(name=row["name"]), tempfile.TemporaryDirectory() as temporary:
                name = translate.symbol(row["name"])
                result = f"({name} {argument})" if argument else name
                source = translator.compile(row["name"])["source"]
                source += (f"\nmu Witness : (0 n : {nat}) -> Type 0 with\n"
                           f"| two : Witness {two}\n"
                           f"def computed : Witness {result} := two\n")
                directory = Path(temporary)
                path = directory / "beta.kan"
                path.write_text(source)
                checks = translate.check_artifact(CHECKER, directory, path.name)
                self.assertEqual([check["exit_code"] for check in checks], [0, 0, 0],
                                 (directory / "beta.kan.check.stderr").read_text())
                for label, _ in translate.CHECKS:
                    self.assertEqual((directory / f"beta.kan.{label}.stderr").read_bytes(), b"")
                self.assertEqual((directory / "beta.kan.axioms.stdout").read_bytes(), b"")
                self.assertIn("KLet", (directory / "beta.kan.erased.stdout").read_text())
                path.write_text(source.replace(f"| two : Witness {two}", f"| two : Witness {zero}"))
                self.assertEqual(translate.check_artifact(CHECKER, directory, path.name)[0]["exit_code"], 1)

    @unittest.skipUnless(LIVE, "requires --live and a built Veil checker")
    def test_let_applications_compute_without_capturing_variables(self):
        direct = definition("letDirect", [["const", "Nat", []], ["bvar", 0], ["nat", "0"],
                                          ["nat", "2"], ["lam", "same", "explicit", 0, 1],
                                          ["let", "same", 0, 2, 4, False], ["app", 5, 3]],
                            0, 6, ["Nat"])
        capture = definition("letCapture", [["const", "Nat", []], ["bvar", 0], ["nat", "0"],
                                            ["forall", "same", "explicit", 0, 0],
                                            ["lam", "same", "explicit", 0, 1],
                                            ["let", "same", 0, 2, 4, False], ["app", 5, 1],
                                            ["lam", "same", "explicit", 0, 6]],
                             3, 7, ["Nat"])
        mixed = definition("letMixed", [["const", "Nat", []], ["bvar", 0], ["nat", "0"],
                                        ["nat", "2"], ["lam", "same", "explicit", 0, 1],
                                        ["lam", "same", "explicit", 0, 4], ["app", 5, 1],
                                        ["let", "same", 0, 2, 6, False], ["app", 7, 3]],
                           0, 8, ["Nat"])
        partial = definition("letPartial", [["const", "Nat", []], ["bvar", 1], ["nat", "2"],
                                            ["forall", "x", "explicit", 0, 0],
                                            ["lam", "same", "explicit", 0, 1],
                                            ["let", "same", 0, 2, 4, False],
                                            ["lam", "same", "explicit", 0, 5], ["app", 6, 2]],
                             3, 7, ["Nat"])
        nested = definition("letNested", [["const", "Nat", []], ["bvar", 1], ["nat", "0"],
                                          ["nat", "2"], ["lam", "same", "explicit", 0, 1],
                                          ["let", "same", 0, 3, 4, False],
                                          ["let", "same", 0, 2, 5, False], ["app", 6, 2]],
                            0, 7, ["Nat"])
        higher = definition("letHigher", [["const", "Nat", []], ["bvar", 0], ["nat", "2"],
                                          ["forall", "x", "explicit", 0, 0],
                                          ["lam", "x", "explicit", 0, 1],
                                          ["lam", "f", "explicit", 3, 1],
                                          ["let", "n", 0, 2, 5, False],
                                          ["app", 6, 4], ["app", 7, 2]],
                            0, 8, ["Nat"])
        family = definition("letFamily", [["const", "Nat", []], ["sort", ["succ", ["zero"]]],
                                          ["forall", "n", "explicit", 0, 1],
                                          ["lam", "n", "explicit", 0, 0]], 2, 3, ["Nat"])
        dependent = definition("letDependent", [["const", "Nat", []], ["const", "letFamily", []],
                                                ["bvar", 0], ["app", 1, 2], ["nat", "2"],
                                                ["lam", "x", "explicit", 3, 2],
                                                ["let", "n", 0, 4, 5, False], ["app", 6, 4]],
                               0, 7, ["Nat", "letFamily"])
        translator = self.synthetic(direct, capture, mixed, partial, nested, higher, family, dependent)
        nat, zero, succ = (translate.symbol(n) for n in ("Nat", "Nat.zero", "Nat.succ"))
        two = f"({succ} ({succ} {zero}))"
        for row, argument in ((direct, ""), (capture, two), (mixed, ""),
                              (partial, zero), (nested, ""), (higher, ""), (dependent, "")):
            with self.subTest(name=row["name"]), tempfile.TemporaryDirectory() as temporary:
                name = translate.symbol(row["name"])
                result = f"({name} {argument})" if argument else name
                source = translator.compile(row["name"])["source"]
                source += (f"\nmu Witness : (0 n : {nat}) -> Type 0 with\n"
                           f"| two : Witness {two}\n"
                           f"def computed : Witness {result} := two\n")
                directory = Path(temporary)
                path = directory / "let.kan"
                path.write_text(source)
                checks = translate.check_artifact(CHECKER, directory, path.name)
                self.assertEqual([check["exit_code"] for check in checks], [0, 0, 0],
                                 (directory / "let.kan.check.stderr").read_text())
                for label, _ in translate.CHECKS:
                    self.assertEqual((directory / f"let.kan.{label}.stderr").read_bytes(), b"")
                self.assertEqual((directory / "let.kan.axioms.stdout").read_bytes(), b"")
                self.assertIn("KLet", (directory / "let.kan.erased.stdout").read_text())
                path.write_text(source.replace(f"| two : Witness {two}", f"| two : Witness {zero}"))
                self.assertEqual(translate.check_artifact(CHECKER, directory, path.name)[0]["exit_code"], 1)

    @unittest.skipUnless(LIVE, "requires --live and a built Veil checker")
    def test_let_proofs_erase_and_unused_bindings_remain_checked(self):
        proof = theorem("letProof", [["const", "True", []], ["const", "True.intro", []],
                                     ["bvar", 1], ["lam", "p", "explicit", 0, 2],
                                     ["let", "p", 0, 1, 3, False], ["app", 4, 1]],
                        0, 5, ["True", "True.intro"])
        consume = definition("letConsume", [["const", "Nat", []], ["const", "True", []],
                                            ["const", "letProof", []], ["nat", "2"],
                                            ["lam", "p", "explicit", 1, 3],
                                            ["let", "p", 1, 2, 4, False], ["app", 5, 2]],
                             0, 6, ["Nat", "True", "letProof"])
        translator = self.synthetic(proof, consume)
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            path = directory / "proof-let.kan"
            source = translator.compile("letConsume")["source"]
            nat, zero, succ = (translate.symbol(n) for n in ("Nat", "Nat.zero", "Nat.succ"))
            two = f"({succ} ({succ} {zero}))"
            source += (f"\nmu Witness : (0 n : {nat}) -> Type 0 with\n"
                       f"| two : Witness {two}\n"
                       f"def computed : Witness {translate.symbol('letConsume')} := two\n")
            path.write_text(source)
            checks = translate.check_artifact(CHECKER, directory, path.name)
            self.assertEqual([check["exit_code"] for check in checks], [0, 0, 0],
                             (directory / "proof-let.kan.check.stderr").read_text())
            erased = (directory / "proof-let.kan.erased.stdout").read_text()
            self.assertIn(f"erased {translate.symbol('letProof')}\n", erased)
            self.assertNotIn("KLet", erased)
            self.assertEqual((directory / "proof-let.kan.axioms.stdout").read_bytes(), b"")
            path.write_text(source.replace(f"| two : Witness {two}", f"| two : Witness {zero}"))
            self.assertEqual(translate.check_artifact(CHECKER, directory, path.name)[0]["exit_code"], 1)
            for bad_let in (True, False):
                with self.subTest(bad_let=bad_let):
                    row = definition("letUnused", [["const", "Nat", []], ["const", "True.intro", []],
                                                   ["nat", "2"], ["lam", "x", "explicit", 0, 2],
                                                   ["let", "x", 0, 1 if bad_let else 2, 3, False],
                                                   ["app", 4, 2 if bad_let else 1]],
                                     0, 5, ["Nat", "True.intro"])
                    self.value = copy.deepcopy(self.original)
                    bad = self.synthetic(row).compile("letUnused")["source"]
                    path.write_text(bad)
                    checks = translate.check_artifact(CHECKER, directory, path.name)
                    self.assertEqual([check["exit_code"] for check in checks[:2]], [1, 1])
                    path.write_text(bad.replace(f":= {translate.symbol('True.intro')} in", f":= {zero} in"))
                    self.assertTrue(all(check["exit_code"] == 0
                                        for check in translate.check_artifact(CHECKER, directory, path.name)))

    @unittest.skipUnless(LIVE, "requires --live and a built Veil checker")
    def test_lambda_application_preserves_dependent_domains(self):
        family = definition("betaFamily", [["const", "Nat", []], ["sort", ["succ", ["zero"]]],
                                            ["forall", "n", "explicit", 0, 1],
                                            ["lam", "n", "explicit", 0, 0]], 2, 3, ["Nat"])
        value = definition("betaDependent", [["const", "Nat", []], ["const", "betaFamily", []],
                                               ["bvar", 0], ["app", 1, 2], ["nat", "2"],
                                               ["lam", "x", "explicit", 3, 2],
                                               ["lam", "n", "explicit", 0, 5],
                                               ["app", 6, 4], ["app", 7, 4]],
                           0, 8, ["Nat", "betaFamily"])
        source = self.synthetic(family, value).compile("betaDependent")["source"]
        nat, zero, succ = (translate.symbol(n) for n in ("Nat", "Nat.zero", "Nat.succ"))
        source += (f"\nmu Witness : (0 n : {nat}) -> Type 0 with\n"
                   f"| two : Witness ({succ} ({succ} {zero}))\n"
                   f"def computed : Witness {translate.symbol('betaDependent')} := two\n")
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            path = directory / "dependent.kan"
            path.write_text(source)
            checks = translate.check_artifact(CHECKER, directory, path.name)
            self.assertEqual([check["exit_code"] for check in checks], [0, 0, 0],
                             (directory / "dependent.kan.check.stderr").read_text())
            path.write_text(source.replace(f"| two : Witness ({succ} ({succ} {zero}))",
                                           f"| two : Witness {zero}"))
            self.assertEqual(translate.check_artifact(CHECKER, directory, path.name)[0]["exit_code"], 1)

    @unittest.skipUnless(LIVE, "requires --live and a built Veil checker")
    def test_lambda_proof_arguments_erase_and_unused_bad_arguments_fail(self):
        proof = theorem("betaProof", [["const", "True", []], ["const", "True.intro", []],
                                       ["bvar", 0], ["lam", "p", "explicit", 0, 2], ["app", 3, 1]],
                        0, 4, ["True", "True.intro"])
        consume = definition("betaConsume", [["const", "Nat", []], ["const", "True", []],
                                              ["const", "betaProof", []], ["nat", "2"],
                                              ["lam", "p", "explicit", 1, 3], ["app", 4, 2]],
                             0, 5, ["Nat", "True", "betaProof"])
        unused = definition("betaUnused", [["const", "Nat", []], ["const", "True.intro", []],
                                            ["nat", "2"], ["lam", "x", "explicit", 0, 2],
                                            ["app", 3, 1]], 0, 4, ["Nat", "True.intro"])
        translator = self.synthetic(proof, consume, unused)
        nat, zero, succ = (translate.symbol(n) for n in ("Nat", "Nat.zero", "Nat.succ"))
        source = translator.compile("betaConsume")["source"]
        source += (f"\nmu Witness : (0 n : {nat}) -> Type 0 with\n"
                   f"| two : Witness ({succ} ({succ} {zero}))\n"
                   f"def computed : Witness {translate.symbol('betaConsume')} := two\n")
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            path = directory / "proof-beta.kan"
            path.write_text(source)
            checks = translate.check_artifact(CHECKER, directory, path.name)
            self.assertEqual([check["exit_code"] for check in checks], [0, 0, 0],
                             (directory / "proof-beta.kan.check.stderr").read_text())
            erased = (directory / "proof-beta.kan.erased.stdout").read_text()
            self.assertIn(f"erased {translate.symbol('betaProof')}\n", erased)
            self.assertNotIn("KLet", erased)
            self.assertEqual((directory / "proof-beta.kan.axioms.stdout").read_bytes(), b"")
            path.write_text(source.replace(f"| two : Witness ({succ} ({succ} {zero}))",
                                           f"| two : Witness {zero}"))
            self.assertEqual(translate.check_artifact(CHECKER, directory, path.name)[0]["exit_code"], 1)
            # An unused argument is still checked by its generated typed let.
            bad = translator.compile("betaUnused")["source"]
            path.write_text(bad)
            checks = translate.check_artifact(CHECKER, directory, path.name)
            self.assertEqual([check["exit_code"] for check in checks[:2]], [1, 1])
            path.write_text(bad.replace(f":= {translate.symbol('True.intro')} in", f":= {zero} in"))
            self.assertTrue(all(check["exit_code"] == 0
                                for check in translate.check_artifact(CHECKER, directory, path.name)))

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
