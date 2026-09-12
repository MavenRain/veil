# Directory listing validation, 2026-09-11

Base: `037eccb42a0cbb0882a8aa726d1a2afe4ceff31f`.

The [operation note](../../DIRECTORY-LISTING.md) specifies the request and
reproduction commands. `results.json` records the base, platform, Node version,
source hashes, compiler hash, exact commands, exit statuses and capture hashes.
Every file in `captures/` holds the complete stdout and stderr as JSON strings;
decode those fields to recover the original streams. The source hashes name
the final sources used for validation. Local artifact paths are provenance
pointers; reproducing the checks does not require those directories or wrappers.

| Check | Result |
| --- | --- |
| RUNTIME | 83 passed, 0 failed, 0 cancelled, 0 skipped |
| REACTOR | 351 checks passed |
| HOUSE | All five checks passed |
| TRUSTED-LINES | Kernel 5246/5250, encoder 246/600 |

Each negative control runs the same six focused directory-listing tests.
Every control completes with exit 1, without cancellation or skipped tests.
`results.json` stores each replacement and the resulting runtime and test hashes.

| Control | Passed | Failed | Defect detected |
| --- | --- | --- | --- |
| `runtime-before` | 0 | 6 | Base runtime has no operation 22 |
| `text-sort` | 4 | 2 | Locale text ordering changes raw byte order |
| `missing-terminators` | 2 | 4 | Entry names lose NUL boundaries |
| `unbounded-answer` | 5 | 1 | A 65537-byte answer succeeds |
| `unclosed-directory` | 4 | 2 | Success and read failure leave handles open |

For `runtime-before`, use the base commit's `runtime/reactor.mjs`. For each
mutation, replace the single exact `before` text with `after` in the final
runtime. Copy that runtime and the final test file into matching `runtime/`
and `dev/` directories, then run:

```sh
gtimeout 30 node --test --test-reporter=tap \
  --test-name-pattern='^directory listing' dev/runtime-test.mjs
```

The initial focused run was superseded after fixing the test helper's
quadratic response construction and its double-counting of Node's callback
wrapper, and replacing refused raw-filename creation with injected reader
bytes. Mutation diagnostics were then bounded without weakening byte equality
checks, followed by a fresh RUNTIME and negative-control run. The compiled
suite uses the same production runtime and unchanged final fixture throughout.

The compiler executable is reused from the preceding rename validation and
its hash matches that record. This slice changes runtime behavior and fixtures;
it does not rebuild the compiler or rerun unrelated milestone and timing gates.
Tests ran on macOS with Node.js v23.10.0. Windows, native non-UTF-8 filename
creation and concurrent directory mutation are outside this validation.

## Review 2026-09-11

The review ladder of the last round is `gates-review.log` (tag fix-2, start
22:51:05, end 22:55:14). The ladder passed 24 of 27 legs. The load averages of
the run were 33.21 36.58 43.24, and load1 was 33.21 at launch.

Numbers after the review, read from that log:

- `TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK`
- RUNTIME `# tests 83`, `# pass 83`, `# fail 0`, `RUNTIME-EXIT 0`
- `HOST-NAT 16/16`, `HOST-NAT-EXIT 0`
- `reactor: 351 checks passed`, `REACTOR-EXIT 0`
- `PASS HOST programs=3 zk-instance=10/10`, `HOST-EXIT 0`
- `BUILD-EXIT 0`

The three red legs are timing legs:

- `FAIL M0-TIME median_ms=500.597 bound_ms=150 load1=31.137 samples=3x5`
- `FAIL M0-RATIO kanon_ms=63.921 kanon_lines=1000 tot_ms=103.662
  tot_lines=8138 ratio=5.018127 bound=2.000 load1=31.137`
- `FAIL M1-CORPUS elapsed_ms=972.197 bound_ms=713 lines=1000 main=814
  load1=33.428`

The ladder line reads `GATES-FAIL` with `LADDER-EXIT 1` because of those three
legs only. The check loop closed under this dispatcher waiver after check-2:
every item of the round is fixed and new_defects is empty. Each red leg is
waivable under the load rule, because the waiver threshold is load1 above 25
and each leg ran above that threshold. The kernel bound is unchanged:
`TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK`. Load alone never waives
the RUNTIME 83 of 83 line, the six new directory listing tests, the reactor
351 line or the HOST-NAT 16/16 line.

The review recomputed one hash in `results.json`:
`source_sha256["test/fixtures/reactor/directory-listing.kan"]`, after the D-1
fix of the `exitCode` arm. The other nine source hashes and the five control
hashes are unchanged, because `dev/runtime-test.mjs` did not change in the
review. The nine captures predate that fix and are not re-recorded.

The sections above describe the scoped checks recorded before the review:
runtime 83 of 83 with no skips, all six new tests failing against the HEAD
runtime in `runtime-before`, reactor 351 checks, trusted lines kernel
5246/5250 and encoder 246/600, and house five checks OK.

A close ladder ran after the closer on the final staged tree (tag close,
start 23:13:26 at load averages 41.05 41.24 40.01, end 23:18:24 at load1
20.36). Its log is `gates-close.log` in the review work directory and is not
carried. It passed the same 24 of 27 legs. The red legs are the same three
timing legs, each at load1 above 34:

- `FAIL M0-TIME median_ms=850.978 bound_ms=150 load1=34.729 samples=3x5`
- `FAIL M0-RATIO kanon_ms=116.683 kanon_lines=1000 tot_ms=103.662
  tot_lines=8138 ratio=9.160215 bound=2.000 load1=34.110`
- `FAIL M1-CORPUS elapsed_ms=1478.176 bound_ms=713 lines=1000 main=814
  load1=34.746`

AGREEMENT, HOUSE, TRUSTED-LINES, RUNTIME (`# pass 83`, `# fail 0`), REACTOR
(`reactor: 351 checks passed`), HOST-NAT (`HOST-NAT 16/16`) and HOST
(`programs=3 zk-instance=10/10`) passed, and the compiler binary hash equals
the recorded `source_sha256` entry.
