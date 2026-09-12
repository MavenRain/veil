# Symlink creation

Operation 25 accepts exactly two arguments, target then destination, and calls
`symlink(target, destination)`. Success returns status 0 and an empty answer.
The payload is unused. Both arguments follow the existing NUL-free UTF-8 rules.
On POSIX, the stored target retains its literal bytes, including dot segments,
repeated separators, spaces and newlines. The target need not exist, so dangling
links, chains and self-referential links can be created. Relative targets refer
to the link's parent when later followed, independently of the host cwd.

The destination path is passed directly to the OS. Relative paths use the host
working directory, and parent symlinks and trailing separators retain OS
resolution. For example, if `alias` points to `actual/nested`, destination
`alias/../created` names `actual/created`. The host does not create missing
parents or replace existing destinations. Existing files, directories, live
symlinks and dangling symlinks remain intact after a conflict.

Missing or surplus arguments return status 1 before filesystem access. NUL
bytes or invalid UTF-8 in a request argument that the program supplies end the
run before dispatch through the existing exit-2 path. Process argv that reaches
the reactor through `runtime/run.mjs` is already UTF-8 decoded with
replacement, so a command-line byte that is not UTF-8 becomes U+FFFD before the
check and does not end the run. OS errors return status 1 with their code and message
through `resume`; subsequent requests can still succeed. Empty targets pass
through to the OS: macOS accepts them, while other platforms may reject them.
Node's default symlink type is used. Native symlink cases in these tests run
on POSIX; Windows type detection and permissions were not exercised.

Six focused RUNTIME tests cover literal targets, destination path resolution,
conflicts, path errors, file-read and unlink composition, and validation before
filesystem access. Native checks use `lstat` to observe dangling links as entries
and verify that target bytes, inode identities and file content survive conflicts.
An injected `symlink` verifies that invalid requests never reach the filesystem
and that valid arguments, including an empty target, are forwarded unchanged.
The injection restores both default and named builtin imports after the test.
The shared request-arity matrix also includes operation 25.

`test/fixtures/reactor/symlink-create.kan` forwards argv to operation 25, prints
the answer with operation 6, and adds the creation and stdout write statuses
for its exit code. REACTOR compiles the fixture into an import-free Wasm module,
checks argument order and both status paths directly, and runs the CLI against
real links, existing destinations, invalid arities and path errors.

Run the affected checks from the repository root with a built compiler:

```sh
gtimeout 30 node --test --test-reporter=tap dev/runtime-test.mjs
gtimeout 30 node dev/reactor-test.mjs _build/default/bin/kanon.exe
zsh dev/house.sh
zsh dev/trusted-lines.sh
```

The [validation record](validation/2026-09-12-symlink-create/README.md) retains
completed captures, source hashes and negative controls.

## Review 2026-09-12 (symlink creation)

- B-1, medium, carried for a user ruling: target literalness stays untested for
  trailing separators and NFD form, because the repair edits `dev/runtime-test.mjs`
  and invalidates frozen hashes in the validation record. No file changed.
- C-1, medium: the record now states that the `source_sha256` row for its own
  README is refreshed after a README or review edit, never before it.
  Files: `dev/validation/2026-09-12-symlink-create/README.md`.
- A-1, low: the NUL and UTF-8 sentence now applies to request arguments only,
  and it states that process argv is UTF-8 decoded with replacement.
  Files: `dev/SYMLINK-CREATE.md`.
- B-2, low: the control row and the build log now give the per-test kill counts
  6, 5, 3, 1, 6 and 1 instead of uniform rejection.
  Files: `dev/validation/2026-09-12-symlink-create/README.md`,
  `dev/REACTOR-BUILD-LOG.md`.
- C-2, low: the record title carries the date 2026-09-12.
  Files: `dev/validation/2026-09-12-symlink-create/README.md`.
- C-3, low: the record states that `runtime-initial.json` ran an unrecorded test
  file under an unanchored pattern, and it states the schema difference.
  Files: `dev/validation/2026-09-12-symlink-create/README.md`.
- D-1, low: the arity pointer list now names operation 25.
  Files: `REACTOR.md`.
- The check loop closed with no waiver. The waiver threshold stays at load1
  above 25, and a red timing leg above that load is a load artifact, because
  the compiler binary hash `ba114dff` did not change. The RUNTIME 103 of 103
  line, the six new symlink creation tests, the line
  `reactor: 568 checks passed` and `HOST-NAT 16/16` are never waived by load.
- Gate result of the carried log
  `dev/validation/2026-09-12-symlink-create/gates-review.log`: 27 of 28 legs
  pass, with `TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK`,
  RUNTIME `# pass 103` and `# fail 0`, `HOST-NAT 16/16`,
  `reactor: 568 checks passed` and
  `PASS HOST programs=3 zk-instance=10/10`. One leg is red:
  `FAIL M0-TIME median_ms=256.470 bound_ms=150 load1=23.154 samples=3x5`,
  a timing leg. The ladder tail prints `GATES-FAIL` and `LADDER-EXIT 1`.
