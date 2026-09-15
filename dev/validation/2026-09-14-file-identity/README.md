# File identity validation, 2026-09-14

Base: `88d6bfe6de844eb8852489ee88f419aebdfb82b8` (operation 36).
Validation ran in `/Users/oobi/Documents/gpt3/veil-identity` on macOS.
`results.json` records the Node version, platform, source hashes, capture
hashes and scope. These captures precede staging in the canonical repository.

The compiler at `_build/default/bin/kanon.exe` is an untracked build artifact.
Its hash was matched against both the canonical checkout and
`../2026-09-14-file-created/results.json` before it was copied for reuse.
Compiler sources and gate definitions retain their base hashes.

- `positive.json`: all eight focused identity tests passed.
- `focused-arity.json`: the identity and arity selection passed 47/47, with
  zero failures, cancellations or skips. Its unanchored selection also runs
  the existing hard-link identity regression.
- `runtime.json`: `kanoncho test dev/runtime-test.mjs` exited 0 and reported
  `OK test: 208 passed`. This capture retains the compact wrapper output;
  it does not contain the underlying per-test output.
- `reactor.json`: the compiled reactor suite passed 1799 checks under a
  120-second watchdog. This direct run does not establish the separate
  30-second gate verdict.
- `host-nat.json`: HOST-NAT passed 16/16.
- Syntax, HOUSE, TRUSTED-LINES and tracked whitespace captures passed.
  Trusted lines remain kernel 5246/5250 and encoder 246/600.
- `control-run.json` and `controls.json`: the positive implementation passes
  and all 14 defect variants fail assertions with exit 1. Every candidate
  first passes JavaScript syntax validation. A timeout, skipped test or
  cancellation fails the control runner.

Each capture stores its argv, working directory, exit status and complete
stdout and stderr for that command, with hashes. The compact runtime output
is identified above. The variant captures also pin their runtime and test
bytes. `results.json` pins every other file in this directory, including this
README. After a prose change, recompute its `capture_sha256` entry after all
record edits; retain the original command captures. Source hashes are under
`source_sha256`. `results.json` excludes its own hash to avoid a hash cycle.

The main validations used these child commands from the validation checkout,
with `kanon-wait run -- kanon-exec run --budget 4000 --` around finite runs.
Runtime, reactor, HOST-NAT and the control runner used `--timeout 120000`
before the child-command separator:

```sh
node --test --test-name-pattern 'file identity|request arities' dev/runtime-test.mjs
kanoncho test dev/runtime-test.mjs
node dev/reactor-test.mjs _build/default/bin/kanon.exe
node dev/host-nat-test.mjs _build/default/bin/kanon.exe
node --check runtime/reactor.mjs
node --check dev/runtime-test.mjs
node --check dev/reactor-test.mjs
zsh dev/house.sh .
zsh dev/trusted-lines.sh .
git diff --check
```

After staging, use `git diff --cached --check` for the staged whitespace
check. A plain `git diff --check` then checks only remaining unstaged edits.

Reproduce controls from the repository root, using an output directory that
does not already exist:

```sh
kanon-wait run -- kanon-exec run --budget 4000 --timeout 120000 -- \
  python3 -I dev/validation/2026-09-14-file-identity/reproduce-controls.py \
  --output /tmp/veil-identity-controls-fresh
```

The runner copies the current runtime and tests into isolated directories,
uses the base runtime from Git for the missing-operation control, and saves
full TAP captures. The two content-access controls select the injected
metadata test alone, so deliberately opening a private FIFO cannot hang the
native fixture. All other variants select the eight identity tests.

Native filesystem coverage is macOS only. Zero and large 64-bit pairs are
covered by injected metadata without claiming native allocation of those
identifiers. No full compiler or milestone gate ladder was rerun, and no
timing waiver is claimed.

## Review 2026-09-14

The review kept D-1 (low, fixed) and C-1 (low, close task); it carried
B-1 (medium) for a user ruling with no edit to this record. The close
ladder ran after the fixes and is filed at `gates-review.log` in this
directory, copied from the review kit close run `gates-close-2.log`.

The ladder ran from 15:25 to 15:33 (15:3x) and read LADDER-EXIT 1 at
end load1 39.82, load5 103.80 and load15 129.01; the run started at
load1 51.68. Three rows failed: FAIL M0-TIME median_ms=224.299
bound_ms=150 load1=129.750; FAIL M0-RATIO ratio=2.701597 bound=2.000
load1=129.750; FAIL M1-CORPUS elapsed_ms=1383.643 bound_ms=713
load1=114.064. The three timing rows carry load1 above thirty, the
waiver threshold, so each is a load artifact, not a defect. No other
row failed: the ladder AGREEMENT, REACTOR and RUNTIME rows passed under
their watchdogs, MEASURE exit=0 each.

Numbers after the review, read from the close log: TRUSTED-LINES
kernel=5246/5250 encoder=246/600 OK. RUNTIME # pass 208, # fail 0,
RUNTIME-EXIT 0. HOST-NAT 16/16, HOST-NAT-EXIT 0. reactor: 1799 checks
passed, REACTOR-EXIT 0. HOST: PASS HOST programs=3 zk-instance=10/10,
HOST-EXIT 0. AGREEMENT cases=7445 unary=5445 full-range=2000.

A first close ladder ran from 15:08 to 15:17 at load1 148 to 262 and
failed the standalone runtime suite on both of its runs, each on one
pre-existing test outside the eight file identity tests (`not ok 12`,
a leader deadline test, and `not ok 99`, a file mode test, each
`# pass 207` and `# fail 1` of 208). That log stays in the review kit
as `gates-close.log` and is not filed here; the ladder was rerun at a
lower load as the close above.

The sections above this one describe the scoped checks recorded before
the review: runtime 208 of 208, focused 8 of 8 under the pattern
`^file identity`, reactor 1799 checks, trusted lines kernel 5246/5250
and encoder 246/600, house six checks OK, and `git diff --check`
clean. This review does not rewrite those earlier sentences.

The check loop closed under no named waiver.

This close refreshes the `source_sha256` rows of `REACTOR.md` and
`dev/FILE-IDENTITY.md` from their staged index bytes, because the fix
round and this review section edited them; the other source rows are
byte-identical to the pre-review record. This close also adds one
`capture_sha256` row for `gates-review.log`, so `results.json` pins
every file of this directory again, this README among them. The
`capture_sha256` row for this README is refreshed last, after this
section is final.
