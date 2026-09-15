# Filesystem type validation, 2026-09-15

Base: `2e9656fdaddb8c040df3a2efa6f131372878c114`.
Recorded checkout: `/Users/oobi/Documents/gpt3/veil-filesystem-type`.
Native validation used macOS and Node v23.10.0. Windows was not exercised.

| Check | Result | Capture |
| --- | --- | --- |
| Filesystem type and shared argument counts | 51/51 | `focused-arity.json` |
| Full runtime suite | 259 passed | `runtime.json` |
| Compiled reactor suite | 2891 checks | `reactor.json` |
| HOST-NAT | 16/16 | `host-nat.json` |
| Positive control | 7/7 | `positive.json` |
| Defect controls | 12 rejected | `controls.json`, named captures |
| JavaScript syntax | passed | `syntax-*.json` |
| HOUSE | passed | `house.json` |
| TRUSTED-LINES | kernel 5246/5250, encoder 246/600 | `trusted-lines.json` |
| Whitespace | passed | `diff-check.json` |

Captures record command arguments, working directories, exit status, stdout
and stderr with hashes. Five captures also record an outer watchdog:
`focused-arity.json`, `runtime.json`, `reactor.json` and `host-nat.json`
record 30000 ms, and `control-run.json` records 120000 ms. The captures
`house.json`, `trusted-lines.json`, the three `syntax-*.json` files and
`diff-check.json` record no watchdog, and the summary `controls.json` has no
watchdog field. The positive control and the twelve defect captures bound
each variant to 20 seconds. The compiled harness adds one test block and
retains its existing per-child bounds.

The predecessor inode record reports 251 runtime tests and 2672 reactor
checks, so this slice adds eight tests and 219 checks. The focused pattern
`filesystem type|request arities` covers seven type tests, the argument-count
parent test and its 43 operation rows.

The ignored compiler `_build/default/bin/kanon.exe` was reused. Its SHA-256
in `results.json` is the same hash that the predecessor inode record pins.
The compiler source check is the staged diff of the base: no compiler source
is staged, and `source_sha256` pins no compiler source row. `results.json`
pins the compiler binary, runtime sources, test harnesses including HOST-NAT,
fixture inputs and captures. Gate scripts and thresholds did not change. The
full compiler and milestone ladder was not rerun; the results establish the
scoped checks above.

Both native harnesses compare the response with the actual host query's
type identifier. The compiled observer also checks the literal path,
bigint options and exactly one call. Injected metadata checks zero, negative
and large values independently of native host values. These are formatting
checks, not claims that a particular OS reports every endpoint.

To reproduce the defect controls from this checkout, run the command that
`control-run.json` captures:

```sh
python3 -I dev/validation/2026-09-15-filesystem-type/reproduce-controls.py \
  --output <fresh dir>
```

The author machine also has the local wrappers `kanon-wait` and `kanon-exec`,
which add a budget and an outer timeout. This repository does not ship those
wrappers, and the reproduction does not need them.

Choose a fresh output directory. The reproducer writes isolated temporary
runtime variants and runs the same seven tests against each. A defect
control counts only when the tests fail assertions; timeouts, skipped tests
and cancellations fail the reproducer. The unmodified runtime must pass
all seven tests. `controls.json` records each mutation and capture hash.

## Review 2026-09-15

Close ladder run 15:1x, start load1 9.17, end load1 10.65.
LADDER-EXIT 0, every named leg PASS, no FAIL row. The check loop closed
under an empty waiver: no leg needed a load waiver. The full log is pinned
at `gates-review.log`.

Numbers read from that log: TRUSTED-LINES kernel=5246/5250
encoder=246/600 OK. RUNTIME `# pass 259 of 259`, `# fail 0`,
RUNTIME-EXIT 0. HOST-NAT 16/16, HOST-NAT-EXIT 0.
`reactor: 2891 checks passed`, REACTOR-EXIT 0.

This review recomputed the stale source_sha256 rows from the fixed, staged
bytes. It added the new capture_sha256 row
`dev/validation/2026-09-15-filesystem-type/gates-review.log`, pinning
that log. It then recomputed the source_sha256 row of this README last,
since the section you are reading changed the README's own bytes.
