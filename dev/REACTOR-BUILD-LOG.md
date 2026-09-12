# Reactor application increment (2026-09-07)

This increment starts at e0a691a6909e38be414b248a2db541ca58989567, whose
compiler exports ordinary Kanon definitions and whose Node runtime drives
an OS request protocol.  The earlier runtime tests supplied JavaScript
mock exports; the compiler tests called Wasm exports directly.  Neither
test exercised a compiled Kanon state machine through the full runtime.

## Application and command

`runtime/reactor.kan` supplies the Bytes and Words families, ten ABI
constructors/accessors and `bytesAppend`.  `examples/reactor-realpath.kan`
uses those definitions to accept exactly one path, request operation 8,
consume the returned answer through `resume`, and write it with a newline
using operation 6 or 7.  It exits 0 on success, 1 on filesystem or output
failure, and 64 for a wrong argument count.  An output failure preserves
an already nonzero application result.

`node runtime/run.mjs MODULE.wasm [ARG ...]` loads an application, forwards
its arguments unchanged, and returns its runtime status.  Missing module
arguments use exit 64; loading or runtime exceptions use exit 2 and one
stderr diagnostic.  A sole `--help` prints usage with exit 0.  No compiler,
kernel, parser, trusted budget, gate bound or dependency revision changes.

## Interruption correction

After an interrupted operation 4, the runtime allows one shutdown request.
If that request was operation 0, the old branch returned the application's
exit code and could report success after SIGINT or SIGTERM.  A latched
signal now takes precedence in that branch, returning 130 or 143.

Two regression controls failed on the original runtime with actual 0
instead of 130 or 143.  Both pass after the fix.  Ordinary terminal exits
0 and 7 and the existing final shutdown write still pass.  The new tests
deliver interruption while capture opening yields, check the operation 4
interruption response, and verify that no child was started.

## Validation

Validation used the isolated source snapshot at
/Users/oobi/Documents/gpt4/kanon-reactor-followup/work and its copied
23 MiB compiler cache.  The existing compiler checked the shared Kanon
source and built the application through the normal multiple-file CLI.
The example module is 5,131 bytes and exports the sixteen required names.

| Check | Result |
| --- | --- |
| REACTOR command under the existing 30-second MED watchdog | 70 checks passed, exit 0, 0.880 seconds. |
| RUNTIME command under the existing 30-second MED watchdog | 20 tests passed, no failures or skips, exit 0, 4.289 seconds.  Fix round 1 added the argument-order test and measured this run. |
| Real CLI and OS integration | UTF-8 and flag-shaped path arguments, canonical-path output, missing-path errors, usage errors and runner diagnostics passed. |
| Compiled state transitions | Raw answer bytes including NUL and 255 survive `resume` and output preparation; output failure produces terminal status 1. |
| Existing reactor compiler coverage | Host ABI and literal refusals passed; the legacy emitted module still matches its tracked bytes. |
| HOUSE | Passed. |
| TRUSTED-LINES | Kernel 3997/4000, encoder 246/600, passed. |
| Documentation checks | Exact export list and all 21 gate names agree with source; M1 ratification remains open. |
| Independent source review | No further correctness or test-isolation defects found. |

These are the existing REACTOR and RUNTIME gate commands with their
unchanged watchdog and success oracles.  The full compiler, Lean,
arithmetic-agreement and performance batteries were not repeated for this
runtime/application increment.  No M1 exit ratification is claimed.

Evidence root: /Users/oobi/Documents/gpt4/kanon-reactor-followup/evidence.
`gate-checks.json`, `reactor-gate.log` and `runtime-gate.log` record the gate
commands and results.  `runtime/terminal-before.tap` records the failing
controls, with passing focused and full results beside it.  `example/`
holds the built application and direct/runtime observations.  `house.log`
and `trusted-lines.log` record the static checks.

## Full-buffer append (2026-09-07)

This increment starts at fdd52f0a039f120b65a2af21c472e4dcbd5e8b07.
The shared `bytesAppend` helper consumed one Wasm call frame per left
element, so it could not process a full 65536-byte reactor read answer.
It now uses `bytesReverseOnto` for two structurally recursive tail-call
passes.  The public append type and the sixteen host exports stay the
same.  The result preserves byte order and shares the right list.
Wasm stack use is constant; time and allocation are linear in the left
length, with two list nodes allocated per left element.

The reactor suite constructs large inputs through the compiled module's
ABI.  It checks empty operands, binary suffixes, a full read buffer on
either side, two full buffers, preservation of the left input, and a
second append onto each result.  The
compiled realpath state machine also consumes full-buffer answers on
both its success and error paths, appends a newline, and completes after
the output acknowledgement.

An initial run of the unchanged runtime suite exposed a readiness race:
test 8 sent SIGINT after 150 ms even if the Node child had not published
its PID, then failed with ENOENT when reading that PID.  The test now
signals only after the child atomically publishes the complete marker.
The 1000 ms process deadline, signal-status oracle and process-reaping
assertion remain; additional assertions require one spawn and a valid
PID.  No runtime implementation or gate bound changed.

| Check | Result |
| --- | --- |
| REACTOR under its existing 30-second watchdog | 103 checks passed. |
| Original append with the same new tests | Failed with `RangeError: Maximum call stack size exceeded`. |
| RUNTIME after the readiness fix, existing 30-second watchdog | 20 tests passed, zero failures or skips. |
| HOUSE | Passed. |
| TRUSTED-LINES | Kernel 3997/4000, encoder 246/600, passed. |
| Independent source review | No findings; test deadlines and gate oracles preserved. |

At the time of this record the README status recorded Stage L
implementation as complete and full validation as open.  dev/gates.sh
holds 21 leg invocations, the last two being REACTOR and RUNTIME.  At
the time of this record the recorded battery in M1-BUILD-LOG.md held
19 leg rows and no row for those two legs.  It also ran on a source
snapshot that predates the compiler commits in HEAD.  The later record
M1-BUILD-LOG.md `## Current compiler validation (2026-09-07)` holds 21
leg rows, including REACTOR and RUNTIME, on commit 8603482.  M1 exit ratification
remains open.  Compiler, kernel, Lean and gate sources did not change;
the full milestone and performance batteries were not repeated.

Evidence root: /Users/oobi/Documents/gpt4/kanon-reactor-buffer/evidence.
`captures/run-xpzvm5` holds REACTOR, `negative-control/run-cAvBad` holds
the original helper's failure, `scoped-gates/run-enKipZ` holds the initial
runtime failure and passing static checks, and `runtime-fixed/run-K3nhin`
holds the final passing runtime suite.  All are kanon-exec artifacts.

## Process signal test synchronization, 2026-09-11

Base: `33317868b33ad474916b29b4e4fc4ba7e523de2f`.

Three signal tests could kill the Node child before it published its PID.
They now wait for atomic readiness before advancing a controlled parent
timer. The child startup and OS signals remain real. Assertions cover the
150 ms deadline, the 250 ms escalation delay, original error propagation
and process reaping. The fixture deliberately delays readiness by 200 ms.

The complete runtime suite passed 63 of 63 tests with no skips. A separate
200 ms startup-delay reproduction fails all three old tests and passes
all three revised tests. Mutations that delay the deadline or escalation
by one millisecond, or replace the propagated error, are rejected.

Production sources and gate thresholds are unchanged. No compiler rebuild
or full milestone/performance ladder was required for this test-only change.
The method and reproduction commands are in `dev/PROCESS-SIGNALS.md`;
captures and source hashes are in `dev/validation/2026-09-11-process-signals/`.

## Temporary-directory prefixes, 2026-09-11

Base: `e0a1f7b351c7e5a7b385825fdc15dfbf05d0741d`.

Operation 1 now keeps empty and literal dot prefixes inside the resolved
root. Previously, joining the prefix before adding the random suffix could
create a sibling of the root or its parent. Prefixes containing either
slash form now return status 1 before any filesystem operation.

The original runtime fails both new regressions. The final RUNTIME suite
passes 65 tests and REACTOR passes 227 checks under their existing
30-second watchdogs. The new compiled fixture covers successful directory
creation and error delivery through Wasm and the CLI. HOUSE and
TRUSTED-LINES pass, with kernel 5246/5250 and encoder 246/600 unchanged.

The [directory note](TEMP-DIRECTORY.md) specifies the behavior and commands;
the [validation record](validation/2026-09-11-temp-directory/README.md)
retains the failed control, final outputs, source hashes and a corrected
macOS path-alias assertion from the first compiled test run. No full
milestone or performance battery was repeated for this runtime slice.

## Filesystem cleanup, 2026-09-11

Base: `b0887e5c8fce2e4e16f929bdb73b9ba3903c0e96`.

Operation 19 unlinks files and symlinks; operation 20 removes empty
directories. Both require one path and return empty success answers or
filesystem errors through `resume`. This lets reactors release files and
temporary directories through the host API. Directory removal is never
recursive, and unlinking a final symlink preserves its target.

RUNTIME passes 70 tests with no skips, and REACTOR passes 281 checks under
the existing 30-second watchdogs. The three new cleanup tests fail against
the original runtime. They also reject three isolated mutations: a no-op
unlink, recursive directory removal, and following symlinks before unlink.
The initial full runtime run caught the old unknown-opcode test's use of
19; its sentinel is now 21. Production behavior required no further change.

HOUSE and TRUSTED-LINES pass. The kernel remains 5246/5250 lines and the
encoder 246/600. The existing compiler executable compiled the new fixture;
no compiler rebuild or full milestone/performance battery was required.
The [cleanup note](FILE-CLEANUP.md) documents semantics and commands; the
[validation record](validation/2026-09-11-file-cleanup/README.md) retains
outputs, source hashes and the failed controls.

## Filesystem rename, 2026-09-11

Base: `6fbd6dd0d14503b64635453ceea651df9455db99`.

Operation 21 renames existing files, symlinks and directories with exactly
two path arguments. It returns empty success answers or OS errors through
`resume`. The host uses `rename` directly, retaining the filesystem's
replacement semantics and refusing cross-filesystem moves without a copy
fallback. Final symlink targets are preserved.

RUNTIME passes 76 tests with no skips, and REACTOR passes 321 checks under
the existing 30-second watchdogs. The base runtime fails four of the five
new focused tests; its existing path decoder already passes the fifth.
The tests reject four isolated mutations: a no-op rename, copying and then
unlinking, following the source symlink, and following the destination
symlink. The unknown-operation test now uses the maximum ABI operation
number, keeping that check separate from the newly implemented operation.

The compiler executable matches the preceding cleanup validation record
and compiled the new fixture without a compiler rebuild. HOUSE passes all
five checks. The kernel remains
5246/5250 lines and the encoder 246/600. No gate or threshold changed, and
the full milestone and performance battery was not repeated.
The [rename note](FILE-RENAME.md) documents behavior and commands; the
[validation record](validation/2026-09-11-file-rename/README.md) retains
the complete captured streams, statuses, source hashes and mutation details.
