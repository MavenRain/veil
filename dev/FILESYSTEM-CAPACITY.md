# Filesystem capacity

Operation 41 accepts exactly one path. One `statfs(path, { bigint: true })`
call returns the host fields as `bsize:blocks:bfree:bavail`, in that order:

| Field | Meaning |
| --- | --- |
| `bsize` | Host filesystem block size in bytes |
| `blocks` | Total data blocks |
| `bfree` | Free blocks |
| `bavail` | Free blocks available to unprivileged users |

These are the fields of Node's
[`fs.StatFs`](https://nodejs.org/api/fs.html#class-fsstatfs).
Every field uses exact decimal text without conversion through Number.
Fields have one colon between them and no whitespace or terminator.
Zero and any signed host values are preserved. The runtime neither clamps
values nor substitutes another StatFs field, such as `files` or `ffree`,
for `bsize`. Node's `fs.StatFs` does not supply the POSIX statvfs field
`frsize`; the defect controls inject that field.

The host resolves the supplied path, including final symlinks, relative
paths and parent segments after symlinks. Files, directories and special
files identify the filesystem containing the resolved entry. Each request
reads a fresh snapshot without opening file contents or creating entries.
The body is unused under the shared decoding limits, even above the file-I/O
chunk limit. Missing and surplus arguments return status 1 before statfs.
Invalid UTF-8 and embedded NUL fail in the shared string decoder before
statfs. Native errors, including unsupported operations, return status 1
with `CODE: message`; a later request can succeed in the same run.

This is a host snapshot. Capacity can change independently of the requesting
program, and filesystem policy determines the relationship between the
fields. The response does not reserve space or guarantee a later write.

Seven focused runtime tests cover:

- Exact native snapshots while preserving file metadata and contents.
- Directories, hard links, final symlinks and private FIFOs, with guards
  against opening or reading contents and against using stat or lstat.
- Relative Unicode paths and native parent-symlink resolution.
- Missing paths, invalid parents, dangling and cyclic links, and recovery.
- Argument counts, invalid UTF-8 and embedded NUL before statfs.
- Distinct field order, zeros, large and signed integers, literal paths,
  bigint options and exactly one fresh host call per request.
- EACCES, EIO, EOVERFLOW, ENOSYS, ENOTSUP and generic host errors.

The native tests observe the exact statfs result used by each request.
They do not compare free-space counts from separate calls. Injected fields
cover precision, signed values and zero endpoints without assuming a host
filesystem can be made to produce each endpoint.

The compiled `test/fixtures/reactor/filesystem-capacity.kan` fixture covers
request bytes, unused body bytes, exact answer forwarding, output failures
and stable terminal states. Native compiled runs cover files, directories,
hard links, final symlinks, relative paths and request errors. They check
response format and block size; the runtime tests establish all four fields
against the same native snapshot. The shared argument-count matrix includes
operation 41.

Native validation ran on macOS. Windows and other operating systems were
not exercised. The
[validation record](validation/2026-09-15-filesystem-capacity/README.md)
contains commands, captures, source hashes and reproducible defect controls.

## Review 2026-09-15 (filesystem capacity)

- D-2, low: three added prose lines were rewrapped to 80 columns or fewer
  (REACTOR.md, dev/FILESYSTEM-CAPACITY.md, dev/REACTOR-BUILD-LOG.md).
- C-1, low: the field guarantee now names real `fs.StatFs` fields and states
  that `frsize` is a POSIX statvfs field the controls inject
  (dev/FILESYSTEM-CAPACITY.md).
- C-2, low: the record now discloses that the host reports `bfree` equal to
  `bavail`, thus the injected-field test separates the third field from the
  fourth field (dev/validation/2026-09-15-filesystem-capacity/README.md).
- D-1, low: a contract paragraph for operation 41 was added after the
  operation 40 paragraph (REACTOR.md).
- B-1, low: CARRIED for a user ruling. The compiled native rows pin only
  `bsize`; the repair changes the frozen reactor check count
  (dev/reactor-test.mjs).
- Close: the check loop closed with no waiver. The close ladder
  (dev/validation/2026-09-15-filesystem-capacity/gates-review.log) reads
  GATES-OK, LADDER-EXIT 0, 28 PASS legs and no FAIL leg: RUNTIME `# pass
  243` `# fail 0`, reactor 2453 checks passed, HOST-NAT 16/16, TRUSTED-LINES
  kernel=5246/5250 encoder=246/600 OK, M0-TIME 116.440 ms at load1 10.522,
  M0-RATIO 1.339298 at load1 10.522 and M1-CORPUS 227.120 ms at load1
  10.400. An earlier close ladder at start load1 64.83 ended LADDER-EXIT 1
  on three timing legs only and was not filed.
