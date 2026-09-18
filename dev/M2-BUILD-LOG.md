# M2 build log

## Monomorphic translation prototype, 2026-09-17

Added `dev/m2-translate.py`, a structural translator from the pinned Lean
declaration export to Veil source for a bounded monomorphic subset. It
lowers simple inductive families to `mu`, preserves dependency order and
de Bruijn binding, and supports safe nonrecursive definitions, lambdas,
applications, lets and small natural literals. Unsupported forms and
dependencies produce explicit translation gaps without inserted axioms.
The [translation contract](M2-TRANSLATION.md) states the limits and trust
boundary.

The sample retains all 44 snapshot names. `Nat`, `Nat.zero` and `Nat.succ`
share one generated artifact and pass kernel, erasure and empty-axiom checks.
The other 41 names have explicit gap reasons. The record binds each original
declaration, generated source, compiler and translator sources, executable
hash, commands, statuses and full output captures. Offline verification
re-translates the pinned inputs; live verification re-runs the three checks.
The 51,980-name parity baseline stays at zero credited successes and its gate
still exits 1 for the valid, incomplete baseline.

Validation in `/Users/oobi/Documents/gpt3/veil-m2-translation`, based on
`a7534cedeac82d396de8e23058ee6bc990560f65`:

- Build passed with 0 errors and 0 warnings.
- All 22 translation regression tests passed, including three live tests.
  The computation check rejects an altered expected result; integrity checks
  reject unrelated source even after its hash is changed, missing captures,
  changed commands, statuses, counts, file sets and provenance.
- The existing declaration suite passed 30 tests and skipped its two
  optional Lean integrations. Exporter and Lean sources are unchanged.
- Record creation, its offline verification and live reproduction passed.
- HOUSE and TRUSTED-LINES passed. Trusted counts remain kernel 5246/5250
  and encoder 246/600.

The [validation record](validation/2026-09-17-m2-translation/README.md)
retains eight captures and checks their hashes and source bindings. This is
scoped development-tool validation. The full M1 timing ladder and Lean
export were not rerun. Compiler and runtime sources are unchanged. Prenex
universes, Prop, proof translation, full-inventory parity and M2 exit remain
open. No user ratification or commit is written by this slice.

### Review 2026-09-17 (M2 monomorphic translation)

An independent review read the staged slice and kept seven findings. Its
check stage raised one more. The fixes are test, record-checker and document
changes. The translator and the sample record are unchanged, so no re-record
was necessary.

- A-1, medium, dev/m2-translate-test.py:262. A fourth case gives exit 0 on
  all three checker commands, with a warning on stderr. It asserts that the
  result is not rechecked.
- D-1, medium, dev/validation/2026-09-17-m2-translation/verify.py:51. The
  record checker accepts an optional `review` key, hashes every file that
  the key names, and admits those files in the record directory.
- B-1, low, dev/M2-TRANSLATION.md:63. The contract states that the
  translator restricts no application head, and that a lambda head gives a
  beta-redex which Veil refuses. One test pins that output.
- A-COV, low, dev/m2-translate-test.py:141. Four tests reach the
  dependency-depth bound, the accumulated byte budget, constructor
  polymorphism and safety, and the committed sample bytes.
- C-2, low, dev/M2-READINESS.md:82. The sentence is scoped to the exporter
  record, which holds no translations or Veil kernel re-checks.
- C-1, low, dev/validation/2026-09-17-m2-translation/README.md:47. The skip
  reason names the mechanism: the declaration suite ran without `--live`.
- D-3, low, dev/validation/2026-09-17-m2-translation/verify.py:38. The
  source union binds the five `test/*.ml` files that the house legs scan.
- ND-1, low, dev/validation/2026-09-17-m2-translation/README.md:49. The
  record states that the translation-tests capture predates the four tests
  the review added.

The translation suite now holds 26 tests, 3 of them live. Five mutants that
the review found are now refused: the empty-stderr conjunct, the
dependency-depth admit, the byte budget, the constructor safety admit and
the `mu` keyword. The captured streams of the original runs are unchanged.

## Declaration bodies and dependency closure, 2026-09-17

Starting point: `7abe6a51d717bcb64d8fde2900610fc88cb9e7da`, the committed
parity inventory and gate specification. Added `meta/ExportDeclarations.lean`,
`dev/m2-declarations.py`, expression-codec and snapshot regressions, the pinned
sample and [schema documentation](M2-DECLARATIONS.md).

The exporter reads private-level Init module data to recover original
declaration kinds, types, definition and proof bodies, and structural data.
The sample's eight requested declarations expand to 44 dependencies and roots.
It contains the `Nat.add_zero` proof and reports three actual axiom declarations.
All 631 private-level imported modules have base and optional sidecar artifact
pins. The three modules added by private imports do not change the exported
inventory's 628 modules or its 51,980-declaration denominator.

Expression graphs retain universe arguments, binder annotations, exact
natural literals, projection fields and recursor rules. Structural equality
preserves binder information during sharing. Free variables, unresolved
metavariables, incomplete closures and malformed snapshots are rejected.

Validation: all 32 declaration tests pass, including a fresh inventory and
declaration export plus elaborated expression-codec fixtures (the `#eval` of
the appended fixture is interpreted by `lean`). All 21 existing
parity tests pass. HOUSE passes, and TRUSTED-LINES remains
`kernel=5246/5250 encoder=246/600`. The parity gate exits 1 as expected for
the unchanged zero-translation baseline. The [validation record](validation/2026-09-17-m2-declarations/README.md)
retains transcripts and source hashes.

No compiler, runtime or M1 gate implementation changed. No full M1 battery or
theorem-library rebuild is claimed. Translation, Veil kernel re-check evidence,
the M2 language features and the user's M1 exit stamp remain open.

### Review 2026-09-17 (M2 declaration export)

Seven findings were applied. No finding is carried for a user ruling.

- A-1 (medium), `dev/m2-declarations.py:320`: the suite now refuses a pin
  with a changed declaration fingerprint, a changed closure count, or a
  changed inventory, toolchain or version pin.
- A-2 (medium), `dev/m2-declarations.py:311`: the suite now refuses a
  reformatted snapshot, a changed pinned module olean hash, and an export
  whose installed `Init` artifacts differ from the inventory pin. The export
  case also shows that the exporter subprocess does not start.
- A-4 (medium), `dev/m2-declarations.py:195`: the suite now refuses a
  declaration kind that differs from the inventory kind, and a constructor
  that its own inductive does not list.
- B-1 (low), `dev/M2-BUILD-LOG.md:24`: the codec fixtures are elaborated.
  `lean` interprets the `#eval` of the appended fixture. The skip message of
  the suite uses the same verb.
- B-2 (low), `dev/m2-declarations.py:270`: the exporter and the codec test
  also clear `LEAN_SYSROOT`, so the loaded modules are the hashed modules.
  The [schema documentation](M2-DECLARATIONS.md) names the three cleared
  variables.
- C-1 (low), `dev/validation/2026-09-17-m2-declarations/README.md:13`: the
  record checker asserts the published numbers: 44 declarations with the
  seven-kind histogram, the TRUSTED-LINES row and the `HOUSE OK` row.
- D-1 (low), `dev/validation/2026-09-17-m2-declarations/verify.py:21`: the
  record checker reads the record directory and refuses an unexpected file.
  It also refuses a manifest whose command reports a failure code or a
  signal.

The suite passes 32 tests, with 2 tests skipped without `--live`. Eight
mutants of the guarded rows were built in a full copy. Each mutant fails the
suite. Five doctored records, each one with its capture hash rewritten, fail
the record checker. `pin.json` holds the new `dev/m2-declarations.py` source
hash.

## Init parity inventory, 2026-09-17

Starting point: `0955e62c4a866bf25d867d24f737c120fe7ad46e`, the committed
M1 readiness increment. The user's M1 exit ratification remains open.

Added `meta/ExportInit.lean`, `dev/m2-parity.py`, the regression suite and
the pinned `dev/m2-init` artifacts. The exporter reads a fresh exported
`Init` environment. The verifier binds every declaration to the denominator,
the baseline accounting, exporter source and Lean toolchain artifacts.

The denominator is 51,980 declarations from an exported environment of 628
imported modules. 535 of those modules own a declaration. Its initial baseline
has 51,980 explicit translation gaps, zero translation attempts, zero Veil
kernel re-checks, zero successes and zero unclassified entries. All gaps
refer to the absent translation pipeline. No per-declaration expressibility
or kernel-correctness conclusion follows from this classification.

Validation: 21 regression tests pass. A separate live export reproduces the
complete inventory and all module fingerprints. The integrity command exits
0; the incomplete parity gate exits 1; missing input exits 2. Tests reject
denominator shrinkage, missing and duplicate results, fabricated passes,
changed exporter/toolchain pins, malformed module pins, and changed live
artifacts. They also exercise subprocess failures and search-path isolation.

No existing compiler, reactor, runtime or M1 gate source changed. The previous
27-leg M1 result remains the historical readiness evidence. This increment
does not claim a new M1 battery run or a new theorem-library build. The Lean
inventory driver was elaborated and its `main` was interpreted with
`lean --run` during live reproduction.

The [parity specification](M2-PARITY.md) defines the denominator and the
future differential result contract. The [validation record](validation/2026-09-17-m2-parity/README.md)
retains commands, captures and source hashes. Translation, language features,
axiom disclosure, corpus timing and incremental re-checking remain open.

### Review 2026-09-17 (M2 parity inventory)

Seven low findings were applied. No finding is carried for a user ruling.

- A-4 (low), `dev/m2-parity-test.py:141`: the suite now pins four validator
  rows. It refuses a module list without `Init`, an empty or non-string
  `lean_version` pin, a snapshot whose export disagrees with its own pin,
  and it asserts the full summary map and the 51,980 CLI denominator.
- A-7 (low), `dev/m2-parity-test.py:237`: the file imports `sys` and uses
  `sys.executable` in place of `os.sys.executable`.
- B-2 (low), `dev/M2-PARITY.md:33`: the axiom-kind note names the three
  exported forms: theorem, definition without `@[expose]`, opaque constant.
- B-1 (low), `dev/M2-BUILD-LOG.md:29`: the build log and the record README
  say that `lean --run` elaborates the driver and interprets its `main`.
- C-1 (low), `dev/M2-PARITY.md:3`: 628 is the imported module set. Both
  intro rows now give 535 modules that own a declaration.
- C-4 (low), `dev/M2-PARITY.md:88`: two long requirement rows are split into
  one sentence per requirement. The record README list is now a bullet list.
- C-2 (low), `dev/M2-READINESS.md:5`: rows 5, 72, 76 and 77 use two spaces
  after a period, as the rest of the file does.

The suite passes 21 tests. Four mutants of the pinned validator rows were
built in full copies. Each mutant now fails the suite.
