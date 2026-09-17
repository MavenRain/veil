# M2 parity inventory validation, 2026-09-17

Validated in `/Users/oobi/Documents/gpt3/veil-m2-parity`, an independent
snapshot of Veil at `0955e62c4a866bf25d867d24f737c120fe7ad46e`.
The source hashes in `results.json` identify the increment copied to Veil.

The snapshot command ran `meta/ExportInit.lean` with `lean --run` under
`leanprover/lean4:v4.33.0-rc1`. A separate `verify --live` repeated that
export and matched all 51,980 declarations, their metadata, and the hashes
of 628 imported `.olean` artifacts. The suite passed 21 tests and HOUSE
passed all five source-convention checks.

| Capture | Command | Exit |
| --- | --- | --- |
| snapshot | `python3 -I dev/m2-parity.py snapshot --output dev/m2-init` | 0 |
| regressions | `python3 -I dev/m2-parity-test.py` | 0 |
| live | `python3 -I dev/m2-parity.py verify --live` | 0 |
| house | `zsh dev/house.sh` | 0 |
| parity-gate | `python3 -I dev/m2-parity.py gate` | 1, expected incomplete baseline |

Each capture retains its original manifest, stdout and stderr. The manifests
name their original capture paths; the copies here are located by their
capture label. `results.json` hashes these retained bytes and this README.
It does not hash itself. Source hashes exclude this validation directory
to avoid a circular digest. Recompute the results after any source or
record change; never edit the captured streams to reflect a later run.

The regressions cover these cases:

- dropped, duplicate and extra names;
- forged success counts;
- changed source and toolchain pins;
- module pin omissions;
- changed live artifacts;
- a self-consistent smaller denominator;
- malformed JSON;
- subprocess failure;
- search-path isolation;
- snapshot publication and CLI exit distinctions.

The live-artifact negative cases use injected exporter results. The separate
live capture above uses the real installed Lean toolchain.

No translation or Veil kernel re-check is claimed. Every name is retained
as an unattempted translation gap because the translator is absent. This
record does not claim a full M1 gate battery run, a theorem-library rebuild,
M1 exit ratification, or M2 parity success. Exported constant kinds are not
an axiom-dependency audit. The baseline and future gate contract are in
`dev/M2-PARITY.md`.

## Review 2026-09-17

An independent review read the staged slice and ran the gate ladder again on
the fixed tree. The ladder log is retained here as `gates-review.log` and is
hashed in `capture_sha256` with the other captures. The review added no new
claim about parity, translation or kernel re-checking. The source hashes
above were recomputed after the review edits; the captured streams of the
original run were not edited.
