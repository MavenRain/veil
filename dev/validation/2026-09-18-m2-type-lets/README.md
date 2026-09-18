# Type-valued let validation, 2026-09-18

Base: `42768bc236be720d158df9129478edc87b1e51f5`.
Captured in `/Users/oobi/Documents/gpt3/veil-m2-type-lets`.

The translator admits type-valued lets and applications consuming type or
proposition lambda parameters. The kernel normalizes the declared let type
and checks universe-valued definitions in erased mode with zero quantity.
Type and proposition values erase while their type checks and dependent
scopes remain intact, including references to enclosing erased parameters.

All 62 translation tests pass with `--live`, including nineteen integrations.
The five new live tests exercise direct, partial and let-headed applications,
plain type lets, shadowed type names, caller scopes, higher closed sorts,
proposition lets and proof consumers. They inspect erased data bindings,
function signatures and empty axiom reports. Changed computation witnesses
fail checking and erasure. Invalid type values and universe levels fail even
when the binding is unused. A kernel regression covers normalized universe
aliases, erased-local reads and exact-use resource accounting. Type-only reads
do not consume a linear argument; unused and duplicated runtime uses fail.

The eleven retained captures are:

- `build`: the checker and test executables rebuild successfully.
- `kernel`: the complete kernel fixture suite passes.
- `wasm`: the complete Wasm fixture suite passes.
- `m1-suite`: the M1 functional suite passes.
- `translation-tests`: all 62 tests pass, with no skips.
- `declaration-tests`: 30 pass, with two optional Lean integrations skipped.
- `record`: fresh sample creation and offline verification pass.
- `live`: the installed sample reproduces every checker status and output byte.
- `house`: `HOUSE OK`.
- `trusted-lines`: kernel 5248/5250, encoder 246/600.
- `parity-gate`: expected exit 1 for the incomplete 51,980-name baseline.

The sample sources and checker captures match the previous record byte for
byte. Refreshed provenance retains five rechecked names, 39 explicit gaps
and zero parity credit. The recorded checker was rebuilt from the changed
kernel. This record claims no fresh Lean export or full M1 timing run.

The binary fingerprint records the executable used at capture time. Live
verification hashes it before and after its run. This record's offline
verifier compares the recorded fingerprint with its pin and does not hash
a local executable. `results.json` binds the command manifests, complete
stdout and stderr, and source hashes. Verify from the repository root:

```sh
python3 -I dev/validation/2026-09-18-m2-type-lets/verify.py
```

Alias unfolding for lambda binder quantities, universe polymorphism, general
Prop parity, the remaining M2 exit criteria and M1 exit ratification stay open.
