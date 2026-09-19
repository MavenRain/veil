# Closed-sort alias validation, 2026-09-18

Base: `228da98abb60c77fbf7133e5b68f717d9e35bc2d`.
Captured in `/Users/oobi/Documents/gpt3/veil-m2-sort-aliases`.

Lambda and arrow binders over transparent constant aliases of closed sorts
now receive zero quantity. Both declaration telescopes use the same bounded
resolution rule, including mixed alias and literal domains. Alias definitions
and references remain in the generated source for kernel checking. Ordinary
data aliases keep their runtime arguments.

All 71 translation tests pass with `--live`, including 23 integrations.
The nine new tests cover alias chains, mixed telescope domains, nested binder
scopes, ordinary data aliases, cycle and depth limits, unsupported dependencies,
partial applications, computation, higher universes and proposition proofs.
They inspect erased signatures and empty axiom reports. Incorrect unused
arguments, universe levels, alias declarations and computation witnesses fail
both checking and erasure. These are synthetic regression declarations;
they add no names to the pinned Lean sample or full-inventory parity results.

The nine retained captures are:

- `translation-tests`: all 71 tests pass without skips.
- `declaration-tests`: 30 pass and two optional Lean integrations are skipped.
- `record`: sample creation and offline verification pass.
- `live`: the sample reproduces every checker status and output byte.
- `compiler-reuse`: the binary and 46 unchanged pinned inputs match the
  prior type-let build record, whose result manifest is fingerprinted here.
- `controls`: an unmodified two-test baseline passes. Syntactic-only sort
  recognition fails the binder consistency check, and erasing data aliases
  fails the real-checker regression. Each mutation is isolated in memory.
  Full expected failure transcripts are retained in `controls.stderr`.
- `house`: `HOUSE OK`.
- `trusted-lines`: kernel 5248/5250, encoder 246/600.
- `parity-gate`: expected exit 1 for the incomplete 51,980-name baseline.

The 14 generated sample sources and checker capture streams match the prior
record byte for byte. The refreshed sample retains five rechecked names,
39 explicit gaps and zero parity credit. Compiler, runtime, Lean and exporter
sources are unchanged. This record claims no new compiler build, Lean export,
kernel or Wasm fixture run, or full M1 timing battery.

`results.json` binds the command manifests, complete stdout and stderr, this
record's scripts, the prior build manifest and current source hashes. Offline
verification checks those bindings and the refreshed translation record. It
does not hash a local executable; the retained compiler-reuse capture and
live verification record which binary ran. The `--compiler-reuse` mode below
also compares the local binary to that fingerprint. The controls script runs
two control cases, one of them live, so it needs the built
`_build/default/bin/kanon.exe`. Run from the repository root:

```sh
python3 -I dev/validation/2026-09-18-m2-sort-aliases/verify.py
python3 -I dev/validation/2026-09-18-m2-sort-aliases/verify.py --compiler-reuse
python3 -I dev/validation/2026-09-18-m2-sort-aliases/controls.py
```

Alias resolution inspects at most 128 expressions, including the terminal
sort. It does not reduce applications or local lets, substitute local values,
or unfold unsupported declarations. An inductive family type must still be a
literal closed sort; only binder domains and constructor field types resolve
aliases. General normalization, prenex universes, general Prop parity, full M2
exit and M1 exit ratification remain open.

Review note, 2026-09-18: the retained transcripts predate the review
extensions of existing test cases. The suite still runs 71 tests, no case was
added or removed, and no capture was made again.

## Review 2026-09-18

An independent review read the staged slice and ran the gate ladder again on
the fixed tree. The ladder log is retained here as `gates-review.log`, hashed
under the `review` key of `results.json`. The review added no new claim about
the translator, the sample record or the parity denominator. The source hashes
above were recomputed over the working tree after the review edits; the
captured streams of the original runs were not edited.
