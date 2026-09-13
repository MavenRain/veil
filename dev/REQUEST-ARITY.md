# Reactor request arities

The JavaScript reactor validates the argument count of operations 1 to 28
before dispatch. This note records the original rows 1 to 18; the
[cleanup regressions](FILE-CLEANUP.md) record rows 19 and 20, the
[rename regressions](FILE-RENAME.md) record row 21, the
[directory listing regressions](DIRECTORY-LISTING.md) record row 22, the
[entry kind regressions](ENTRY-KIND.md) record row 23, the
[symlink target regressions](SYMLINK-TARGET.md) record row 24, the
[symlink creation regressions](SYMLINK-CREATE.md) record row 25, the
[hard-link regressions](HARD-LINK.md) record row 26, the
[file copy regressions](FILE-COPY.md) record row 27, and the
[directory creation regressions](DIRECTORY-CREATE.md) record row 28.
An unknown operation resumes with an unknown-request error
and no count check. Fixed requests require their documented arity;
process operation 4 accepts an executable with zero or more arguments, and
joint-computation operation 16 accepts one or more share slots.

Previously, fixed requests ignored extra arguments. For example, operation 1
with `[root, prefix, "surplus"]` created a directory and returned success.
Operation 3 could replace a file, and operations 10, 12 and 15 could allocate
slots, despite having surplus arguments. Some short requests reached partial
filesystem work or failed with incidental argument errors.

A request whose arguments decode now returns status 1 through `resume` when
the count is malformed, with an error such as
`IO: OS request 10 expects 2 arguments, got 3`. The state machine can handle
that answer and continue. An argument that the host cannot decode ends the
run with exit 2 before the count check, as REACTOR.md records. A request with too few joint-computation arguments
reports the same arity error format. Slot lookup, natural-number parsing and
subset-size checks still apply after the count check. Terminal operation 0
does not inspect the argument list or body.

The existing RUNTIME gate runs these regressions in `dev/runtime-test.mjs`:

- The 18 request rows of this note reject each missing argument prefix. Every fixed row
  also rejects a surplus argument, including stdout and stderr requests.
- Rejected requests preserve existing file contents, leave new directory and
  capture paths absent, keep the process counter unchanged and consume no
  slot indices. A valid request after each rejection sequence still succeeds.
- Valid filesystem requests preserve UTF-8 and NUL bytes in file contents.
  A process request containing only its executable succeeds, as do joint
  computations with one or several shares. Unknown requests still resume
  with status 1.

Validation records are in `dev/validation/2026-09-10-request-arity/`. In
`results.json`, `baseline_test_sha256` is not a base-commit hash. It records
the test file of the validation run (prefix `244a32ae`), which ran against the
baseline runtime. The base-commit blob of `dev/runtime-test.mjs` starts with
`4c25bc7c`. The review fix D-2 changed the test file after that run, so
`sha256["dev/runtime-test.mjs"]` records the later staged file.
At that revision the final runtime suite passed 49 tests, including the 17
request-row subtests, and the existing compiled host-natural and reactor
fixtures passed 16/16 and 103 checks respectively. Later slices add runtime
tests and reactor checks, so a fresh run reports larger counts. These checks
reuse the existing compiler
executable; this slice does not change compiler sources or run the full
compiler gate ladder.

Reproduce the checks from the repository root after building the compiler:

```sh
node --test --test-reporter=tap dev/runtime-test.mjs
node dev/host-nat-test.mjs _build/default/bin/kanon.exe
node dev/reactor-test.mjs _build/default/bin/kanon.exe
```

## Review 2026-09-10 (request arity)

- D-2, low: the arity error now writes "1 argument" for the six rows that
  take one argument. Files: `runtime/reactor.mjs`, `dev/runtime-test.mjs`.
- D-1, low: the opening sentence now scopes the count check to operations 1
  to 17 and states the unknown-operation answer. File: `dev/REQUEST-ARITY.md`.
- A-1, low: the status-1 sentence now applies to arguments that decode, and
  names the exit-2 path for an argument that does not decode. Files:
  `REACTOR.md`, `dev/REQUEST-ARITY.md`.
- C-1, low: the runtime-test count of the blob-isolation note is scoped to
  its own revision. File: `dev/BLOB-ISOLATION.md`.
- C-2, low: this note now records that `baseline_test_sha256` holds the test
  file of the validation run, not the base-commit blob. File:
  `dev/REQUEST-ARITY.md`.

The review closed with no waiver. The full gate ladder ran after the fix
round and passed 26 legs of 27: BUILD-EXIT 0; TRUSTED-LINES kernel=5246/5250
encoder=246/600 OK; RUNTIME `# pass 49`, `# fail 0`; HOST-NAT 16/16;
reactor: 103 checks passed; PASS HOST programs=3 zk-instance=10/10. The one
red leg is the timing leg FAIL M0-RATIO ratio=2.401551 bound=2.000
load1=18.160, which is also red in the baseline log of the staged tree. The
log is `dev/validation/2026-09-10-request-arity/gates-review.log`. The
review recomputed `sha256["runtime/reactor.mjs"]` and
`sha256["dev/runtime-test.mjs"]` in `results.json` from the staged bytes,
because the fix of D-2 changed those two files.
