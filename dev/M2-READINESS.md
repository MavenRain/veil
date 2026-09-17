# M2 readiness, 2026-09-17

The M1 closure candidate passes all 27 current gates.  Its source starts at
`f0f3561dff00af8f4de90d1e0eec89e9130ef777` and adds bounded CLI batching to
the reactor tests.  At that capture, M2 implementation had not started, and
the closure increment still needed the user's commit and M1 exit ratification.
See the follow-up below for the committed increment and parity tooling.

The [validation record](validation/2026-09-17-m2-readiness/README.md) retains
the failed baseline, the passing candidate, complete transcripts, source
hashes, regression tests and three killed controls.

## M1 exit evidence

| Requirement | Current evidence |
| --- | --- |
| M0 exit committed | `90116b6`, `M0-EXIT ratified`, is in the current history. |
| Stages F through L committed | F `893b422`, G `c018a0f`, H `de40d65`, I `02b517e`, J `ac94fe3`, K `c418062`, L `b6a5af6`; follow-up `936a43a`. |
| Current executable battery | 27 of 27 PASS, ending in `GATES-OK`. |
| M0-TIME | 106.063 ms against 150 ms, three five-run medians. |
| M0-RATIO | 1.230804 against 2.000. |
| M1-CORPUS | 214.371 ms against 713 ms, 1,000 lines, main=814. |
| Arithmetic agreement | 7,445 cases: 5,445 unary and 2,000 full-range. |
| Lean evidence | All 56 pinned `meta/` sources and retained captures match the latest base-change record.  Its README fingerprint is historical.  No new Lean build is claimed. |
| Required historical mutations | The [September 7 audit](M1-BUILD-LOG.md#current-compiler-validation-2026-09-07) records all 29 required rows and their qualifications.  They were not rerun here. |
| M1 exit stamp | Still open.  The user supplies it after the committed-tree checks. |

The external [M1 plan, section 12](../../kanon-m1/M1-PLAN.md#12-m1-exit-stamp-decisions-corrections)
requires every leg to be green on the committed tree.  Its ratification row
says: "the user writes the date and \"ratified\" here; nothing else counts".
The recorded entry sequence was to commit this increment, run
`zsh dev/gates.sh` on that commit, and record the user's M1 exit stamp.
This record leaves that stamp open.

## M2 scope and first increment

The external [ratified design verdict](../../kan-lang-design-verdict.md),
lines 252 to 263, defines M2 as proof grade.  Its features are prenex universe
polymorphism, Prop, `SPar` with tracked `Quot.sound`, productive `SNu`,
typeclasses, well-founded recursion through `Acc`, and nested inductives
reduced to tag-indexed mutual `SMu`.

The proposed first increment after M1 exit is the parity inventory and gate
specification.  Pin the Lean toolchain and exported `Init` declaration set,
retain every name in the denominator, and record each translation and kernel
re-check.  Classify each failure as a kernel bug, ledger-row parity gap, or
translation gap.  A partial implementation must report its actual coverage.
This produces a measured baseline for the compiler increments.

The proposed order is:

1. Freeze that inventory, axiom set, corpus and measurement commands in an
   M2 plan and decision sheet.
2. Add prenex levels and Prop, with kernel re-checking and erasure coverage.
3. Add quotient and coinductive shape support with their axiom and
   productivity obligations.
4. Add typeclass elaboration, `Acc` recursion and nested-family reduction.
5. Close parity and performance gaps with the complete M2 battery.

The M2 exit thresholds in the verdict remain: at least 95 percent of exported
Lean `Init` declarations translate and re-check, no failure is unclassified,
axiom disclosure matches the ratified set, a 5,000-line corpus runs end to end
within the same-session `ocamlopt` comparison, and a warm re-check after one
definition changes takes at most 120 ms.  These are future exit criteria.

The [foundation audit](FOUNDATION-AUDIT.md) still leaves general typed
interpretation, compiler preservation and full Lean parity open.  The present
finite tests and bounded semantic bridges do not discharge those obligations.

## Follow-up, 2026-09-17

The closure increment is committed as `0955e62`.  The first M2 tooling slice
now provides the [parity inventory and gate specification](M2-PARITY.md).
It pins all 51,980 declarations from the exported Lean `Init` environment,
retains every name in a 0-percent baseline, and verifies the pinned module
artifacts against a fresh export.  The translator and M2 language features
remain unimplemented by this slice.  The user's M1 exit stamp remains open.
