# Process signal validation, 2026-09-11

Base: `33317868b33ad474916b29b4e4fc4ba7e523de2f`. Node: `v23.10.0`.

- `runtime.stdout`: the complete runtime suite passes 63 of 63 tests,
  with zero failures, cancellations or skips, in 14.18 seconds. An `uptime`
  reading taken after that run gave a one-minute load average of 31.51.
  That reading is not retained in the captures.
- `slow-start-before.stdout`: all three old signal tests fail when child
  execution is delayed by 200 ms. The timeout test observes SIGTERM
  instead of SIGKILL; the two injected-error tests fail on missing PID
  markers. This is a controlled reproduction, not a claim that every
  ordinary run of the old suite fails.
- `slow-start-after.stdout`: all three revised tests pass with the same
  extra startup delay, in addition to the fixture's own 200 ms delay.
- `deadline.stdout`: the timeout test rejects a runtime deadline delayed
  by one millisecond, because SIGTERM is missing at 150 ms.
- `escalation.stdout`: the timeout test rejects a runtime escalation
  delayed by one millisecond, because SIGKILL is missing at 250 ms.
- `error-identity.stdout`: both injected-error tests reject a runtime
  that replaces the original error object after cleanup.
- `house.stdout`: all five repository house checks pass.

The startup and mutation captures come from `dev/runtime-signals-check.mjs`, which
verifies the expected test counts, failures and diagnostic classes before
exiting 0. The negative cases contain failing TAP output by design.
Every case completes with zero cancellations and skips.

`results.json` records command arguments, artifact locations, exit statuses,
source hashes and capture hashes. The check driver also prints the exact
source and executed-copy hashes into the five startup and mutation captures. Trailing spaces and tabs
were stripped when retaining captures; raw hashes remain in the receipt.

The initial focused run also passed three of three tests. Its capture is
at `/Users/oobi/Documents/gpt3/.kanon-exec/run-egT2GZ`; the retained full
suite covers the final test source and is the validation used here.
No production or gate source changed. The full compiler, milestone and
performance batteries were not repeated for this test-only change.

## Review 2026-09-11

The review of this slice kept six findings and fixed all six: A-1, D-1 and
B-1 (high), D-2 (medium), C-1 and C-2 (low). One finding, C-3, was refuted.
Two findings, B-2 and B-3, were merged into A-1 and D-2. The gate log of the
final round is retained at `gates-review.log`.

The ladder gave 24 PASS legs of 27. These are the numbers of that run:

- `TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK`
- RUNTIME `# pass 63`, with `# fail 0` and `RUNTIME-EXIT 0`
- `HOST-NAT 16/16`
- `reactor: 169 checks passed`
- `PASS HOST programs=3 zk-instance=10/10`

Three legs were red, and each one is a timing leg:

- `FAIL M0-TIME median_ms=550.976 bound_ms=150 load1=54.965 samples=3x5`
- `FAIL M0-RATIO kanon_ms=88.221 kanon_lines=1000 tot_ms=103.662 tot_lines=8138 ratio=6.925802 bound=2.000 load1=51.604`
- `FAIL M1-CORPUS elapsed_ms=1714.358 bound_ms=713 lines=1000 main=814 load1=45.897`

The check loop closed with these three legs waived as load-bound. The waiver
threshold is a one-minute load average above 25, and each red leg records a
load1 above that threshold. A red result on one of the three rewritten signal
tests is never waived by load alone.

The fixes changed four source files. The closer recomputed the `sha256`
entries of `dev/runtime-test.mjs`, `dev/runtime-signals-check.mjs`,
`dev/PROCESS-SIGNALS.md` and `dev/validation/2026-09-11-process-signals/README.md`
in `results.json` from the staged bytes. The `captures`, `base` and `node`
values are unchanged, and the fourteen capture files are unchanged.

The sections above describe the scoped checks recorded before the review:
runtime 63 of 63 in 14.18 seconds, slow-start-before 3 failures with the
ENOENT diagnostic, slow-start-after 3 of 3, deadline 1 failure, escalation
1 failure, error-identity 2 failures, and house five checks OK.
