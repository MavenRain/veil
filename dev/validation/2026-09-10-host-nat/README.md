# Host naturals validation, 2026-09-10

## Review 2026-09-10

A slice review of the host naturals work closed on 2026-09-10. The check loop
closed with no waiver. Six findings were kept and all six are fixed: A-1 (high,
`dev/runtime-test.mjs` reads the operation 13 level back through operation 11),
B-1 (medium, the `HOST-NAT` leg compares the two counts of the verdict line),
D-1 (medium, the dead function-valued `args` branch of `slotScript` is gone),
C-1 (low, the `README.md` leg list names twenty-seven legs), C-2 (low, the
reproduce list of `dev/HOST-NAT.md` holds `zsh dev/gates.sh` and
`--leg host-nat`) and D-3 (low, `dev/host-nat-test.mjs` counts with
`filter(...).length`). No finding was ruled. D-2 was merged into C-1 and A-2
was dropped.

The closing gate log is `gates-review.log` in this directory (tag fix-1, start
15:06:26, end 15:09:03). Its ladder gives 24 PASS legs of 27 leg rows and
`GATES-FAIL` with `LADDER-EXIT 1`. The numbers after the review, read from that
log:

- `TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK`
- RUNTIME `# pass 22` (`# fail 4`, `RUNTIME-EXIT 1`), rerun `# pass 23`
  (`# fail 3`, `RUNTIME-RERUN-EXIT 1`); the ladder leg of the same run reports
  `PASS RUNTIME`, and every failed subtest is a pre-existing signal-timing
  subtest.
- `HOST-NAT 16/16` with `HOST-NAT-EXIT 0`; the ladder leg reports
  `PASS HOST-NAT checks=16/16`.
- `PASS HOST programs=3 zk-instance=10/10` with `HOST-EXIT 0`.

Three legs are red, and all three are load-bound timing legs:

- `FAIL M0-TIME median_ms=648.686 bound_ms=150 load1=79.020 samples=3x5`
- `FAIL M0-RATIO kanon_ms=94.438 kanon_lines=1000 tot_ms=103.662
  tot_lines=8138 ratio=7.413869 bound=2.000 load1=79.020`
- `FAIL M1-CORPUS elapsed_ms=769.519 bound_ms=713 lines=1000 main=814
  load1=78.217`

The fixes changed three of the six sources of `source-manifest.json`, so these
sha256 rows were recomputed from the staged bytes: `dev/runtime-test.mjs`,
`dev/gates.sh` and `dev/host-nat-test.mjs`. The three other rows,
`compiler_sha256` and `gates.log` with the four capture logs are unchanged.

The sections above describe the run recorded in
`dev/validation/2026-09-10-host-nat/gates.log` before the review, 25 of 27 legs
at load1 about 72.
