# M2 closed-universe data and proof translation

`dev/m2-translate.py` lowers a bounded subset of the pinned Lean declaration
export to Veil source. The checked-in record covers all 44 snapshot names.
It re-checks `Nat`, `Nat.zero` and `Nat.succ` together as one recursive family,
and `True` and `True.intro` as a proposition family. It records a
translation-gap reason for each of the other 39 declarations.
No unsupported declaration is replaced by an axiom.

These are prototype results. The 51,980-name [parity baseline](M2-PARITY.md)
and its gate remain unchanged, with zero credited translations. This slice
does not establish general semantic preservation, prenex polymorphism,
general Prop parity, general proof translation, or the M2 exit thresholds.
A sample re-check is not a full-inventory parity result.

## Reproduce

Run from the repository root:

```sh
zsh dev/dunecho.sh build
python3 -I dev/m2-translate-test.py --live
python3 -I dev/m2-translate.py verify
python3 -I dev/m2-translate.py verify --live
```

Offline verification needs Python. Live verification and the nineteen live
regression tests need the built `_build/default/bin/kanon.exe` executable.
The tests without `--live` skip those nineteen integrations. To capture a fresh
record, choose an output directory that does not exist:

```sh
python3 -I dev/m2-translate.py record --output dev/m2-translation-candidate
python3 -I dev/m2-translate.py verify --record dev/m2-translation-candidate --live
```

Both commands accept `--snapshot`, `--inventory` and `--checker` overrides.
The checker is a trusted local executable. Build it from the recorded source
before capturing or reproducing results. Its hash records which binary ran;
it does not prove that an arbitrary supplied executable implements Veil.
Live verification allows a newly built executable with the same pinned
source, compares every status and output byte, and checks that the executable
does not change during the run.

Integrity success exits 0, including a record with translation gaps. Missing
or altered inputs, invalid records, subprocess timeouts, signals and usage
failures from the checker exit 2. There is no parity gate in this tool.
Record creation refuses existing destinations and publishes only after its
offline verification succeeds. A failed checker invocation never publishes
a partial record.

## Supported translation

The translator operates on the export's expression graphs and structural
declaration data. It does not parse pretty-printed Lean terms or infer bodies
from declaration names. Every name is encoded injectively as a lexer-safe
hexadecimal identifier. Local binder names derive from de Bruijn depth,
preventing original names, keywords or shadowed binders from capturing a
translated reference. Binder visibility becomes explicit in Veil.

The current subset contains:

- Closed sorts, with closed `succ`, `max` and `imax` evaluation. Lean sort
  zero lowers to `Prop`; positive sort `n` lowers to `Type (n - 1)`.
- Monomorphic constants, variables, application, lambdas, dependent arrows
  and typed lets. Lambda and arrow binders directly over closed sorts use
  Veil's zero quantity, preserving their scope while erasing the type or
  proposition argument. Remaining binders use unrestricted quantity. Direct
  lambda application chains, including functions exposed through lets,
  lower to nested typed lets so Veil can check them without inferring a bare
  lambda's type. This includes applications consuming type or proposition
  parameters and lets binding type or proposition values.
- Safe, nonrecursive, transparent definitions with supported dependencies.
- Nonrecursive theorem bodies with supported dependencies. An additional
  generated definition checks each theorem's type against `Prop` in Veil.
  Guard names use a separate injective namespace. Both the guard and proof
  erase; a data-valued declaration marked as a theorem fails the kernel check.
- Single, safe, unparameterized, unindexed inductive families in a closed
  sort, including empty families. Fields have monomorphic constant
  types and each constructor returns its own family. These lower to `mu`.
- Natural literals from 0 through 64, as applications of the translated
  `Nat.succ` and `Nat.zero`, using the translated family itself.

The pinned sample exercises the natural and truth families. Synthetic
regression inputs add definition and theorem bodies, empty proposition and
data families, binder shadowing, application, lets and literals.
A real Veil conversion check compares a computed two with two successor
constructors; changing that expected index to zero must fail. These synthetic
inputs are not represented as declarations exported from Lean's inventory.
The proof tests check that direct proofs, implication proofs and proof lets
erase, that a function's proof argument disappears, and that its runtime
result still computes. A false proof and a theorem with a data type are
rejected. Removing the latter's proposition guard admits it as an ordinary
data definition, exercising the guard's effect.

For a lambda application, each supplied argument retains its caller scope,
and each consumed parameter becomes a fresh typed let. Lets on the function
side move around the application while retaining their types and values.
Applications exposed inside a binding supply their arguments before pending
outer arguments. Later parameter types retain references to earlier bindings.
Typed lets preserve checks even when the body ignores a parameter or a local
binding, and proof lets erase through Veil's existing rules. Regression checks
cover nested, partial and higher-order applications, shadowed names, dependent
parameter syntax, proof erasure and incorrect arguments, let values and results.
This lowering follows only explicit application, lambda and let nodes. It
does not unfold constants, substitute local values or perform general
normalization. Functions exposed only by those further reductions may still
fail Veil's inference checks.

Closed-sort binders support named generic functions, partial applications,
forwarding a type argument from an enclosing binder, and proposition-generic
proofs. Synthetic kernel checks cover shadowed type names, later dependent
domains, higher closed universes and erased function signatures. Incorrect
type arguments, data arguments and universe levels fail checking and erasure,
including an invalid type argument that the function ignores. Computation
witnesses reject changed results, and the proof cases retain empty axiom
reports. These tests add no names to the exported snapshot.

For a typed let, the kernel normalizes its declared type. When that type is
a universe, it checks the value in erased mode and gives the local zero
quantity. This admits references to enclosing erased type parameters while
still checking the value's type, including unused values. Type-level reads
of a linear value do not consume it; runtime reads must still use it exactly
once. Erasure drops the type binding and keeps ordinary data bindings.
Live regressions cover direct and let-headed type applications, partial
applications, shadowed type aliases, higher closed sorts, proposition lets
and normalized universe aliases. Invalid values fail checking and erasure,
and changed computation witnesses fail conversion.

Only syntactic sort domains of lambda and arrow binders receive zero quantity
from the translator. It does not unfold type aliases to infer their quantity.
A declaration whose type and value give different quantities to one binder,
because one side names the sort and the other names an alias of it, becomes
an explicit gap.
Named applications use the checked function's declared quantity.

Veil refuses an erased binder that is read in a runtime position. The kernel
tests `test/neg/n02-quantity.kan`, `test/neg/grouped-erased-read.kan` and
`test/neg/zk-wrong-quantity.kan` pin that refusal with their expected
messages. This erasure relies on that kernel rule.

Universe polymorphism, axioms, opaque declarations, recursors,
quotients, projections, strings, unsupported inductives and recursive
definitions remain explicit translation gaps. A supported declaration whose
dependency is unsupported also becomes a gap, naming that dependency.
Kernel, erasure or axiom-check failures of generated candidates are reported
as translation gaps requiring investigation, not automatically as kernel
bugs or ledger-row parity gaps.

Theorem bodies lower to checked Veil definitions, using its existing proof
erasure and conversion rules. This does not establish general proof
irrelevance, large-elimination parity, or preservation of Lean's opacity
and reduction rules. Unsupported dependencies remain gaps even when they
occur only in proofs.

The implementation bounds expression and dependency traversal depth to 128,
generated sources to 256 KiB each, and expression-cache expansion to 4,096
entries and 4 MiB. The same depth bound limits a closed sort level, because
each level constructor spends one unit of that fuel: the largest translated
level is 127, which renders as `(Type 126)`. The existing exporter
additionally bounds the snapshot. These limits are prototype scope, not M2
exclusions.

## Evidence and verification

Each artifact includes its full supported dependency closure, in dependency
order. The natural family's three declarations share one artifact, and the
truth family's two declarations share another. Veil runs
`check --print`, `check --erased` and `axioms` on that exact file, with a
30-second timeout per invocation. A rechecked result requires exit 0 and
empty stderr for all three commands, and an empty axiom report. Family-only
files have empty checked and erased output because families are stored in
Veil's separate family table.

`results.json` retains every snapshot name, each original declaration hash,
source mappings, dependency closure names, gap reasons, command arguments,
exit codes and hashes for generated sources and complete stdout/stderr
captures. Provenance includes the original inventory fingerprint and count,
snapshot and pin bytes, exporter, translator and compiler source hashes,
and the executable hash. Inputs, sources and executable are checked for
changes during recording.

Offline verification first verifies the existing inventory and declaration
pins, then re-translates the snapshot and compares the exact generated
source, result rows, counts and recorded hashes. It rejects extra files,
symlinks, noncanonical JSON, missing captures and unexpected commands or
statuses. A self-consistent rewrite of both recorded command outcomes and
their hashes is not authenticated by offline verification. Live verification
re-runs the checks; retain a trusted record for provenance comparison.

See the [validation record](validation/2026-09-18-m2-type-lets/README.md)
for the rebuild, language suites and scoped checks. The next
language work remains prenex universes and general Prop parity, followed by
the remaining proof-grade forms and full-inventory differential results.
