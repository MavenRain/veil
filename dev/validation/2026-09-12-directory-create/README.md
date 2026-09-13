# Directory creation validation, 2026-09-12

Base: `7a8bbefdcfc681a7be1b00d93c655c7e2c949368`.
Validation ran in `/Users/oobi/Documents/gpt3/veil-directory-create`.
The source changes add operation 28, its arity row, runtime regressions and
the compiled directory-creation fixture. The compiler and gate scripts are
unchanged. The compiler was copied from the main checkout only after its
SHA-256 matched the preceding file-copy validation record.

| Check | Result |
| --- | --- |
| RUNTIME command | 127 passed, 0 failed, 0 skipped |
| REACTOR command | 789 checks passed |
| Focused directory creation tests | 7 passed |
| JavaScript syntax | Runtime and both test files passed |
| HOUSE | Passed |
| TRUSTED-LINES | Kernel 5246/5250, encoder 246/600 |
| Whitespace | `git diff --check` passed on the modified tracked files; the new files were untracked in the validation tree, and `git diff --cached --check` on the staged tree covers them |
| Negative controls | All six rejected by the same seven-test focused run (7, 3, 2, 3, 1, 3 failures) |

Both full test commands retain their 30-second watchdogs:

```sh
gtimeout 30 node --test --test-reporter=tap dev/runtime-test.mjs
gtimeout 30 node dev/reactor-test.mjs _build/default/bin/kanon.exe
```

This slice did not rerun the full compiler or milestone battery. Native
filesystem validation ran on macOS. Windows was not exercised. Failure
injection covers permission, full-disk, read-only-filesystem and I/O errors.
The real permission tests inspect the created mode under umasks `0000` and
`0277` and restore the original umask before filesystem inspection.

The negative controls use identical test bytes with isolated runtime copies:

| Control | Deliberate defect | Focused failures |
| --- | --- | --- |
| `runtime-before` | Base runtime has no operation 28 | 7 |
| `recursive-creation` | Creates missing parents and accepts existing directories | 3 |
| `public-permissions` | Requests mode 0777 | 2 |
| `normalize-path` | Resolves the path lexically before mkdir | 3 |
| `omit-arity` | Omits the operation 28 arity entry | 1 |
| `swallow-errors` | Reports success after mkdir rejects | 3 |

`controls.json` records each substitution and the resulting runtime and test
hashes. Each control record retains its exact command, exit status, TAP counts
and failed test names. To reproduce a control, copy the two files to an
isolated directory, apply the recorded substitution to `runtime/reactor.mjs`,
and run `node --test --test-reporter=tap --test-name-pattern '^directory creation'
dev/runtime-test.mjs` there. For `runtime-before`, obtain the runtime from
the base commit instead of applying a text substitution.

`results.json` pins source and compiler hashes, capture record hashes, platform
and command summaries. Individual records retain the original capture paths
and stdout/stderr hashes; the full capture streams remain at those paths.
The README is hashed in both `source_sha256` and `capture_sha256`. Refresh
both rows after any README edit. Generated compiler output and temporary test
files are not part of the staged slice.

## Review 2026-09-12

The review of the directory creation slice kept six findings, B-1, C-1, A-1,
B-2, B-4 and C-2, and one fix round made all six fixes. Every fix is prose.
No capture, no `controls.json` entry and no runtime file changed. The check
loop closed with no waiver.

The carried gate log is `gates-review.log`. It is the log of the fix round 1
run. The ladder shows 26 PASS legs of 28 legs and `LADDER-EXIT 1`
(`RUN end=20:25:36 load=32.45 46.83 48.94`). The numbers after the review are:

- `TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK`
- RUNTIME `# pass 127`, `# fail 0`, `RUNTIME-EXIT 0`
- `HOST-NAT 16/16`, `HOST-NAT-EXIT 0`
- `reactor: 789 checks passed`, `REACTOR-EXIT 0`
- `PASS HOST programs=3 zk-instance=10/10`, `HOST-EXIT 0`

Two legs are red, and both are timing legs:

- `FAIL M0-TIME median_ms=309.597 bound_ms=150 load1=73.167 samples=3x5`
- `FAIL M0-RATIO kanon_ms=39.512 kanon_lines=1000 tot_ms=103.662
  tot_lines=8138 ratio=3.101895 bound=2.000 load1=73.167`

The waiver threshold is load1 above twenty-five. Both red legs ran at load1
73.167, and the compiler binary hash `ba114dff...` is unchanged, so the two
timing legs are load-bound and are not a defect of this slice. The RUNTIME
127 of 127 line, the seven new directory creation tests, the reactor 789 line
and `HOST-NAT 16/16` are never waived by load alone.

The review refreshed these `results.json` hashes from the staged bytes:
`source_sha256` rows `REACTOR.md`, `dev/DIRECTORY-CREATE.md`,
`dev/REACTOR-BUILD-LOG.md` and
`dev/validation/2026-09-12-directory-create/README.md`, and the
`capture_sha256` row `README.md`. All other rows stay byte-identical.

The sections above describe the scoped checks that were recorded before the
review: runtime 127 of 127 with no skips, the seven new tests failing against
the HEAD runtime in `runtime-before` with 0 of 7 passing under the pattern
`^directory creation`, reactor 789 checks, trusted lines kernel 5246/5250 and
encoder 246/600, house six checks OK, and a clean `git diff --check`.
