# Hard-link creation

Operation 26 adds a name for an existing filesystem entry using the host's
`link(source, destination)` call. For a regular file, both names share its
identity and contents. It returns status 0 with an empty answer on success.
Both arguments must be NUL-free UTF-8; the request payload is unused.

The source and destination are passed unchanged. Relative paths use the host
working directory, and parent symlinks, dot segments and trailing separators
retain OS resolution. Source symlink behavior is the host's native `link`
behavior, without an extra `realpath` step. No test uses a symlink as the
source, thus the suite does not pin that case. On macOS, the host `link` call
follows a symlink source and gives the new name the identity of the target
file. This operation does not store a literal target string like operation 25.

An existing destination remains unchanged, including a directory, symlink or
dangling link. Missing parents are not created. Native restrictions apply to
directory links, permissions, link counts and crossing filesystem boundaries.
There is no overwrite or copy fallback. OS errors return status 1 through
`resume` with their code and message. The state machine can continue after
failure. Missing or surplus arguments return an arity error before filesystem
access; NUL or invalid UTF-8 arguments fail request decoding before dispatch.

In-place writes through either hard link affect the shared file. Removing one
name with operation 19 leaves the other usable. Operation 3 uses atomic
replacement, so it gives the replaced name a new file while other hard links
retain the old contents. Applications can use this distinction to keep a name
for an old version before replacing the original.

`dev/runtime-test.mjs` covers:

- Shared device/inode identity, link counts, binary contents, in-place updates
  and survival after unlinking either name.
- Composition with operations 2, 3, 5 and 19, including atomic replacement.
- Relative UTF-8 names and OS resolution of parent symlinks and dot segments
  in both paths, with decoy paths to detect lexical normalization.
- Preservation of existing files, directories, live and dangling symlinks.
- Missing sources and parents, directory sources, non-directory or cyclic
  parents, empty paths, trailing separators and continuation after failure.
- Rejection of malformed counts, NUL and invalid UTF-8 before the injected
  filesystem call, plus exact forwarding of valid arguments and ignored payloads.
- Injected `EXDEV`, `EPERM` and `EMLINK` failures followed by a successful request.

`test/fixtures/reactor/hard-link.kan` compiles with `runtime/reactor.kan` into
an import-free Wasm module. It forwards its command-line arguments to operation
26, writes the host answer to stdout and includes both creation and output
failures in its exit code. `dev/reactor-test.mjs` checks those transitions
directly and exercises creation, shared identity, updates, unlinking, conflicts,
missing paths and invalid argument counts through the real CLI.

Native tests cover macOS. Windows was not exercised. Cross-device and link-limit
errors use injection; no separate filesystem or exhausted host resource is
required.

Run the affected checks from the repository root with a built compiler:

```sh
gtimeout 30 node --test --test-reporter=tap dev/runtime-test.mjs
gtimeout 30 node dev/reactor-test.mjs _build/default/bin/kanon.exe
zsh dev/house.sh
zsh dev/trusted-lines.sh
```

The [validation record](validation/2026-09-12-hard-link/README.md)
retains the exact commands, source hashes, results and negative controls.

## Review 2026-09-12 (hard-link creation)

- B-1, medium: the source-symlink sentences now state that no test uses a
  symlink as the source, and they give the observed macOS outcome.
  Files: `dev/HARD-LINK.md`, `REACTOR.md`.
- C-1, medium: the record now states that `source_sha256` pins
  `dev/HARD-LINK.md` and `dev/REACTOR-BUILD-LOG.md`, and that a review edit
  refreshes those rows after the edit, never before it.
  Files: `dev/validation/2026-09-12-hard-link/README.md`.
- D-1, medium, carried for a user ruling: the `reporting` arm of the fixture
  exit code returns the constant 1 and no check covers it, because the repair
  edits the pinned fixture and `dev/reactor-test.mjs` inside the frozen
  627-check capture. No file changed.
- B-2, low: the record now states that the arity matrix row at
  `dev/runtime-test.mjs:774` is a subtest that the anchored focused pattern
  does not select, so only the full RUNTIME run covers it.
  Files: `dev/validation/2026-09-12-hard-link/README.md`.
- C-3, low: the rerun block now states which commands keep the 30-second
  watchdog and which run without one.
  Files: `dev/validation/2026-09-12-hard-link/README.md`.
- C-4, low: the note now carries the sibling rerun command block.
  Files: `dev/HARD-LINK.md`.
- C-5, low: the record now attributes the arguments, working directory,
  capture path and stream hashes to the capture files, and it states that the
  `summary` records hold the exit code and the counts only.
  Files: `dev/validation/2026-09-12-hard-link/README.md`.

The fix round ran the full gate ladder. The log is kept at
`dev/validation/2026-09-12-hard-link/gates-review.log`. It gives `GATES-OK` and
`LADDER-EXIT 0`, with 28 of 28 legs PASS and no FAIL leg, at load averages 23.73
at the start and 32.50 at the end. The carried lines are
`TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK`, RUNTIME `# pass 111` with
`# fail 0`, `HOST-NAT 16/16`, `reactor: 627 checks passed` and
`PASS HOST programs=3 zk-instance=10/10`. The check loop closed with no waiver.
The waiver threshold stays at load1 above twenty-five. The RUNTIME 111 of 111
line, the seven hard-link creation tests, the reactor 627 line and HOST-NAT
16/16 are never waived by load alone.
