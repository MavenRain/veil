# Request arity validation

Validated on base `69be3ab435fdd05af64e9637c012df64b1d18b52` in
`/Users/oobi/Documents/gpt3/veil-request-validation`.

| Check | Result |
| --- | --- |
| Final regression tests with the base runtime | Expected exit 1: all 17 request-row subtests fail; two valid-request controls pass |
| Final runtime suite | Exit 0: 49 tests pass, zero fail |
| Compiled host-natural fixtures | Exit 0: HOST-NAT 16/16 |
| Compiled reactor fixtures and CLI | Exit 0: 103 checks pass |

`regressions-before.stdout` comes from a minimal scratch tree containing the
final `dev/runtime-test.mjs` and `runtime/reactor.mjs` extracted from the base
commit. The command selects the three new test groups. It demonstrates, among
other cases, that an extra temporary-directory argument is ignored and the
runtime creates a directory successfully instead of rejecting the request.

`runtime-startup-race.stdout` records an intermediate run with 48 passes and
one failure in the existing escalation-callback test. Its 150 ms deadline
terminated the child before the PID marker was available, and the test
reported ENOENT. The arity tests all passed in that run. A subsequent full
run, without a concurrent baseline test process, passed all 49 tests. The
escalation test and runtime process-handling code were not changed.

The command metadata, source hashes, baseline runtime hash, compiler hash and
Node version are recorded in `results.json`. Retained output has trailing
whitespace removed from each line; original capture paths and counts remain
in the metadata. No compiler sources changed, and validation reused the
existing compiler executable. This record covers the scoped suites above,
not a fresh full compiler gate ladder.

Static inspection checked the arity table against all 17 documented rows,
the validation position before dispatch, both variadic minimums, terminal
request handling, error delivery through `resume`, and the absence of gate
removals or bound changes. No remaining defect was found in this slice.

## Review 2026-09-10

A four-lens review of this slice ran on 2026-09-10. It kept five findings
(D-2, D-1, A-1, C-1, C-2), refuted none, and dropped one (A-2, a duplicate of
D-2). One fix round corrected all five findings. The check loop closed with no
waiver.

The full gate ladder ran after the fix round. The log of that run is
`gates-review.log` in this directory. The ladder passed 26 legs of 27.

- BUILD-EXIT 0
- TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK
- RUNTIME `# pass 49`, `# fail 0`, RUNTIME-EXIT 0
- HOST-NAT 16/16, HOST-NAT-EXIT 0
- reactor: 103 checks passed, REACTOR-EXIT 0
- PASS HOST programs=3 zk-instance=10/10, HOST-EXIT 0
- FAIL M0-RATIO kanon_ms=30.591 kanon_lines=1000 tot_ms=103.662 tot_lines=8138
  ratio=2.401551 bound=2.000 load1=18.160
- GATES-FAIL, LADDER-EXIT 1

M0-RATIO is a timing leg and is the only red leg. The baseline log of the
staged tree shows the same leg red.

The review recomputed two hashes in `results.json` from the staged bytes:
`sha256["runtime/reactor.mjs"]` and `sha256["dev/runtime-test.mjs"]`. The fix
of D-2 changed those two files. No other value of `results.json` changed, and
the ten capture files stay as captured.

The sections above this one describe the scoped checks recorded before the
review (regressions-before 2 of 20 with the 18 arity failures, runtime 49 of
49, runtime-startup-race 48 of 49, host-nat 16 of 16, reactor 103 checks) and
no full ladder run.
