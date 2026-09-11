# Blob release validation, 2026-09-11

Base: `d169af3bd8a1dec8e551c564cba4561db1cbd4a1`.

- `before.stdout`: all three new release tests fail against the previous
  runtime, which answers `IO: unknown OS request 18`. Produced with
  `runtime/reactor.mjs` restored from d169af3
  (`git show d169af3:runtime/reactor.mjs`) over the staged
  `dev/runtime-test.mjs`; the staged runtime was restored before the other
  captures.
- `focused.stdout`: 26 tests pass, including release, request arity,
  overlapping and sequential stores, and joint computation.
- `compiled.stdout`: 38 checks pass using the release block from
  `dev/reactor-test.mjs`, compiled from the retained Kanon fixture and run
  through the real CLI. The original capture command and scratch driver
  location are recorded in `results.json`; the full suite runs these same
  checks with `node dev/reactor-test.mjs _build/default/bin/kanon.exe`.
- `mutant-reuse.stdout`: replacing the next index with live map size plus
  one causes two release tests to fail.
- `mutant-retain.stdout`: replacing deletion with a membership check
  causes two release tests to fail.
- `house.stdout`: the house checks pass after adding the validation files.
- `runtime-first.stdout`: the full runtime suite completed with two
  failures in existing process signal tests, both missing child marker
  files. The new release tests and overlapping-store tests passed.
- `gates.stdout`: 21 of 27 legs pass. M0-TIME reports 1952.378 ms against
  150 ms at load1 116.691. M0-RATIO reports 7.480362 against 2.000 at load1
  111.510. M1-CORPUS reports 3089.336 ms against 713 ms at load1 98.787.
  AGREEMENT, REACTOR and RUNTIME hit their gate time limits. RUNTIME also
  records missing child marker files in the same two signal tests.

The complete failing output is retained. No timing bound or test timeout
was changed, and this is not a green full-ladder result. The focused tests
establish the new request behavior; a quieter full-ladder run remains useful.
The new safe-integer exhaustion guard was inspected in source; these tests
do not simulate 9007199254740991 allocations.

`results.json` records command arguments, exit statuses, source hashes and
capture hashes. Every stdout file has its corresponding stderr capture.
Trailing spaces and tabs at line ends are removed for Git whitespace checks.
Original captures remain at the recorded artifact paths with their raw hashes.
No compiler, kernel or Wasm emitter source changed in this slice.

## Review 2026-09-11

The review fixed four findings: D-1 (REACTOR.md row count), C-2 (before
capture provenance in this README), C-1 (arity range in
dev/REQUEST-ARITY.md) and ND-1-1 (row count in dev/REQUEST-ARITY.md).
Round 1 fixed D-1, C-2 and C-1. Round 2 fixed ND-1-1. A-1 was merged into
C-1. No source, test, fixture or capture changed.

`gates-review.log` is the full ladder log of the run after fix round 2.
It records 23 of 27 ladder legs PASS and LADDER-EXIT 1. The numbers after
the review are:

- TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK
- RUNTIME first run `# pass 60`, RUNTIME-RERUN `# pass 61`; the failures
  are the pre-existing signal-timing tests 6, 7 and 9 (first run) and 7
  and 9 (rerun)
- HOST-NAT 16/16
- reactor: 169 checks passed
- PASS HOST programs=3 zk-instance=10/10
- FAIL M0-TIME median_ms=674.387 bound_ms=150 load1=33.575 samples=3x5
- FAIL M0-RATIO kanon_ms=76.649 kanon_lines=1000 tot_ms=103.662
  tot_lines=8138 ratio=6.017341 bound=2.000 load1=33.769
- FAIL M1-CORPUS elapsed_ms=1411.958 bound_ms=713 lines=1000 main=814
  load1=34.220
- FAIL RUNTIME at a one-minute load of 30.75 before the launch and 42.15
  after LADDER-EXIT (ladder section `# pass 62`, `# fail 1`, test 7)

The dispatcher waived each red leg under the load rule after check-2:
every item of the round is fixed, new_defects is empty, and an independent
run of the runtime suite reported `# fail 0`. The kernel bound is
unchanged: TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK.

The sections above describe the scoped checks recorded before the review:
before 0 of 3 with `IO: unknown OS request 18`, runtime-first 61 of 63,
focused 26 of 26, compiled 38 checks, mutant-reuse and mutant-retain 1 of
3 each, gates 21 PASS legs with the six retained failures M0-TIME,
M0-RATIO, M1-CORPUS, AGREEMENT, REACTOR and RUNTIME, house OK.

The closer recomputed these `sha256` entries of `results.json` from the
staged bytes after the fixes: `REACTOR.md`, `dev/BLOB-RELEASE.md` and
`dev/validation/2026-09-11-blob-release/README.md`. The captures,
`raw_sha256`, `mutations` and `base` are unchanged.
