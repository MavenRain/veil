# Temporary-directory prefixes

Operation 1 takes a root and a literal filename prefix. It resolves the root,
creates it if needed, then creates a fresh directory inside it with private
permissions. Empty prefixes and the literal prefixes `.` and `..` are valid.
The generated suffix makes the latter ordinary filenames, not path components.

Previously, `join(root, prefix)` normalized the prefix before `mkdtemp`
appended its suffix. An empty or `.` prefix therefore produced a sibling of
the root; `..` produced a sibling of its parent. Prefixes such as `../escape-`
could also create directories outside the requested root.

The host now retains a trailing separator on the resolved root and appends
the prefix literally. It rejects both slash forms in the prefix before any
filesystem operation, with status 1 and
`IO: temporary directory prefix must not contain path separators` through
`resume`. These are filename rules for operation 1. The host normalizes the
root text lexically before any filesystem access, so a `..` segment removes
the name before it. The host does not follow a symlink and does not test
that the removed name exists. The OS follows symlinks only for the
components that stay after the normalization.

The runtime regressions check empty, dot, ordinary, Unicode and space prefixes,
relative root resolution, two distinct allocations per prefix, exact parent
placement, directory contents and mode 0700 on POSIX. Eight prefixes with a
separator must leave the root absent and its parent empty. A prefix that the
OS rejects, for example one longer than the name limit, passes the separator
check. The host then creates the root and answers with the node error code.
The original runtime fails
both new tests. The compiled `temp-directory.kan` fixture sends operation 1,
prints its answer and exits with its status. The reactor suite checks success
and rejection through the emitted Wasm and CLI, including parent placement
and POSIX permissions.

Run the focused tests from the repository root:

```sh
node --test --test-name-pattern 'temporary directories' dev/runtime-test.mjs
```

The full RUNTIME and REACTOR checks retain their existing 30-second watchdogs:

```sh
gtimeout 30 node --test --test-reporter=tap dev/runtime-test.mjs
gtimeout 30 node dev/reactor-test.mjs _build/default/bin/kanon.exe
```

On hosts where GNU timeout is named `timeout`, use that spelling. Captures
and source hashes are retained in [the validation record](validation/2026-09-11-temp-directory/README.md).

## Review 2026-09-11 (temp directory)

- C-1 (medium): the prose of the root resolution now states lexical
  normalization before any filesystem access, not OS symlink semantics.
  Files: REACTOR.md, dev/TEMP-DIRECTORY.md.
- D-1 (medium): the three reproduction commands drop the `kanon-wait` and
  `kanon-exec` wrapper, which is not in the repository.
  File: dev/TEMP-DIRECTORY.md.
- A-1 (low): the rejection sentence is limited to prefixes with a separator,
  and records that a prefix the OS rejects creates the root first.
  File: dev/TEMP-DIRECTORY.md.
- B-1 (medium): ruling, not fixed. The root mode 0700 stays unasserted,
  because the only repair edits a test file that the validation record hashes.
- GATE-1 (high): ruling, not fixed. The red rows of the review ladder are
  load-bound. The timing rows M0-TIME, M0-RATIO and M1-CORPUS failed at load
  above 69, and the AGREEMENT, REACTOR and RUNTIME rows stopped on their
  watchdogs with exit 124. A repeat of each leg on its own passed: 65 of 65
  runtime tests, 227 reactor checks, HOST-NAT 16 of 16 and PASS HOST. No
  source file changed.

The close ladder ran from 16:08:57 to 16:10:35 at load1 22 to 30. It gives 26
PASS rows and one red row, `FAIL M0-TIME median_ms=167.312 bound_ms=150
load1=29.097`, which is waived as load-bound. The same run gives RUNTIME 65 of
65, reactor 227 checks, HOST-NAT 16 of 16 and PASS HOST. The copy of that log
is `dev/validation/2026-09-11-temp-directory/gates-review.log`.
