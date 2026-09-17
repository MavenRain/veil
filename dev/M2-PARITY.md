# M2 parity inventory

The first M2 tooling increment freezes **51,980 declarations** from an
exported environment of **628 imported modules** in Lean
`leanprover/lean4:v4.33.0-rc1`. 535 of those modules own a declaration.
Its inventory SHA-256 is
`80dd1223088490394b6177e7b5fb8aa9e43b57799b9c8fa70504a2d4eb6e0cf4`.
The initial measured translation coverage is **0 percent**: no declaration
translation or Veil kernel re-check has been attempted by this harness.

Every inventoried name is explicitly retained in the baseline's translation
gap group. The shared reason is the missing Lean-to-Veil translator. This
does not assert that Veil cannot express each declaration, or that any
declaration exposed a kernel bug. The [validation record](validation/2026-09-17-m2-parity/README.md)
records reproduction and regression checks.

## Denominator

`meta/ExportInit.lean` creates a fresh environment with `importModules
#[{ module := Init }]` at `OLeanLevel.exported`. Its own `import Lean` is
used only to implement the driver; that environment is not enumerated.
The inventory contains every constant in the resulting environment, including
constructors, recursors, generated names and private dependencies retained by
exported module data. There is no namespace, kind or name-based exclusion.
Declarations absent from the exported environment are outside this explicitly
pinned denominator.

The driver emits the name, originating module, exported constant kind,
universe parameter names and private-name flag. Python sorts the names and
modules, rejects duplicates, and writes deterministic UTF-8 JSON Lines. Name
renderings use Lean's `Name.toString`; the uniqueness check refuses collisions.
The first line is the header; every subsequent line is one declaration.

An exported `axiom` kind is **not an axiom-dependency disclosure**. At the
exported level Lean represents three declaration forms of a module-system
file as an axiom. These forms are a theorem, a definition without
`@[expose]`, and an opaque constant. The axiom count is therefore not a
count of Lean axioms. The inventory neither reads proof bodies nor
establishes the eventual translated axiom set. That requires a separate
dependency audit and the M2 axiom gate.

`dev/m2-init/pin.json` pins the inventory bytes, exporter source, exact Lean
toolchain and version banner, declaration count, and SHA-256 of all 628
imported `.olean` files. These hashes bind this installed toolchain's artifacts;
a different platform's artifacts may require a separately reviewed snapshot.
The exporter clears `LEAN_PATH` and `LEAN_SRC_PATH` before invoking the pinned
toolchain through `elan`. An unavailable toolchain or module is an error.

## Commands

Run from the repository root:

```sh
python3 -I dev/m2-parity-test.py
python3 -I dev/m2-parity.py verify
python3 -I dev/m2-parity.py verify --live
python3 -I dev/m2-parity.py gate
```

`verify` checks the stored inventory, denominator, local exporter/toolchain
pins and complete baseline accounting. It needs only Python. `verify --live`
also runs the pinned Lean exporter and compares the complete declaration set,
metadata, version and module fingerprints. Offline verification cannot detect
a self-consistent rewrite of the inventory and all its pins; live reproduction
is required when establishing or changing the denominator. Neither command
claims a successful translation or a passing M2 exit gate.

`gate` verifies integrity and exits **1** for this valid, incomplete baseline.
It cannot mark M2 parity passed. Successful inventory verification exits **0**;
invalid data, missing files or a failed exporter exit **2**. No incomplete
snapshot is published after an exporter failure.

For an intentional new snapshot, choose a directory that does not exist:

```sh
python3 -I dev/m2-parity.py snapshot --output dev/m2-init-candidate
python3 -I dev/m2-parity.py verify --inventory dev/m2-init-candidate --live
```

Compare its names and pins with the committed denominator before adopting it.
The command refuses an existing destination. It never silently regenerates
`dev/m2-init` during verification.

## Differential gate contract

The ratified design's M2 threshold is at least 95 percent of exported `Init`
declarations translating and re-checking, with no unclassified failures.
For this denominator, at least **49,381** distinct declarations must pass.
A future result schema must retain exactly the inventory's name set and
fingerprint. No omitted, duplicated, renamed, unsupported or skipped name may
reduce the denominator.

Each successful result must bind the original Lean declaration and its
dependencies to the translated Veil source. It must record the translator
version. It must retain a successful Veil kernel re-check of that
artifact. Merely
checking an unrelated `.kan` file cannot count as translation success. The
gate compares `100 * successes >= 95 * denominator` without rounded
percentages. Every unsuccessful result must include evidence and one of:

| Classification | Meaning |
| --- | --- |
| `kernel bug` | A supported, faithful translation exposes a checker defect. |
| `ledger-row parity gap` | The compiler lacks a required language feature. |
| `translation gap` | The translator cannot yet produce the required artifact. |

The present schema deliberately supports only the initial, unattempted
translation-gap baseline. It rejects fabricated attempts, kernel re-checks,
successes and threshold claims. The translator and its evidence-bearing
result schema are the next implementation work.

M2 also requires the ratified axiom disclosure. It requires a 5,000-line
end-to-end corpus against a same-session OCaml comparison. It requires a warm
re-check within 120 ms after a one-definition edit. These remain open. This increment adds no kernel
forms, changes no existing M1 gate, and does not write the user's M1 exit
ratification. See [M2 readiness](M2-READINESS.md) for the entry record.
