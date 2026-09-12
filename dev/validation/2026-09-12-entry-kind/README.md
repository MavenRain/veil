# Entry kind validation, 2026-09-12

Base: `0c9cf1e21407f0391c8a932f3cecc279bbf8046c`.
Environment: macOS, Node.js v23.10.0. Windows was not exercised.

| Check | Result |
| --- | --- |
| Full runtime suite | 89 passed, 0 failed, 0 skipped |
| Compiled reactor suite | 390 checks passed |
| House conventions | HOUSE OK |
| Trusted lines | Kernel 5246/5250, encoder 246/600 |
| Base runtime with new focused tests | Rejected, operation 23 is unknown |
| Follow final symlinks control | Rejected, file returned where symlink was required |
| Omit operation 23 arity control | Rejected, surplus argument accepted |

Both full suites completed within their existing 30-second watchdogs. The
new fixture compiles through the normal CLI and produces a module with zero
imports. It exercises files, directories, links, a character device, relative
and Unicode paths, missing paths and malformed request arities.

`results.json` records exit statuses, platform details, hashes of the source and
copied captures, and the compiler hash. Each named capture is a JSON object
containing the exact argv, working directory, exit status and complete
stdout/stderr, so the capture file is the record of the command. The `command`
number of a capture entry is a position inside the external artifact directory
of that run, which this record does not resolve. The base-runtime check uses the new runtime tests against the
unchanged runtime from the base commit. Its six failures include the enclosing
arity test and its failing entry-kind subtest; four behavioral tests fail, while
the undecodable-path test already passes.

`controls.json` records the exact single-line replacements applied to isolated
copies of the tested runtime and their resulting hashes. Both controls run the
new entry-kind tests plus the full request-arity matrix. Each control copy reuses
the staged `dev/runtime-test.mjs`, whose hash `results.json` records; `controls.json`
pins the mutated runtime hash only, not the copied test file. The working
implementation was not changed by these control runs.

This slice stages no compiler source, no gate script and no threshold change,
which the staged path list shows. Gate-script hashes are outside this record.
The existing
compiler matches the executable hash in the preceding
[directory-listing validation](../2026-09-11-directory-listing/results.json).
The runtime, compiled reactor, house and trusted-line checks were run; the full
milestone and performance gate ladder was not rerun.

## Review 2026-09-12

The slice review closed after two fix rounds. The review kept four low
findings, C-1, C-2, C-3 and C-4, and all four are corrected in prose. The
review refuted one finding and dropped it. The item GATE-1 stays not fixed.

The final gate ladder is `gates-review.log`, tag fix-2, from 01:55:21 to
01:57:23. The ladder shows 26 PASS rows and 2 FAIL rows, that is 26 of 28.
The check loop closed with no waiver text from the dispatcher. The two red
legs are compiler benchmark legs:

- `FAIL M0-TIME median_ms=282.632 bound_ms=150 load1=19.086 samples=3x5`
- `FAIL M0-RATIO kanon_ms=38.078 kanon_lines=1000 tot_ms=103.662
  tot_lines=8138 ratio=2.989319 bound=2.000 load1=19.086`

These two legs time the compiler binary, and this slice stages no compiler,
no kernel and no gate source. M0-RATIO was also red in the baseline ladder
at ratio 8.588777. The recorded `load1` of the two legs is 19.086, which is
below the waiver threshold of 25, but the machine load average was 22.21 at
the start of the run and 18.01 at the end. The RUNTIME 89 of 89 line, the
five new entry kind tests, the reactor 390 line and HOST-NAT 16/16 are
never waived by load, and all of them are green in this log.

Numbers after the review, read from `gates-review.log`:

- `TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK`
- RUNTIME `# pass 89`, `# fail 0`, RUNTIME-EXIT 0
- `HOST-NAT 16/16`, HOST-NAT-EXIT 0
- `reactor: 390 checks passed`, REACTOR-EXIT 0
- `PASS HOST programs=3 zk-instance=10/10`, HOST-EXIT 0
- Ladder tail: `GATES-FAIL`, `LADDER-EXIT 1`,
  `RUN end=01:57:23 load=18.01 20.81 25.77`

The sections above this one describe the scoped checks that were recorded
before the review: the runtime suite with 89 of 89 tests and no skips, the
five new tests plus the arity test failing against the HEAD runtime in
`runtime-before` with 23 of 29 passing, the reactor suite with 390 checks,
trusted lines with kernel 5246/5250 and encoder 246/600, and the five house
checks OK.

The review recomputed one `source_sha256` entry of `results.json`,
`dev/ENTRY-KIND.md`, because the review appended its log block to that
file. All other hashes, the seven capture files and `controls.json` stay
unchanged.

The closing ladder ran on 2026-09-12 from 02:08:28 to 02:16:01, at load1
82.92 at the start and 95.34 at the end. The verdict is GREEN-WAIVED. Three
compiler timing legs are red:
`FAIL M0-TIME median_ms=941.500 bound_ms=150 load1=45.504 samples=3x5`,
`FAIL M0-RATIO kanon_ms=118.938 kanon_lines=1000 tot_ms=103.662
tot_lines=8138 ratio=9.337245 bound=2.000 load1=45.504` and
`FAIL M1-CORPUS elapsed_ms=2104.733 bound_ms=713 lines=1000 main=814
load1=46.534`. All other legs passed, with RUNTIME 89 of 89,
`reactor: 390 checks passed`, HOST-NAT 16/16 and TRUSTED-LINES kernel
5246/5250. The compiler binary is unchanged (sha256 ba114dff...4ed0, the
baseline binary), so the timing legs measure host load, not this slice.
