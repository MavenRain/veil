# Named directory creation

Operation 28 creates one directory at the supplied path. It requires exactly
one NUL-free UTF-8 argument and returns status 0 with an empty answer on success.
The payload is unused. The runtime calls `mkdir` with mode `0700` and leaves
recursive creation disabled. On POSIX hosts, the resulting permission bits are
`0700 & ~umask`. The operation 28 arm makes no `umask` or `chmod` call, and the
tests observe the resulting mode bits only.
An application can create a hierarchy by requesting each parent first.

The parent must already exist. Existing files, directories and symlinks,
including dangling links, are refused and preserved. The host receives the
original path without lexical normalization. Relative paths use the host
working directory; parent symlinks, dot segments and trailing separators
retain OS resolution. OS failures return status 1 with their error code and
message. The state machine may continue after a failed request.

Missing or surplus arguments return status 1 before filesystem access.
NUL and invalid UTF-8 fail request decoding before dispatch. As with the other
filesystem operations, the application chooses the path. This operation adds
no restriction to paths created by the reactor and no crash durability guarantee.

`dev/runtime-test.mjs` covers:

- Real permission bits under umasks `0000` and `0277`, empty contents and an
  ignored binary payload.
- Creation of parents and children, entry-kind queries, directory listing,
  binary file write and read, unlink and empty-directory cleanup.
- Relative UTF-8 paths, trailing separators and a parent symlink followed by
  `..`, with a decoy location that detects lexical normalization.
- Existing files, directories, live links and dangling links, including
  preserved device/inode identities, modes, contents and stored link targets.
- Missing and non-directory parents, cyclic parent links, empty paths and a
  successful request after those errors, without creating missing parents.
- Malformed argument counts and bytes before the injected filesystem call,
  exact path forwarding and the requested creation mode.
- Injected `EACCES`, `ENOSPC`, `EROFS` and `EIO` errors followed by success.

The arity matrix includes operation 28 as a nested test. That row runs in the
full suite, or under the `request arities` pattern, not in the anchored leg.
The anchored `^directory creation` selection runs the seven top-level tests
only. Native filesystem
tests cover macOS. Windows was not exercised. Permission, full-disk and
read-only-filesystem failures use injection rather than modifying host resources.

`test/fixtures/reactor/directory-create.kan` compiles with `runtime/reactor.kan`
to an import-free Wasm module. It forwards CLI arguments to operation 28,
prints the host answer and includes both the creation and output statuses in
its final exit code. `dev/reactor-test.mjs` checks its requested, reporting and
finished states, byte forwarding, both status combinations and terminal-state
stability. CLI checks cover relative-path success, permissions, existing
entries, missing parents, empty paths and argument counts.

Run from the repository root with a built compiler:

```sh
gtimeout 30 node --test --test-reporter=tap dev/runtime-test.mjs
gtimeout 30 node dev/reactor-test.mjs _build/default/bin/kanon.exe
zsh dev/house.sh
zsh dev/trusted-lines.sh
```

The [validation record](validation/2026-09-12-directory-create/README.md) retains
commands, source hashes, results and negative controls.

## Review 2026-09-12 (directory creation)

- B-1 (medium): the umask clause now states that the operation 28 arm makes no
  `umask` or `chmod` call and that the tests observe the mode bits only.
  Files: `REACTOR.md`, `dev/DIRECTORY-CREATE.md`.
- C-1 (medium): the whitespace claim now names the tracked files that
  `git diff --check` covered and the staged check that covers the new files.
  Files: `dev/validation/2026-09-12-directory-create/README.md`,
  `dev/REACTOR-BUILD-LOG.md`.
- A-1 (low): the fixture states are now named `requested`, `reporting` and
  `finished`, as the fixture declares them.
  File: `dev/DIRECTORY-CREATE.md`.
- B-2 (low): the control sentence now records the selection and the
  non-uniform kill counts 7, 3, 2, 3, 1, 3.
  File: `dev/REACTOR-BUILD-LOG.md`.
- B-4 (low): the arity matrix row is now stated to run in the full suite, not
  in the anchored `^directory creation` leg.
  File: `dev/DIRECTORY-CREATE.md`.
- C-2 (low): the control table gains a `Focused failures` column and the
  summary row records the same counts.
  File: `dev/validation/2026-09-12-directory-create/README.md`.
- Gates: the carried log is
  `validation/2026-09-12-directory-create/gates-review.log`, the fix round 1
  run. The ladder shows 26 PASS legs of 28 legs with `LADDER-EXIT 1`.
  `TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK`, RUNTIME `# pass 127`
  with `# fail 0`, `HOST-NAT 16/16`, `reactor: 789 checks passed` and
  `PASS HOST programs=3 zk-instance=10/10` are all green.
- The two red legs are `FAIL M0-TIME median_ms=309.597 bound_ms=150
  load1=73.167` and `FAIL M0-RATIO ratio=3.101895 bound=2.000 load1=73.167`.
  Both are timing legs. The check loop closed with no waiver. The waiver
  threshold is load1 above twenty-five, both legs ran at load1 73.167, and the
  compiler binary hash `ba114dff...` is unchanged, so the two legs are
  load-bound. The RUNTIME 127 of 127 line, the seven new directory creation
  tests, the reactor 789 line and `HOST-NAT 16/16` are never waived by load
  alone.
