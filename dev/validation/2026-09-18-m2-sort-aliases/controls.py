#!/usr/bin/env python3
"""Run passing alias checks, then require two isolated quantity mutations to fail."""

import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location("alias_regressions", ROOT / "dev/m2-translate-test.py")
tests = importlib.util.module_from_spec(SPEC)
if sys.argv[1:]:
    print("controls: expected no arguments", file=sys.stderr)
    raise SystemExit(2)
sys.argv = [str(Path(__file__).resolve()), "--live"]
SPEC.loader.exec_module(tests)
Expressions = tests.translate.Expressions
original = Expressions.sort_domain
NAMES = ("test_sort_alias_binders_resolve_both_telescopes", "test_sort_alias_data_binders_compute_and_erase")


def run():
    stream = io.StringIO()
    suite = unittest.TestSuite(tests.TranslationTests(name) for name in NAMES)
    result = unittest.TextTestRunner(stream=stream, verbosity=1).run(suite)
    sys.stderr.write(stream.getvalue())
    if result.testsRun != len(NAMES) or result.skipped:
        raise RuntimeError("control suite did not exercise every live case")
    return result


def erase_data_aliases(expr, index):
    node = expr.nodes[index]
    return original(expr, index) or (node[0] == "const"
                                     and expr.rows.get(node[1], {}).get("kind") == "definition")


baseline = run()
if not baseline.wasSuccessful():
    raise RuntimeError("unmodified control baseline failed")
with mock.patch.object(Expressions, "sort_domain", lambda expr, index: expr.nodes[index][0] == "sort"):
    syntactic = run()
if syntactic.wasSuccessful() or not any("binder quantity differs" in error for _, error in syntactic.errors):
    raise RuntimeError("syntactic-only mutation was not killed by the binder check")
with mock.patch.object(Expressions, "sort_domain", erase_data_aliases):
    data = run()
if data.wasSuccessful() or data.errors or not data.failures:
    raise RuntimeError("data-alias mutation was not killed by an assertion")
print(json.dumps({"baseline_passed": True, "syntactic_only_killed": True,
                  "erase_data_aliases_killed": True}, sort_keys=True))
