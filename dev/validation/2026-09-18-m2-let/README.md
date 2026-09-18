# Let-headed application validation, 2026-09-18

Base: `d32b81208d4c9283e38f3d940f790939ab9d2e61`.
Captured in `/Users/oobi/Documents/gpt3/veil-m2-let`.

The translator lowers applications whose function is exposed through explicit
lambda and let nodes to nested typed lets. Original bindings keep their types
and values, consumed parameters retain argument checks, and every argument
keeps the scope in which it was supplied. Inner application arguments precede
pending outer arguments. The existing checker and erasure rules handle the
result without translator evaluation or added axioms.

All 48 translation tests pass with `--live`, including eleven integrations.
Seven new computation cases exercise direct, nested, mixed, partial and
higher-order let applications, shadowed caller variables and dependent
parameter types. Each checks the generated source, erasure and empty axiom
report, then rejects a changed result using an indexed conversion witness.
The proof case checks erased proof bindings and a computed runtime result.
An unused let value and an unused lambda argument with the wrong type each
fail both checking and erasure; replacing the bad value admits each program.

Offline cases pin argument order, scope, dependent domains, partial and
surplus applications, and the depth boundary. Sort binders and oversized
generated expressions remain refused. These synthetic declarations carry
no full-inventory parity credit.

The seven retained captures are:

- `translation-tests`: all 48 tests pass, with no skips.
- `declaration-tests`: 30 pass, with two optional Lean integrations skipped.
- `record`: fresh sample creation and its required offline verification pass.
- `live`: the installed sample reproduces each checker status and output byte.
- `house`: `HOUSE OK`.
- `trusted-lines`: kernel 5246/5250, encoder 246/600.
- `parity-gate`: expected exit 1 for the valid, incomplete 51,980-name baseline.

PREDATE NOTE: the `translation-tests` capture, and each count of 48 tests
above, predate the 2026-09-18 review of this slice. The review added two
offline tests to `dev/m2-translate-test.py`, so the suite now runs 50
tests and still passes with no failure. The captures stay frozen, because
this record files no re-capture.

The sample sources and checker captures match the previous record byte for
byte. Its refreshed provenance at `dev/m2-translation` retains five rechecked
names, 39 explicit gaps and zero parity credit. The checker was reused after
matching its source and binary hashes to the previous record. Compiler,
runtime, Lean and exporter sources are unchanged. This record claims no
compiler rebuild, fresh Lean export or full M1 timing run.

The binary fingerprint is a capture-time claim: live verification hashes the
checker before and after its run. This record's offline verifier compares
the recorded fingerprint with its pin; it does not hash a local executable.
`results.json` binds the seven command manifests, complete stdout and stderr,
and source hashes. To verify this record:

```sh
python3 -I dev/validation/2026-09-18-m2-let/verify.py
```

Constant unfolding, local-value substitution and general normalization remain
outside this lowering. Prenex universes, general Prop parity and the remaining
M2 exit criteria remain open. The user's M1 exit ratification remains open.

## Review 2026-09-18

An independent review read the staged slice and ran the gate ladder again on
the fixed tree. The ladder log is retained here as `gates-review.log`, hashed
under the `review` key of `results.json`. The review added no new claim about
the translator, the sample record or the parity denominator. The source hashes
above were recomputed over the working tree after the review edits; the
captured streams of the original runs were not edited.
