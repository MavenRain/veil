# Reactor filesystem cleanup

Operations 19 and 20 complete the host API for temporary-file lifetimes. A
reactor can create a private directory with operation 1, write files with
operation 3 or capture a child process with operation 4, then unlink each
file with operation 19 and remove the empty directory with operation 20.

Both operations take exactly one UTF-8, NUL-free path and return status 0
with empty bytes on success. Missing or surplus arguments return status 1
before filesystem access. Filesystem failures return status 1 with the
OS error code and message through `resume`, including `ENOENT` for a missing
path. Cleanup is not implicitly idempotent: the program chooses how to
handle a path that is already absent.

Operation 19 calls `unlink`. A final symlink is removed without following
its target, including a dangling symlink. A directory is refused. Operation
20 calls `rmdir` without recursive options. It refuses files, final symlinks
and nonempty directories. Relative paths use the host working directory,
and parent symlinks follow ordinary OS path resolution. The caller owns
the path and cleanup policy; these operations are not a filesystem sandbox.

The runtime tests exercise creation, binary content, relative Unicode paths,
successful cleanup, repeated removal, wrong path kinds, directory-content
preservation and symlink targets. The arity matrix covers both new rows and
checks that surplus arguments leave removable files and empty directories
intact. POSIX symlink tests are skipped on Windows, where creating a symlink
can require privileges.

The compiled `file-cleanup.kan` fixture forwards a one-byte operation code
and argument words, prints the returned answer and exits with its status.
The REACTOR suite tests both operations through emitted Wasm and the CLI,
including errors, argument counts and filesystem state after each request.

Run from the repository root:

```sh
node --test --test-name-pattern 'filesystem cleanup|request arities' dev/runtime-test.mjs
gtimeout 30 node --test --test-reporter=tap dev/runtime-test.mjs
gtimeout 30 node dev/reactor-test.mjs _build/default/bin/kanon.exe
```

Use `timeout` where GNU timeout has that name. The gate watchdogs and compiler
are unchanged. The [validation record](validation/2026-09-11-file-cleanup/README.md)
retains command outputs, source hashes and the failed original-runtime control.

## Review 2026-09-11 (file cleanup)

- A-1, medium: the cleanup paragraph now records that the path-kind and
  symlink rules are the POSIX rules and that Windows was not exercised.
  File: `REACTOR.md`.
- A-2, low: the path-scope caveat now states that the operations are not
  restricted to paths that the reactor created and are not a filesystem
  sandbox. File: `REACTOR.md`.
- C-1, low: the arity note now gives the current operation range and scopes
  its 18 rows to itself, with a pointer to this note for rows 19 and 20.
  File: `dev/REQUEST-ARITY.md`.
- C-2, low: the validation record now states that the captures keep their
  whitespace-only lines and that the gate scripts hold no whitespace leg.
  File: `dev/validation/2026-09-11-file-cleanup/README.md`.
- GATE-1, high: the ladder of the review is `validation/2026-09-11-file-cleanup/gates-review.log`,
  the run with tag `fix-2`. It gives 24 PASS legs and 3 FAIL legs. The three red
  legs are `FAIL M0-TIME median_ms=204.528 bound_ms=150 load1=20.955`,
  `FAIL M1-CORPUS elapsed_ms=769.464 bound_ms=713 load1=20.955` and
  `FAIL M0-RATIO ratio=2.537600 bound=2.000 load1=20.955`. The dispatcher closed
  the check loop with this waiver after check-2: every item of the round is
  fixed and new_defects is empty, and each red leg is waivable under the load
  rule, which applies to timing legs only. The kernel bound is unchanged:
  `TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK`. The RUNTIME 70 of 70
  line, the three new filesystem cleanup tests, the line
  `reactor: 281 checks passed` and `HOST-NAT 16/16` are never waived by load
  alone. That log gives all four of them.
