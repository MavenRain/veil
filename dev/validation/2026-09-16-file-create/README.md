# File creation validation, 2026-09-16

Base: `6bd7ffdb82215d52950d0fe5340369a9d3613af9`.

Operation 49 creates a file exclusively from its raw body. Its contract
is in [FILE-CREATE.md](../../FILE-CREATE.md). Validation ran in
`/Users/oobi/Documents/gpt3/veil-file-create` on macOS with Node v23.10.0,
using the base compiler verified against the file-access validation record.

| Check | Result | Capture |
| --- | --- | --- |
| RUNTIME, 30-second watchdog | 318 passed, 0 failed, 0 skips | `runtime.json` |
| REACTOR, 30-second watchdog | 4128 checks passed | `reactor.json` |
| Host naturals | 16/16 | `host-nat.json` |
| Positive control | Ten passed, no failures or skips | `positive.json` |
| Defect controls | All nine failed assertions | `controls.json` |
| JavaScript syntax | All three files passed | `syntax-*.json` |
| Repository conventions | HOUSE OK | `house.json` |
| Trusted lines | Kernel 5246/5250; encoder 246/600 | `trusted-lines.json` |
| Whitespace | Passed | `diff-check.json` |

The runtime count is 11 above the predecessor's recorded 307; the compiled
count is 110 above its recorded 4018. The baseline suites were not rerun.
The full milestone ladder was not rerun. Compiler and gate sources, the
reused compiler binary and all original runtime and reactor test bodies
were checked against the base. `source-scope.json` records that check.
Windows and network filesystems were not exercised. Native denial and
permission controls require a non-root POSIX host.

The control reproducer copies the final runtime and test file into a fresh
temporary directory per variant. It copies `runtime/reactor.mjs` and
`dev/runtime-test.mjs` only, and it reruns the ten file create runtime
tests. The compiled reactor checks stay outside this mutation evidence.
It selects `^file create `, including
the trailing space to exclude the separate creation-time tests. The
positive control uses unchanged source. The nine mutations remove the
operation, remove its arity, overwrite existing files, widen the creation
mode, decode the payload as text, omit the size guard, normalize the path,
omit the write or omit awaiting its completion. Exact replacements,
variant hashes, commands and counts are in `controls.json`; each named
capture also retains its stdout and stderr. Every defective variant
returned exit 1 with an assertion failure. A timeout is not a passing
defect control. Temporary copies were removed after each run.

Run from the repository root, using a Node version with the required
WebAssembly features and an already built compiler:

```sh
kanon-wait run -- kanon-exec run --budget 4000 -- gtimeout 30 node --test --test-reporter=tap dev/runtime-test.mjs
kanon-wait run -- kanon-exec run --budget 4000 -- gtimeout 30 node dev/reactor-test.mjs _build/default/bin/kanon.exe
kanon-wait run -- kanon-exec run --budget 4000 -- gtimeout 30 node dev/host-nat-test.mjs _build/default/bin/kanon.exe
kanon-wait run -- kanon-exec run --budget 4000 -- python3 -I dev/validation/2026-09-16-file-create/reproduce-controls.py
```

`results.json` pins the final source bytes and every retained file in this
record except itself. Its `checks` object holds five counts only. The
syntax, conventions, trusted-line and whitespace verdicts stay in their
captures and in the table above, and the two count deltas stay in the
prose above. The `capture_sha256` keys name files in this record
directory, and the `source_sha256` keys are repository-relative, so the
key `README.md` names this record README in the first map and the
repository README in the second. The record README is included in
`capture_sha256`; if prose changes, recompute that map and the affected
`source_sha256` entries. Captures retain their original command, working
directory and streams. The compiler is an ignored, untracked local
artifact, so its recorded hash identifies the binary used but does not
distribute it. Its
hash matches `2026-09-16-file-access/results.json`; the compiler was not
rebuilt for this slice.

## Review 2026-09-16

Close ladder run 02:0x, start load1 12.51, end load1 10.48.
LADDER-EXIT 0, every named leg PASS, no FAIL row. The check loop closed
under an empty waiver: no leg needed a load waiver. The full log is pinned
at `gates-review.log`.

Numbers read from that log: TRUSTED-LINES kernel=5246/5250
encoder=246/600 OK. RUNTIME `# pass 318 of 318`, `# fail 0`,
RUNTIME-EXIT 0. HOST-NAT 16/16, HOST-NAT-EXIT 0.
`reactor: 4128 checks passed`, REACTOR-EXIT 0.

This review recomputed the stale source_sha256 rows from the fixed, staged
bytes. It added the new capture_sha256 row for `gates-review.log`, pinning
that log in the key shape this record uses. It then recomputed the
capture_sha256 row `README.md` of this README last, since the section you
are reading changed the README's own bytes.
