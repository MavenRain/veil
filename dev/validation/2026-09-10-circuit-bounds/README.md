# Validation, 2026-09-10

Base: `d843a01986dd3213d8f45cfb9b4ac4ef526aa2df`.

The final compiler builds with zero errors and zero warnings.
`regressions.json` records eleven command checks: acceptance of the
understated FHC level by the baseline compiler, its rejection by the new
checker, acceptance of the corrected level, the named-leaf circuit
depth, one run of `circuit_bounds.exe` (ten direct circuit-reader cases
at capture time; the test now holds 18), the tree fixture returning 42
on the kernel, Node and Wasmtime, the trusted-lines count, the shape
audit and `git diff --check`.

The final full `zsh dev/gates.sh` run is in `gates.log`: 23/26 gates
passed. This is a failing full run, with three recorded limitations:

- M0-TIME: 371.654 ms against 150 ms, load1 72.898.
- M0-RATIO: 2.795333 against 2.000, load1 72.898.
- RUNTIME: 21/22 tests passed. The signal-callback cleanup test failed
  reading its child's marker file. It gives the child 150 ms to start
  Node, write that file, and await termination. Heavy load is a suspected
  cause, not a proven explanation.

`runtime-recheck.log` records the separate full runtime run, also 21/22
with the same marker failure. `runtime-baseline.log` records an isolated
run of that test in the unchanged main checkout, which passed. The
runtime module and test file are byte-identical between the checkouts:

| file | SHA-256 |
| --- | --- |
| `runtime/reactor.mjs` | `045eeae2614d5fbe5b6231c1329d50b6dd3368d49f65abe5a798bfd0f99c421e` |
| `dev/runtime-test.mjs` | `36de09c3c00c990497d051818ef09cc9aeca0856880a3d37825eb2fbdbb6cadb` |

Kernel, Wasm, CIRCUIT (28 source observations plus ten direct cases),
ZK, FHC, MPC, host integration, reactor, structural audits and all 7,445
arithmetic agreement cases passed in the final full run. The trusted
kernel is 5,122/5,250 lines; the encoder is 246/600. No gate thresholds,
runtime files or existing tests were weakened.

`gates-first.log` preserves the initial fixture-golden mistakes, which
were corrected. `gates-before-increment-fix.log` records the intervening
run before adding primitive/case increment overflow handling. Only
`gates.log` and `regressions.json` describe the final implementation.

To reproduce from this checkout:

```sh
zsh dev/dunecho.sh build
zsh dev/gates.sh
_build/default/test/circuit_bounds.exe
_build/default/bin/kanon.exe run test/fixtures/circuit-named-tree.kan --export main --host both
node --test dev/runtime-test.mjs
```

`source-manifest.json` lists the copied source and evidence hashes.
Whitespace-only log lines were normalized before staging; test outcomes
and diagnostic text were preserved.

## Review 2026-09-10

`gates-review.log` is the final ladder of the review: 26/26 gates
passed at load1 31.7 with no red leg, and the RUNTIME leg passed.
`CIRCUIT-BOUNDS 18/18`, ten slice cases plus eight review cases.
`SL-SURFACE OK`. The tree fixture returns `host=kernel: 42` and
`host=both: 42`. The trusted kernel is 5,246/5,250 lines; the encoder
is 246/600. The spine golden has 28 lines. The review added the two
goldens `test/golden/circuit-mu-dependent-layout.circuit` and
`test/golden/circuit-one-fields.circuit`, which the CIRCUIT leg diffs
through `CIRCUIT_FIXTURES` in `dev/gates.sh`. The eleven-checks
sentence above was corrected in the review (C-2).

C-1 is recorded, not rewritten: `regressions.json` check 1 (baseline
accepted understated FHC depth) names the ROOT compiler
`/Users/oobi/Documents/veil/_build/default/bin/kanon.exe` and the other
rows name
`/Users/oobi/Documents/gpt18/veil-circuit/_build/default/bin/kanon.exe`,
so a clean checkout cannot replay the record.

C-4 is recorded, not rewritten: `regressions.json` check 11
(`git diff --check`) was captured on the gpt18 checkout, so it says
nothing about this index; the close runs `git diff --cached --check` on
the index itself.
