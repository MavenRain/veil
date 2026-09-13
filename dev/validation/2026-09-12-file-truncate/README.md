# File truncate validation, 2026-09-12

Base: `1a88d6f7e84f6d27e8775e5a0657a20229fca53e`.
The isolated checkout was `/Users/oobi/Documents/gpt3/veil-file-truncate`.
The final runtime reuses the existing numeric parser, adds operation 30 and
its two-argument arity, and changes no compiler sources or gate thresholds.

| Check | Result | Record |
| --- | --- | --- |
| RUNTIME | 144 passed; 0 failed, cancelled, skipped or todo | `runtime.json` |
| Focused `^file truncate` | 7 passed; 0 failed, cancelled, skipped or todo | `focused.json` |
| REACTOR | 963 checks passed | `reactor.json` |
| HOST-NAT | 16/16 | `host-nat.json` |
| JavaScript syntax | Runtime and both changed test files pass | `syntax-*.json` |
| HOUSE | Pass | `house.json` |
| TRUSTED-LINES | Kernel 5246/5250, encoder 246/600 | `trusted-lines.json` |
| `git diff --check` | Pass for modified tracked files at validation time | `diff-check.json` |

Every runtime, focused, reactor and host-natural command ran under
`gtimeout 30`. Captured commands used `kanon-wait run -- kanon-exec`.
The compiler executable matches the preceding file-append record by SHA-256.
The full compiler and milestone gate battery was not repeated. Final
promotion separately checks whitespace in added paths and the staged diff.

The controls run the identical seven focused tests against isolated runtime
variants. Each command exits 1 due to test assertions, with no timeout,
cancellation or skipped test. `controls.json` records exact substitutions
and source hashes; the named JSON records retain failing test names.

| Variant | Failed tests |
| --- | --- |
| Base runtime without operation 30 | 7 |
| Always use length zero | 6 |
| Lexically normalize the path | 3 |
| Convert lengths without validating | 1 |
| Apply the transfer-size bound to file length | 2 |
| Omit operation 30's arity | 1 |
| Swallow filesystem errors | 2 |

Real filesystem tests resize files to at most 65537 bytes. Larger safe
lengths, including 9007199254740991, are checked at a mocked filesystem
boundary. EACCES, ENOSPC, EFBIG, EROFS and EIO are injected to verify error
propagation and continuation. This is not evidence of native resource
exhaustion, filesystem maximum sizes or permission denial. Native tests ran
on macOS; Windows, special files, concurrent mutation and crash durability
were not exercised.

Each command record gives its argv, working directory, exit status, stream
hashes, byte counts and parsed results. Complete captures remain at the
recorded local artifact paths. `results.json` pins the final source bytes,
the compiler and every capture file of this record. The evidence README
appears in both hash maps and must match both if it is edited. Earlier
exploratory captures are not part of this final validation record.

Reproduce from the repository root with an existing compiler:

```sh
kanon-wait run -- kanon-exec run --budget 4000 -- gtimeout 30 node --test --test-reporter=tap dev/runtime-test.mjs
kanon-wait run -- kanon-exec run --budget 4000 -- gtimeout 30 node --test --test-reporter=tap --test-name-pattern '^file truncate' dev/runtime-test.mjs
kanon-wait run -- kanon-exec run --budget 4000 -- gtimeout 30 node dev/reactor-test.mjs _build/default/bin/kanon.exe
kanon-wait run -- kanon-exec run --budget 4000 -- gtimeout 30 node dev/host-nat-test.mjs _build/default/bin/kanon.exe
```

## Review 2026-09-12

The review of this slice kept two findings.

- C-1 (low), `README.md` line 50: the record README overclaimed that
  `results.json` pins every file in the evidence directory. The close step
  makes that claim false. Round 1 scoped the claim to the final source
  bytes, the compiler and every capture file of this record.
- GATE-1 (high): the veil ladder did not pass. The review carries this item
  for a user ruling.

The carried ladder log is `gates-review.log`. This log is evidence, not a
capture, so `results.json` holds no hash row for it. The review notes are
also in `dev/FILE-TRUNCATE.md`.

Green legs of that run:

```text
BUILD-EXIT 0
TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK
# tests 144
# pass 144
# fail 0
HOST-NAT 16/16
reactor: 963 checks passed
REACTOR-EXIT 0
PASS HOST programs=3 zk-instance=10/10
PASS RUNTIME
```

Red legs of that run, with LADDER-EXIT 1:

```text
FAIL M0-TIME median_ms=283.912 bound_ms=150 load1=40.549 samples=3x5
FAIL M0-RATIO ratio=12.784013 bound=2.000 load1=40.549
FAIL M1-CORPUS elapsed_ms=1141.374 bound_ms=713 lines=1000 load1=37.266
FAIL REACTOR (MEASURE REACTOR tier=MED exit=124, the 30 second ceiling)
```

The load rule waives a timing leg above load 30. The machine carried 27
sessions at load1 37 to 41. The slice changes no compiler, kernel or gate
source, and the compiler hash ba114dff is unchanged.
