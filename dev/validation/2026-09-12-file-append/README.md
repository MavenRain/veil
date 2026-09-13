# File append validation, 2026-09-12

Validated in `/Users/oobi/Documents/gpt3/veil-file-append` from base
`67255e5eacb091a0341872572c9249b8db34bb1a`. The compiler executable was
copied from the main Veil repository after its SHA-256 matched the committed
directory-creation record. No compiler rebuild was needed.

| Check | Result |
| --- | --- |
| `gtimeout 30 node --test --test-reporter=tap dev/runtime-test.mjs` | 136 passed, 0 failed, cancelled or skipped |
| `gtimeout 30 node dev/reactor-test.mjs _build/default/bin/kanon.exe` | 857 checks passed |
| Anchored `^file append` runtime selection | 8 passed, 0 failed |
| `node --check` for runtime and both test scripts | Passed |
| `zsh dev/house.sh` | HOUSE OK |
| `zsh dev/trusted-lines.sh` | Kernel 5246/5250, encoder 246/600 |
| `git diff --check` | Passed for the modified tracked files |

The new fixture, contract and record files were untracked during the captured
diff check. Staging verifies their whitespace and runs `git diff --cached
--check` over the complete staged slice.

The reactor fixture covers the actual compiled Wasm ABI and CLI append flow.
Its output has no Wasm imports. Runtime tests cover file bytes, creation
permissions, identity, hard and symbolic links, native path resolution,
65536-byte acceptance, 65537-byte refusal and continuation after errors.
The arity matrix includes one nested append test; the anchored selection
runs only the eight top-level append tests.

Each negative control runs the identical test bytes in an isolated directory:

```sh
gtimeout 30 node --test --test-reporter=tap --test-name-pattern '^file append' dev/runtime-test.mjs
```

| Control | Change | Focused failures |
| --- | --- | --- |
| `runtime-before` | Base-commit runtime with operation 29 absent | 8 |
| `truncate-file` | Open with `w` instead of `a` | 5 |
| `text-payload` | Convert binary contents through UTF-8 text | 6 |
| `public-permissions` | Create with mode 0666 | 3 |
| `normalize-path` | Resolve the path lexically before append | 3 |
| `omit-size-bound` | Remove the pre-effect payload bound | 2 |
| `omit-arity` | Remove the argument-count entry for operation 29 | 1 |
| `swallow-errors` | Convert append failures to success | 2 |

Every control completed with exit 1, eight executed tests, and no skipped or
cancelled tests. `controls.json` records the exact textual mutations and
source hashes. Each of the ten test and control captures records the command,
working directory, test counts, failed test names and complete-stream hashes.
The seven command captures, `diff-check`, `house`, `reactor`,
`syntax-runtime`, `syntax-runtime-tests`, `syntax-reactor-tests` and
`trusted-lines`, retain the command, the working directory, the exit code and
the inline streams with their hashes, and they carry an empty count block and
no failed test names. The reactor count is thus in the `reactor` stdout line
only. `focused-initial.json` is the incomplete capture that the next
paragraph describes. Apply each mutation to
the recorded runtime separately; `runtime-before` uses the base runtime
with the current test file.

`focused-initial.json` preserves an earlier wrapper failure before the test
adapter switched to Buffer views. The wrapper returned exit 2 with
`IO: process group cleanup failed`; its incomplete manifest contains no
command verdict. Its partial output is retained, but no success, timeout or
test count is inferred from it. The later focused and full runs supersede it.

`results.json` pins the final sources, compiler and capture files. Its
`source_sha256` and `capture_sha256` maps both contain this README; an edit to
it requires refreshing both entries. Refresh hashes after every final
documentation change. Old validation records remain unchanged.

The runtime and compiled reactor commands keep their existing 30-second
watchdogs. HOUSE and TRUSTED-LINES cover the source conventions and trusted
code bounds. Compiler, gate and milestone sources did not change, and the
full compiler and milestone battery was not repeated. Native validation
covers macOS. Windows, special files, concurrent writers, partial writes and
Node's internal handle cleanup were not exercised. Injected OS failures
verify status propagation and continuation without changing host resources.

## Review 2026-09-12

The review of the file append slice ran two fix rounds on head 67255e5. Round 1
fixed the low finding C-1: the capture sentence above now applies to the ten
test and control captures only, and it states that the seven command captures
keep the command, the exit code and the inline streams with an empty count
block. Round 2 carried the high finding GATE-1 for a user ruling, because the
only red legs are the load-sensitive timing legs. The check loop closed with no
waiver text. The waiver threshold stays load1 above twenty-five. The RUNTIME
136 of 136 line, the eight new file append tests, the reactor 857 line and
HOST-NAT 16/16 are never waived by load alone.

The final gate log of the review is `gates-review.log`, the fix-2 run. It ran
from load1 35.30 to load1 37.50 and it gives 26 PASS legs of 28 legs.

Numbers after the review, read from `gates-review.log`:

- `TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK`
- RUNTIME `# tests 136`, `# pass 136`, `# fail 0`, `RUNTIME-EXIT 0`
- `HOST-NAT 16/16`, `HOST-NAT-EXIT 0`
- `reactor: 857 checks passed`, `REACTOR-EXIT 0`
- `PASS HOST programs=3 zk-instance=10/10`, `HOST-EXIT 0`
- `FAIL M0-TIME median_ms=261.075 bound_ms=150 load1=42.588 samples=3x5`
- `FAIL M0-RATIO kanon_ms=159.850 kanon_lines=1000 tot_ms=103.662
  tot_lines=8138 ratio=12.549047 bound=2.000 load1=42.588`
- `GATES-FAIL`, `LADDER-EXIT 1`, `RUN end=22:15:23 load=38.47 38.49 40.27`

Both red legs are timing legs at load1 42.588, above the waiver threshold, and
the compiler binary hash ba114dff is unchanged, so they are load artifacts of
the host machine and not a defect of this slice.

The sections above describe the scoped checks recorded before the review:
runtime 136 of 136 with no skips, the eight new tests failing against the HEAD
runtime in `runtime-before` with 0 of 7 passing under the pattern
`^file append`, reactor 857 checks, trusted lines kernel 5246/5250 and encoder
246/600, house six checks OK, and `git diff --check` clean.

The review recomputed these hashes from the staged bytes:
`source_sha256["dev/FILE-APPEND.md"]`,
`source_sha256["dev/validation/2026-09-12-file-append/README.md"]` and
`capture_sha256["README.md"]`. Every other entry stays byte-identical. No
capture file and no `controls.json` entry was edited.
