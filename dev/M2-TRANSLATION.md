# M2 monomorphic translation prototype

`dev/m2-translate.py` lowers a bounded subset of the pinned Lean declaration
export to Veil source. The checked-in record covers all 44 snapshot names.
It re-checks `Nat`, `Nat.zero` and `Nat.succ` together as one recursive family,
and records a translation-gap reason for each of the other 41 declarations.
No unsupported declaration is replaced by an axiom.

These are prototype results. The 51,980-name [parity baseline](M2-PARITY.md)
and its gate remain unchanged, with zero credited translations. This slice
does not establish general semantic preservation, prenex polymorphism,
Prop parity, proof translation, or the M2 exit thresholds. A sample re-check
is not a full-inventory parity result.

## Reproduce

Run from the repository root:

```sh
zsh dev/dunecho.sh build
python3 -I dev/m2-translate-test.py --live
python3 -I dev/m2-translate.py verify
python3 -I dev/m2-translate.py verify --live
```

Offline verification needs Python. Live verification and the three live
regression tests need the built `_build/default/bin/kanon.exe` executable.
The tests without `--live` skip those three integrations. To capture a fresh
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

- Closed positive sorts, with closed `succ`, `max` and `imax` evaluation.
- Monomorphic constants, variables, application, lambdas, dependent arrows
  and typed lets. Binders directly over sorts are refused pending erasure
  translation. Remaining binders use Veil's unrestricted quantity. The
  translator restricts no application head, and Veil refuses a beta-redex,
  so an application with a lambda head becomes a translation gap.
- Safe, nonrecursive, transparent definitions with supported dependencies.
- Single, safe, unparameterized, unindexed inductive families in a positive
  sort, with at least one constructor. Fields have monomorphic constant
  types and each constructor returns its own family. These lower to `mu`.
- Natural literals from 0 through 64, as applications of the translated
  `Nat.succ` and `Nat.zero`, using the translated family itself.

The pinned sample exercises the natural family. Synthetic regression inputs
add definition bodies, binder shadowing, application, lets and literals.
A real Veil conversion check compares a computed two with two successor
constructors; changing that expected index to zero must fail. These synthetic
inputs are not represented as declarations exported from Lean's inventory.

Polymorphism, Prop, axioms, theorems, opaque declarations, recursors,
quotients, projections, strings, unsupported inductives and recursive
definitions remain explicit translation gaps. A supported declaration whose
dependency is unsupported also becomes a gap, naming that dependency.
Kernel, erasure or axiom-check failures of generated candidates are reported
as translation gaps requiring investigation, not automatically as kernel
bugs or ledger-row parity gaps.

The implementation bounds expression and dependency traversal depth to 128,
sort levels to 255, generated sources to 256 KiB each, and expression-cache
expansion to 4,096 entries and 4 MiB. The existing exporter additionally
bounds the snapshot. These limits are prototype scope, not M2 exclusions.

## Evidence and verification

Each artifact includes its full supported dependency closure, in dependency
order. The natural family's three declarations share one artifact. Veil runs
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

See the [validation record](validation/2026-09-17-m2-translation/README.md)
for the scoped checks. Compiler and runtime sources are unchanged. The next
language work remains prenex universes and Prop, followed by the remaining
proof-grade forms and full-inventory differential results.
