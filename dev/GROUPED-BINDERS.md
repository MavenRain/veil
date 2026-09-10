# Grouped binders, 2026-09-10

Continuation from `2ee38c92c65554910d93c179f2a8e3459dacb537`.
The wave 5 handoff left F5-9 open: several names could not share a
binder annotation, including the `(a b : fhc 2 Nat)` spelling in the
original Veil examples.  The parser now expands a group into consecutive
binders before elaboration.  This closes the syntax gap.  Multi-ciphertext
`eval` remains a separate kernel and runtime extension.

The same expansion serves function and definition parameters, arrow and
pair types, family and constructor telescopes, typed branch fields, and
the binders of a numeric case leg.
It preserves source order and repeats the annotation and quantity for
each name.  An annotation is checked in the same scope as its expanded
spelling, including any preceding binders.  The SPEC records the
precedence rule for annotations followed by arrows or stars.

Validation ran in the isolated checkout
`/Users/oobi/Documents/gpt18/veil-next` before copying identical source
bytes to the main checkout:

- `zsh dev/dunecho.sh build`: 0 errors, 0 warnings.
- Surface regression suite: 36/36, including 16 new cases for grouped
  syntax, expansion equivalence, quantities, round trips, parser errors
  and a refused branch field annotation.
- The new fixture checks and erases against saved goldens.  Two negative
  fixtures reject dropping a linear argument and reading an erased one.
- `kanon run test/fixtures/grouped-binders.kan --export groupResult`
  with `--host kernel` and `--host both`: all three evaluators return `42`.
- `zsh dev/gates.sh`: all 26 legs pass and the run ends `GATES-OK`.
  Load1 was 29.21 at launch.  Timing thresholds passed without changes.
- Trusted size stays `kernel=5120/5250 encoder=246/600`.
- `git diff --check`: clean.

The complete gate and surface logs are under
`dev/validation/2026-09-10-grouped-binders/`.  The README now reflects
the existing MPC implementation and introduces the grouped syntax.

## Review 2026-09-10

- D-1, the `name+` row made the sugar-table `q` rows read as groups.
  Section 7 now says that `q` in a surface form is the optional mark and
  not a name, so `(q x : A)` stays one binder.
- B-1, the grouped branch case passed with no annotation.  The surface
  suite adds `grouped-branch-annotation`, which refuses a shared
  annotation that disagrees with the second constructor field.
- A-1, the context list omitted the numeric case leg.  SPEC section 9,
  the README and this note now name the leg binders.
- A-2, the grammar row admitted only the characters `0` and `1`.  The
  row now reads a `mark` nonterminal, and the prose says that the parser
  reads the mark by value, so `00` and `01` are marks as well.
- D-1 round 2, the legend of section 7 claimed every `q` of section 4.
  The legend now covers the surface forms only, and it says that `q` is
  an ordinary binder name in the mpc predicate `(0 q : Sub P) -> Prop`.
