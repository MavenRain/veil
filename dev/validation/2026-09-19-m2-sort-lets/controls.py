#!/usr/bin/env python3
"""Require local-let and captured-scope mutations to fail the passing regressions."""

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
SPEC = importlib.util.spec_from_file_location("let_regressions", ROOT / "dev/m2-translate-test.py")
tests = importlib.util.module_from_spec(SPEC)
if sys.argv[1:]:
    print("controls: expected no arguments", file=sys.stderr)
    raise SystemExit(2)
SPEC.loader.exec_module(tests)
Expressions = tests.translate.Expressions
original = Expressions.sort_domain
NAMES = ("test_sort_let_domains_resolve_both_telescopes",
         "test_sort_let_values_keep_their_scope_under_shadowing")


def run():
    stream = io.StringIO()
    suite = unittest.TestSuite(tests.TranslationTests(name) for name in NAMES)
    result = unittest.TextTestRunner(stream=stream, verbosity=1).run(suite)
    sys.stderr.write(stream.getvalue())
    if result.testsRun != len(NAMES) or result.skipped:
        raise RuntimeError("control suite did not exercise every case")
    return result


def no_local_lets(expr, index):
    return expr.nodes[index][0] != "let" and original(expr, index)


baseline = run()
if not baseline.wasSuccessful():
    raise RuntimeError("unmodified control baseline failed")
with mock.patch.object(Expressions, "sort_domain", no_local_lets):
    missing = run()
if missing.wasSuccessful() or not any("binder quantity differs" in error for _, error in missing.errors):
    raise RuntimeError("missing-let mutation was not killed by the binder check")

source = textwrap.dedent(inspect.getsource(original))
# Match the captured-scope assignment on its tokens, not its exact spacing,
# so a cosmetic reformat of this line (wrap, reindent) does not require a
# lockstep edit here. Only the site's tuple shape is pinned.
binding = re.compile(r"value\s*=\s*\(\s*nodes\s*,\s*node\[3\]\s*,\s*bindings\s*,\s*seen\s*\)")
if len(binding.findall(source)) != 1:
    raise RuntimeError("captured-scope mutation site changed")
namespace = dict(tests.translate.__dict__)
exec(binding.sub("value = (nodes, node[3], (), seen)", source, count=1), namespace)
with mock.patch.object(Expressions, "sort_domain", namespace["sort_domain"]):
    discarded = run()
if discarded.wasSuccessful() or discarded.errors or not discarded.failures:
    raise RuntimeError("discarded-scope mutation was not killed by an assertion")
print(json.dumps({"baseline_passed": True, "no_local_lets_killed": True,
                  "discard_scope_killed": True}, sort_keys=True))
