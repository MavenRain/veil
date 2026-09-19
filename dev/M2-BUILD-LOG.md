# M2 build log

## Closed-sort alias binders, 2026-09-18

Base: `228da98abb60c77fbf7133e5b68f717d9e35bc2d`.

The translator now recognizes safe, monomorphic, transparent constant alias
chains ending in closed sorts when choosing lambda and arrow quantities.
The declared type and value use the same rule, so an alias on one side and
the literal sort on the other preserve the same erased parameter. Generated
source retains every alias definition and domain reference for kernel
checking. Data aliases keep runtime arguments. Resolution detects cycles
and allows at most 128 inspected expressions, including the terminal sort.

All 71 translation tests pass with `--live`, including 23 integrations.
Five new offline cases cover mixed domains, nested scopes, data aliases,
cycles, depth, unsupported dependencies and the bounded reduction scope.
Four new live cases exercise partial applications, two erased type binders,
higher universes, proof erasure, invalid unused arguments and invalid alias
definitions. Changed computation witnesses fail checking and erasure.
Two controls kill syntactic-only resolution and incorrect data-alias erasure.

Declaration regressions pass 30 tests and skip two optional Lean integrations.
Fresh recording, live reproduction, HOUSE and TRUSTED-LINES pass. The checker
binary and the 46 unchanged pinned translation/build inputs match the prior
type-let record; of the 47 pinned inputs only dev/m2-translate.py changed.
This increment reuses that compiler without a new build, fresh Lean export or
full M1 timing run. The incomplete parity gate retains its expected exit 1.

All 14 sample source and capture files remain byte-identical. Refreshed
provenance still reports five rechecked names, 39 gaps and zero full-inventory
parity credit. An inductive family type must still be a literal closed sort;
only binder domains and constructor field types resolve aliases. Alias
resolution through applications or local lets, prenex universes, general Prop
parity and the remaining M2 exit criteria stay open.

Evidence: [closed-sort alias validation](validation/2026-09-18-m2-sort-aliases/README.md).

### Review 2026-09-18 (M2 closed-sort aliases)

Seven items were kept and all seven are fixed.

- B-2 medium, dev/m2-translate-test.py:626: the unsupported-alias test now
  also calls `sort_domain` directly and asserts `False` for the opaque,
  unsafe, universe-polymorphic and foreign-mutual alias rows, so a deleted
  guard clause of the resolver fails the offline suite.
- A-3 low, dev/m2-translate.py:106: a chain of constant aliases that reaches
  the inspection bound without a sort stays a data binder and returns
  `False`, the HEAD rule, instead of a translator gap. The cycle refusal
  reads `recursive constant alias`. The sample is re-recorded; every capture
  stream stays byte-identical and only the translator hash moves.
- A-1 low, dev/m2-translate.py:254: an offline test compiles a family whose
  constructor field type is a sort alias and pins the erased `(0 b0 :` field
  text; a live test checks the same source through the checker.
- A-4 low, dev/m2-translate.py:236: the build log and the record README
  state that an inductive family type must still be a literal closed sort;
  only binder domains and constructor field types resolve aliases.
- C-1 low, dev/M2-BUILD-LOG.md:25: the section says that the 46 unchanged
  pinned inputs match the type-let record and that only dev/m2-translate.py
  changed, in place of a claim over all 47.
- C-2 low, dev/validation/2026-09-18-m2-sort-aliases/README.md:48: the
  README states that the controls script runs two control cases, one of
  them live, and needs the built `_build/default/bin/kanon.exe`.
- D-3 low, dev/validation/2026-09-18-m2-sort-aliases/controls.py:15: the
  script exits with status 2 when it receives an argument, before it sets
  the live argv, like its sibling `verify.py`.

The offline suite still runs 71 tests with 23 skips at exit 0. The
`translation-tests` capture predates the extended cases and keeps its
`Ran 71 tests` row. The record README holds the predate note. A re-capture
is not part of this review.

## Type-valued let translation and checking, 2026-09-18

Base: `42768bc236be720d158df9129478edc87b1e51f5`.

The translator now lowers type-valued lets and direct applications consuming
type or proposition lambda parameters through the existing typed-let path.
Every value retains its declared type check, including unused arguments.
The kernel normalizes a let's declared type and checks universe-valued
bindings in erased mode with zero quantity. This allows a type value to
refer to an enclosing erased parameter, including through a universe alias.
Ordinary runtime bindings retain their existing resource accounting.

All 62 translation tests pass with `--live`, including nineteen integrations.
Five new live cases cover full and partial type applications, let-headed
applications, dependent scopes, shadowing, higher sorts, proposition lets,
proof erasure and normalized universe aliases. They inspect erased bindings
and function signatures and require empty axiom reports. Invalid unused
values, invalid universe levels and changed computation witnesses fail.
Resource checks reject unused or duplicated linear values and runtime reads
of erased locals. Three existing offline cases now cover admitted sort
bindings and retained universe and expression limits.

The checker was rebuilt and the kernel, Wasm and M1 functional suites pass.
Declaration regressions, HOUSE and the trusted-line bound pass. The kernel
uses 5248 of 5250 lines. The retained parity gate exits 1 as expected for
the incomplete 51,980-name baseline. No full timing run or fresh Lean export
is claimed by this increment.

The refreshed 44-name sample still has five rechecked names and 39 explicit
gaps. Its generated sources and checker captures match the previous record;
provenance binds the changed kernel and translator and rebuilt executable.
These results credit no full-inventory translations. Prenex universes,
general Prop parity and the remaining M2 exit criteria stay open.

Evidence: [type-valued let validation](validation/2026-09-18-m2-type-lets/README.md).

## Closed-sort binder translation, 2026-09-18

Lambda and dependent-arrow binders over explicit closed sorts now lower to
zero-quantity Veil binders. Named generic definitions and proposition-generic
proofs retain dependent scopes while their type arguments disappear at runtime.
The kernel still checks every supplied argument, including unused ones.

Three live tests cover generic identity, type-argument forwarding, partial
application, two shadowed type binders, higher closed universes and generic
proofs. Erased signatures retain only the data parameters. Changed computation
witnesses fail conversion; incorrect universes, type arguments and data
arguments fail both checking and erasure. Three offline tests cover binder
visibility, scope, closed sort evaluation and the existing resource limits.
The previous plain type-binder refusal test is replaced by positive coverage;
type-valued lets and applications consuming type lambdas remain refused.

Validation in `/Users/oobi/Documents/gpt3/veil-m2-type-binders`, based on
`68b6f54013232005926d64fbfa2599e8524030d3`: all 55 translation tests pass,
including fourteen live integrations. The declaration suite passes 30 tests
and skips two optional Lean integrations. Fresh sample recording, offline and
live verification, HOUSE and TRUSTED-LINES pass. The incomplete parity gate
retains its expected exit 1. The
[validation record](validation/2026-09-18-m2-type-binders/README.md) retains
the seven captures and source hashes.

The sample sources and checker captures remain byte-identical, with five
rechecked names, 39 gaps and zero full-inventory parity credit. The checker
was reused after matching its source and binary hashes to the prior record.
Compiler, runtime, Lean and exporter sources are unchanged. This slice claims
no new compiler build, Lean export or full M1 timing run. Prenex universes,
general Prop parity and the user's M1 exit ratification remain open.

### Review 2026-09-18 (M2 closed-sort binders)

Five items were kept and all five are fixed.

- A-1 medium, dev/m2-translate.py:245: the compiler compares the quantity
  marks of the type telescope and of the value telescope, and refuses a
  declaration that erases one binder on one side only. A new offline test
  pins both directions. The sample is re-recorded, and its 14 capture
  streams and all 44 result rows stay byte-identical.
- A-2 medium, dev/m2-translate-test.py:473: a new offline test pins two
  stacked closed-sort binders with their full rendered type and value. A
  copy that erases the outer binder only now fails the offline suite.
- B-2 low, dev/M2-TRANSLATION.md:128: the document names the three kernel
  tests that refuse an erased binder read in a runtime position.
- C-1 low, dev/m2-translate.py:306: the recorded scope key holds
  `closed-universe-prototype`, the name that the documents use.
- B-3 low, dev/m2-translate.py:50: the unreachable 255 level cap is
  deleted, because the traversal fuel bounds a closed level to 127. The
  document states that effective bound.

The offline suite now runs 57 tests with fourteen skips at exit 0. The
`translation-tests` capture predates these tests and keeps its `Ran 55
tests` row. The record README holds the predate note. A re-capture is not
part of this review.

## Let-headed application translation, 2026-09-18

Extended the monomorphic translator to lower applications exposed through
explicit lambda and let nodes. Original let bindings retain their types and
values, supplied arguments keep their caller scope, and inner applications
supply arguments before pending outer ones. Unused bindings still receive
kernel type checks. Proof bindings erase through the existing rules.

Seven new live computation cases cover nested and mixed applications,
shadowed names, partial and higher-order functions, and dependent domains.
Changed result witnesses fail conversion. A proof case checks erasure and
runtime computation, plus rejected unused let values and lambda arguments.
Six offline cases pin lowering and retain depth, size and sort restrictions.

Validation in `/Users/oobi/Documents/gpt3/veil-m2-let`, based on
`d32b81208d4c9283e38f3d940f790939ab9d2e61`: all 48 translation tests pass,
including eleven live integrations. The declaration suite passes 30 tests and
skips two optional Lean integrations. Sample recording, offline and live
verification, HOUSE and TRUSTED-LINES pass. The incomplete parity gate keeps
its expected exit 1. The checker was reused after its source and binary hashes
matched the previous record. The
[validation record](validation/2026-09-18-m2-let/README.md) retains the seven
captures and their source bindings.

The sample retains five rechecked names and 39 explicit gaps, with zero
full-inventory parity credit. Compiler, runtime, Lean and exporter sources
are unchanged. General normalization, prenex universes and general Prop
parity remain open. This increment does not rerun the full M1 timing ladder
or supply the user's M1 exit ratification.

### Review 2026-09-18 (M2 let-headed application)

Seven items were kept: six are fixed and one is carried for a user ruling.

- A-1 medium, dev/m2-translate.py:89: the let branches now refuse a declared
  type that is a sort, in the application spine and in the plain render.
  A new offline test pins both directions. The sample provenance is
  re-recorded and its 14 artifact streams stay byte-identical.
- A-2 medium, dev/m2-translate-test.py:331: a new offline test pins the
  order of three surplus arguments after a let head.
- A-3 medium, dev/m2-translate-test.py:312: the dependent domain test now
  pins a let type that names the binding before it.
- C-6 low, README.md:190: the sentence names direct lambda applications
  again, together with the applications exposed through typed lets.
- C-1 low, validation/2026-09-18-m2-let/README.md:25: the uncaptured
  pre-change sentence is deleted here and in this log.
- D-1 low, validation/2026-09-18-m2-let/verify.py:60: the checker refuses
  an invalid review block and keeps its one-line verdict.
- CARRY A-2 of the 2026-09-17 m2-beta review, dev/m2-translate.py:108: the
  render memo keys on the node index and the depth, with no fuel part.
  The item waits for a user ruling.

The offline suite now runs 50 tests with eleven skips at exit 0. The
`translation-tests` capture predates these tests and keeps its `Ran 48 tests`
row. The record README holds the predate note. A re-capture is not part of
this review.

## Direct lambda application translation, 2026-09-17

Extended the monomorphic translator to lower direct lambda application chains
to nested typed lets. Arguments keep their caller scope, consumed parameters
retain their domain checks, and proof arguments erase through the existing
checker and erasure rules. Unused arguments are still checked. No evaluator,
unfolding rule or axiom was added to the translator.

The regression suite covers direct, nested, partial and higher-order
applications, shadowed binders, dependent parameter syntax and proof erasure.
Incorrect computed results fail conversion checks. An unused argument of the
wrong type fails both checking and erasure; replacing it with a valid argument
passes. Sort binders, excessive application depth and oversized generated
expressions remain refused.

Validation in `/Users/oobi/Documents/gpt3/veil-m2-beta`, based on
`680d50b0ed1877308058abdc4cc1ab479d641064`: all 38 translation tests passed,
including nine live integrations. The declaration suite passed 30 tests and
skipped its two optional Lean integrations. Fresh sample recording, offline
and live verification, HOUSE and TRUSTED-LINES passed. The incomplete parity
gate retains its expected exit 1. The checker was reused after its binary and
source hashes matched the committed translation record.

The [validation record](validation/2026-09-17-m2-beta/README.md) retains the
seven captures and their source bindings. The sample still has five rechecked
names and 39 explicit gaps; full-inventory parity credit stays zero. Compiler,
runtime, Lean and exporter sources are unchanged. General normalization,
prenex universes and general Prop parity remain open. This increment does not
rerun the full M1 timing ladder or provide the user's M1 exit ratification.

### Review 2026-09-17 (M2 direct lambda application)

Four items were kept and fixed. No item is carried for a user ruling.

- D-2, medium, dev/validation/2026-09-17-m2-beta/verify.py:57: the record
  checker reads an optional `review` key, hashes each named review file and
  accepts those regular files in the record file set.
- A-1, low, dev/m2-translate-test.py:224: three offline tests pin the exact
  lowering of a two binder spine with a surplus argument, of a partial
  application and of a dependent later domain.
- A-3, low, dev/m2-translate-test.py:239: one offline test pins both sides of
  the spine fuel boundary, the refusal at one less fuel unit and the exact
  string at the boundary.
- D-1, low, dev/validation/2026-09-17-m2-beta/verify.py:94: the checker
  message names a recorded pin, and the record README states that the binary
  fingerprint is a capture-time claim.

The offline suite now runs 42 tests with nine skips at exit 0. The
`translation-tests` capture predates these tests and keeps its `Ran 38 tests`
row. The record README holds the predate note. A re-capture is not part of
this review.

## Closed proposition and proof translation, 2026-09-17

Extended the monomorphic translator with closed `Prop` sorts, empty
inductive families and nonrecursive theorem bodies. Each theorem receives
a separate kernel-checked `Prop` guard before its body is checked. No axiom
is inserted. Unsupported polymorphism, sort binders, opaque declarations,
recursors and dependencies still produce explicit gaps.

The pinned 44-declaration sample now rechecks `True` and `True.intro` as well
as the three natural-family names. Five names recheck, 39 have explicit
translation gaps, and full-inventory parity credit remains zero. The
synthetic proof tests cover direct proofs, implication, proof lets and a
runtime function whose proof argument erases while its result still computes.
Negative checks reject false proofs, a changed computation result and a
data-valued theorem. Removing the theorem guard admits the latter only as
an ordinary definition. Failure accounting now tests each of the two sample
artifacts independently for checker, erasure, stderr and axiom failures.

Validation in `/Users/oobi/Documents/gpt3/veil-m2-prop`, based on
`bd610e6451a94f6931238e55da552d5a35e0487d`: all 33 translation tests passed,
including six live integrations. The declaration suite passed 30 tests and
skipped its two optional Lean integrations. Sample recording, offline and
live verification, HOUSE and TRUSTED-LINES passed. The incomplete parity
gate retains its expected exit 1. The existing checker was reused after
matching its source and binary hashes to the committed translation record;
no new compiler build is claimed.

The [validation record](validation/2026-09-17-m2-prop/README.md) retains the
seven final captures and verifies their source bindings. Compiler, runtime,
Lean and exporter sources are unchanged. General Prop parity, proof
preservation, prenex universes and the remaining M2 exit criteria stay open.
The full M1 timing ladder was not rerun, and the user's M1 stamp stays open.

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
