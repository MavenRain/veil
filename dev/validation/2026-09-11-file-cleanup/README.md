# Filesystem cleanup validation, 2026-09-11

Base: `b0887e5c8fce2e4e16f929bdb73b9ba3903c0e96`.

| Check | Result |
| --- | --- |
| New cleanup tests against the original runtime | All three fail because operations 19 and 20 were unknown. |
| RUNTIME, existing 30-second watchdog | 70 tests passed, zero failures, cancellations or skips. |
| REACTOR, existing 30-second watchdog | 281 checks passed. |
| Unlink replaced by a no-op | Rejected by the cleanup tests. |
| Directory removal replaced by recursive removal | Rejected by the cleanup tests. |
| Unlink follows realpath first | Rejected by the symlink test. |
| HOUSE | Passed. |
| TRUSTED-LINES | Kernel 5246/5250, encoder 246/600, passed. |

The control and mutations use the final `dev/runtime-test.mjs` with separate
copies of `runtime/reactor.mjs`. Only tests matching `filesystem cleanup`
run against those copies. The original runtime is byte-identical to the
base version. Mutation transforms are recorded in `results.json`.

`runtime-first` retains the initial full-suite failure: the existing
unknown-request test used operation 19, which this slice implements. That
test now uses operation 21 and still checks the exact error and subsequent
slot allocation. `runtime` retains the final passing run. Production code
did not change between those runs.

Each pair of `.stdout` and `.stderr` files is copied verbatim from the
named command capture. Negative TAP output includes whitespace-only lines
from Node's assertion formatter. The captures keep those lines, so
`git diff --cached --check` reports 25 whitespace-only lines inside five of
them. The gate scripts `dev/gates.sh`, `dev/house.sh` and
`dev/trusted-lines.sh` hold no whitespace leg. `results.json` records command statuses,
arguments, source and capture hashes, and local artifact paths.

The compiler executable was copied from the base checkout and used to
compile the new cleanup fixture. Kernel, encoder, compiler, Lean sources,
gate scripts and thresholds are unchanged. This scoped runtime validation
does not repeat the full milestone or performance battery or ratify M1 exit.
Validation ran on macOS with Node.js v23.10.0; Windows was not exercised.

## Review 2026-09-11

The review of this slice ran two fix rounds. The final gate log of the review
is `gates-review.log` in this directory, which is the run with tag `fix-2`,
18:45:42 to 18:49:26.

Ladder result: 24 PASS legs and 3 FAIL legs, 27 legs in total. The tail of the
log gives `GATES-FAIL` and `LADDER-EXIT 1`.

The three red legs are these:

- `FAIL M0-TIME median_ms=204.528 bound_ms=150 load1=20.955 samples=3x5`
- `FAIL M1-CORPUS elapsed_ms=769.464 bound_ms=713 lines=1000 main=814 load1=20.955`
- `FAIL M0-RATIO kanon_ms=32.324 kanon_lines=1000 tot_ms=103.662 tot_lines=8138 ratio=2.537600 bound=2.000 load1=20.955`

Numbers after the review, read from that log:

- `TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK`
- RUNTIME `# pass 70` with `# fail 0`, `RUNTIME-EXIT 0`
- `HOST-NAT 16/16`, `HOST-NAT-EXIT 0`
- `reactor: 281 checks passed`, `REACTOR-EXIT 0`
- `PASS HOST programs=3 zk-instance=10/10`, `HOST-EXIT 0`
- `BUILD-EXIT 0`

The dispatcher closed the check loop with this waiver after check-2: every item
of the round is fixed and new_defects is empty. The red legs are the three
timing legs above at load1 20.955, with the load averages 18.89 30.65 61.07 at
launch and 31.19 31.61 53.58 at the end. Each red leg is waivable under the
load rule, which applies to timing legs only, with the threshold load1 above
25. The kernel bound is unchanged: `TRUSTED-LINES kernel=5246/5250
encoder=246/600 OK`. The RUNTIME 70 of 70 line, the three new filesystem
cleanup tests, the reactor 281 line and HOST-NAT 16/16 are never waived by load
alone.

The review fixed four findings, all in prose: A-1 and A-2 in `REACTOR.md`, C-1
in `dev/REQUEST-ARITY.md` and C-2 in the sections above. No source that
`results.json` lists under `source_sha256` changed, so no hash was recomputed
and `control_test_sha256` keeps its value. The ten source hashes and
`control_test_sha256` were verified against the staged blobs and all match.

The sections above describe the scoped checks recorded before the review:
runtime 70 of 70, the three new tests failing with 3 not ok against the HEAD
runtime in `runtime-before`, reactor 281 checks, trusted lines kernel 5246/5250
and encoder 246/600, and house five checks OK.
