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

## Directory listing, 2026-09-11

Base: `037eccb42a0cbb0882a8aa726d1a2afe4ceff31f`.

Operation 22 lists direct entry names with exactly one directory argument.
Names retain their raw bytes, sort in unsigned byte order and each end in
NUL. The host reads incrementally and rejects answers over 65536 bytes,
including terminators. Success, overflow and read failures close the handle.
Symlink entries remain names; a requested directory symlink follows normal
OS resolution. OS errors resume with status 1, without partial listings.

RUNTIME passes 83 tests with no skips, and REACTOR passes 351 checks under
the existing 30-second watchdogs. The compiled fixture checks the exact
65536-byte answer and a 65537-byte rejection through the CLI. All six new
focused runtime tests fail against the base runtime. They also reject four
isolated mutations: text sorting, missing terminators, no answer limit and
omitted directory close. The response helper now uses constant-time cons,
and byte comparison diagnostics stay bounded even for full-size answers.

The initial focused run caught quadratic copying in the test helper and
double-counted Node's callback wrapper when observing handle closure. It
also found that the local sandbox refuses raw non-UTF-8 filenames. The final
raw-byte test injects those reader entries; the remaining enumeration tests
create real files and directories. The compiled suite passed on its first run.

HOUSE and TRUSTED-LINES pass. The existing compiler executable matches the
preceding rename validation record. No compiler sources, gate scripts or
thresholds changed; the kernel remains 5246/5250 and the encoder 246/600.
The full milestone and performance battery was not repeated for this runtime
slice. The [listing note](DIRECTORY-LISTING.md) documents the operation; the
[validation record](validation/2026-09-11-directory-listing/README.md) retains
the completed captures, source hashes and negative controls.

## Filesystem entry kinds, 2026-09-12

Operation 23 extends directory listing with entry inspection. It accepts one
path, uses `lstat`, and returns `file`, `directory`, `symlink` or `other` as
unterminated ASCII bytes. Directly named final symlinks retain their own kind,
including dangling and self-referential links. Parent components and trailing
separators follow OS resolution. Missing paths report errors through `resume`.

The full RUNTIME suite passes 89 tests without skips, and REACTOR passes 390
checks under the existing 30-second watchdogs. The new Kanon fixture compiles
to an import-free Wasm module and checks successful kinds and error statuses
through the CLI. The base runtime fails the new behavior and arity checks with
`unknown OS request 23`. Two isolated controls are rejected: replacing `lstat`
with `stat`, and omitting the operation's arity entry.

HOUSE and TRUSTED-LINES pass. The compiler executable was reused after matching
the directory-listing validation hash. Compiler sources, gate scripts and
thresholds are unchanged; the kernel remains 5246/5250 and the encoder 246/600.
The full milestone and performance battery was not repeated for this runtime
slice. The [entry kind note](ENTRY-KIND.md) documents the operation, and the
[validation record](validation/2026-09-12-entry-kind/README.md) retains captures,
source hashes and the negative-control replacements.

## Symlink targets, 2026-09-12

Base: `10a97e77bc7c36925317dca44af2f449cb70ab73`.

Operation 24 reads a symlink's stored target as raw bytes. It accepts exactly
one path, preserves literal relative targets and non-UTF-8 answer bytes, and
does not follow the final target. Dangling, chained and cyclic final links
succeed. Paths retain OS resolution of parent components and dot segments.
The response is limited to 65536 bytes; larger responses and OS errors resume
with status 1 and no partial target.

RUNTIME passes all 96 tests without skips, and REACTOR passes 465 checks.
Both use their existing 30-second watchdogs. The first concurrent attempts
timed out while the observed load1 was 88.30; subsequent individual runs of
the same source passed without changing commands or thresholds. The captures
retain both timeouts and passing runs. All six new focused tests fail against
the base runtime with `unknown OS request 24`.

The new import-free Kanon fixture checks raw and 65536-byte response forwarding,
read and stdout write statuses, and real CLI requests. Native link tests use
UTF-8 targets. Injected reader results cover arbitrary target bytes and the
65536/65537-byte boundary, which native filesystems may not permit. Five isolated
controls are rejected: resolving the target, decoding the target, normalizing
the request path, omitting the response bound and omitting the arity entry.

HOUSE and TRUSTED-LINES pass. The existing compiler executable matches the
entry-kind validation record. Compiler sources, gate scripts and thresholds
are unchanged; the kernel remains 5246/5250 lines and the encoder 246/600.
The full milestone and performance battery was not repeated for this runtime
slice. The [symlink target note](SYMLINK-TARGET.md) documents the behavior, and
the [validation record](validation/2026-09-12-symlink-target/README.md) retains
completed captures, source hashes and the exact mutation replacements.

## Symlink creation, 2026-09-12

Base: `3018ec59c4fff261de59f7ca78cec29aa5130102`.

Operation 25 creates a symlink from a target and destination, returning an
empty status-0 answer. On POSIX the stored target remains literal, including
relative, dangling, chained and cyclic targets. Destination paths retain OS
resolution of parent symlinks and dot segments. Existing destinations are
preserved, missing parents are not created, and OS errors resume with status 1.
Both arguments use the existing NUL-free UTF-8 validation before dispatch.

RUNTIME passes all 103 tests without skips. REACTOR passes 568 checks, including
the new import-free fixture, direct argument and status checks, and native CLI
creation and failure cases. Both suites use their existing 30-second watchdogs.
The six focused tests all fail against the base runtime with
`IO: unknown OS request 25`.

Six isolated controls are rejected: resolving the target, normalizing the
target, normalizing the destination, unlinking an existing destination first,
reversing the arguments and omitting the arity entry. Each control runs the
unchanged final test file. The kill counts are not uniform: the controls fail
6, 5, 3, 1, 6 and 1 of the six tests, in that order. Native cases cover macOS; an injected creator
checks validation before any filesystem call and literal argument forwarding.
An initial test assumed empty targets were rejected; macOS accepts them, so
the final contract leaves their acceptance to the OS and tests their forwarding.

HOUSE and TRUSTED-LINES pass. The kernel remains 5246/5250 lines and the encoder
246/600. The existing compiler executable matches the symlink-target validation
record. Compiler sources, gate scripts and thresholds are unchanged. The full
milestone and performance battery was not repeated for this runtime slice.
The [symlink creation note](SYMLINK-CREATE.md) documents the behavior, and the
[validation record](validation/2026-09-12-symlink-create/README.md) retains
completed captures, source hashes and exact mutation replacements.

## Hard-link creation, 2026-09-12

Base: `e099b831b8ec3fe3b5b09d9a35720bcb688dc875`.

Operation 26 creates a hard link from source and destination arguments and
returns an empty status-0 answer. For regular files, both names share identity
and contents. Unlinking one name preserves the other. Atomic replacement through
operation 3 leaves the other name attached to the old contents. Paths retain
OS resolution; existing destinations are preserved, parents are not created,
and OS failures resume with status 1. Both arguments use the existing arity,
NUL and UTF-8 validation before dispatch.

RUNTIME passes all 111 tests without skips. REACTOR passes 627 checks, including
the new import-free fixture, argument and status forwarding, and real CLI
creation, conflict and error cases. Both use the unchanged 30-second watchdogs.
The first sandboxed REACTOR capture failed with a process-group cleanup error
and empty streams. The same command passed with process-control access; the
failed capture is recorded as having no usable verdict.

All seven focused tests fail against the base runtime. Seven isolated mutation
controls are rejected: copying instead of linking, creating a symlink,
normalizing either path, overwriting a destination, reversing the arguments
and omitting the arity entry. Native cases cover macOS. Cross-device,
permission and link-limit errors are also injected to verify error propagation.

JavaScript syntax, HOUSE and TRUSTED-LINES checks pass. The kernel remains
5246/5250 lines and the encoder 246/600. The existing compiler executable
matches the symlink-creation validation record. Compiler sources, gate scripts
and thresholds are unchanged, so the full milestone battery was not repeated.
The [hard-link note](HARD-LINK.md) documents the contract, and the
[validation record](validation/2026-09-12-hard-link/README.md) retains the
commands, capture references, source hashes and exact mutation replacements.

## File copying, 2026-09-12

Base: `addeb7a814c65e2c965e56a79d92f18cb704dd99`.

Operation 27 copies file contents to a new destination using the host's
exclusive-create flag. The files have independent identities and contents;
source symlinks are followed, existing destination entries are preserved, and
missing parents are not created. Both paths retain OS resolution and the
existing arity, NUL and UTF-8 checks. Copies do not pass through the response
buffer, so files may exceed 65536 bytes. The host retains its copy permission,
metadata and partial-failure behavior, as documented in [FILE-COPY.md](FILE-COPY.md).

RUNTIME passes 119 tests with no skips. REACTOR passes 715 checks, including
the new import-free fixture, all fixture states, byte and argument forwarding,
status propagation and real CLI copying. The hard-link fixture's reporting
state now preserves the operation status, resolving review D-1; direct compiled
checks cover both statuses. A separate control passes on the repaired fixture
and fails on its previous constant-1 arm.

Both suites keep the existing 30-second watchdog. The modified and unchanged
REACTOR suites first timed out in the sandbox with empty streams at high load
(a nearby load1 reading was 91.32). The modified suite passed with normal
child-process access under the same limit. Both timeout captures are retained;
they are not passing evidence or waived assertions. The first focused RUNTIME
run also caught a test expectation: macOS reports ENOTSUP for a directory
source. The test now accepts that native refusal, and the full suite passes.

The seven focused copy tests reject the base runtime. Six isolated mutations
are also rejected: overwriting a destination, creating a hard link, normalizing
either path, reversing arguments and omitting the arity entry. Native filesystem
cases cover macOS; ENOSPC, EIO and EACCES failures use injection.

JavaScript syntax, HOUSE and TRUSTED-LINES checks pass. The kernel remains
5246/5250 lines and the encoder 246/600. The compiler executable matches the
hard-link validation record. Compiler sources, gate scripts and thresholds
are unchanged; the full compiler and milestone battery was not repeated.
The [validation record](validation/2026-09-12-file-copy/README.md) pins source
hashes, command captures, negative controls and this build log after all edits.

## Named directory creation, 2026-09-12

Operation 28 creates one directory under an existing parent. It accepts one
NUL-free UTF-8 path, requests mode 0700 subject to the host umask, and returns
an empty answer on success. It preserves existing entries and returns OS
errors through `resume`. Paths retain native resolution, including relative
names and parent symlinks followed by dot segments. The payload is unused.

The runtime suite adds seven tests and one arity-matrix row. They cover real
permission bits under two umasks, composition with file creation and cleanup,
native path resolution, preserved entries, missing parents, malformed requests
before filesystem access and continuation after injected OS errors.
The compiled fixture checks argument and answer forwarding, retained statuses,
terminal-state stability and actual CLI creation and refusal paths.

Validation at base `7a8bbefdcfc681a7be1b00d93c655c7e2c949368`:

- RUNTIME: 127 passed, zero failures and skips.
- REACTOR: 789 checks passed.
- JavaScript syntax, HOUSE and TRUSTED-LINES checks passed. `git diff --check`
  passed on the modified tracked files; the new files were untracked in the
  validation tree, and `git diff --cached --check` on the staged tree covers them.
- The base runtime and five defect controls were all rejected under the same
  `^directory creation` selection of seven focused tests. The kill counts are
  not uniform (7, 3, 2, 3, 1, 3).

The compiler was reused by hash from the file-copy record. The full test
commands retain their 30-second watchdogs. No compiler, gate or milestone
battery changes were needed. Native validation covers macOS; Windows was
not exercised. The [directory creation record](validation/2026-09-12-directory-create/README.md)
retains commands, hashes, captures and controls.

## Binary file append, 2026-09-12

Operation 29 appends up to 65536 raw payload bytes to one path, using append
mode and private creation permissions. Empty payloads create missing files.
Existing file identities and ordinary permission bits survive append, hard
links share the result, and final symlinks are followed. Paths retain native
resolution. The operation adds no rollback or whole-payload atomicity promise.

The runtime adds eight tests and one arity-matrix row for binary chunks,
private creation under two umasks, identities and links, relative paths,
path errors, size limits, malformed requests and injected OS failures.
The new compiled fixture checks exact argument and binary payload forwarding,
reporting and terminal states, both status combinations, creation, repeated
append and CLI errors.

Validation at base `67255e5eacb091a0341872572c9249b8db34bb1a`:

- RUNTIME: 136 passed, zero failures, cancellations or skips.
- REACTOR: 857 checks passed.
- The anchored `^file append` selection passed all eight tests.
- The base runtime and seven isolated defect controls were rejected under
  that same selection, with failure counts 8, 5, 6, 3, 3, 2, 1 and 2.
- JavaScript syntax, HOUSE and TRUSTED-LINES checks passed. The kernel stays
  at 5246/5250 lines and the encoder at 246/600.
- `git diff --check` passed for modified tracked files. Staging checks cover
  all added paths as well, including the fixture and validation records.

The first focused run used a test adapter that copied each remaining payload
tail. Its command wrapper failed during process-group cleanup and produced
no complete capture or trustworthy test verdict. The retained initial record
does not count as a passed run. Request bodies in the script adapter now use
Buffer views; the final focused and full runtime runs use those tested bytes.
Production decoding is unchanged.

The compiler executable matches the directory-creation validation record.
Compiler sources, gate scripts and thresholds are unchanged. RUNTIME and
REACTOR retained their 30-second watchdogs; the full compiler and milestone
battery was not repeated. Native filesystem tests cover macOS, with injected
permission, full-disk and read-only-filesystem failures. Windows, special
files, concurrent writers and partial writes were not exercised. The
[append validation record](validation/2026-09-12-file-append/README.md) pins
commands, source hashes, captures and controls after all documentation edits.

## File truncation and extension, 2026-09-12

Operation 30 resizes an existing file to an ASCII decimal byte length. It
uses the existing OS numeric parser and `truncate`, preserving literal path
resolution and file identity. Shrinking retains the prefix, extension fills
with zeros, hard links share the result and final symlinks are followed.
Missing files and dangling targets are not created. The unused request body
and file length are independent of the 65536-byte transfer bound.

Seven runtime tests and one arity-matrix row cover binary contents, repeated
lengths, zero extension through 65537 bytes, links and ordinary permissions,
relative paths, parent symlinks, malformed requests, exact safe-integer
forwarding and OS errors. The new compiled fixture covers argument and body
forwarding, reporting and terminal states, host/output status combinations,
CLI resizing and request failures.

Validation at base `1a88d6f7e84f6d27e8775e5a0657a20229fca53e`:

- RUNTIME: 144 passed, zero failures, cancellations or skips.
- REACTOR: 963 checks passed. HOST-NAT: 16/16.
- The anchored `^file truncate` selection passed all seven tests.
- The base runtime and six isolated defect controls were rejected under
  that same selection, with failure counts 7, 6, 3, 1, 2, 1 and 2.
- JavaScript syntax, HOUSE, TRUSTED-LINES and tracked-file whitespace checks
  passed. Kernel lines remain 5246/5250; encoder lines remain 246/600.

The validated compiler executable is reused by hash from the file-append
slice. Compiler sources, gate scripts and thresholds are unchanged. RUNTIME,
REACTOR and HOST-NAT ran with 30-second watchdogs. The full compiler and
milestone battery was not repeated. Native tests ran on macOS; lengths above
65537 and EACCES, ENOSPC, EFBIG, EROFS and EIO failures used a mocked filesystem
boundary. Windows, special files, concurrent mutation, crash durability and
native resource exhaustion were not exercised. The
[truncate validation record](validation/2026-09-12-file-truncate/README.md)
pins final sources, commands, captures and controls.
