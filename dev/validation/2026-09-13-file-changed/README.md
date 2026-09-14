# Status-change time validation, 2026-09-13

This record covers operation 35 on base
`eb47fa4a4cdc6323af53ac35dd2d94490cdc5ff2`. Validation ran in the isolated
checkout `/Users/oobi/Documents/gpt3/veil-changed` with the compiler copied
from that base's validated checkout and verified by SHA-256. Compiler
sources and gate definitions are unchanged. The executable at
`_build/default/bin/kanon.exe` is untracked; its hash records the reused
artifact, and a fresh checkout must obtain that compiler or build one.

The timestamp and arity selection passed 60/60, the complete runtime suite
passed 190/190, and HOST-NAT passed 16/16. All test counts have zero failures,
cancellations and skips. The compiled reactor suite passed 1469 checks,
116 more than the preceding slice, under a 120-second watchdog. This is a
direct suite result, with no verdict on the separate 30-second reactor gate.
JavaScript syntax, HOUSE, TRUSTED-LINES and tracked whitespace checks passed.
The full compiler and milestone ladder was not rerun; no timing waiver is
claimed. Native tests ran on macOS with Node v23.10.0. Windows and native
pre-epoch status timestamps were not exercised.

`results.json` records source and compiler hashes, capture hashes, platform,
commands and summaries. Each command JSON retains complete stdout and stderr
with byte lengths and hashes. `controls.json` records nine deliberate defects
and pins the runtime and tests used for each control. Each control exited 1
with a failing assertion and zero cancelled or skipped tests. The controls
cover the base runtime, wrong modification or creation timestamp, Number
rounding, final-symlink inspection, missing arity, lexical path normalization,
opening contents and reading contents. `reproduce-controls.py` defines each
mutation and runs it in a fresh temporary copy.

The recorded successful commands, from the checkout root, are:

```sh
node --test --test-reporter=tap --test-name-pattern 'file (changed|accessed|modified)|request arities' dev/runtime-test.mjs
node --test --test-reporter=tap dev/runtime-test.mjs
node dev/reactor-test.mjs _build/default/bin/kanon.exe
node dev/host-nat-test.mjs
python3 -I dev/validation/2026-09-13-file-changed/reproduce-controls.py --output /Users/oobi/Documents/gpt3/veil-changed-controls
node --check runtime/reactor.mjs
node --check dev/runtime-test.mjs
node --check dev/reactor-test.mjs
zsh dev/house.sh .
zsh dev/trusted-lines.sh .
git diff --check
```

Use the installed `kanon-wait` and `kanon-exec` wrappers for captured runs.
To reproduce controls, choose a fresh `--output` directory; the script
refuses an existing one and does not overwrite the recorded evidence.
The captured absolute work and temporary paths identify the original run
and need not exist when reading the saved output.

`results.json` is the manifest and does not hash itself. Its `source_sha256`
map pins final source bytes; its `capture_sha256` map covers every other
file that this run wrote in this directory, including this README and the
control reproducer. The review gate log `gates-review.log` is added after
this run, and it is not pinned.
After a prose-only correction, recompute affected source or capture hashes
from file bytes and retain the original command output. Runtime, fixture,
test or reproducer changes require fresh affected validation and records.
Earlier validation directories remain snapshots of their original sources.

## Review 2026-09-13

The close ladder ran after fix round 1 and passed 28 of 28 legs, with no
red leg. `gates-review.log` records the run: TRUSTED-LINES
kernel=5246/5250 encoder=246/600 OK, RUNTIME `# pass 190`, HOST-NAT
16/16, `reactor: 1469 checks passed`, and PASS HOST programs=3
zk-instance=10/10. Timing legs PASS M0-TIME median_ms=103.865
bound_ms=150 load1=9.914, PASS M0-RATIO ratio=1.284344 bound=2.000 and
PASS M1-CORPUS elapsed_ms=344.723 bound_ms=713 load1=9.914; the check
loop closed under no waiver.

The sections above describe the scoped checks recorded before this
review: runtime 190 of 190, focused 60 of 60 under the pattern
`^file changed`, reactor 1469 checks, trusted lines kernel 5246/5250
and encoder 246/600, house six checks OK, and `git diff --check` clean.

Findings C-1 and D-4 are fixed; finding B-1 is carried for a user
ruling. This review edited three files: `dev/validation/2026-09-13-file-changed/README.md`
(finding C-1, this record's own `capture_sha256` row), `REACTOR.md`
(finding D-4, a `source_sha256` row) and `dev/FILE-CHANGED.md` (the
review block below, a `source_sha256` row). The closer refreshed the
`source_sha256` rows `REACTOR.md` and `dev/FILE-CHANGED.md`, then
refreshed the `capture_sha256` row `README.md` last, from the staged
bytes of this file after this section was appended. Every other
`source_sha256` and `capture_sha256` row, among them `runtime/reactor.mjs`,
`dev/runtime-test.mjs`, `dev/reactor-test.mjs`,
`test/fixtures/reactor/file-changed.kan` and `dev/REACTOR-BUILD-LOG.md`,
stays byte-identical because this review did not edit those files.
