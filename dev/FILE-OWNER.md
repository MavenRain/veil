# File owner

Operation 39 accepts exactly one path and returns `uid:gid` from one
`stat(path, { bigint: true })` result. The first field is the numeric owner
ID; the second is the numeric group ID. Both use exact ASCII decimal
digits with one colon between them and no sign, leading zero, whitespace
or terminator. Zero fields are preserved. Formatting never converts
through Number. See the Node contracts for
[`stats.uid`](https://nodejs.org/api/fs.html#statsuid) and
[`stats.gid`](https://nodejs.org/api/fs.html#statsgid).

The operation follows final symlinks and accepts directories and special
files. It passes literal paths to the host, including relative paths and
parent segments after symlinks. It reads metadata without opening file
contents or creating entries. The body is unused under the shared decoding
limits, including bodies larger than the file-I/O chunk limit. Host errors
resume with status 1 and `CODE: message`; later requests may continue.
Missing or surplus arguments are rejected before stat. Invalid UTF-8 and
NUL-containing path bytes fail in the shared string decoder before stat.

Hard links report the same ownership. Append, ordinary permission changes,
rename to an absent destination and unlinking another name preserve that
ownership. Values are snapshots scoped to the host's account namespace.
The pair does not identify a file, resolve account names, report the
current process's credentials, change ownership or establish access rights.
Each request resolves its path again and reads fresh metadata.

Eight focused runtime tests cover:

- Native fields and preservation of contents and metadata.
- Hard links through append, permission changes, rename and unlink.
- Directories, private FIFOs and final symlinks. The FIFO test guards both
  opening and reading contents and has a five-second timeout.
- Relative Unicode paths and native parent-symlink resolution, with an
  absent path where lexical normalization would incorrectly look.
- Missing paths, dangling and cyclic symlinks, invalid parents and recovery.
- Argument counts, invalid UTF-8 and embedded NUL before stat.
- Exact zero and large integer pairs, distinct field order, one fresh bigint
  stat per request, literal path forwarding and no content opens or reads.
- Injected EACCES, EIO, EOVERFLOW and generic errors followed by success.

The compiled `test/fixtures/reactor/file-owner.kan` fixture checks request
bytes, unused body bytes, exact answer forwarding, output failures and
stable terminal states. Native runs cover files, directories, hard links,
symlinks, relative paths and request failures. Injected fixture answers
check the compiled state machine; separate runtime mocks check formatting
of host fields. The shared argument-count matrix includes operation 39.

Native tests ran on macOS. Node documents these ownership fields as POSIX
identifiers; the operation preserves whatever fields the host supplies.
Zero and large integer endpoints use injected metadata. Native ownership
changes and Windows were not exercised. The
[validation record](validation/2026-09-14-file-owner/README.md) contains
commands, captures, source hashes and reproducible defect controls.

## Review 2026-09-14 (file owner)

- D-1, low, fixed: the REACTOR.md argument-count sentence now reads
  "Operations 1 to 39", matching the table row and the arity array.
  File: `REACTOR.md`.
- D-2, low, fixed: the REACTOR.md operation 39 paragraph now discloses
  that native ownership changes and Windows were not exercised, as this
  file, the build log and the record do. File: `REACTOR.md`.
- C-3, C-2 and C-1, low, fixed: the validation README now separates the
  outer watchdog of the timed commands from each control's process
  timeout, names the focused and control-reproducer commands among the
  120-second watchdogs, and states that the `reject-zero` control can
  fail a different number of tests on another host or temporary
  directory. File: `dev/validation/2026-09-14-file-owner/README.md`.
- C24, low, carried for a user ruling: `reproduce-controls.py` has no
  guard against an existing output directory. Its hash is pinned in
  `controls.json`, so a fix regenerates every control capture and this
  review does not edit it.
- C1, refuted: the private FIFO test has an open spy, an lstat spy and a
  five-second timeout, so the carried FIFO finding of operations 33 to
  38 does not apply here. File: `dev/runtime-test.mjs`.
- Close: the check loop closed without a waiver. The close gate log,
  filed as `gates-review.log`, reports TRUSTED-LINES kernel 5246/5250
  and encoder 246/600, RUNTIME 226 of 226 with zero failures,
  HOST-NAT 16/16, `reactor: 2118 checks passed`, and HOST programs 3 of
  3 with zk-instance 10 of 10. No leg failed. Start load1 11.86, end
  load1 17.51.
