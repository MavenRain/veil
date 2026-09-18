# Direct lambda application validation, 2026-09-17

Base: `680d50b0ed1877308058abdc4cc1ab479d641064`.
Captured in `/Users/oobi/Documents/gpt3/veil-m2-beta`.

The translator lowers direct lambda application chains to typed lets. This
preserves the caller's variable scope and every supplied argument's type
check, including unused arguments. The existing kernel checks the result and
the existing erasure pass drops proof lets.

All 38 translation tests pass with `--live`, including nine live integrations.
Five computation cases cover direct, nested, partial and higher-order
applications and caller variables under shadowed binders. Each case checks
the generated source, its erasure and its empty axiom report, then rejects a
changed result through an indexed conversion witness. Further live cases
check dependent parameter syntax, erased proof applications and rejection of
an unused argument with the wrong type. Replacing that argument with a valid
one passes. These are synthetic inputs, without full-inventory parity credit.

The new refusal cases retain the restrictions on sort binders, application
and lambda depth, and generated expression size. Existing traversal, source
budget, provenance and record-tampering tests also pass.

The seven retained captures are:

- `translation-tests`: all 38 tests pass, with no skips.
- `declaration-tests`: 30 pass, with two optional Lean tests skipped because
  the suite was run without `--live`.
- `record`: fresh sample creation and its required offline verification pass.
- `live`: the installed sample reproduces every checker status and output byte.
- `house`: `HOUSE OK`.
- `trusted-lines`: kernel 5246/5250, encoder 246/600.
- `parity-gate`: expected exit 1 for the valid, incomplete 51,980-name baseline.

The fresh candidate's sources and captures match the previous sample byte
for byte; its updated provenance is installed at `dev/m2-translation`. That
sample retains five rechecked names, 39 explicit gaps and zero parity credit.
Compiler, runtime, Lean and exporter sources are unchanged. The checker was
reused only after matching the previous record's source and binary hashes.
No new compiler build, Lean export or full M1 gate run is claimed.

Predate note: the `translation-tests` capture predates the review fixes of
2026-09-17 and records `Ran 38 tests`. The review adds four offline tests to
`dev/m2-translate-test.py`, so that suite now runs 42 tests, with nine skips
without `--live`. The capture stays as captured. A re-capture is not part of
the review.

The `checker_sha256` row of `verify.py` compares two recorded values. The
binary fingerprint is a capture-time claim of the `live` capture, which
hashed `_build/default/bin/kanon.exe` before and after its run. The offline
verification of this record hashes no binary.

`results.json` binds the exact commands, full capture streams and source
hashes. Each capture includes its `kanon-exec` manifest. To verify the record:

```sh
python3 -I dev/validation/2026-09-17-m2-beta/verify.py
```

Application heads that require other evaluation to expose a lambda can still
fail Veil's inference checks. General normalization, prenex universes, general
Prop parity and the remaining M2 exit criteria remain open. The user's M1
exit stamp remains open.

## Review 2026-09-17

An independent review read the staged slice and ran the gate ladder again on
the fixed tree. The ladder log is retained here as `gates-review.log`, hashed
under the `review` key of `results.json`. The review added no new claim about
the translator, the sample record or the parity denominator. The source hashes
above were recomputed over the working tree after the review edits; the
captured streams of the original runs were not edited.
