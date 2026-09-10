# Finite constructor bounds

This slice extends the circuit reader on Veil commit `d843a01`.
`spineSucc (spineSucc spineZero)` can now be stored in a definition and
used as the scrutinee of a circuit match. Finite branching trees and
literal payload fields also work. Global aliases and annotations retain
the constructor certificate.

Each constructor of the matched family adds one to the maximum field
height. Literals and a payload of another family have height zero, so a
nullary constructor has height one. Every field must pass, which
prevents a known subtree from masking an opaque sibling.
The height multiplies the largest branch only when a branch reads a
field that its own constructor binds, because such a branch can fold
over the tree. A match whose branches read no field of their own
constructor holds the depth of the largest branch, which includes the
leaf branch. Multiplication and the
primitive/case depth increments use checked Bignum narrowing to refuse a
result beyond the host integer range.

This repairs a depth-accounting bug: a match on a nullary constructor
previously multiplied branch depth by zero. `fhc-leaf-depth.kan` contains
two nested primitive calls in that branch and incorrectly requests an
unchanged ciphertext level. It must fail with the existing FHC level
diagnostic.

The accepted data fragment contains constructors and literal fields.
It excludes local variables, local let aliases, computed fields,
function fields, unresolved globals and cyclic global aliases. An
constructor value returns `mu` only when a field names its own family
and no certificate covers that field; a field of another shape is
ordinary data at its own depth. An uncertified match bound
returns `unbounded iteration`. Recursive branch functions still return
`mu`. The checker does not unroll recursive functions in this slice.

Validation lives under `dev/validation/2026-09-10-circuit-bounds/`.
The CIRCUIT gate now also runs 18 direct reader regressions covering
aliases, leaf work, literal fields and literal scrutinees, a payload of
another family, opaque siblings, closed fields of another shape, an
unknown field global, global cycles, folding and non-folding matches,
representable depth and multiplication, primitive and case overflow.
The gate holds the count line `CIRCUIT-BOUNDS 18/18` against its own
expected value, because the exit code of the reader binary answers
against the length of its own case list. The gate also holds the circuit
rows of `test/fixtures/mu-dependent-layout.kan` and
`test/fixtures/one-fields.kan` against goldens. The source spine has 28
expected observations. A compiled tree fixture returns 42 on the kernel
and both Wasm hosts. The negative
FHC fixture is part of the kernel suite.

The trusted-kernel limit remains 5,250 lines. The change only touches
the circuit reader within the kernel; no new shape or rule pack is added.

## Review 2026-09-10 (circuit bounds)

- B-1, high: the CIRCUIT leg now holds the reader count line against
  `CIRCUIT-BOUNDS 18/18` and the reader binary fails an empty case list;
  `dev/gates.sh`, `test/circuit_bounds.ml`.
- A-1, medium: the constructor height multiplies a branch only when the
  branch reads a field of its own constructor, so a non-folding match
  keeps the depth of one branch; `lib/circuit.ml`, `SPEC.md`,
  `dev/CIRCUIT-BOUNDS.md`, `test/golden/circuit-spine.circuit`.
- A-2, medium: a constructor layer adds to the height only when it
  belongs to the matched family, so a payload of another family no
  longer inflates the bound; `lib/circuit.ml`, `test/circuit_bounds.ml`.
- B-2, medium: a scrutinee of height zero refuses `unbounded iteration`,
  and reader cases pin a literal field and a literal scrutinee;
  `lib/circuit.ml`, `test/circuit_bounds.ml`.
- D-1, medium: an introduction at `SMu` keeps the largest field depth
  and refuses `mu` only for an uncertified field that names its own
  family; `lib/circuit.ml`, `SPEC.md`, `dev/CIRCUIT-BOUNDS.md`,
  `test/golden/circuit-mu-dependent-layout.circuit`,
  `test/golden/circuit-one-fields.circuit`.
- D-2, medium: the fields are read before the family test, so an
  unknown global in a field keeps the `unknown global NAME` refusal;
  `lib/circuit.ml`, `test/circuit_bounds.ml`.
- C-3, low: the refusal list now says that a global with no body refuses
  `unknown global NAME` where the reader evaluates it, and refuses
  `unbounded iteration` in the scrutinee of a match at `SMu`, because
  the certificate runs first; `SPEC.md`.
- A-3, low: the finite-tree certificate carries the answer of each alias
  name for one certification, so a shared alias body is read once and a
  graph of 14 aliases costs 0.16 s instead of 47.8 s; `lib/circuit.ml`.
- C-2, low: no change here. The close corrected the eleven-checks
  sentence of the validation README.
- ND-1-1, medium: the certificate carries its answers in an immutable
  list, not in a hash table, which keeps mutable state out of the
  kernel and keeps the `HOUSE` gate leg green; `lib/circuit.ml`.

Two passes ran. Pass 1 fixed B-1, A-1, A-2, B-2, D-1, D-2 and the new
defects ND-1-1 to ND-1-3. Pass 2 fixed C-3, A-3 and ND-1-1, the mutable
state. The close fixed C-2. The final ladder `gates-review.log` is 26/26
at load1 31.7 with `CIRCUIT-BOUNDS 18/18`, ten slice cases plus eight
review cases. The counter moved from 5,122 to 5,246 trusted lines under
the unchanged 5,250 bound, with 4 lines of headroom, and the kernel
comments stay. C-1: check 1 of `regressions.json` names the ROOT
compiler and the other rows name the gpt18 checkout, so a clean checkout
cannot replay the record. C-4: check 11 ran on gpt18, not on this index.
