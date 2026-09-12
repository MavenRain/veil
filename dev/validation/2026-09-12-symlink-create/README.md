# Symlink creation validation, 2026-09-12

Base commit: `3018ec59c4fff261de59f7ca78cec29aa5130102`.

Operation 25 accepts target and destination, creates a symlink and returns an
empty success answer. Existing entries survive conflicts, targets retain their
literal bytes on POSIX, and errors return through `resume`. See
[SYMLINK-CREATE.md](../../SYMLINK-CREATE.md) for the contract and test scope.

| Check | Result |
| --- | --- |
| RUNTIME | 103 tests passed, 0 failures, 0 skipped |
| REACTOR | 568 checks passed |
| HOUSE | Pass |
| TRUSTED-LINES | Kernel 5246/5250, encoder 246/600 |
| Diff whitespace | Pass |
| Final focused tests with the base runtime | All 6 fail with `IO: unknown OS request 25` |
| Six mutation controls | Each rejected by at least one focused test (6, 5, 3, 1, 6 and 1 failures) |

RUNTIME and REACTOR ran individually with their existing 30-second watchdogs.
REACTOR compiled the new fixture with the existing compiler and exercised it
as an import-free Wasm module and through the real CLI. The runtime tests also
drive native filesystem requests, use `lstat` to distinguish dangling entries
from missing paths, and check that unlinking a new link preserves its target.

The native symlink cases ran on macOS. Windows was not exercised. An injected
creator verifies that malformed arities and invalid bytes in either argument
do not reach filesystem dispatch, and that a valid empty target is forwarded.
The initial focused run assumed an empty target produced ENOENT, but macOS
accepted it. The final tests and contract defer empty-target acceptance to
the host OS. `runtime-initial.json` retains that failed test capture. That
capture ran an exploratory test file that no recorded hash describes, under the
unanchored pattern `symlink creation`, while the base-runtime capture and the
controls use `^symlink creation`, so it does not select the same test set.

This record carries its own `before_test_sha256` key and one per-capture
`phase` note, and it carries no retry block, because no run was retried.

Each capture JSON contains the executed argv, cwd, exit status and complete
stdout and stderr. `results.json` pins the captures and their streams, the
final sources, the compiler binary and the unchanged gate scripts. External
artifact paths identify the original local captures; the copied capture files
in this directory are sufficient to read every recorded command and result.
The base-runtime test copy has the same hash as the final runtime test source.

`results.json` also records a `source_sha256` row for this README. A review
that edits this README, and a closer that appends the review section below,
must refresh that one row after the edit, never before it. The captures,
`controls.json` and the recorded streams stay byte-identical.

`controls.json` records exact before/after replacements and the runtime and test
hashes for six isolated variants. They resolve the target, normalize the target,
normalize the destination, unlink a conflicting destination, reverse arguments,
or omit the operation's arity entry. Each variant runs all six focused tests;
its capture identifies the rejected assertions. The counts are not uniform: the
variants above fail 6, 5, 3, 1, 6 and 1 of the six tests, in that order. Every copied test matches the
final source. Control working directories are isolated from the checkout.

The compiler binary is byte-identical to the one recorded in
`../2026-09-12-symlink-target/results.json`. Compiler sources, gate scripts and
watchdog thresholds did not change. The full milestone and performance ladder
was not run for this runtime slice. These scoped checks do not establish a
new full-ladder verdict.

The captures preserve the commands as run. Hash checks in the staging step
confirm that the tested runtime, tests, fixture and recorded sources match the
staged bytes.

## Review 2026-09-12

The review of the symlink creation slice made one fix round. The gate runner
ran the full ladder after the fixes. The carried log of that run is
`gates-review.log` in this directory.

The check loop closed with no waiver. The waiver threshold stays at load1
above 25: a timing leg that goes red above that load is a load artifact,
because the compiler binary hash `ba114dff` did not change. The RUNTIME
103 of 103 line, the six new symlink creation tests, the line
`reactor: 568 checks passed` and `HOST-NAT 16/16` are never waived by load.

The ladder shows 27 of 28 legs pass. One leg is red:
`FAIL M0-TIME median_ms=256.470 bound_ms=150 load1=23.154 samples=3x5`.
M0-TIME is a timing leg. The ladder tail prints `GATES-FAIL` and
`LADDER-EXIT 1` for that one leg. The run load averages were
19.14 17.99 17.36 at the start and 17.93 18.43 17.70 at the end.

The numbers after the review, read from `gates-review.log`:

| Line | Value |
| --- | --- |
| TRUSTED-LINES | `TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK` |
| RUNTIME | `# pass 103`, `# fail 0`, `RUNTIME-EXIT 0` |
| HOST-NAT | `HOST-NAT 16/16`, `HOST-NAT-EXIT 0` |
| REACTOR | `reactor: 568 checks passed`, `REACTOR-EXIT 0` |
| HOST | `PASS HOST programs=3 zk-instance=10/10`, `HOST-EXIT 0` |
| FAIL legs | `M0-TIME median_ms=256.470 bound_ms=150 load1=23.154` |

The sections above describe the scoped checks recorded before the review:
runtime 103 of 103 with no skips, the six new tests failing against the HEAD
runtime in `runtime-before` with 0 of 6 passing under the pattern
`^symlink creation`, reactor 568 checks, trusted lines kernel 5246/5250 and
encoder 246/600, house six checks OK, and `git diff --check` clean.

The review kept seven findings. It fixed C-1, A-1, B-2, C-2, C-3 and D-1 in
round 1. It carried B-1 with a user ruling, because the repair edits
`dev/runtime-test.mjs` and invalidates frozen hashes of this record.

The closer recomputed four `source_sha256` rows from the staged bytes:
`REACTOR.md`, `dev/SYMLINK-CREATE.md`, `dev/REACTOR-BUILD-LOG.md` and
`dev/validation/2026-09-12-symlink-create/README.md`. The captures,
`controls.json`, the recorded streams, `before_runtime_sha256`,
`before_test_sha256` and `controls_sha256` stay byte-identical.
