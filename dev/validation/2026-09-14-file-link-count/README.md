# File link count validation, 2026-09-14

Base: `be5e76e9f9d960d018d04571ccdc3c409127defe` (operation 37).
Validation ran in `/Users/oobi/Documents/gpt3/veil-link-count` on macOS.
`results.json` records the Node version, platform, source hashes, capture
hashes and scope. These captures precede staging in the canonical repository.

The compiler at `_build/default/bin/kanon.exe` is an untracked build artifact.
Its hash was matched against both the canonical checkout and
`../2026-09-14-file-identity/results.json` before it was copied for reuse.
Compiler sources and gate definitions retain their base hashes.

- `positive.json`: all eight focused link-count tests passed.
- `focused-arity.json`: the link-count and argument-count selection passed
  47/47 with zero failures, cancellations or skips.
- `runtime.json`: `kanoncho test dev/runtime-test.mjs` exited 0 and reported
  `OK test: 217 passed`. This retains the compact wrapper output, without
  the underlying per-test output.
- `reactor.json`: the compiled reactor suite passed 1959 checks under a
  120-second watchdog, 160 checks more than the prior slice. This direct
  run does not establish the separate 30-second gate verdict.
- `host-nat.json`: HOST-NAT passed 16/16.
- Syntax, HOUSE, TRUSTED-LINES and tracked whitespace captures passed.
  Trusted lines remain kernel 5246/5250 and encoder 246/600.
- `control-run.json` and `controls.json`: the positive implementation passes
  and all 12 defect variants fail assertions with exit 1. Every variant
  first passes JavaScript syntax validation. A timeout, skipped test or
  cancellation fails the control runner.

Each capture stores its argv, working directory, exit status and complete
stdout and stderr for that command, with hashes. The compact runtime output
is identified above. The variant captures also pin their runtime and test
bytes. `results.json` pins every other file in this directory, including this
README. Source hashes are under `source_sha256`; record hashes are under
`capture_sha256`. `results.json` excludes itself to avoid a hash cycle.

The validations used these child commands from the validation checkout,
with `kanon-wait run -- kanon-exec run --budget 4000 --` around finite runs.
Focused, runtime, reactor, HOST-NAT and control runs used `--timeout 120000`
before the child-command separator. Static commands used a captured batch.

```sh
node --test --test-name-pattern '^file link count|request arities' dev/runtime-test.mjs
kanoncho test dev/runtime-test.mjs
node dev/reactor-test.mjs _build/default/bin/kanon.exe
node dev/host-nat-test.mjs _build/default/bin/kanon.exe
node --check runtime/reactor.mjs
node --check dev/runtime-test.mjs
node --check dev/reactor-test.mjs
zsh dev/house.sh .
zsh dev/trusted-lines.sh .
git diff --check HEAD
python3 -I dev/validation/2026-09-14-file-link-count/reproduce-controls.py \
  --output /Users/oobi/Documents/gpt3/veil-link-count-controls
```

To reproduce the controls, choose a new `--output` directory. The script
refuses an existing directory, copies the runtime and tests into isolated
directories and selects the eight focused tests. The content-opening and
content-reading variants select only the injected metadata test to avoid
opening a FIFO. All variants use a 15-second watchdog. The base control
reads the runtime from the pinned base commit without changing the checkout.

The other defects replace nlink with ino, round through Number, omit bigint
options, use lstat, normalize paths, return a constant, repeat stat, replace
zero with one, or omit the operation's arity. Each change is limited to
operation 38 or its arity entry. `reproduce-controls.py` defines the exact
replacements and asserts that each anchor occurs once.

Native tests ran on macOS. Zero, large integer endpoints and selected host
errors use injected metadata. Windows and the full compiler and milestone
gate ladder were not exercised. No timing waiver is claimed.

## Review 2026-09-14

A review ran after staging, close run at 18:3x. The check loop closed
without a waiver.

The final gate log, filed as `gates-review.log`, reports these numbers.
TRUSTED-LINES: kernel 5246/5250, encoder 246/600. RUNTIME: 217 of 217
tests passed, zero failed. HOST-NAT: 16/16. The reactor line reads
`reactor: 1959 checks passed`. HOST: programs 3 of 3, zk-instance 10 of
10. No leg failed. The ladder line reads `LADDER-EXIT 0`. Start load1
7.70, end load1 8.03.

The sections above describe the scoped checks recorded before the review:
runtime 217 of 217, focused 8 of 8 under the pattern `^file link count`,
reactor 1959 checks, trusted lines kernel 5246/5250 and encoder 246/600,
house six checks OK, and `git diff --check` clean.

The review kept two findings. D-1 (low) reworded the argument-rejection
sentence in `dev/FILE-LINK-COUNT.md`; the fix is staged and the
`source_sha256` row for that file is refreshed. B-1 (low) is carried for a
user ruling: the repair would edit the sha256-pinned `dev/runtime-test.mjs`,
which this close does not touch.

This close adds `gates-review.log` to this directory and pins it with a
new `capture_sha256` row, so the sentence above that `results.json` pins
every other file in this directory stays true. The close also refreshes
the `source_sha256` row for `dev/FILE-LINK-COUNT.md` and, last, the
`capture_sha256` row for this README, because this record hashes its own
README and this review section is new text in it.
