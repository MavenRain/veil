# Filesystem rename

Operation 21 lets a reactor move an existing file, symlink or directory:

| Operation | Arguments | Successful answer |
| --- | --- | --- |
| 21 | source, destination | Empty bytes, status 0 |

The host calls `rename` directly. An existing destination file is replaced
under the filesystem's rename rules. File bytes, permissions and identity
are retained. Directories move with their contents and, under POSIX rules,
can replace empty directories. Renaming a path to the same file succeeds
without changing it. The operation does not create parents or copy across
filesystems. It reports OS errors, including `ENOENT` and `EXDEV`, through
`resume` with status 1, so the program can handle a failed move and continue.

Exactly two arguments are required before the host performs the operation.
Both paths use the existing UTF-8 and NUL validation. The request payload
is unused. Final symlinks move or are replaced as links, preserving their
targets. Parent symlinks and relative paths retain normal OS resolution.
The host adds no path sandbox, and a successful rename does not promise
durability across a crash.

`dev/runtime-test.mjs` covers binary file replacement and movement between
directories, relative and absolute paths, retained file identity and mode,
same-path success, and recovery after a failed move. It also covers moving
nonempty directories, replacing empty directories, missing paths or parents,
incompatible path kinds, nonempty destinations, and moving a directory into
itself. Symlink tests exercise file, directory and dangling targets at both
endpoints. Malformed arities preserve the source and destination, and invalid
path bytes end the run before either path changes.

`test/fixtures/reactor/file-rename.kan` forwards its argv to operation 21,
prints the answer and exits with the host status. `dev/reactor-test.mjs`
compiles this fixture to an import-free Wasm module and runs it through the
CLI. It checks missing and surplus arguments, binary replacement with a
relative path, same-path success, missing-source error delivery, and moving
a nonempty directory.

Run the affected gates from the repository root:

```sh
gtimeout 30 node --test --test-reporter=tap dev/runtime-test.mjs
gtimeout 30 node dev/reactor-test.mjs _build/default/bin/kanon.exe
zsh dev/house.sh
zsh dev/trusted-lines.sh
```

The [validation record](validation/2026-09-11-file-rename/README.md) retains
results, source hashes and negative controls. Validation covers macOS with
Node.js v23.10.0. Windows, cross-filesystem mounts and crash durability were
not exercised. Kernel, compiler, gate scripts and thresholds are unchanged.

## Review 2026-09-11 (file rename)

- C-1, medium: the four gate commands above drop the `kanon-wait` and
  `kanon-exec` wrapper, which the repository does not contain. File:
  `dev/FILE-RENAME.md`.
- D-2, low: the rename atomicity sentence now names operation 21 and states
  that the host retains the filesystem property. File: `REACTOR.md`.
- D-3, low: the arity reference sentence names the matrix again, because the
  same hunk removed the antecedent of "it". File: `REACTOR.md`.
- C-2, low: the arity note now scopes the count check to operations 1 to 21
  and points to this note for row 21. File: `dev/REQUEST-ARITY.md`.

Rulings, not fixed: B-1 (medium) and B-2 (low) both need a new regression,
which would change the frozen RUNTIME and REACTOR captures of the validation
record. The review records them as gaps.

The review ladder is `validation/2026-09-11-file-rename/gates-review.log`,
tag fix-1, which shows 25 PASS rows of 27 legs with
`TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK`, RUNTIME `# pass 76`
with `# fail 0`, `HOST-NAT 16/16`, `reactor: 321 checks passed` and
`PASS HOST programs=3 zk-instance=10/10`. Two timing legs of the compiler
binary are red: `FAIL M0-TIME median_ms=208.076 bound_ms=150 load1=14.486`
and `FAIL M0-RATIO ratio=2.395663 bound=2.000 load1=14.486`. The check loop
closed with no waiver text. The waiver threshold stays load1 above 25, and
the RUNTIME 76 of 76 line, the five new rename tests, the reactor 321 line
and HOST-NAT 16/16 are never waived by load alone.
