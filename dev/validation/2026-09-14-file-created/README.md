# Creation time validation, 2026-09-14

Base: `9654b0de0b07669b4950fef5fe225254e24520a4`.
Work directory: `/Users/oobi/Documents/gpt3/veil-created`.
The existing compiler was reused after matching the preceding record's
SHA-256. `results.json` pins the compiler, changed sources, validation
scripts and retained captures. `_build/default/bin/kanon.exe` is an
untracked build artifact, so its row pins the reused binary on disk. That
row is matched against the preceding record, not against a Git object. The
other 16 `source_sha256` rows name tracked files. No compiler or gate
definitions changed.

Results:

- `focused.json`: 8/8 creation-time runtime tests passed.
- `runtime.json`: 199/199 runtime tests passed, with no cancellations or skips.
- `reactor.json`: 1631 compiled reactor checks passed under a 120-second
  watchdog, including 162 new creation-time checks.
- `host-nat.json`: 16/16 host natural-number checks passed.
- Syntax checks, HOUSE, TRUSTED-LINES and tracked whitespace checks passed.
  Kernel size remains 5246/5250 lines; encoder size remains 246/600.
- `controls.json` and the individual control captures record all 12
  deliberate defects failing their targeted tests.

The first compiled test run caught a scratch filename shared with the
directory-creation fixture. The new timestamp fixture now uses distinct
names; the retained successful reactor capture is from the corrected source.
The direct harness run does not establish a 30-second gate verdict. The full
compiler and milestone ladder was not rerun; no timing waiver is claimed.
Native tests ran on macOS with Node v23.10.0. Fallback fields and signed
endpoints use injected metadata, without claiming native support for those
values or cross-platform creation-time behavior.

Run these commands from the repository root with its built compiler:

```sh
node --test --test-reporter=tap --test-name-pattern '^file created' dev/runtime-test.mjs
node --test --test-reporter=tap dev/runtime-test.mjs
node dev/reactor-test.mjs _build/default/bin/kanon.exe
node dev/host-nat-test.mjs
node --check runtime/reactor.mjs
node --check dev/runtime-test.mjs
node --check dev/reactor-test.mjs
zsh dev/house.sh .
zsh dev/trusted-lines.sh .
git diff --check
python3 -I dev/validation/2026-09-14-file-created/reproduce-controls.py --output /tmp/veil-created-controls-fresh
```

The `git diff --check` capture ran with these changes unstaged in the work
directory, so the command examined the added lines. A reader who stages the
changes first must run `git diff --cached --check` to inspect the same
lines, because `git diff --check` then reports nothing.

The control output directory must be absent. The reproducer uses temporary
copies and preserves the repository and recorded evidence. Each positive
capture includes the command, working directory, stdout, stderr and exit
status. `results.json` contains their hashes and links the evidence to the
tested source. Local runs used `kanon-wait` and `kanon-exec` for bounded
output and full capture retention.

## Review 2026-09-14

The closer ran the full gate ladder after the fix rounds. The ladder
ended GATES-FAIL, LADDER-EXIT 1. Four rows failed: FAIL M0-TIME
median_ms=348.040 bound_ms=150 load1=41.252; FAIL M0-RATIO
ratio=2.821946 bound=2.000 load1=41.252; FAIL M1-CORPUS
elapsed_ms=1054.815 bound_ms=713 load1=39.202; FAIL REACTOR, MEASURE
REACTOR tier=MED elapsed_ms=30025.500 exit=124. The three timing rows
carry load1 above thirty, the waiver threshold. The REACTOR ladder row
failed the thirty-second watchdog at high load; the standalone REACTOR
section of the same log passed, REACTOR-EXIT 0 with reactor: 1631 checks
passed, so that row is a load artifact, not a defect. No other row
failed.

Numbers after the review, read from the close log: TRUSTED-LINES
kernel=5246/5250 encoder=246/600 OK. RUNTIME # pass 199, # fail 0,
RUNTIME-EXIT 0. HOST-NAT 16/16, HOST-NAT-EXIT 0. reactor: 1631 checks
passed, REACTOR-EXIT 0. HOST: PASS HOST programs=3 zk-instance=10/10,
HOST-EXIT 0.

The sections above describe the scoped checks recorded before this
review: runtime 199 of 199, focused 8 of 8 under the pattern
^file created, reactor 1631 checks, trusted lines kernel 5246/5250 and
encoder 246/600, house six checks OK, git diff --check clean.

The check loop closed under no named waiver. This review refreshed the
source_sha256 rows of REACTOR.md and dev/FILE-CREATED.md, and the
capture_sha256 row README.md, from the staged bytes after this section
was appended.
