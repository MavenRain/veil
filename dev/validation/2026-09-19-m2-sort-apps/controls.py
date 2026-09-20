#!/usr/bin/env python3
"""Require application, scope, order and fuel mutations to fail focused tests."""

import importlib.util
import inspect
import io
import json
from pathlib import Path
import re
import sys
import textwrap
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location("application_regressions", ROOT / "dev/m2-translate-test.py")
tests = importlib.util.module_from_spec(SPEC)
if sys.argv[1:]:
    print("controls: expected no arguments", file=sys.stderr)
    raise SystemExit(2)
SPEC.loader.exec_module(tests)
Expressions = tests.translate.Expressions
original = Expressions.sort_domain
NAMES = ("test_sort_application_domains_resolve_both_telescopes",
         "test_sort_application_arguments_capture_caller_scope",
         "test_sort_application_spines_preserve_argument_order",
         "test_render_cache_preserves_remaining_fuel",
         "test_render_cache_preserves_fuel_across_shared_let_subtrees")


def run():
    stream = io.StringIO()
    suite = unittest.TestSuite(tests.TranslationTests(name) for name in NAMES)
    result = unittest.TextTestRunner(stream=stream, verbosity=1).run(suite)
    sys.stderr.write(stream.getvalue())
    if result.testsRun != len(NAMES) or result.skipped:
        raise RuntimeError("control suite did not exercise every case")
    return result


def mutate(method, pattern, replacement):
    source, count = re.subn(pattern, replacement, textwrap.dedent(inspect.getsource(method)))
    if count != 1:
        raise RuntimeError(f"mutation site changed: {method.__name__}")
    namespace = dict(tests.translate.__dict__)
    exec(source, namespace)
    return namespace[method.__name__]


def no_applications(expr, index):
    return expr.nodes[index][0] != "app" and original(expr, index)


baseline = run()
if not baseline.wasSuccessful():
    raise RuntimeError("unmodified control baseline failed")

variants = (
    ("no_applications", "sort_domain", no_applications, NAMES[:1]),
    ("discard_argument_scope", "sort_domain", mutate(original,
        r"arguments\.append\(\(\s*nodes\s*,\s*node\[2\]\s*,\s*bindings\s*,\s*seen\s*\)\)",
        "arguments.append((nodes, node[2], (), seen))"), NAMES[1:2]),
    ("reverse_arguments", "sort_domain", mutate(original,
        r"arguments\.pop\(\s*\)", "arguments.pop(0)"), NAMES[2:3]),
    ("ignore_fuel", "render", mutate(Expressions.render,
        r"key\s*=\s*\(\s*index\s*,\s*depth\s*,\s*fuel\s*\)",
        "key = (index, depth)"), NAMES[3:]),
)
summary = {"baseline_passed": True}
for label, method, replacement, witnesses in variants:
    with mock.patch.object(Expressions, method, replacement):
        result = run()
    failures = {case.id().split(" (", 1)[0].rsplit(".", 1)[-1] for case, _ in result.failures}
    if label == "no_applications":
        errors = {case.id().split(" (", 1)[0].rsplit(".", 1)[-1]: message
                  for case, message in result.errors}
        if not set(witnesses).issubset(errors):
            raise RuntimeError(f"mutation lacks its assertion failures: {label}")
        if not any("binder quantity differs" in message for message in errors.values()):
            raise RuntimeError("missing application reduction did not reach the binder check")
    elif result.errors or not set(witnesses).issubset(failures):
        raise RuntimeError(f"mutation lacks its assertion failures: {label}")
    if result.wasSuccessful():
        raise RuntimeError(f"mutation survived: {label}")
    summary[f"{label}_killed"] = True
print(json.dumps(summary, sort_keys=True))
