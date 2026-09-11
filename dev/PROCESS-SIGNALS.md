# Process signal test synchronization

The RUNTIME suite tests deadline escalation and error cleanup with real child
processes and OS signals. Three tests previously started a 150 ms deadline
before Node had installed its signal handler and written its PID. A slow
startup could produce SIGTERM instead of SIGKILL or an ENOENT marker error.
Waiting for a marker after killing the child could not repair that race.

The shared fixture now controls the parent's `setTimeout` clock using the
Node test runner. It leaves child startup, filesystem operations, process
exit and OS signals real. The child deliberately waits 200 ms before
installing its handler and atomically publishing its complete PID. The
parent waits for that marker before advancing the deadline clock. Readiness
has a separate five-second wall-clock bound. On a readiness failure the
fixture cleanup kills the child group when the marker exists, then advances
the mocked clock until the run settles, so the failure is reported.

The timeout test requires no signal at 149 ms, SIGTERM at 150 ms, no SIGKILL
after another 249 ms, and SIGKILL at 250 ms after SIGTERM. It checks the
timeout response and verifies that the child was reaped. The two injected
error tests still require the original error object and a reaped child;
the escalation test also requires that the injected failure occurred.
Fixture cleanup runs after these assertions, so it cannot satisfy them.
Cleanup advances the mocked clock in steps, because a timer that a mocked
timer creates runs only on a later step. Each of the three tests also has a
twenty-second bound, so a runtime defect gives a failure, not a stopped run.

The production runtime, compiler, kernel and gate thresholds are unchanged.
Other runtime tests continue to exercise wall-clock deadlines and process
interruption. This change makes the three tests independent of Node startup
speed within the readiness bound, while checking exact timer boundaries.

Reproduce from the repository root:

```sh
node --test --test-reporter=tap dev/runtime-test.mjs
node dev/runtime-signals-check.mjs slow-start-before
node dev/runtime-signals-check.mjs slow-start-after
node dev/runtime-signals-check.mjs deadline
node dev/runtime-signals-check.mjs escalation
node dev/runtime-signals-check.mjs error-identity
```

The check driver runs in temporary copies. `slow-start-before` loads the
tests from commit `3331786` and adds a 200 ms child startup delay; all three
fail. `slow-start-after` adds the same delay to the revised tests; all three
pass. The mutation cases require failures when the deadline or escalation
is delayed by one millisecond, or when cleanup replaces the original error.
The driver succeeds only when the expected tests, failures and diagnostics
are present, with no cancellations or skips. The driver gives each test run
fifteen seconds and one mebibyte of output. When a run passes a cap, the
driver reports the spawn error code, which is not a surviving mutation.

Captures, command arguments and source hashes are retained in
`dev/validation/2026-09-11-process-signals/`.

## Review 2026-09-11 (process signals)

- A-1 (high): the fixture cleanup now kills the child group from the marker
  and advances the mocked clock in steps until the run settles, and the three
  signal tests have a twenty-second bound. `dev/runtime-test.mjs`.
- D-1 (high): the readiness sentence now states how cleanup reports a
  readiness failure. `dev/PROCESS-SIGNALS.md`.
- B-1 (high): the documented `deadline` command is deterministic again,
  because the cleanup no longer stops. `dev/runtime-test.mjs`,
  `dev/PROCESS-SIGNALS.md`.
- D-2 (medium): the driver names the spawn error code when a run gives no
  usable output, and the note states the fifteen-second and one-mebibyte
  caps. `dev/runtime-signals-check.mjs`, `dev/PROCESS-SIGNALS.md`.
- C-1 (low): the load reading now states its method and that it is not
  retained. `dev/validation/2026-09-11-process-signals/README.md`.
- C-2 (low): the hash sentence is scoped to the five startup and mutation
  captures. `dev/validation/2026-09-11-process-signals/README.md`.

The review gate ran the full ladder on the fixed tree. The ladder gave 24
PASS legs of 27. Three timing legs were red: M0-TIME, M0-RATIO and M1-CORPUS.
The host load was above the waiver threshold of load1 25 for each of those
legs, so the check loop closed with the three timing legs waived as
load-bound. A red result on one of the three rewritten signal tests is never
waived by load alone. The RUNTIME suite gave 63 of 63 tests, with zero
failures. The gate log is retained at
`dev/validation/2026-09-11-process-signals/gates-review.log`.
