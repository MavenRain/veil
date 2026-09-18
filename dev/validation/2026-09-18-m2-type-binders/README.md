# Closed-sort binder validation, 2026-09-18

Base: `68b6f54013232005926d64fbfa2599e8524030d3`.
Captured in `/Users/oobi/Documents/gpt3/veil-m2-type-binders`.

The translator uses zero-quantity binders for lambda and dependent-arrow
parameters whose domains are explicit closed sorts. Named generic functions
and proposition-generic proofs retain dependent scopes and checked arguments,
while their type and proposition parameters occupy no runtime slots.

All 55 translation tests pass with `--live`, including fourteen integrations.
The three new live tests cover generic identity, type-argument forwarding,
partial application, two shadowed type binders, higher closed universes,
generic proofs and proof consumers. They inspect erased function signatures
and empty axiom reports. Changed computation witnesses fail conversion.
Incorrect universe levels, type arguments and data arguments fail both
checking and erasure, including an unused type argument.

Three offline cases pin binder quantities, visibility, dependent scope,
closed sort evaluation and existing limits. The previous plain type-binder
refusal test is replaced by positive coverage. Existing tests continue to
reject type-valued lets and applications consuming type lambdas.
These synthetic declarations carry no full-inventory parity credit.

The seven retained captures are:

- `translation-tests`: all 55 tests pass, with no skips.
- `declaration-tests`: 30 pass, with two optional Lean integrations skipped.
- `record`: fresh sample creation and its offline verification pass.
- `live`: the installed sample reproduces every checker status and output byte.
- `house`: `HOUSE OK`.
- `trusted-lines`: kernel 5246/5250, encoder 246/600.
- `parity-gate`: expected exit 1 for the incomplete 51,980-name baseline.

The sample sources and checker captures match the previous record byte for
byte. Refreshed provenance retains five rechecked names, 39 explicit gaps
and zero parity credit. The checker was reused after matching its source
and binary hashes to the previous record. Compiler, runtime, Lean and
exporter sources are unchanged. This record claims no compiler rebuild,
fresh Lean export or full M1 timing run.

The binary fingerprint records the executable used at capture time. Live
verification hashes it before and after its run. This record's offline
verifier compares the recorded fingerprint with its pin and does not hash
a local executable. `results.json` binds the seven command manifests,
complete stdout and stderr, and source hashes. Verify from the repo root:

```sh
python3 -I dev/validation/2026-09-18-m2-type-binders/verify.py
```

Type-valued lets, direct type-lambda applications, alias unfolding and
universe polymorphism remain outside this increment. General Prop parity,
the remaining M2 exit criteria and the user's M1 exit ratification remain open.
