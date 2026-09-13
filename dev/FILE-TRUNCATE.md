# File truncation and extension

Operation 30 requires exactly two NUL-free UTF-8 arguments: a path and a
decimal byte length. It calls
[`fsPromises.truncate`](https://nodejs.org/api/fs.html#fspromisestruncatepath-len)
and returns status 0 with an empty answer. Shrinking retains the prefix,
length zero clears the contents, and extension fills the new range with
zeros. The request payload is unused, including binary payloads over 65536
bytes that satisfy the existing traversal rules.

Lengths are ASCII digits only, in the inclusive range 0 to 9007199254740991.
Leading zeros are accepted. No narrowing through the i31 ABI, 32-bit coercion
or 65536-byte transfer bound applies. Filesystem limits can reject an
otherwise valid length. Missing or surplus arguments return the standard
arity error. Invalid lengths return `IO: invalid OS numeric argument`.
Both failures resume with status 1 before the filesystem call. Invalid
UTF-8 or NUL in either argument retain the existing exit-2 path before dispatch.

Paths reach the OS literally. Relative names use the host working directory;
parent symlinks, dot segments and trailing separators retain native
resolution. Existing file identities and ordinary permission bits survive.
Hard links observe the resize and final symlinks are followed. Missing paths
and dangling targets are not created. OS failures resume with status 1 and
their error code and message, allowing the application to continue.

The runtime does not add a regular-file check, lock, durability flush or
rollback. Special files retain host behavior and can block. Concurrent
requests or processes may change the file before or after a resize; special
mode bits and timestamps follow host rules. Native evidence is from macOS,
with Windows, special files and maximum filesystem lengths untested.

Seven top-level `^file truncate` runtime tests exercise binary shrinking,
zero extension beyond 65536 bytes, repeated lengths, append/read/cleanup
composition, identities and links, literal paths, missing entries, malformed
requests, exact length forwarding, and injected OS failures. Boundary
lengths through 9007199254740991 are tested at a mocked filesystem boundary
without creating large files. Real resize tests use at most 65537 bytes.
Injected EACCES, ENOSPC, EFBIG, EROFS and EIO errors verify propagation and
continuation, not native resource exhaustion or permission denial.

The arity matrix adds operation 30. The compiled `file-truncate.kan` fixture
forwards both arguments and a binary unused payload, reports host answers, combines host and output
statuses, and keeps completion terminal. REACTOR exercises that ABI and
real CLI resizing, malformed lengths and counts, and path errors.

Run from the repository root with an existing compiler:

```sh
node --test --test-reporter=tap --test-name-pattern '^file truncate' dev/runtime-test.mjs
node --test --test-reporter=tap dev/runtime-test.mjs
node dev/reactor-test.mjs _build/default/bin/kanon.exe
node dev/host-nat-test.mjs _build/default/bin/kanon.exe
```

The [validation record](validation/2026-09-12-file-truncate/README.md) records
the scoped checks and negative controls, including source and capture hashes.

## Review 2026-09-12 (file truncate)

- C-1 (low): the record README now scopes the `results.json` claim to the
  final source bytes, the compiler and every capture file of this record,
  because the close step adds an unhashed `gates-review.log` to the same
  directory. Files: `dev/validation/2026-09-12-file-truncate/README.md`.
- GATE-1 (high): the veil ladder did not pass. The review carries this item
  for a user ruling. The red legs of the two fix rounds are M0-TIME (median
  284 to 423 ms against the bound 150 ms), M0-RATIO (5.5 to 12.8 against the
  bound 2.0) and M1-CORPUS (1141 to 1836 ms against the bound 713 ms) at
  load1 37 to 41 with 27 sessions on the machine. The load rule waives a
  timing leg above load 30. The ladder also shows FAIL REACTOR from MEASURE
  REACTOR tier=MED exit=124, which is the 30 second ceiling. The standalone
  leg of the same log reads `reactor: 963 checks passed` and `REACTOR-EXIT
  0`. A fresh-copy rerun gave build 0, runtime pass 144 fail 0, reactor 963,
  HOST-NAT 16/16 and HOST PASS. The slice changes no compiler, kernel or
  gate source, and the compiler hash ba114dff is unchanged, so no slice
  repair exists. The baseline ladder has the same shape.
- Counts: 144 runtime tests, 963 reactor checks, HOST-NAT 16/16,
  TRUSTED-LINES kernel 5246/5250 encoder 246/600. No fix added a test and no
  fix changed code. The review staged 29 paths, +1135/-7, on HEAD 1a88d6f.
- Tier rulings: finder, builder and closer at Fable medium are UNMET. The
  Fable probe died on the classifier (request id
  req_011Cf12uSnixJmsnq3bR6pSf). Every agent ran on Opus or Sonnet with
  explicit markers.
- Workflow run id: wf_99e20e33-564.
