# File allocation validation, 2026-09-14

Base: `07ebd5c25ea469d1109608d679f4cd95440040b9`.
Working copy: `/Users/oobi/Documents/gpt3/veil-allocation`.
The compiler was copied from the primary Veil checkout after its SHA-256
matched the preceding ownership validation record. Compiler sources and
gate definitions match the base; no rebuild was needed.

| Check | Result | Capture |
| --- | --- | --- |
| Allocation plus shared argument counts | 49/49 | `focused-arity.json` |
| Full runtime through `kanoncho` | 235 passed | `runtime.json` |
| Compiled allocation block | 158 checks | `compiled-allocation.json` |
| Full compiled reactor attempts | Incomplete; see below | `reactor-timeout.json`, `reactor-watchdog.json` |
| HOST-NAT | 16/16 | `host-nat.json` |
| JavaScript syntax | Three files and scoped runner passed | `syntax-*.json` |
| HOUSE | Passed | `house.json` |
| TRUSTED-LINES | Kernel 5246/5250, encoder 246/600 | `trusted-lines.json` |
| Tracked whitespace | Passed | `diff-check.json` |
| Positive control | 8/8 | `positive.json` |
| Defect controls | All 16 rejected by assertions | `controls.json`, `control-run.json`, individual captures |
| Output guard | Directory, file and dangling symlink preserved | `output-guard.json` |

The first full compiled run exited 1 when an existing file-change case
hit the unchanged 20-second Node child timeout, before the allocation
block. The second reached the 120-second outer watchdog and exited 124
without output. Host load was high during these attempts. The scoped
runner extracts the exact allocation block and its helpers from
`dev/reactor-test.mjs`, preserving the 20-second child time limit. It builds
the new fixture and exercises the compiled ABI and real host paths. Its
158 checks establish the new block's result; they do not establish a full
REACTOR or the separate 30-second gate pass. No timing waiver is claimed.

Each command capture records its argv, working directory, exit status,
complete stdout and stderr, their hashes, and any outer watchdog. The
focused, runtime, compiled, HOST-NAT, output-guard and control-reproducer
commands use 120-second outer watchdogs. Each mutation's Node process has
a 20-second timeout. All 17 control runs completed without timeouts, skips
or cancellations. Only the unchanged runtime passed. `control-run.json`
holds the single transcript of the sweep, with one result line for each run.

The `output-guard.json` capture ran a copy of the checker that was stored
outside the working copy, at
`/Users/oobi/Documents/gpt3/veil-allocation-output-check.py`. That copy was
byte-identical to the pinned
`dev/validation/2026-09-14-file-allocation/check-output.py`, SHA-256
`344493b62381b7814dad74e3d2c356c90ba56e47c7b93e57cf724535c7356d92`. The
review of 2026-09-15 then changed the pinned checker: it now finds its
repository root and its reproducer from its own path, it accepts an
optional output directory, and it stops when the reproducer is absent.
The frozen capture therefore records a run of the text before that change.
To rerun the guard from this checkout:

```sh
python3 -I dev/validation/2026-09-14-file-allocation/check-output.py
```

`results.json` pins changed source and documentation, supporting runtime
files, reactor fixtures, both reproducers, the output-guard checker, the
compiler and gate scripts. It also pins the captures, excluding itself.
This README is included in the source hashes. Source or test edits require
rerunning affected checks and refreshing their captures and hashes.
Prose-only edits require refreshing that file's hash. The compiler is an
untracked, reused artifact. Explicit compiler arguments in the captures
must be adjusted when rerunning from another checkout.

To rerun the compiled allocation block:

```sh
kanon-wait run -- kanon-exec run --budget 4000 --timeout 120000 -- node dev/validation/2026-09-14-file-allocation/run-compiled.mjs
```

To reproduce all controls from this checkout:

```sh
kanon-wait run -- kanon-exec run --budget 4000 --timeout 120000 -- python3 -I dev/validation/2026-09-14-file-allocation/reproduce-controls.py --output /tmp/veil-allocation-controls-new
```

The output path must be new. The reproducer makes an isolated temporary
copy and tests the unchanged runtime, base runtime and 15 single-defect
variants. `reproduce-controls.py` contains each exact mutation. It leaves
the source checkout unchanged and refuses to overwrite existing output.
Captures include temporary paths and timings, so rerun hashes differ.
Native allocation policy can change how many assertions a defect fails,
especially `reject-zero`; every defect must still exit 1 with an assertion.

Native tests ran on macOS. Large integer endpoints and explicit zero pairs
also use injected metadata. Native comparisons do not assume allocation
units, sparse-file savings or monotonic growth. Windows was not exercised.
Compiler sources, gate definitions and prior validation records match the
base. The full compiler and milestone ladder was not rerun.

## Review 2026-09-15

Close ladder run 01:1x, start load1 11.63, end load1 17.76. LADDER-EXIT 0,
27 of 27 named legs PASS, no FAIL row. The check loop closed under an
empty waiver: no leg needed a load waiver. The full log is pinned at
`gates-review.log`.

Numbers read from that log: TRUSTED-LINES kernel=5246/5250
encoder=246/600 OK. RUNTIME `# pass 235`, `# fail 0`, RUNTIME-EXIT 0.
HOST-NAT 16/16, HOST-NAT-EXIT 0. `reactor: 2276 checks passed`,
REACTOR-EXIT 0. HOST PASS programs=3 zk-instance=10/10, HOST-EXIT 0.

The sections above this one describe the scoped checks recorded before
this review: runtime 235 of 235, focused 8 of 8 under the pattern
`^file allocation`, reactor 2276 checks, trusted lines kernel 5246/5250
and encoder 246/600, house six checks OK, `git diff --check` clean.

This review recomputed the source_sha256 rows of
`dev/validation/2026-09-14-file-allocation/check-output.py`, `REACTOR.md`
and `dev/FILE-ALLOCATION.md` from their fixed, staged bytes. It added the
new capture_sha256 row `gates-review.log`, pinning that log. It then
recomputed the source_sha256 row of this README last, since the section
you are reading changed the README's own bytes.
