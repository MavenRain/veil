# Permission inspection validation, 2026-09-13

Base: `27de049e758872ca077215a8ba1e365d68829d72`.
The runtime adds operation 32 and its exact one-argument arity. It returns
the nine ordinary permission bits from `stat` as decimal bytes. See the
[contract and tests](../../FILE-PERMISSIONS.md).

| Check | Result |
| --- | --- |
| Focused `^file permissions` tests | 8 pass, 0 fail, 0 skip |
| Full RUNTIME | 163 pass, 0 fail, 0 skip |
| REACTOR | 1141 checks passed |
| HOST-NAT | 16/16 |
| JavaScript syntax | Runtime and both test harnesses pass |
| HOUSE | Pass |
| TRUSTED-LINES | Kernel 5246/5250, encoder 246/600 |
| Tracked whitespace check | Pass |

The focused tests, full runtime suite, compiled reactor harness and
host-natural harness all passed using the existing 30-second watchdogs.
The runtime adds eight focused tests and one arity subtest to the previous
154 tests. The reactor adds 71 checks to the previous 1070. No gate script
or limit changed, and no timing waiver was needed. No defect controls were
run for this slice. This record holds no `controls.json`, no run against the
base runtime and no capture of a mutated runtime.

The compiler executable was reused with SHA-256
`ba114dff6ab0e6f38753321393c0502c76b4937ff9896989ee962498e94a4ed0`,
matching the preceding file-mode validation record. The
`_build/default/bin/kanon.exe` row hashes a build artifact that the commit
does not track. To repeat that row, rebuild the compiler to the same bytes.
Compiler sources and
runtime Kanon definitions were unchanged. The compiler was not rebuilt, and
the full milestone battery was not rerun. Native permission and link behavior was
exercised on macOS. Windows, ACL interactions and concurrent path replacement
were not exercised. Injected stat failures cover EACCES, EPERM, EIO and an
error without a code separately from native path failures.

Each check's JSON records its command, working directory, exit code,
stream hashes and TAP counts where present. Non-TAP outputs are included
verbatim. Full streams remain at the referenced local capture paths.
`results.json` pins the final source and compiler bytes in `source_sha256`
and every file this run recorded in `capture_sha256`. The review gate log
`gates-review.log` is added after this run, and it is not pinned.
This README is covered by `capture_sha256["README.md"]` only. Recompute
that entry if this file changes.

## Review 2026-09-13

A slice review of operation 32 ran on 2026-09-13. It fixed seven findings in
one round: C-1 medium (the record dropped the mutation controls of the nine
preceding records without a word), A-1 low (the arity matrix coverage
sentence), B-1 low (the sentence "no file contents are opened" had no test
pin), C-2 low (the `capture_sha256` sentence), C-3 low (a `source_sha256` row
this record does not carry), D-1 low (the build-log heading form) and C-4 low
(the compiler row hashes an untracked artifact). A second round carried one
item, GATE-1 high, for a user ruling. That item is a gate verdict and not a
defect of this slice.

The review edited four tracked files: dev/FILE-PERMISSIONS.md,
dev/REACTOR-BUILD-LOG.md, dev/runtime-test.mjs and this README.

Two fix ladders ran. gates-fix-1.log passed every check leg (BUILD, CARRY,
R0-COUNT, R0-AUDIT, SUITE-KERNEL, SUITE-WASM, ENCODER-SUBSET, AXIOMS,
M0-E2E main=521, TRUSTED-LINES, CIRCUIT lines=28, ZK, FHC, MPC, HOST
programs=3 zk-instance=10/10, HOST-NAT checks=16/16, DENOMINATORS, HOUSE,
PIN sha=8cf0b8b, POSITIVITY fixtures=25, M1-SUITE, RUNTIME) and ended
LADDER-EXIT 1 on M0-TIME load1=38.640, M0-RATIO load1=38.108, M1-CORPUS
load1=36.025, AGREEMENT at its 300 second watchdog and REACTOR at its
30 second watchdog. gates-fix-2.log passed every check leg again, with
AGREEMENT cases=7445 and REACTOR-EXIT 0 in the standalone section, and ended
LADDER-EXIT 1 on M0-TIME load1=27.825, M0-RATIO load1=27.825, M1-CORPUS
load1=26.958 and the measured REACTOR leg at exit=124. The load rule applies:
the timing legs M0-TIME, M0-RATIO and M1-CORPUS measure speed on a loaded
machine and are not a finding of this slice, and a watchdog stop is not a
failed check.

The closing ladder gates-close.log ran from 12:32:13 at load 64.45 to
12:36:48 at load 26.89. It passed every check leg (BUILD, CARRY, R0-COUNT,
R0-AUDIT, SUITE-KERNEL, SUITE-WASM, ENCODER-SUBSET, AXIOMS, M0-E2E main=521,
TRUSTED-LINES, CIRCUIT lines=28, ZK, FHC, MPC, HOST programs=3
zk-instance=10/10, HOST-NAT checks=16/16, DENOMINATORS, HOUSE, PIN
sha=8cf0b8b, POSITIVITY fixtures=25, M1-SUITE, AGREEMENT cases=7445,
RUNTIME with RUNTIME-EXIT 0) and ended LADDER-EXIT 1 on M0-TIME
median_ms=386.310 load1=43.368, M0-RATIO ratio=3.454383 load1=43.368,
M1-CORPUS elapsed_ms=1625.496 load1=43.058 and the measured REACTOR leg at
exit=124, while the standalone section of that run prints
`reactor: 1141 checks passed` with REACTOR-EXIT 0. Every red leg ran above
load1 30, so the load rule waives it. This log is kept as
`gates-review.log`.

The `source_sha256` rows for `dev/FILE-PERMISSIONS.md`,
`dev/REACTOR-BUILD-LOG.md` and `dev/runtime-test.mjs` are refreshed to the
reviewed bytes, while the captures keep the pre-review run. The runtime
capture of 163 of 163 was produced before the B-1 test edit, and
`gates-review.log` shows the post-fix run.

The review refreshed the `capture_sha256` row for `README.md` last.
