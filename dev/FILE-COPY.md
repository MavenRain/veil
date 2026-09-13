# File copying

Operation 27 copies a file to a new destination. It takes exactly two path
arguments, source then destination, and returns status 0 with an empty answer
on success. Both arguments must be NUL-free UTF-8. The payload is unused.
The file contents stay in host storage, so files can exceed the 65536-byte
answer limit. Later writes and unlinks of either file leave the other file
independent.

The runtime uses `copyFile` with `COPYFILE_EXCL`. A source symlink is followed.
An existing destination is refused, including a directory, symlink, dangling
link or the source itself. Paths are passed without lexical normalization;
relative paths use the host working directory, and parent symlinks, dot
segments and trailing separators retain OS resolution. Missing parents are
not created, and directories are not recursively copied. A non-regular source
gets host behavior: a FIFO source blocks until a writer opens it, and the
reactor cannot interrupt a request that blocks inside a host operation; a
character device such as `/dev/zero` copies zero bytes and answers status 0.

OS failures return status 1 with their code and message through `resume`.
Invalid argument counts return status 1 before filesystem access. NUL and
invalid UTF-8 fail request decoding before dispatch. The state machine can
issue another request after a status-1 response.

The host controls permission and metadata copying. The operation does not
force mode 0600. No test in this suite reads the destination mode or its
metadata, so this is host behavior that the suite does not observe. It makes
no snapshot, atomic publication or crash durability
guarantee. A concurrent reader can see a partly written new destination.
On a copy failure after destination creation, Node attempts to remove that
destination; removal is not guaranteed. No test in this suite creates a partial
destination, so that attempted removal is unverified Node behavior. These
limits follow the
[Node copyFile contract](https://nodejs.org/api/fs.html#fspromisescopyfilesrc-dest-mode).

`dev/runtime-test.mjs` covers:

- Empty, 65536-byte and 131077-byte binary files; separate device/inode
  identities, independent in-place updates and survival after source unlink.
- Composition with atomic write, file size, chunk read and unlink requests.
- Source symlinks, relative UTF-8 paths and parent symlinks with dot segments,
  with decoy paths that detect lexical normalization of either argument.
- Existing file, directory, live-link and dangling-link destinations,
  including copying a source onto itself, with identity and content checks.
- Missing paths and parents, directory sources, dangling or cyclic source
  links, non-directory parents, empty paths and trailing separators.
- Argument counts, NUL and invalid UTF-8 rejection before the injected copy
  call; valid path forwarding, ignored payloads and the exclusive flag.
- Injected `ENOSPC`, `EIO` and `EACCES` errors followed by a successful request.

The arity matrix includes operation 27 as a nested test in the full RUNTIME
run. The anchored `^file copy` selection runs the seven top-level copy tests.
Native filesystem tests cover macOS. Windows was not exercised. Disk-space
and permission failures use injection rather than exhausting host resources.

`test/fixtures/reactor/file-copy.kan` compiles with `runtime/reactor.kan` into
an import-free Wasm module. It forwards CLI arguments to operation 27 and
prints the host answer. Its final exit code includes both the copy status and
the output status. `dev/reactor-test.mjs` checks every state, argument and byte
forwarding, both status combinations, and actual CLI success and refusal paths.
The CLI copies 65537 binary bytes and checks independence and source symlinks.

This slice also resolves hard-link review D-1: the existing fixture's reporting
state now returns its retained operation status, and the compiled suite checks
that state for both success and failure. The old validation captures remain
historical evidence; the new fixture and test hashes belong to this slice.

Run from the repository root with a built compiler:

```sh
gtimeout 30 node --test --test-reporter=tap dev/runtime-test.mjs
gtimeout 30 node dev/reactor-test.mjs _build/default/bin/kanon.exe
zsh dev/house.sh
zsh dev/trusted-lines.sh
```

The [validation record](validation/2026-09-12-file-copy/README.md) retains
commands, source hashes, results and negative controls.

## Review 2026-09-12 (file copy)

- B-1, high: the permission and metadata sentences now state that no test
  reads the destination mode or its metadata.
  Files: `REACTOR.md`, `dev/FILE-COPY.md`.
- C-1, medium: the record now states that `results.json` hashes the record
  README twice, in `source_sha256` and in `capture_sha256`, and that an edit
  refreshes both rows after the edit.
  Files: `dev/validation/2026-09-12-file-copy/README.md`.
- C-2, medium: the record now states that the rejecting reporting-state run
  used the pre-repair fixture at base `addeb7a` through the live path, and
  that the same command passes on the current tree.
  Files: `dev/validation/2026-09-12-file-copy/README.md`.
- D-1, medium: the hard-link note now states D-1 in the past tense and points
  at the repaired fixture arm and its check.
  Files: `dev/HARD-LINK.md`.
- A-1, low: the contract note now states the host behavior of a non-regular
  source, a blocking FIFO and a zero-byte character device copy.
  Files: `dev/FILE-COPY.md`.
- C-3, low: the record now names `reporting-control.json` as a retained
  record with no `summary` row, and it names its three hashes.
  Files: `dev/validation/2026-09-12-file-copy/README.md`.
- C-4, low: the removal-after-failure sentences now carry the same hedge and
  state that no test creates a partial destination.
  Files: `REACTOR.md`, `dev/FILE-COPY.md`.
- GATE-1, ruling: the review ladders ran at load1 49 to 76. The only red legs
  were the timing legs `M0-TIME`, `M0-RATIO` and `M1-CORPUS`, plus one
  `REACTOR` exit 124 at the 30-second ceiling. A fresh copy of the repository
  re-ran green: runtime 119 of 119, reactor 715 checks, HOST-NAT 16 of 16 and
  host PASS. The red legs are a ladder artifact of host load, not a defect.
