# M2 declaration export

The declaration exporter supplies structured Lean types, values and dependency
closures for the next translation increment. The checked-in sample requests
eight declarations from the pinned `Init` inventory and retains 44 declarations
after following their dependencies. It includes the proof of `Nat.add_zero`.
It reports the actual axiom declarations `Classical.choice`, `Quot.sound` and
`propext` in that closure.

These are translator inputs. The exporter itself performs no translation or
kernel re-check. The [parity inventory](M2-PARITY.md) still has
51,980 declarations, zero attempted translations and an open parity gate.
The sample's size does not change that denominator. The axiom list describes
this dependency closure, including structural and mutual-declaration edges;
it is not the full M2 translated-axiom disclosure.

## Commands

Run from the repository root:

```sh
python3 -I dev/m2-declarations.py verify
python3 -I dev/m2-declarations.py verify --live
python3 -I dev/m2-declarations-test.py --live
```

Offline verification needs Python only. Live verification also needs the
pinned Lean toolchain and reproduces both the original exported inventory
and the complete selected declaration snapshot. The regression suite without
`--live` skips its two Lean integration checks.

To create a new snapshot, choose an output directory that does not exist:

```sh
python3 -I dev/m2-declarations.py snapshot --output dev/m2-declarations-candidate \
  --name id --name Nat.add --name Nat.add_zero --name True.intro \
  --name Eq.refl --name Classical.choice --name Quot.sound --name propext
python3 -I dev/m2-declarations.py verify --snapshot dev/m2-declarations-candidate --live
```

Every requested name must belong to the original inventory. Private helper
declarations may appear as dependencies. The command refuses duplicate roots,
unknown names and an existing destination. Export or verification failure
does not publish a partial snapshot. Integrity success exits 0; invalid input,
missing files and failed Lean commands exit 2. There is no translation-success
or parity-gate command in this exporter.

## Representation

`meta/ExportDeclarations.lean` imports a fresh `Init` environment at Lean's
private-data level. Unlike the exported level used by the denominator,
this exposes definition and proof bodies with their original constant kinds.
It also loads three additional Init modules, for 631 imported modules total.
The inventory itself remains at its original 628 modules.

`declarations.json` contains the requested names, full imported module set,
and declarations sorted by name. Each declaration retains its module, kind,
universe parameters, private flag, type, optional value and kind-specific
data. Definitions retain reducibility hints and safety; inductives retain
constructors, mutual families and counts; recursors retain their reduction
rules. Opaque values and theorem proofs are exported as values. Axioms,
inductives, constructors, recursors and quotient primitives have no value
field beyond JSON null; their type and structural data remain present.

Each declaration has a separate expression graph. Nodes are arrays with a
tag followed by fields; child indices always refer to earlier nodes:

| Tag | Fields after the tag |
| --- | --- |
| `bvar` | de Bruijn index |
| `sort` | universe expression |
| `const` | declaration name, universe arguments |
| `app` | function node, argument node |
| `lam`, `forall` | binder name, binder annotation, domain node, body node |
| `let` | binder name, type node, value node, body node, nondependent flag |
| `nat` | exact nonnegative decimal string |
| `string` | string value |
| `proj` | structure name, field index, structure node |

Universe expressions use `zero`, `succ`, `max`, `imax` and `param` tags.
Names use Lean's rendering; the exporter rejects rendering collisions in
the imported constant map, and the verifier rejects duplicate parameter names.
Structural expression equality preserves binder names and annotations while
sharing repeated nodes. Lean expression metadata, such as source annotations,
is intentionally erased. Free variables and unresolved expression or universe
metavariables are errors.

Dependencies include constants, projection types, literal types (`Nat` and
`String`), mutual groups, constructors and recursor rules. The verifier derives
these edges from the payload and requires their complete closure. It rejects
missing or unrelated declarations, extra fields, unknown forms, forward or
cyclic expression references, loose bound variables, undeclared universe
parameters, wrong constant universe arities, unreachable nodes, and inconsistent
constructor, projection or recursor metadata. This is structural validation;
it does not independently type-check the Lean expressions.

Exports are bounded to 4,096 declarations, 100,000 expression nodes per
declaration and universe-expression depth 512. Each Lean subprocess has a
180-second timeout. A limit failure is an export failure, not a parity result.

## Provenance

`pin.json` binds the inventory fingerprint, toolchain and version banner,
exporter and Python source hashes, declaration count and complete snapshot
bytes. For every private-level imported module, it retains `.olean`,
`.olean.server` and `.olean.private` hashes, with explicit null for an absent
optional sidecar. Installed Init candidates are hashed before export; the
used artifacts and exporter sources are checked again afterwards. The
search-path environment variables `LEAN_PATH`, `LEAN_SRC_PATH` and
`LEAN_SYSROOT` are cleared before Lean is invoked, so the loaded modules are
the hashed modules of the toolchain prefix.

Offline verification checks structure, accounting and recorded hashes. A
self-consistent rewrite of data and pins can only be detected by comparing
against a trusted record or running live reproduction. Live verification is
required to establish or replace a snapshot. The [validation record](validation/2026-09-17-m2-declarations/README.md)
retains the scoped checks. Existing compiler, runtime and M1 gate sources are
unchanged. The translator, Veil re-check evidence and M2 language features
remain beyond this exporter. The follow-up
[monomorphic prototype](M2-TRANSLATION.md) now re-checks the natural family
and its two constructors, with an explicit gap for every other snapshot
declaration and no full-inventory parity credit.
