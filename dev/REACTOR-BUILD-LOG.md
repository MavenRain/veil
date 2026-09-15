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

## Filesystem permission changes, 2026-09-13

Starting from `c3fc553`, operation 31 changes permissions on an existing
filesystem entry with exactly two arguments, `path, mode`. The mode uses
the existing decimal parser and must fit 0 to 511, the nine ordinary
permission bits. Paths pass literally to `chmod`; success returns empty
bytes, and failures use the existing status and error response. This lets
generated files become executable and supports permission changes on
directories and through links.

Nine runtime tests cover native file and directory modes, zero and maximum
permissions, identity and contents, generated-program execution through
operation 4, hard and symbolic links, relative and Unicode paths, path
failures, rejected arguments and injected OS errors. An adapter checks all
512 accepted numeric modes and the ignored binary payload. The arity matrix
also includes the new row. A compiled Kanon fixture checks operation 31,
literal arguments, binary body, response forwarding, output failure and
stable termination through the normal compiler and runtime.

Validation:

- RUNTIME passed 154 tests with zero failures or skips, including the nine
  new top-level tests and the new arity subtest. The focused selection passed
  all nine tests. Both successful runs used 30-second watchdogs.
- REACTOR passed 1070 checks, an increase of 107 executed checks, under a
  120-second diagnostic watchdog after two 30-second runs timed out.
- HOST-NAT passed 16/16. JavaScript syntax, HOUSE, TRUSTED-LINES and tracked
  whitespace checks passed. Kernel lines remain 5246/5250 and encoder lines
  remain 246/600.
- The base runtime and eight isolated defect controls all failed the same
  focused selection, with failure counts 9, 1, 1, 8, 7, 3, 7, 8 and 2.

The initial full runtime capture ended with a process-group cleanup error
and no complete verdict; its unchanged rerun passed in about 12.5 seconds.
Machine load was 50.97 when inspected after the first failed runs. The
reactor diagnostic establishes functional results, not a pass of its
30-second gate. No timing waiver is claimed. Gate scripts and thresholds
are unchanged.

The validated compiler executable is reused by SHA-256 from the truncate
slice, with compiler sources unchanged. The full compiler and milestone
battery was not repeated. Native tests ran on macOS; Windows, ACL
interactions and concurrent path replacement were not exercised. The
[file mode validation record](validation/2026-09-13-file-mode/README.md)
pins final source bytes, compiler bytes and each recorded evidence file.

## Filesystem permission inspection, 2026-09-13

Operation 32 reads the nine ordinary permission bits of an existing entry
as decimal bytes from 0 to 511. It accepts exactly one path, follows final
symlinks and leaves file-type and special bits out of the answer. Programs
can pass the answer to operation 31 to restore ordinary permissions; that
operation clears special bits. Host errors resume with status 1.

Eight focused runtime tests cover files, directories, a character device,
unchanged contents and identity, preservation of sticky bits, symlink
resolution, hard links, save/change/restore composition, relative Unicode
paths, request validation and error propagation. A compiled Kanon fixture
checks request bytes, answer forwarding, output failure, terminal stability
and native filesystem behavior. The shared arity matrix includes operation 32.

The focused selection passed 8/8 tests, RUNTIME passed 163/163 with no skips,
REACTOR passed 1141 checks, and HOST-NAT passed 16/16. All four commands used
the existing 30-second watchdogs. The compiler executable was reused by
SHA-256 from the preceding slice, with compiler sources unchanged. The full
compiler and milestone battery was not rerun. Native tests ran on macOS.
No defect controls were run for this slice, and the record holds no
`controls.json` and no capture of a mutated runtime.

The [permission inspection validation record](validation/2026-09-13-file-permissions/README.md)
records the remaining static checks, command captures, final source hashes
and validation scope.

## Filesystem modification time, 2026-09-13

Operation 33 reads an existing entry's modification time as signed decimal
nanoseconds since the Unix epoch. It accepts exactly one literal path and
requests BigInt metadata so formatting preserves nanoseconds beyond the
JavaScript safe integer range. Final symlinks are followed. Files, directories
and special files are accepted, and host errors resume with status 1.

Eight runtime tests cover metadata and content preservation, update detection
through append and truncate, links, native path resolution, rejected requests,
exact positive and negative timestamps, and host error propagation. The shared
arity matrix includes operation 33. A compiled Kanon fixture checks request
bytes, signed answer forwarding, output failures, stable termination and
native CLI behavior.

Validation at base `246e9b216d5d7a43934edd00e7d76deba872cef8`:

- Focused tests passed 8/8; RUNTIME passed 172/172 with no failures or skips.
- A 120-second diagnostic run of REACTOR executed 1245 checks, an increase of
  104 executed checks; the 30-second gate produced no verdict. The first
  30-second run timed out with exit 124 and no verdict. The final 30-second
  attempt's capture wrapper failed during process-group cleanup with exit 2,
  so that attempt supplies no complete test verdict. Neither is a gate pass.
- HOST-NAT passed 16/16 under its 30-second watchdog. JavaScript syntax,
  HOUSE, TRUSTED-LINES and tracked whitespace checks passed.
- The base runtime and four isolated defect controls all failed the same
  focused selection. Controls cover Number rounding, the wrong timestamp
  field, inspecting symlinks themselves and omitted arity validation.

The host load average was 114.00 when checked after the first reactor timeout.
The diagnostic establishes functional behavior without a timing waiver.
The compiler is reused by hash from the preceding slice. Compiler sources,
gate scripts and thresholds are unchanged; the full compiler and milestone
battery was not rerun. Kernel lines remain 5246/5250; encoder lines remain
246/600. Native tests ran on macOS. Negative timestamps and signed 64-bit
endpoints used an injected filesystem result. Windows and concurrent path
replacement were not exercised. The
[modification time validation record](validation/2026-09-13-file-modified/README.md)
pins final source bytes, compiler bytes, passing checks and failed attempts.

## File access time, 2026-09-13

Operation 34 accepts exactly one path and returns `atimeNs` from bigint
`stat` as signed decimal nanoseconds since the Unix epoch. The host preserves
the integer directly, follows final symlinks and leaves paths literal for
native resolution. It does not open file contents or set timestamps. Errors
resume with status 1, and the request body is unused. Filesystem update policy
and resolution determine the observation; reading a file need not update it.

Eight focused runtime tests cover native and injected timestamps, an actual
pre-epoch Date, explicit updates, metadata preservation, native paths and
errors, exact signed formatting and failure recovery. The shared arity matrix
now includes operation 34, with a separate no-stat spy for malformed requests.
The compiled fixture checks request bytes, answer propagation and terminal
states, then runs through the host against native paths and a pre-epoch value.

The existing modification-time tests now use a private FIFO instead of a
shared `/dev/null` observation, assert hard-link timestamp equality explicitly,
and reject content opens and reads through host spies. Earlier validation
records remain snapshots of their original test bytes.

Validation passed against the reused compiler from base `1b1dc23`:

- The combined timestamp and arity selection passed 51/51. The complete runtime
  suite passed 181/181, with no failures, cancellations or skips.
- The compiled reactor suite passed 1353 checks, 108 more than the preceding
  slice, under a 120-second watchdog. This direct invocation does not establish
  the separate 30-second gate bound.
- HOST-NAT passed 16/16. JavaScript syntax, HOUSE, TRUSTED-LINES and tracked
  whitespace checks passed. Kernel lines remain 5246/5250; encoder lines
  remain 246/600.
- All eight defect controls were rejected, including the base runtime,
  wrong timestamp, Number rounding, final-symlink inspection, missing arity,
  path normalization, content opening and a modification-time content read.

Compiler sources and gate definitions are unchanged. The full compiler and
milestone gate ladder was not rerun, and no timing waiver is claimed. Native
tests ran on macOS; Windows was not exercised. The
[access-time validation record](validation/2026-09-13-file-accessed/README.md)
contains commands, full captures, source hashes and a control reproducer.

## File status-change time, 2026-09-13

Operation 35 accepts exactly one path and returns `ctimeNs` from bigint
`stat` as signed decimal nanoseconds since the Unix epoch. The host preserves
the integer directly, follows final symlinks and leaves paths literal for
native resolution. It does not open contents or set timestamps. Errors
resume with status 1, and the request body is unused. This is the host's
status-change timestamp, with filesystem-dependent updates and precision;
creation time is a separate field.

Eight focused runtime tests cover native metadata, a real permission change
through operation 31, private special files, links, native path errors,
request rejection before stat, exact signed formatting and failure recovery.
The shared arity matrix includes operation 35. The compiled fixture checks
request bytes, signed answer propagation and terminal states, then runs
through the host against native paths and a permission change. Negative
status timestamps and signed 64-bit endpoints use injected metadata only.

Validation passed against the reused compiler from base `eb47fa4`:

- The combined timestamp and arity selection passed 60/60. The complete
  runtime suite passed 190/190, with no failures, cancellations or skips.
- The compiled reactor suite passed 1469 checks, 116 more than the preceding
  slice, under a 120-second watchdog. This direct invocation does not
  establish the separate 30-second gate bound.
- HOST-NAT passed 16/16. JavaScript syntax, HOUSE, TRUSTED-LINES and tracked
  whitespace checks passed. Kernel lines remain 5246/5250; encoder lines
  remain 246/600.
- All nine defect controls were rejected: the base runtime, modification
  time, creation time, Number rounding, final-symlink inspection, missing
  arity, path normalization, content opening and content reading.

Compiler sources and gate definitions are unchanged. The full compiler and
milestone gate ladder was not rerun, and no timing waiver is claimed. Native
tests ran on macOS; Windows was not exercised. The
[status-change time validation record](validation/2026-09-13-file-changed/README.md)
contains commands, full captures, source hashes and a control reproducer.

## File creation time, 2026-09-14

Operation 36 accepts exactly one path and returns the host's `birthtimeNs`
from bigint stat as signed decimal nanoseconds since the Unix epoch. It
preserves the integer and literal path, follows final symlinks, and performs
metadata inspection without opening contents or setting timestamps. Host
errors resume with status 1; the request body is unused. Zero and values
equal to ctime pass through unchanged, including host fallback values.
The contract records the host's resolution and update limitations.

Eight focused runtime tests cover native observations, composition with
append and chmod, files and directories, private FIFOs, links, path errors,
request validation, exact signed formatting and error recovery. The shared
arity matrix includes operation 36. The compiled fixture checks the request
and response bytes, signed endpoints, output failures and terminal states,
then runs through the native host. Its scratch filenames are distinct from
the directory-creation fixture, correcting a collision caught by the first
compiled test run.

Validation against the compiler reused by hash from base `9654b0d` passed:

- Focused creation-time tests: 8/8. Complete runtime suite: 199/199, with no
  failures, cancellations or skips.
- Compiled reactor: 1631 checks, 162 more than the preceding slice, under a
  120-second watchdog. This direct run does not establish the separate
  30-second gate verdict.
- HOST-NAT: 16/16. JavaScript syntax, HOUSE, TRUSTED-LINES and tracked
  whitespace checks passed. Kernel lines remain 5246/5250; encoder lines
  remain 246/600.
- All 12 isolated defect controls were rejected: the base runtime, wrong
  modification or status field, Number rounding, missing bigint options,
  final-symlink inspection, missing arity, path normalization, content opening
  or reading, rejecting zero and rejecting equality with ctime.

Compiler sources and gate definitions are unchanged. The full compiler and
milestone gate ladder was not rerun. Native tests ran on macOS; other host
fallback policies and signed endpoints use injected metadata. The
[creation time validation record](validation/2026-09-14-file-created/README.md)
contains commands, full captures, source hashes and the control reproducer.

## File identity, 2026-09-14

Operation 37 accepts exactly one path and returns `dev:ino` from a single
bigint stat result. Decimal formatting preserves both integers, including
zero, without Number conversion. The operation follows final symlinks,
preserves literal path resolution, accepts directories and special files,
and inspects metadata without opening contents. Host errors resume with
status 1; the request body is unused under the shared limits.

Eight focused runtime tests cover native values, metadata preservation,
hard-link equality through append and rename, replacement while the old
inode remains alive, unlink, symlinks, private FIFOs, path validation and
error recovery. Injected metadata covers exact large integers, zero fields,
pair separation and one fresh stat per request. The shared arity matrix now
includes operation 37. The compiled fixture checks request and response
bytes, output failures, terminal states and native host behavior, including
the identity change seen through a symlink after replacement.

Validation against the compiler reused by hash from base `88d6bfe` passed:

- The eight focused tests passed in the positive control. The combined
  identity and arity selection passed 47/47, including an existing hard-link
  regression. The complete runtime suite passed 208 tests via `kanoncho`.
- The compiled reactor suite passed 1799 checks, 168 more than the preceding
  slice, under a 120-second watchdog. This direct invocation does not
  establish the separate 30-second gate verdict.
- HOST-NAT passed 16/16. JavaScript syntax, HOUSE, TRUSTED-LINES and tracked
  whitespace checks passed. Kernel lines remain 5246/5250; encoder lines
  remain 246/600.
- All 14 isolated defect controls failed their assertions as expected:
  the base runtime, swapped fields, wrong device field, separately rounded
  device and inode fields, missing bigint options, final-symlink inspection,
  missing arity, path normalization, separate stat calls, missing separator,
  content opening, content reading and rejected zero fields.

Compiler sources and gate definitions are unchanged. The full compiler and
milestone gate ladder was not rerun, and no timing waiver is claimed. Native
tests ran on macOS; large integer endpoints use injected metadata. The
[file identity validation record](validation/2026-09-14-file-identity/README.md)
contains commands, captures, source hashes and the control reproducer.

## File link count, 2026-09-14

Operation 38 accepts exactly one path and returns the `nlink` field from one
bigint stat result as exact decimal digits. It follows final symlinks,
preserves literal paths, accepts directories and special files, and reads
metadata without opening contents. The body is unused under the shared
limits. Host errors resume with status 1, including recovery on later
requests. The shared argument-count matrix includes operation 38.

Eight focused runtime tests cover native metadata, link-count changes,
symlinks, FIFOs, literal path resolution, malformed requests, exact integer
formatting and error recovery. The compiled fixture checks the state
machine and host integration, including hard links and atomic replacement.

Validation with the compiler reused by hash from base `be5e76e` passed:

- The positive control passed all eight focused tests. The link-count and
  argument-count selection passed 47/47. The full runtime suite passed all
  217 tests through `kanoncho`.
- The compiled reactor suite passed 1959 checks, 160 more than the prior
  slice, under a 120-second watchdog. This direct invocation does not
  establish the separate 30-second gate verdict.
- HOST-NAT passed 16/16. Syntax, HOUSE, TRUSTED-LINES and tracked whitespace
  checks passed. Kernel lines remain 5246/5250; encoder lines remain 246/600.
- All 12 isolated defect controls failed assertions as expected: the base
  runtime, wrong metadata field, rounded count, missing bigint options,
  symlink inspection, path normalization, constant count, duplicate stat,
  replaced zero, missing arity, content opening and content reading.

Compiler sources and gate definitions retain their base hashes. The full
compiler and milestone ladder was not rerun, and no timing waiver is
claimed. Native tests ran on macOS; zero and large integer endpoints use
injected metadata. The
[link count validation record](validation/2026-09-14-file-link-count/README.md)
contains commands, captures, source hashes and the control reproducer.

## File owner, 2026-09-14

Operation 39 accepts exactly one path and returns `uid:gid` from a single
bigint stat result. Both numeric fields retain exact decimal formatting,
including zero. The operation follows final symlinks, passes literal paths
to the host, accepts directories and special files, and reads metadata
without opening contents. The body is unused under the shared limits.
Host errors resume with status 1, with recovery on later requests.

Eight focused runtime tests cover native ownership, unchanged metadata,
hard links, append, permission changes, rename, unlink, symlinks, private
FIFOs, path validation and exact integer pairs. The FIFO test guards opens
and reads and has a five-second timeout. Injected metadata checks fresh
single-stat responses, zero and large integers. The shared argument-count
matrix now includes operation 39. A compiled fixture checks request and
response bytes, output failures, terminal states and native host behavior.

Validation with the compiler reused by hash from base `72ccf34` passed:

- The positive control passed all eight focused tests. The ownership and
  argument-count selection passed 48/48. The full runtime suite passed all
  226 tests through `kanoncho`.
- The compiled reactor suite passed 2118 checks, 159 more than the preceding
  slice, under a 120-second watchdog. This direct run does not establish the
  separate 30-second gate verdict.
- HOST-NAT passed 16/16. Syntax, HOUSE, TRUSTED-LINES and tracked whitespace
  checks passed. Kernel lines remain 5246/5250; encoder lines remain 246/600.
- All 15 isolated defect controls failed assertions: the base runtime,
  swapped fields, wrong owner or group field, separately rounded fields,
  missing bigint options, symlink inspection, path normalization, duplicate
  stat, missing separator, content opening, content reading, rejected zero
  and missing arity.

Compiler sources and gate definitions retain their base hashes. The full
compiler and milestone ladder was not rerun. Native tests ran on macOS;
zero and large integer endpoints use injected metadata. Native ownership
changes and Windows were not exercised. The
[file owner validation record](validation/2026-09-14-file-owner/README.md)
contains commands, captures, source hashes and the control reproducer.

## File allocation, 2026-09-14

Operation 40 accepts exactly one path and returns `blocks:blksize` from a
single bigint stat result. Both fields retain exact decimal formatting,
including zero. The operation follows final symlinks, preserves literal
paths, accepts directories and special files, and reads metadata without
opening contents. The body is unused under the shared limits. Host errors
resume with status 1, with recovery on later requests. The block count's
unit belongs to the host; the I/O block size is not a conversion factor.

Eight focused runtime tests cover native allocation snapshots through
append, sparse extension, truncation and hard-link changes, unchanged
metadata, symlinks, private FIFOs, path validation and exact integer pairs.
The shared argument-count matrix now includes operation 40. A compiled
fixture checks request and response bytes, output failures, stable terminal
states and native host behavior.

Validation used the compiler reused by hash from base `07ebd5c`:

- The allocation and argument-count selection passed 49/49. The full
  runtime suite passed all 235 tests through `kanoncho`.
- The exact allocation block extracted from the compiled reactor suite
  passed all 158 checks. Full-suite attempts were incomplete: the first
  hit an existing file-change case's 20-second child timeout; the second
  hit the 120-second outer watchdog without output. No full REACTOR or
  separate 30-second gate pass is claimed by these scoped checks.
- HOST-NAT passed 16/16. Syntax, HOUSE, TRUSTED-LINES and tracked whitespace
  checks passed. Kernel lines remain 5246/5250; encoder lines remain 246/600.
- The positive control passed all eight tests. All 16 defect controls
  failed assertions, covering the base runtime, swapped or wrong fields,
  separate rounding, multiplied fields, missing bigint options, symlink
  inspection, path normalization, duplicate stat, missing separator,
  content opening or reading, rejected zero and missing arity.
- The control reproducer rejected an existing output directory, file and
  dangling symlink while preserving each one.

Compiler sources and gate definitions retain their base hashes. The full
compiler and milestone ladder was not rerun, and no timing waiver is
claimed. Native tests ran on macOS; zero and large integer formatting also
use injected metadata. Windows was not exercised. The
[allocation validation record](validation/2026-09-14-file-allocation/README.md)
contains commands, captures, source hashes and reproducible checks.
