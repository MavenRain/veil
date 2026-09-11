# Temporary-directory validation, 2026-09-11

Base: `e0a1f7b351c7e5a7b385825fdc15dfbf05d0741d`.

| Check | Result |
| --- | --- |
| New runtime tests against the original runtime | Both fail: wrong parent for an empty prefix and successful `../escape-` traversal. |
| RUNTIME, existing 30-second watchdog | 65 tests passed, zero failures, cancellations or skips. |
| REACTOR, existing 30-second watchdog | 227 checks passed. |
| HOUSE | Passed. |
| TRUSTED-LINES | Kernel 5246/5250, encoder 246/600, passed. |

The failed control uses an unchanged copy of the base runtime and an exact
copy of the final runtime test source. Only the two new tests run in that
control. Its command is `node --test --test-reporter=tap --test-name-pattern
'temporary directories' .gatework/temp-directory-before/dev/runtime-test.mjs`.
The test copies sit under a separate `dev` and `runtime` pair so the relative
module import loads the original runtime. Both directories are untracked
scratch material; the complete failed output is retained here.

The first compiled-suite attempt failed because its expected relative-root
path used the macOS `/var` alias while the spawned process resolved its
working directory through `/private/var`. The assertion now derives the
expected root from `realpathSync(scratch)`. `reactor-first.stderr` retains
that test failure; `reactor.stdout` records the successful rerun. Production
code did not change between those attempts.

`runtime.stdout`, `reactor.stdout`, `house.stdout` and `trusted-lines.stdout`
are the complete final command outputs, with corresponding stderr files.
Commands and coverage are described in [TEMP-DIRECTORY.md](../../TEMP-DIRECTORY.md).
`results.json` records the tested source hashes, original runtime hash,
compiler executable hash, capture hashes and local source artifact IDs.
Source and documentation whitespace checks pass. Four blank lines in the
failed TAP capture retain the test runner's trailing spaces unchanged.

The existing compiler executable was copied from the base checkout and used
to compile the new fixture. No compiler, kernel, encoder, Lean, gate source
or threshold changed. This runtime slice did not repeat the full milestone,
Lean or performance battery, and does not ratify M1 exit. Validation ran on
macOS with Node.js v23.10.0; Windows execution was not tested.

## Review 2026-09-11

The sections above describe the scoped checks that were recorded before the
review: runtime 65 of 65, the two new tests failing with 2 not ok against the
HEAD runtime in `runtime-before`, reactor 227 checks, trusted lines kernel
5246/5250 and encoder 246/600, and house five checks OK.

The close ladder is `gates-review.log`, a byte-identical copy of the close
run. It gives 26 PASS rows and 1 FAIL row. The one red leg is
`FAIL M0-TIME median_ms=167.312 bound_ms=150 load1=29.097 samples=3x5`. That
leg is a timing leg. The waiver is load-bound, because load1 29.097 is above
25. These leg lines of the same run are green:

```
PASS TRUSTED-LINES
# pass 65
# fail 0
HOST-NAT 16/16
reactor: 227 checks passed
PASS HOST programs=3 zk-instance=10/10
```

The review kept three findings and fixed them all in round 1 as prose. C-1
corrects the root resolution prose to lexical normalization. D-1 drops the
`kanon-wait` and `kanon-exec` wrapper from the three reproduction commands.
A-1 limits the rejection sentence and records the root that a rejected prefix
leaves behind. Two items became rulings. B-1 is not fixed, because the only
repair edits a test file that this validation record hashes. GATE-1 is ruled
load-bound. B-2 was merged into A-1. Nothing was refuted.

The round ladders `gates-fix-1.log` and `gates-fix-2.log` went red only on
timing legs and on watchdog exits 124, at load1 69 to 78, while their
standalone sections reported 65 of 65, 227 checks and 16 of 16. The close
ladder replaces them.

No entry of `results.json` changed, because the fixes edited only
`REACTOR.md` and `dev/TEMP-DIRECTORY.md`.
