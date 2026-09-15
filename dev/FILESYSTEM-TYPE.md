# Filesystem type inspection

Operation 43 accepts one literal path and returns the host's numeric
filesystem type identifier from `statfs(path, { bigint: true }).type`.
It formats the integer directly as ASCII decimal bytes with no leading
zeros, whitespace or trailing terminator. Zero, negative and unknown values
remain intact. The identifier's interpretation is platform-specific, as
documented by Node's [`statfs.type`](https://nodejs.org/api/fs.html#statfstype).

Each request makes one fresh statfs call. The OS resolves the path, including
final symlinks and parent segments after symlinks. Relative paths use the
host working directory. Files, directories and special files can identify
their containing filesystem without opening their contents.

The request body is unused under the shared decoding limits. Missing or
surplus arguments return status 1 before statfs. NUL-containing and invalid
UTF-8 paths fail in the shared decoder with exit 2. Host failures return
status 1 and `CODE: message`; later requests can continue. No filesystem
entries are created or changed by this operation.

## Regressions

Seven tests in `dev/runtime-test.mjs` cover:

- Native identifiers and preservation of file contents and metadata, including
  a 65537-byte unused body.
- Directories, hard links, symlinks and a private FIFO, with guards against
  opening contents or substituting file metadata for statfs.
- Relative Unicode paths and parent symlink resolution, verifying the literal
  path and bigint options passed to the host.
- Missing entries, dangling and cyclic symlinks, non-directory components,
  empty paths and recovery after each native error.
- Missing and surplus arguments, NUL bytes and invalid UTF-8 before statfs.
- Exact zero, positive, negative, unsigned 64-bit and beyond-safe-integer
  values from one fresh query per request, with distinct unrelated fields.
- Unsupported-host, permission, I/O and overflow errors, generic-error
  fallback and a subsequent successful request.

The shared argument-count matrix includes operation 43. The compiled
`test/fixtures/reactor/filesystem-type.kan` fixture verifies request bytes,
answer forwarding, output failures and terminal states. Native compiled
runs capture the actual statfs result, require exactly one query, and check
the complete output against that result along with its path and options.

The mutation reproducer confirms that the seven tests pass unchanged and
reject twelve deliberate defects: an omitted operation, wrong field,
precision loss, missing bigint options, normalized path, repeated query,
missing arity, content reads, stat substitution, rejected zero, clamped
negative and forced unsigned interpretation.

Native validation ran on macOS with Node v23.10.0. Injected metadata covers
formatting endpoints that the native host does not produce. Windows was
not exercised. The
[validation record](validation/2026-09-15-filesystem-type/README.md)
contains captures, source hashes, scope and reproduction commands.

## Review 2026-09-15 (filesystem type)

- D-1 (low): four added prose lines are rewrapped below 80 columns
  (dev/FILESYSTEM-TYPE.md, REACTOR.md).
- C-3 (low): the record now prints the captured bare reproducer command and
  names the two local wrappers as a convenience that this repository does not
  ship (dev/validation/2026-09-15-filesystem-type/README.md).
- C-2 (low): the capture sentence now names the five captures that record a
  watchdog and the captures that record none
  (dev/validation/2026-09-15-filesystem-type/README.md).
- C-1 (low): the compiler reuse claim now says that the binary hash matches
  the predecessor record and that the source check is the staged diff
  (dev/validation/2026-09-15-filesystem-type/README.md,
  dev/REACTOR-BUILD-LOG.md).
- B-1 (medium): CARRIED for a user ruling. The private FIFO test at
  dev/runtime-test.mjs:1939 can stall the RUNTIME leg, and the only repair
  edits a sha256-pinned test file and frozen capture hashes.

The close ladder ran at load1 9.17 start, 10.65 end (15:1x).
LADDER-EXIT 0, every named leg PASS, no FAIL row, under an empty waiver: no
leg needed a load waiver. TRUSTED-LINES kernel=5246/5250 encoder=246/600
OK. RUNTIME `# pass 259 of 259`, `# fail 0`. HOST-NAT 16/16.
`reactor: 2891 checks passed`. The full log is pinned at
`validation/2026-09-15-filesystem-type/gates-review.log`.
