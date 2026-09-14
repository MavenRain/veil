# File creation time

Operation 36 accepts exactly one path and returns the host's `birthtimeNs`
from `stat(path, { bigint: true })`. The answer is signed ASCII decimal
nanoseconds since the Unix epoch, with no plus sign, leading zeros, newline
or terminator. Formatting preserves the integer without a Number, Date or
millisecond conversion. See the
[Node field contract](https://nodejs.org/api/fs.html#statsbirthtimens).

The operation follows final symlinks. Hard links observe the same entry;
directories and special files are accepted. Relative paths use the working
directory, and path text reaches the host unchanged, including dot segments
after parent symlinks. Missing entries, dangling or cyclic links and other
host failures resume with status 1 and `CODE: message`. No entry is created.
Missing or surplus arguments are rejected before stat. NUL and invalid UTF-8
paths fail shared request decoding. The body is unused under the shared
limits. The request does not open or read contents or set timestamps.

This exposes the value supplied by the host. If creation time is unavailable,
Node can substitute status-change time or zero. Both pass through unchanged;
zero does not signal an error or prove that creation occurred at the epoch.
Darwin can revise birthtime when an earlier modification time is set
through `utimes`. Host rules also determine resolution.
This value is not an immutable creation record, unique identity, revision
number or ordering guarantee. The
[Node timestamp semantics](https://nodejs.org/api/fs.html#stat-time-values)
describe these limitations. Operations 33, 34 and 35 read modification,
access and status-change time respectively.

Eight focused runtime tests cover:

- Exact native metadata, unused binary payloads and preservation of entry
  metadata and contents during inspection.
- Fresh host observations after append and permission operations, without
  assuming creation time is invariant across platforms.
- Private FIFOs, directories, final symlinks, hard links, relative Unicode
  names and native resolution of parent symlinks followed by `..`.
- Missing paths, dangling and cyclic links, nondirectory components, trailing
  separators, the empty path and continued processing after failure.
- Arity and string rejection before stat, plus the shared request matrix.
- Injected zero, submillisecond, large positive, negative and signed 64-bit
  endpoint values, with distinct metadata fields and explicit bigint options.
  The same path is read repeatedly with changing values, including zero and
  equality with ctime, to cover fresh reads and host fallback pass-through.
  Mocked open and read calls reject any attempt to access entry contents.
- Injected permission, I/O, overflow and generic errors, followed by success.

The compiled `test/fixtures/reactor/file-created.kan` fixture checks request
code, literal path and payload bytes, signed answer propagation, output
failures and stable terminal states. It also runs through the real host
against files, directories, links, permissions and rejected requests.

Native tests ran on macOS. Other operating systems, native fallback policies
and negative creation times were not exercised. Injected metadata covers
fallback values and exact signed endpoints without claiming filesystem
support for setting them. The
[validation record](validation/2026-09-14-file-created/README.md) records
commands, source hashes, full captures and reproducible defect controls.

## Review 2026-09-14 (file created)

- A-1, low: the Darwin birthtime revision now names the modification time,
  which the host probe shows, not the access time (REACTOR.md,
  dev/FILE-CREATED.md).
- C-2, low: the record now states that the pinned compiler row is an
  untracked build artifact matched against the preceding record
  (dev/validation/2026-09-14-file-created/README.md).
- C-1, low: the record now tells a reader with staged changes to run
  `git diff --cached --check` for the whitespace evidence
  (dev/validation/2026-09-14-file-created/README.md).
- C5, low, from the kit facts rather than the workflow: three added
  REACTOR.md lines ran past 80 columns, the operation 35 row of the
  regression list and two lines of the operation 36 paragraph, one of
  them made by the A-1 fix. The lines are rewrapped; no sentence changed
  (REACTOR.md).
- Close ladder ran at 09:1x with load1 from 28.5 to 41.3: TRUSTED-LINES
  kernel 5246/5250 encoder 246/600, RUNTIME 199 pass of 199, HOST-NAT
  16/16, reactor 1631 checks passed, HOST programs=3 zk-instance=10/10.
  Three timing legs failed with load1 above thirty: M0-TIME load1=41.252,
  M0-RATIO load1=41.252, M1-CORPUS load1=39.202. The ladder REACTOR row
  failed with exit=124 under the thirty-second watchdog at high load; the
  standalone REACTOR run in the same log passed with REACTOR-EXIT 0 and
  reactor: 1631 checks passed, so that row is a load artifact, not a
  defect. The check loop closed under no named waiver. Log:
  dev/validation/2026-09-14-file-created/gates-review.log.
