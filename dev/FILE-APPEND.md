# Binary file append

Operation 29 requires exactly one NUL-free UTF-8 path and appends the raw
request body with `appendFile(path, body, { flag: 'a', mode: 0o600 })`.
Success returns status 0 with an empty answer. The payload may contain any
bytes, including NUL and invalid UTF-8, up to 65536 bytes per request.
A decoded body above that limit returns status 1 before filesystem access.
The application can then continue. Empty bodies still open the path and
create missing files.

A new file has permission bits `0600 & ~umask` on POSIX hosts. The operation
preserves existing file identity and ordinary permission bits; it does not
call `chmod`. The tests observe existing mode `0640` and creation under
umasks `0000` and `0277`. Host rules govern special mode bits.
Appends through hard links update the shared file. Final symlinks are
followed, including dangling links whose missing targets can be created.

The parent must exist. Paths pass unchanged to Node, retaining relative
paths, UTF-8 names, parent symlinks, dot segments and trailing separators.
OS failures return status 1 with their code and message. Missing or surplus
arguments are rejected before filesystem access. NUL and invalid UTF-8 in
the path end request decoding before dispatch, as with other operations.

The operation adds no regular-file check, path restriction, transaction,
rollback or durability guarantee. Special files can block according to host
behavior. An append may use multiple writes, so concurrent writers can
interleave payloads. A failure may leave a new file or partially appended
contents. The failure-injection tests check error propagation and continued
requests; they do not simulate partial writes or verify cleanup by Node.

The eight top-level `^file append` runtime tests cover:

- Empty and 65536-byte chunks, repeated appends, binary preservation, file
  size, offset reads and unlink.
- New file creation with empty and nonempty payloads under two umasks.
- Existing device/inode identity and mode, hard links, live symlinks and
  dangling links, including preservation of the link entries themselves.
- Relative UTF-8 paths and a parent symlink followed by `..`, with a decoy
  path that detects lexical normalization.
- Directories, missing parents, non-directory parents, trailing separators,
  cyclic links and empty paths, followed by a successful request.
- 65537-byte rejection without creating or modifying a file, then success.
- Argument counts, invalid path bytes and payload bounds before the injected
  filesystem call, followed by exact path, body and option forwarding.
- Injected `EACCES`, `ENOSPC`, `EROFS` and `EIO` errors followed by success.

The arity matrix adds operation 29 as a nested test. It runs in the full
suite or under `request arities`, separately from the anchored selection.
The script adapter decodes request bodies through Buffer views, avoiding
quadratic array copying in the boundary tests. Production decoding is unchanged.

`test/fixtures/reactor/file-append.kan` compiles with `runtime/reactor.kan`
to an import-free Wasm module. It forwards CLI arguments and appends bytes
`00 ff 41`, prints the host answer and adds the append and output statuses
for its final exit code. `dev/reactor-test.mjs` covers requested, reporting
and finished states, exact argument and payload bytes, both status
combinations and terminal-state stability. CLI checks cover creation,
repeated append, identity, permissions, malformed argument counts,
directories, missing parents and empty paths.

Run from the repository root with a built compiler:

```sh
gtimeout 30 node --test --test-reporter=tap dev/runtime-test.mjs
gtimeout 30 node dev/reactor-test.mjs _build/default/bin/kanon.exe
zsh dev/house.sh
zsh dev/trusted-lines.sh
```

Native filesystem tests cover macOS. Windows, special files, concurrent
writers and partial writes were not exercised. Permission, full-disk and
read-only-filesystem failures use injection. The
[validation record](validation/2026-09-12-file-append/README.md) retains
commands, source hashes, results and negative controls.

## Review 2026-09-12 (file append)

- C-1, low: the record README capture sentence now applies to the ten test and
  control captures only, and it states that the seven command captures keep the
  command, the exit code and the inline streams with an empty count block.
  Files: dev/validation/2026-09-12-file-append/README.md, dev/FILE-APPEND.md.
- GATE-1, high: carried for a user ruling, because the review ladder failed only
  the timing legs M0-TIME and M0-RATIO at load1 57.213, and the functional legs
  BUILD, RUNTIME 136/136, HOST-NAT 16/16, REACTOR 857 and HOST all passed.
  Files: dev/FILE-APPEND.md.
- Close: the check loop closed with no waiver text. The waiver threshold stays
  load1 above twenty-five. The RUNTIME 136 of 136 line, the eight new file
  append tests, the reactor 857 line and HOST-NAT 16/16 are never waived by
  load alone. The carried log
  [gates-review.log](validation/2026-09-12-file-append/gates-review.log) gives
  26 PASS legs of 28, with the two timing legs M0-TIME and M0-RATIO red at
  load1 42.588.
