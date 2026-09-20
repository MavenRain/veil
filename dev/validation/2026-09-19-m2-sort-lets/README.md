# Closed-sort local-let validation, 2026-09-19

Base: `b6104fe635debc76fc1491850d268ee1cb2ef937`.
Captured in `/Users/oobi/Documents/gpt3/veil-m2-sort-lets`.

Binder domains now resolve closed sorts through local lets, including lets
inside transparent constant aliases. Values carry their binding scope and
alias ancestry. Global definitions start with an empty local scope. Both
declaration telescopes use the same rule, and generated source retains the
original lets and their values for checking. Data arguments remain at runtime.

All 79 translation tests pass with `--live`, including 27 kernel integrations.
The eight new tests cover mixed domains, shadowing, captured values, free
locals, global scope, data aliases, proofs, higher sorts, invalid unused
values, invalid declared types, alias safety, cycles and inspection limits.
Live checks require empty axiom reports and the expected erased signatures.
Changed computation witnesses fail checking and erasure. These synthetic
declarations add no names to the exported sample or full parity inventory.

The nine retained captures are:

- `translation-tests`: all 79 tests pass without skips.
- `declaration-tests`: 30 pass and two optional Lean integrations are skipped.
- `record`: fresh sample creation and offline verification pass.
- `live`: sample reproduction matches every checker status and output byte.
- `compiler-reuse`: the checker and 46 unchanged pinned build inputs match
  the prior type-let build record. Its manifest is fingerprinted here.
- `controls`: the two-case offline baseline passes. Removing local-let
  recognition fails binder consistency; discarding captured value scopes
  fails the shadowing assertions. Full expected failures are in `controls.stderr`.
- `house`: `HOUSE OK`.
- `trusted-lines`: kernel 5248/5250, encoder 246/600.
- `parity-gate`: expected exit 1 for the incomplete 51,980-name baseline.

All 14 sample source files and checker capture streams match the predecessor
byte for byte. Updated provenance retains five rechecked names, 39 gaps and
zero parity credit. This record claims no new compiler build, Lean export,
kernel or Wasm fixture run, or full M1 timing battery.

`results.json` binds the command manifests, complete stdout and stderr, the
record scripts, prior build manifest and current source hashes. Verification
checks those bindings and the refreshed translation record. The default
verification does not inspect a local executable; `--compiler-reuse` also
checks its fingerprint. Run from the repository root:

```sh
python3 -I dev/validation/2026-09-19-m2-sort-lets/verify.py
python3 -I dev/validation/2026-09-19-m2-sort-lets/verify.py --compiler-reuse
python3 -I dev/validation/2026-09-19-m2-sort-lets/controls.py
python3 -I dev/m2-translate-test.py --live
```

PREDATE NOTE: the `translation-tests` capture, and each count of 79 tests
above, predate the 2026-09-19 review of this slice. The review added one
offline test to `dev/m2-translate-test.py`, so the suite now runs 80 tests
and still passes with no failure. The captures stay frozen, because this
record files no re-capture.

The resolver inspects at most 128 expressions, including lets, variable
lookups, constants and the terminal sort. An unresolved domain stays a data
binder. Only locally introduced values resolve; enclosing binders or lets,
application reduction and unsupported declarations retain their limitations.
Inductive family types must still be literal closed sorts, and constructor
fields must still name constants. General normalization, prenex universes,
general Prop parity, full M2 exit and M1 exit ratification remain open.

## Review 2026-09-19

An independent review read the staged slice and ran the gate ladder again on
the fixed tree. The ladder log is retained here as `gates-review.log`, hashed
under the `review` key of `results.json`. The review added no new claim about
the translator, the sample record or the parity denominator. The source hashes
above were recomputed over the working tree after the review edits; the
captured streams of the original runs were not edited.
