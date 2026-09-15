# Filesystem capacity validation, 2026-09-15

Base: `552f567add8a7b66db1dd62615b98e7c9576d4f6`.
Working copy: `/Users/oobi/Documents/gpt3/veil-filesystem-capacity`.
The compiler was copied from the primary Veil checkout after its SHA-256
matched the preceding allocation validation record. Compiler sources and
gate definitions match the base; no compiler rebuild was needed.

| Check | Result | Capture |
| --- | --- | --- |
| Capacity plus shared argument counts | 49/49 | `focused-arity.json` |
| Full runtime through `kanoncho` | 243 passed | `runtime.json` |
| Full compiled reactor | 2453 checks | `reactor.json` |
| HOST-NAT | 16/16 | `host-nat.json` |
| JavaScript syntax | Three files passed | `syntax-*.json` |
| HOUSE | Passed | `house.json` |
| TRUSTED-LINES | Kernel 5246/5250, encoder 246/600 | `trusted-lines.json` |
| Tracked whitespace | Passed | `diff-check.json` |
| Positive control | 7/7 | `positive.json` |
| Defect controls | All 16 rejected by assertions | `controls.json`, `control-run.json`, individual captures |

The compiled suite adds 177 checks to the preceding slice's 2276. Its full
run passed under a 120-second outer watchdog. This direct run does not
establish the separate 30-second gate verdict. The full compiler and
milestone ladder was not rerun. Gate definitions and compiler sources keep
their base hashes; no timing waiver is claimed.

Each capture records its command, working directory, exit status, complete
stdout and stderr, their hashes and the applicable outer watchdog. The
focused, runtime, reactor, HOST-NAT and control sweep commands have
120-second outer watchdogs. The compiled suite retains its 20-second Node
child timeout. Each control process has a 20-second timeout. All controls
completed without timeouts, skips or cancellations.

`results.json` pins the changed source, fixture and documentation, supporting
runtime files, the compiler, gate scripts and this README. It also pins all
captures and the control reproducer. Source or test edits require rerunning
affected checks and refreshing hashes. Prose edits require refreshing the
corresponding hash. The reused compiler is an untracked artifact. Captured
working-directory and compiler paths need adjustment in another checkout.

To reproduce the focused checks:

```sh
kanon-wait run -- kanon-exec run --budget 4000 --timeout 120000 -- node --test --test-name-pattern '^(filesystem capacity|request arities)' dev/runtime-test.mjs
```

To reproduce the full runtime and compiled checks:

```sh
kanon-wait run -- kanon-exec run --budget 4000 --timeout 120000 -- kanoncho test dev/runtime-test.mjs
kanon-wait run -- kanon-exec run --budget 4000 --timeout 120000 -- node dev/reactor-test.mjs _build/default/bin/kanon.exe
```

To reproduce the controls:

```sh
kanon-wait run -- kanon-exec run --budget 4000 --timeout 120000 -- python3 -I dev/validation/2026-09-15-filesystem-capacity/reproduce-controls.py --output /tmp/veil-capacity-controls-new
```

The output directory must be new. The reproducer makes an isolated temporary
copy, tests the unchanged runtime and 16 single-defect variants, then removes
the temporary copy. `controls.json` records the exact replacements and pins
each capture. The mutations omit the operation or arity, swap free and
available blocks, substitute each field, round each field through Number,
omit bigint options, normalize the path, repeat statfs, read file contents
or reject zero capacity. Only the unchanged runtime passes. Native values
can affect assertion counts, but each variant must exit 1 with an assertion
failure. Rerun capture hashes differ because of paths and timings.

Native tests ran on macOS with Node v23.10.0. Runtime tests observe the exact
native statfs call, avoiding comparisons between separate free-space
snapshots. The validation host reports `bfree` equal to `bavail`, thus the
native rows cannot separate the third field from the fourth field. The
injected-field test separates them. Zero, signed and large endpoints also
use injected fields.
Compiled native runs check shape and block size; injected answers check the
compiled state machine's byte forwarding. Windows was not exercised.

## Review 2026-09-15

The review kept four low findings and carried one low finding for a user
ruling. D-2 rewrapped three prose lines to 80 columns or fewer. C-1 fixed
the field guarantee to name real `fs.StatFs` fields and stated that
`frsize` is a POSIX statvfs field the controls inject. C-2 added the
disclosure above this section: the validation host reports `bfree` equal
to `bavail`, so native rows cannot separate the third field from the
fourth field, and the injected-field test separates them. D-1 added a
per-operation contract paragraph for operation 41 to REACTOR.md. B-1 is
CARRIED: the compiled native rows pin only `bsize`, and the repair would
move the frozen reactor check count, so it needs a user ruling. The link
count record (operation 38) carried its B-1 for the same reason. The
check loop closed in one round.

The sections above describe the scoped checks recorded before the review:
runtime 243 of 243, focused 7 of 7 under the pattern
`^filesystem capacity`, reactor 2453 checks, trusted lines kernel
5246/5250 and encoder 246/600, house six checks OK, and `git diff --check`
clean.

The close ladder ran at 07:0x (start=07:06:49, load1 11.77 at start and
15.47 at end) and is recorded at `gates-review.log`, pinned as a new
capture_sha256 row so every file in this directory stays pinned. It reads
TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK, RUNTIME `# pass 243`
`# fail 0` RUNTIME-EXIT 0, HOST-NAT 16/16, `reactor: 2453 checks passed`
REACTOR-EXIT 0, PASS HOST programs=3 zk-instance=10/10, GATES-OK and
LADDER-EXIT 0 with 28 PASS legs and no FAIL leg. The timing legs read
PASS M0-TIME median_ms=116.440 bound_ms=150 load1=10.522, PASS M0-RATIO
ratio=1.339298 bound=2.000 load1=10.522 and PASS M1-CORPUS
elapsed_ms=227.120 bound_ms=713 load1=10.400, so no waiver was needed. An
earlier close ladder, started at 06:18:39 at load1 64.83, ended
LADDER-EXIT 1 on three timing legs only and was not filed. The
source_sha256 rows recomputed after this review are
dev/FILESYSTEM-CAPACITY.md, REACTOR.md and dev/REACTOR-BUILD-LOG.md, plus
the capture_sha256 row for this file (README.md), refreshed last, and the
new capture_sha256 row for gates-review.log.
