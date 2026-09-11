# Request traversal validation, 2026-09-11

Base: `5af55b7`, `Validate list ABI predicates in the reactor`.
The implementation and validation checkout is
`/Users/oobi/Documents/gpt3/veil-numeric-abi`.

`runtime-before` runs the six new traversal tests with the base runtime and
the final test file. Five tests fail: the three cycle regions, the surplus
node rejection and the shared argument budget. The valid shared-list control
passes. Test guards stop the baseline loops deterministically.

`runtime-targeted` runs those same six tests with the bounded decoder: all
six pass. `reactor` uses the unchanged compiler executable from the primary
checkout and passes 131 checks, including three compiled cyclic-list modes
and a valid binary-output control.

`gates` builds the validation checkout and runs the full gate battery. It
passes 25 of 27 legs, including RUNTIME, REACTOR, HOST, HOST-NAT, the compiler
suites and the trusted-line check. The compiler binary is byte-identical to
the primary checkout's compiler.

`gates.stdout` gives one verdict line for each leg. It gives no test count and
no line count. Two commands print those numbers directly. Run
`node --test --test-reporter=tap dev/runtime-test.mjs` for the full runtime
suite, which reports `# tests 59`, `# pass 59` and `# fail 0`. Run
`zsh dev/trusted-lines.sh` for the trusted kernel, which reports
`TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK`.

The full battery exits 1 with `GATES-FAIL` because two timing gates exceed
their unchanged thresholds:

- M0-TIME: 153.194 ms against 150 ms, load1 24.042.
- M1-CORPUS: 801.682 ms against 713 ms, load1 24.539.

These are retained failures, not a claim that the complete battery passed.
No compiler sources or gate thresholds changed in this slice.

Each check has retained stdout and stderr. Trailing whitespace is removed
from capture lines so the evidence passes Git's whitespace check. The
original capture manifests, command arguments, exit statuses, source hashes,
baseline runtime and test hashes, and both compiler hashes are recorded in
`results.json`. The baseline test hash equals the final test hash.

Run the commands in `dev/REQUEST-BOUNDS.md` to reproduce the fixed checks.
For the baseline, place the base commit's `runtime/reactor.mjs` and
`runtime/run.mjs` beside the final `dev/runtime-test.mjs` in a scratch tree,
then run the same targeted test command from that tree.

## Review 2026-09-11

The review closed with no waiver. The review kept three findings, and one fix
round fixed all three: B-1 (medium, `dev/runtime-test.mjs`), C-1 (low, this
file) and C-2 (low, `dev/LIST-ABI.md`). The review refuted no finding and
dropped no finding.

The closing gate run is `gates-review.log` in this directory (tag `fix-1`,
03:39:38 to 03:41:08). It passes 25 of 27 ladder legs. The run reports:

- `TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK`
- `# pass 59` with `# fail 0` for the runtime suite
- `HOST-NAT 16/16`
- `reactor: 131 checks passed`
- `PASS HOST programs=3 zk-instance=10/10`

Two legs are red, and both are timing legs:

- `FAIL M0-TIME median_ms=167.857 bound_ms=150 load1=19.203 samples=3x5`
- `FAIL M0-RATIO kanon_ms=26.317 kanon_lines=1000 tot_ms=103.662
  tot_lines=8138 ratio=2.066020 bound=2.000 load1=19.203`

The sections above describe the scoped checks recorded before the review:
runtime-before passes 1 of 6 tests with the five request traversal failures,
runtime-targeted passes 6 of 6, reactor passes 131 checks, and gates passes 25
PASS legs with the two retained timing failures M0-TIME and M1-CORPUS.

The fixes changed two of the sources that `results.json` lists under `sha256`.
The closer recomputed these two entries from the staged bytes:
`dev/runtime-test.mjs` and `dev/REQUEST-BOUNDS.md`. All other fields of
`results.json` and all eight capture files stay byte-identical.
