# File timestamp updates

Operation 44 accepts `[path, atime, mtime]` and changes an existing entry's
access and modification times. Both times are signed ASCII decimal integer
milliseconds since the Unix epoch. For example, `1000` is one second after
the epoch, and `-1000` is one second before it. Operations 33 and 34 inspect
the resulting stored timestamps in nanoseconds.

The accepted range is -8640000000000000 to 8640000000000000 inclusive,
the JavaScript Date range. Zero is written `0`; other values use an optional
minus sign followed by digits without leading zeros. Empty strings, plus
signs, negative zero, whitespace, fractions, exponents, non-ASCII digits
and values outside the range fail with status 1 and
`IO: invalid OS timestamp argument`. Both inputs are validated before any
host update, including when only the second input is invalid.

Each valid request calls Node's
[`utimes`](https://nodejs.org/api/fs.html#fspromisesutimespath-atime-mtime)
once with the literal path and two Date objects. Using Dates preserves
pre-epoch values. The numeric millisecond inputs reach those Dates exactly;
Node and the filesystem may round stored timestamps or support a narrower
range. This API does not promise nanosecond writes or that every host can
store every accepted Date. It forwards host errors through `resume`.

The OS resolves relative paths against the host working directory and
follows final symlinks and parent components after symlinks. Hard links
observe the same timestamp changes. Files, directories and special files
can be updated without opening their contents. The operation preserves
file contents, identity, size and ordinary permissions; status-change time
may change. Missing entries are not created.

Success returns an empty answer. The body is unused under the shared
decoding limits. Missing or surplus arguments return status 1 before
utimes. NUL bytes and invalid UTF-8 in any argument fail in the shared
decoder with exit 2. Host failures return status 1 and `CODE: message`,
with `IO` as the generic code; later requests can continue.

## Regressions

Nine runtime tests cover:

- Native zero, positive and subsecond timestamps, repeated updates, file
  preservation and composition with modification and access time reads.
- Pre-epoch values in either timestamp, including both negative together.
- Directories, hard links, final symlinks and a private FIFO, with guards
  against content access and symlink-only timestamp updates.
- Relative Unicode paths and parent symlinks, with a decoy to detect
  lexical normalization that would select a different file.
- Native path failures and recovery without creating missing entries.
- Invalid timestamps in either position, Date bounds and argument counts
  before host updates, followed by a successful request.
- NUL-containing and invalid UTF-8 bytes in all three arguments.
- Exact Date values, both range endpoints, literal path forwarding and
  one update per request, including a 65537-byte unused body.
- Permission, read-only, I/O, unsupported-host and range errors, generic
  error fallback and a subsequent successful update.

The argument-count matrix adds row 44. The compiled `file-times.kan`
fixture covers request bytes, binary answer forwarding, output failures
and stable terminal states. Native compiled runs cover timestamps, file
preservation, links, directories, malformed inputs and missing paths.

The mutation reproducer checks the unmodified runtime and fourteen
deliberate defects: omitted operation or arity, swapped times, numeric
seconds, incorrect units, rounded seconds, noncanonical inputs, missing
Date bounds, rejected zero, clamped negatives, normalized paths, repeated
updates, content reads and an update before the second input is validated.

Native validation ran on macOS with Node v23.10.0. Injected utimes calls
check Date endpoints and host errors independently of filesystem storage.
Windows was not exercised. The
[validation record](validation/2026-09-15-file-times/README.md) contains
captures, source hashes, scope and reproduction commands.

## Review 2026-09-15 (file times)

- A-1 (low): REACTOR.md now says that a value the host cannot store is not
  rejected, and that the request succeeds with an empty answer while the
  host clamps or rounds the stored time. Files: REACTOR.md.
- C-1 (refuted): the wrapper disclosure sentence is true as written; a
  reader can find the wrapper name for the runtime capture in
  REACTOR-BUILD-LOG.md, and every capture of this record is summary-only
  by the record's own norm. File:
  dev/validation/2026-09-15-file-times/README.md.
- C-2 (refuted): the control capture hashes match the archived captures
  and the reproducer's own pass/fail protocol reproduces in full; no
  sentence of the record promises cross-run hash reproducibility. File:
  dev/validation/2026-09-15-file-times/README.md.
- B-1 (carried, fifth carry, standing user ruling): the private FIFO test
  rows of dev/runtime-test.mjs bind only fsPromises and the harness is
  sha256-pinned, so the only repair would edit a pinned test file. Not
  fixed this round. File: dev/runtime-test.mjs.

The close ladder ran at load1 12.23 start, 14.87 end (18:3x).
LADDER-EXIT 0, every named leg PASS, no FAIL row, under an empty waiver: no
leg needed a load waiver. TRUSTED-LINES kernel=5246/5250 encoder=246/600
OK. RUNTIME `# pass 269 of 269`, `# fail 0`. HOST-NAT 16/16.
`reactor: 3128 checks passed`. The full log is pinned at
`validation/2026-09-15-file-times/gates-review.log`.
