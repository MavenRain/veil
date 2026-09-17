# File access validation, 2026-09-16

Base: `8888c1d8d561d58e67c13b16144becc5f5a90211`.

Operation 48 checks existence or selected access permissions. Its contract
is in [FILE-ACCESS.md](../../FILE-ACCESS.md). Validation ran in an isolated
checkout on macOS with Node v23.10.0 and the verified compiler from the base.

| Check | Result | Capture |
| --- | --- | --- |
| Complete runtime suite | 307 passed, no failures or skips | `runtime.json` |
| Compiled functional run | 4018 checks passed in 35.284 s | `reactor.json` |
| REACTOR 30 s gate | Four attempts timed out | `reactor-timeout-*.json` |
| Pre-change harness diagnostic | 3811 passed in 42.987 s | `baseline.json` |
| Host naturals | 16/16 | `host-nat.json` |
| Positive control | Eight passed, no failures or skips | `positive.json` |
| Defect controls | All eight failed assertions | `controls.json` |
| JavaScript syntax | All three files passed | `syntax-*.json` |
| Repository conventions | HOUSE OK | `house.json` |
| Trusted lines | Kernel 5246/5250; encoder 246/600 | `trusted-lines.json` |
| Whitespace | Passed | `diff-check.json` |

The runtime count increased by nine: eight tests and the arity subtest.
The compiled suite adds 207 checks. Repeated mode checks share a Node
process, with a fresh module instantiation for each request. These checks
still use the real reactor, filesystem and output stream. Separate CLI
runs cover paths, arity and malformed modes. Existing tests are retained.

## Watchdog limitation

The required REACTOR gate did not pass its unchanged 30-second watchdog.
All four attempts ended with exit 124 and no assertion verdict, which the
four `reactor-timeout-*.json` captures record. The harness used for each
attempt, the concurrent RUNTIME run and the system load averages of 40.51
and later 21.14 were observed at run time. The captures hold none of these
three details, so they are not part of this record.

Diagnostic runs used a 120-second capture ceiling and a timing probe.
The pre-change harness passed its 3811 checks in 42.987 seconds, with
42.145 seconds in 501 subprocess calls. The final harness passed 4018
checks in 35.284 seconds, with 34.560 seconds in 518 subprocess calls.
These measurements occurred at different loads and do not establish a
performance improvement. They show that the pre-change harness also
exceeded the gate limit in this environment. The diagnostic verdict is
functional evidence, not a passing 30-second gate.

The baseline harness came from the base commit. Only its root binding was
redirected to the isolated checkout, which retained the original fixtures
and compiler. It used the current compatible runtime. The run invoked that
copy as `.gatework/access-diagnostics/baseline.mjs`, a scratch path of the
isolated checkout. That copy is not retained in this record, so the 3811
figure and the 207 difference are a one-time diagnostic and cannot be
rebuilt from the record alone. The timing probe wraps synchronous
subprocess calls and reports timing on process exit. It is retained as
`timing-probe.mjs`, and the run imported it as
`.gatework/access-diagnostics/timing.mjs`. Both captures are retained.
No gate threshold was changed.

## Scope and reproduction

`results.json` pins source hashes, capture hashes and platform details.
`source-scope.json` checks every baseline tracked file and verifies that
all original runtime and compiled test bodies are preserved. Compiler
sources, kernel code and gate scripts match their base hashes. The compiler
and full milestone ladder were not rebuilt or rerun. Windows was not
exercised. Injected host calls cover denied and unsupported operations.

Run the existing gates with the compiler at
`_build/default/bin/kanon.exe`:

```sh
kanon-wait run -- kanon-exec run --budget 4000 -- \
  gtimeout 30 node --test --test-reporter=tap dev/runtime-test.mjs
kanon-wait run -- kanon-exec run --budget 4000 -- \
  gtimeout 30 node dev/reactor-test.mjs _build/default/bin/kanon.exe
kanon-wait run -- kanon-exec run --budget 4000 -- \
  gtimeout 30 node dev/host-nat-test.mjs _build/default/bin/kanon.exe
```

The second command is the one that timed out in this environment. Read the
`Watchdog limitation` section above before you use its verdict. The
`reactor.json` capture came from the same command with the timing probe
imported, under a 120-second ceiling:

```sh
node --import ./.gatework/access-diagnostics/timing.mjs \
  dev/reactor-test.mjs _build/default/bin/kanon.exe
```

The probe is retained as `timing-probe.mjs`. Copy it to that import path,
or import it from its record path, to reproduce the 35.284-second figure.

`reproduce-controls.py --output NEW_DIRECTORY` creates isolated runtimes
and runs the unchanged access tests against eight deliberate defects.
Invoke it with `python3 -I` through the same capture wrapper. Its positive
control must pass and every defect must fail an assertion. The defects
remove dispatch or arity, ignore access, ignore permission flags, normalize
paths, check before validation, accept noncanonical modes or omit awaiting
the host call. The script never edits the working runtime.

## Review 2026-09-16

The review found five low findings. All five findings are fixed. The
finder carried two findings, B-1 and A-1, for a user ruling, because
their only repair would edit the sha256-pinned dev/runtime-test.mjs and
invalidate the frozen controls.json capture. The review refuted three
candidate findings after a probe on a fresh copy.

The check loop closed with no waiver. The runtime suite passed 307 of
307 tests. The reactor suite passed 4018 checks. HOST-NAT passed 16 of
16 checks. These four results were never waived by load.

Close ladder run 23:0x, start load1 11.26, end load1 15.34.
LADDER-EXIT 0, every named leg PASS, no FAIL row. The check loop closed
under an empty waiver: no leg needed a load waiver. The full log is pinned
at `gates-review.log`.

Numbers read from that log: TRUSTED-LINES kernel=5246/5250
encoder=246/600 OK. RUNTIME `# pass 307 of 307`, `# fail 0`,
RUNTIME-EXIT 0. HOST-NAT 16/16, HOST-NAT-EXIT 0.
`reactor: 4018 checks passed`, REACTOR-EXIT 0.

This review recomputed the stale source_sha256 rows from the fixed, staged
bytes. It added the new capture_sha256 row
`dev/validation/2026-09-16-file-access/gates-review.log`, pinning
that log. It then recomputed the source_sha256 row of this README last,
since the section you are reading changed the README's own bytes.
