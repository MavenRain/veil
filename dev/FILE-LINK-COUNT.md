# File link count

Operation 38 accepts exactly one path and returns the host's `nlink` field
from one `stat(path, { bigint: true })` call. The answer is the hard-link
count as exact ASCII decimal digits. Zero is `0`; there is no sign, leading
zero, whitespace or terminator. Formatting never converts through Number.
The [Node field contract](https://nodejs.org/api/fs.html#statsnlink) defines
this as the number of hard links to the file.

The operation follows final symlinks and accepts directories and special
files. It passes literal paths to the host, including relative paths and
parent segments after symlinks. It reads metadata without opening file
contents or creating entries. The body is unused under the shared decoding
limits, including a body larger than the file-I/O chunk limit. Host errors
resume with status 1 and `CODE: message`; later requests may continue.
Missing or surplus arguments are rejected before stat. Invalid UTF-8 or
NUL-containing path bytes fail in the shared string decoder before stat.

Hard links report the same count for the shared entry. Creating another
hard link increases the count; removing a name decreases it. Append,
truncate and a rename to an absent destination preserve the count. Atomic
replacement gives the destination a new entry and removes one name from
the old entry. A copy has an independent count. Final symlinks report their
target's count. Directory and special-file counts preserve host filesystem
semantics and must not be interpreted as directory entry counts. Counts
are snapshots, do not establish file identity and can change between
requests. Use operation 37 when inspecting the host's device and inode.

Eight focused runtime tests cover:

- Native counts and preservation of contents and metadata.
- Hard-link creation, append, rename, truncate, unlink, replacement and copy.
- Directories, private FIFOs and final symlinks with distinct target counts.
- Relative Unicode paths and a parent symlink with a different-count decoy.
- Missing paths, dangling and cyclic symlinks, invalid parents and recovery.
- Missing and surplus arguments, invalid UTF-8 and embedded NUL before stat.
- Exact zero and large integers, one fresh bigint stat per request, literal
  path forwarding and guards against opening or reading contents.
- Injected EACCES, EIO, EOVERFLOW and generic errors followed by success.

The compiled `test/fixtures/reactor/file-link-count.kan` fixture checks
request bytes, unused body bytes, exact answer forwarding, output failures
and stable terminal states. Its native runs cover relative paths, files,
directories, hard links, symlinks, link-count changes and request failures.
Large values in the fixture are injected answers; runtime metadata mocks
independently check exact host formatting.

Native tests ran on macOS. Zero, integer precision boundaries and selected
host errors use injected metadata. Windows was not exercised. The
[validation record](validation/2026-09-14-file-link-count/README.md) contains
commands, captures, source hashes and the reproducible defect controls.

## Review 2026-09-14 (file link count)

- D-1, low: the rejection sentence above now names the argument count, not
  the link count, which agrees with the shared argument check. File:
  `dev/FILE-LINK-COUNT.md`.
- B-1, low: the FIFO test in `dev/runtime-test.mjs` has no open spy and no
  per-test timeout, so an arm that opens contents stops the runtime leg. The
  repair changes a hashed test file, so the finding is carried for a user
  ruling and is not fixed. File: `dev/runtime-test.mjs`.
- Close: the check loop closed without a waiver. The carried gate log,
  filed as `gates-review.log`, reports TRUSTED-LINES kernel 5246/5250 and
  encoder 246/600, RUNTIME 217 of 217 with zero failures, HOST-NAT 16/16,
  `reactor: 1959 checks passed`, and HOST programs 3 of 3 with
  zk-instance 10 of 10. No leg failed. Start load1 7.70, end load1 8.03.
