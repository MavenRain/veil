# Declaration export validation, 2026-09-17

Validated in an independent checkout at
`/Users/oobi/Documents/gpt3/veil-m2-declarations`, based on
`7abe6a51d717bcb64d8fde2900610fc88cb9e7da`.

| Capture | Command | Result |
| --- | --- | --- |
| snapshot | `python3 -I dev/m2-declarations.py snapshot` with the eight documented roots | Exit 0; 44 declarations |
| declarations | `python3 -I dev/m2-declarations-test.py --live` | Exit 0; 32 tests pass |
| parity-tests | `python3 -I dev/m2-parity-test.py` | Exit 0; 21 tests pass |
| house | `zsh dev/house.sh` | Exit 0; HOUSE OK |
| trusted-lines | `zsh dev/trusted-lines.sh` | Exit 0; kernel 5,246/5,250, encoder 246/600 |
| parity-gate | `python3 -I dev/m2-parity.py gate` | Exit 1; expected incomplete baseline |

Each capture includes its original manifest, stdout and stderr. Manifests
retain their original working directories and capture paths. `results.json`
binds these copies and the source files by SHA-256. To check the retained
evidence after copying or staging the increment:

```sh
python3 -I dev/validation/2026-09-17-m2-declarations/verify.py
```

Live tests run both exporters from source and compare complete canonical
records and artifact pins. A separate temporary Lean source tests every
expression tag, all binder annotations, exact literals above 64 bits, Unicode,
metadata erasure, graph sharing and explicit rejection of unresolved variables.
The Python tests reject missing bodies, altered dependency lists, missing roots,
unrelated declarations, broken graph references, invalid variable scope,
universe mismatches, constructor and recursor inconsistencies, changed source
and artifact pins, and malformed exporter data. A simulated artifact change
during export is rejected. Search-path substitution is scrubbed. Failed
exports and preexisting output directories preserve the destination.

Offline verification checks a self-consistent record. A regression rewrites
a binder and its fingerprint, demonstrates that offline verification accepts
that consistent record, then verifies that live comparison rejects it. The
snapshot is translator input, not evidence of a successful translation or a
Veil kernel re-check. The parity denominator and its zero-coverage baseline
are unchanged. The scoped checks do not claim a full M1 gate battery or a
Lean theorem-library rebuild.

## Review 2026-09-17

An independent review read the staged slice and ran the gate ladder again on
the fixed tree. The ladder log is retained here as `gates-review.log`, hashed
under the `review` key of `results.json`. The review added no new claim about
the export, the pin or the parity denominator. The source hashes above were
recomputed after the review edits; the captured streams of the original runs
were not edited.
