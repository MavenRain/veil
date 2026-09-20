# Closed-sort application validation, 2026-09-19

Base: `4cbaeeb192f7d8632c899c070789f82f423c34c5`.
Workspace: `/Users/oobi/Documents/gpt3/veil-m2-sort-apps`.

The domain resolver recognizes closed sorts computed by bounded applications
through direct, let-bound and transparent named lambdas. Arguments retain
their caller scope and alias ancestry. Inner arguments precede outer ones.
Both declaration telescopes retain consistent quantities, and generated
source keeps every argument and domain for kernel checking before erasure.

The render cache includes remaining fuel, resolving carried A-2 from the
direct-application and local-let reviews. Tests exercise both repeated calls
with different fuel and shared let subtrees inside one expression.

## Results

| Capture | Command | Result |
| --- | --- | --- |
| translation-tests | `python3 -I dev/m2-translate-test.py --live` | 94 passed, including 32 live integrations |
| declaration-tests | `python3 -I dev/m2-declarations-test.py` | 30 passed, 2 optional Lean integrations skipped |
| record | `python3 -I dev/m2-translate.py record --output .kanon-exec/m2-translation-sort-apps-candidate` | 5 rechecks, 39 gaps |
| live | `python3 -I dev/m2-translate.py verify --live` | Same sample reproduced |
| house | `zsh dev/house.sh` | Passed |
| trusted-lines | `zsh dev/trusted-lines.sh` | Kernel 5248/5250, encoder 246/600 |
| parity-gate | `python3 -I dev/m2-parity.py gate` | Expected exit 1, zero credited translations |
| compiler-reuse | `python3 -I dev/validation/2026-09-19-m2-sort-apps/verify.py --compiler-reuse` | Checker and 46 unchanged source fingerprints match the prior build |
| controls | `python3 -I dev/validation/2026-09-19-m2-sort-apps/controls.py` | Passing baseline and four killed mutations |

PREDATE NOTE: the `translation-tests` capture and its `Ran 94 tests` row
predate the 2026-09-19 review of this slice. The review added one live test,
`test_sort_application_erased_binder_rejected_at_runtime_position`, to
`dev/m2-translate-test.py`, so the suite now runs 95 tests, 33 of them live,
and still passes with no failure. The captures stay frozen, because this record
files no re-capture.

Fourteen new regression cases cover mixed literal and applied domains,
argument order, captured and global scopes, alias ancestry, safety and cycle
restrictions, closed levels, proof erasure, ordinary data arguments, invalid
unused arguments, inspection fuel and the render cache. Computation witnesses
accept the expected result and reject changed results. Accepted sources also
have empty axiom reports.

`controls.py` replaces application recognition, argument scopes, argument
order and the render-cache key in memory, one at a time. Its stderr contains
the intended assertion failures and quantity gaps. The command exits 0 only
after its baseline and each specific mutation witness meet their checks.

The 14 sample sources and their complete checker streams are unchanged.
The provenance in `dev/m2-translation/results.json` binds the new translator.
The sample still has five rechecked declarations and 39 explicit gaps out of
44; it credits zero translations in the 51,980-name inventory. This work does
not close prenex universes, general Prop parity or the M2 exit criteria.

## Reproduce and verify

Run `python3 -I dev/validation/2026-09-19-m2-sort-apps/verify.py` from the repo.
It checks capture commands, working directories, exit statuses, stream sizes,
file hashes, source bindings, sample reproduction and the prior build record.
`--compiler-reuse` also checks the local executable. Use a new output directory
when rerunning the recording command above, because recording refuses an
existing destination. The other commands can be rerun as shown.

The checker matches the pinned executable and all 46 unchanged inputs from
`dev/validation/2026-09-18-m2-type-lets/results.json`. The translator is the
only changed file among that verifier's 47 inputs. No compiler rebuild,
fresh Lean export or full M1 timing run was performed for this Python slice.

Captures are copied without alteration from `kanon-exec` artifacts.
`results.json` pins the source files, verifier, controls and this README.
Hashes bind a retained trusted record; a self-consistent rewrite is not
authenticated by those hashes alone. Re-run the commands for fresh evidence.

## Review 2026-09-19

An independent review read the staged slice and ran the gate ladder again on
the fixed tree. The ladder log is retained here as `gates-review.log`, hashed
under the `review` key of `results.json`. The review added no new claim about
the translator, the sample record or the parity denominator. The source hashes
above were recomputed over the working tree after the review edits; the
captured streams of the original runs were not edited.
