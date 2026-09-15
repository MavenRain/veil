# Filesystem inode counts

Operation 42 accepts exactly one path. One `statfs(path, { bigint: true })`
call returns the host fields as `files:ffree`, in that order:

| Field | Meaning |
| --- | --- |
| `files` | Total file nodes (inodes) reported by the filesystem |
| `ffree` | Free file nodes (inodes) reported by the filesystem |

These are Node's
[`fs.StatFs`](https://nodejs.org/api/fs.html#class-fsstatfs) fields. Each
uses exact decimal text without conversion through Number. One colon
separates the fields, with no whitespace or terminator. Zero and signed
host values pass through unchanged. Values are neither clamped nor derived
from block counts. The filesystem controls their meaning and availability;
the runtime does not enumerate entries or impose a relation between them.

The host resolves the literal path, including final symlinks, relative
paths and parent segments after symlinks. Files, directories and special
files identify the filesystem containing the resolved entry. Each request
reads a fresh snapshot without opening file contents or creating entries.
The body is unused under the shared decoding limits, including bodies above
the file-I/O chunk limit. Missing and surplus arguments return status 1
before statfs. Invalid UTF-8 and embedded NUL fail in the shared decoder
before statfs. Host errors, including unsupported operations, return status
1 with `CODE: message`; a later request can succeed in the same run.

Counts may change independently of the requesting program. They do not
reserve inodes or guarantee a later file creation. Zero counts are preserved
even when a filesystem cannot provide meaningful inode capacity.

Seven focused runtime tests cover:

- Native snapshots while preserving file metadata and contents.
- Directories, hard links, final symlinks and private FIFOs, with guards
  against opening or reading contents and against using stat or lstat.
- Relative Unicode paths and native parent-symlink resolution.
- Missing paths, invalid parents, dangling and cyclic links, and recovery.
- Argument counts, invalid UTF-8 and embedded NUL before statfs.
- Distinct field order, zero endpoints, large and signed integers, literal
  paths, bigint options and exactly one fresh host call per request.
- EACCES, EIO, EOVERFLOW, ENOSYS, ENOTSUP and generic host errors.

The compiled `test/fixtures/reactor/filesystem-inodes.kan` fixture covers
request bytes, unused body bytes, exact answer forwarding, output failures
and stable terminal states. Native compiled runs cover files, directories,
hard links, final symlinks, a private FIFO, relative Unicode paths, native
parent-symlink resolution and request errors. A test observer records both
fields from the exact statfs call used by each compiled request, along with
its literal path and bigint options. The tests require one call and compare
the entire response with that snapshot. They do not compare independent
calls whose counts may change. The argument-count matrix includes row 42.

Native validation ran on macOS. Windows and other operating systems were
not exercised. Injected fields establish precision, signed and zero
endpoints without depending on native filesystem counts. The
[validation record](validation/2026-09-15-filesystem-inodes/README.md)
contains commands, captures, source hashes and reproducible defect controls.

## Review 2026-09-15 (filesystem inodes)

Record directory: `dev/validation/2026-09-15-filesystem-inodes`.

- D-1 (low): the record README now says that malformed argument counts and
  undecodable strings are rejected before statfs; record `README.md`.
- C-6 (low): the record README no longer calls the compiled harness
  unchanged and names its additive test block with the kept 20-second child
  bound; record `README.md`.
- C-3 (low): the record README names the operation 41 totals 243 and 2453
  and the predecessor record behind `runtime_delta` 8 and `reactor_delta`
  219; record `README.md`.
- C-5 (low): the record README discloses that `source_sha256` does not pin
  `dev/host-nat-test.mjs`; record `README.md`.
- C-4 (low): the record README discloses that the `focused-initial.json`
  pattern alternative `OS requests reject` matched no test; record
  `README.md`.
- C-2 (low): the reproducer measures `timed_out` through
  `subprocess.TimeoutExpired`, writes the capture with `exit_code` null and
  stops the sweep; record `reproduce-controls.py` and `README.md`.
- B-1 (low): CARRIED for a user ruling, the compiled FIFO row of the pinned
  `dev/reactor-test.mjs` has no open guard; no file changed.
- ND-1-1 (medium): `.gitignore` gains `__pycache__/`, so the untracked
  bytecode directory that the fix round left under the validation record
  no longer shows in `git status`; file `.gitignore`.

Close ladder `dev/validation/2026-09-15-filesystem-inodes/gates-review.log`,
started 10:19:13 at load1 12.87 and finished 10:20:45: RUNTIME `# pass 251`
`# fail 0`; REACTOR `reactor: 2672 checks passed`, equal to the baseline
count; HOST-NAT checks=16/16; TRUSTED-LINES kernel=5246/5250 encoder=246/600
OK; HOST programs=3 zk-instance=10/10; AGREEMENT OK 7445/7445; M0-TIME
median_ms=101.314 bound_ms=150; M0-RATIO ratio=1.234415 bound=2.000;
M1-CORPUS elapsed_ms=194.811 bound_ms=713. Every leg passed, GATES-OK,
LADDER-EXIT 0. An earlier close ladder, started 10:01:15 at load1 8.94,
ended LADDER-EXIT 1 on M0-TIME and M0-RATIO at load1 19.511 plus a REACTOR
leg timeout beside a standalone REACTOR-EXIT 0 with the same 2672 checks,
and was not filed.
