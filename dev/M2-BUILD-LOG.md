# M2 build log

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
