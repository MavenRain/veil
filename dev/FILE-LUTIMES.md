# Entry timestamps without following a final symlink

Operation 47 accepts `[path, atime, mtime]`, validates both timestamps and
makes one `lutimes` call. A final symlink receives the access and modification
times itself, including when its target is missing or cyclic. Files,
directories, hard links and special files retain native timestamp behavior.
Success returns status 0 with an empty answer. No file contents are opened
and no entry is created or replaced.

Timestamps use operation 44's canonical signed decimal milliseconds since
the Unix epoch, within `-8640000000000000..8640000000000000`. Zero and
negative values are accepted; negative zero, leading zeros, plus signs,
whitespace, fractions, exponents and values outside that range are rejected.
Both timestamps must pass validation before the host call. They reach Node
as `Date` values so negative timestamps preserve their pre-epoch meaning.
The host and filesystem control supported ranges, precision and ctime
updates. No nanosecond storage precision is promised.

Argument-count and timestamp errors resume with status 1 and an `IO:`
message. Host failures preserve their error code and also resume with
status 1; subsequent requests can continue. Unsupported hosts use this
same error path. The request body is ignored within the shared traversal
bound, including bodies larger than 65536 bytes. NUL or invalid UTF-8 in
any argument ends the run during decoding, before a host call or resume.

Paths pass literally to the host, with relative paths using the process
working directory. Parent symlinks, dot segments and trailing slashes keep
native semantics. A trailing slash can require traversing a link to a
directory. This operation does not prevent traversal through parent
components or concurrent path changes. Operations 33 and 34 follow final
symlinks and therefore cannot inspect the link's own timestamps.
See Node's [`lutimes` reference][node-lutimes] for the host binding.

[node-lutimes]: https://nodejs.org/api/fs.html#fspromiseslutimespath-atime-mtime

## Regressions

Eight runtime tests and the shared arity matrix cover live, dangling and
cyclic links, target metadata preservation, binary contents, epoch and
pre-epoch times, millisecond values, literal Unicode paths, parent symlinks,
ordinary files, hard links, directories and FIFOs. They also cover native
path errors, invalid timestamps in either position, Date range endpoints,
undecodable arguments, ignored bodies and continuation after host errors.
Native filesystem tests skip on Windows. Injected host calls cover
unsupported-operation errors and the full accepted timestamp range.

The compiled `file-lutimes.kan` fixture checks operation 47, ordered argument
bytes, an ignored binary body, exact status and answer forwarding, output
failures and stable terminal states. Its subprocess tests update real
symlinks and verify that rejected requests and link updates preserve the
target's contents and metadata. The existing REACTOR and RUNTIME gates run
these checks without gate changes.

Validation evidence is recorded in
[the validation directory](validation/2026-09-16-file-lutimes/README.md).

## Review 2026-09-16 (file lutimes)

- C-2 (low): the record table row for the focused run is now 78 columns, within
  the 80-column rule. File: `dev/validation/2026-09-16-file-lutimes/README.md`.
- D-1 (low): the Node `lutimes` link is now a reference-style link, so no prose
  line is more than 80 columns. File: `dev/FILE-LUTIMES.md`.
- B-2 (low): carried for a user ruling. No test pins the syscall token of a
  native error. The repair edits the sha256-pinned `dev/runtime-test.mjs`.
- B-1 (low): carried for a user ruling, the eighth carry. The FIFO no-open
  guards bind only `fsPromises`. File: `dev/runtime-test.mjs`.

The close ladder ran at load1 12.12 start, 19.51 end (19:5x).
LADDER-EXIT 0, every named leg PASS, no FAIL row, under an empty waiver: no
leg needed a load waiver. TRUSTED-LINES kernel=5246/5250 encoder=246/600
OK. RUNTIME `# pass 298 of 298`, `# fail 0`. HOST-NAT 16/16.
`reactor: 3811 checks passed`. The full log is pinned at
`validation/2026-09-16-file-lutimes/gates-review.log`.
