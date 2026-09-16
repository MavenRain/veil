# File timestamp validation, 2026-09-15

Base: `8869af6530cf39308aa86079c34c5740f567ef2b`.
Recorded checkout: `/Users/oobi/Documents/gpt3/veil-file-times`.
Native validation used macOS and Node v23.10.0. Windows was not exercised.

| Check | Result | Capture |
| --- | --- | --- |
| Timestamp tests and shared argument counts | 54/54 | `focused-arity.json` |
| Full runtime suite | 269 passed | `runtime.json` |
| Compiled reactor suite | 3128 checks | `reactor.json` |
| HOST-NAT | 16/16 | `host-nat.json` |
| Positive control | 9/9 | `positive.json` |
| Defect controls | 14 rejected | `controls.json`, named captures |
| JavaScript syntax | passed | `syntax-*.json` |
| HOUSE | passed | `house.json` |
| TRUSTED-LINES | kernel 5246/5250, encoder 246/600 | `trusted-lines.json` |
| Whitespace | passed | `diff-check.json` |

Captures record command arguments, working directories, exit status, stdout
and stderr with hashes. Focused, runtime, compiled reactor and HOST-NAT
commands have a 30000 ms outer watchdog. `control-run.json` has a 120000 ms
watchdog, and the positive and fourteen defect variants each have a
20-second timeout. Syntax, HOUSE, TRUSTED-LINES and whitespace captures
record no watchdog. The compiled harness retains its per-child bounds.

The predecessor record reports 259 runtime tests and 2891 compiled checks.
This slice adds ten tests and 237 checks. The focused pattern
`file times|request arities` covers nine timestamp tests, the argument-count
parent test and its 44 operation rows.

Native tests check zero, positive, subsecond and pre-epoch timestamps,
file identity and contents, links, path resolution and error handling.
Selected native subsecond cases allow at most 1000 ns deviation from the
requested milliseconds. This measured tolerance is not a cross-platform
precision guarantee. Mocked utimes calls check exact Date values, both
Date endpoints, argument order, literal paths and one update per request.
The host may support a narrower storage range or coarser precision.

The first focused attempt passed eight tests and failed one because the
content-read guard also blocked loading the runtime module. Its capture is
`initial-fixture-guard.json`. The guard now allows that exact module URL;
all later validation uses the corrected tests pinned by `results.json`.
The fourteen mutation controls all fail assertions with the corrected guard.

The ignored compiler `_build/default/bin/kanon.exe` was reused after its
SHA-256 matched the predecessor filesystem type record. All base tracked
files outside the declared runtime, test and documentation edits were
checked against the baseline. Compiler sources and gate definitions did
not change. `results.json` pins the compiler binary, runtime sources,
harnesses, fixture inputs, documents and captures. The full compiler and
milestone ladder was not rerun; the results establish the scoped checks
listed above.

## Reproduction

From the repository root with Node and the existing compiler available:

```sh
node --test --test-reporter=tap \
  --test-name-pattern 'file times|request arities' dev/runtime-test.mjs
node --test dev/runtime-test.mjs
node dev/reactor-test.mjs _build/default/bin/kanon.exe
node dev/host-nat-test.mjs
python3 -I dev/validation/2026-09-15-file-times/reproduce-controls.py \
  --output <fresh-dir>
```

The author machine uses `kanon-wait`, `kanon-exec` and `kanoncho` for
capturing output and enforcing outer timeouts. These wrappers are not
required for the reproduction commands above.

The control reproducer creates temporary isolated runtime variants and
runs the same nine tests on each. It requires the original runtime to pass
and each defect variant to fail assertions. Timeouts, skips and
cancellations fail the reproducer. `controls.json` records each exact
mutation and capture hash. Use a fresh output directory each time.

## Review 2026-09-15

Close ladder run 18:3x, start load1 12.23, end load1 14.87.
LADDER-EXIT 0, every named leg PASS, no FAIL row. The check loop closed
under an empty waiver: no leg needed a load waiver. The full log is pinned
at `gates-review.log`.

Numbers read from that log: TRUSTED-LINES kernel=5246/5250
encoder=246/600 OK. RUNTIME `# pass 269 of 269`, `# fail 0`,
RUNTIME-EXIT 0. HOST-NAT 16/16, HOST-NAT-EXIT 0.
`reactor: 3128 checks passed`, REACTOR-EXIT 0.

This review recomputed the stale source_sha256 rows from the fixed, staged
bytes. It added the new capture_sha256 row
`dev/validation/2026-09-15-file-times/gates-review.log`, pinning
that log. It then recomputed the source_sha256 row of this README last,
since the section you are reading changed the README's own bytes.
