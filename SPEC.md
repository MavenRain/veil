# kanon M0 specification (veil)

Date: 2026-09-05.  Status: M0 Stage A.  This file pins the closed grammar
and the R0 counts.  The gate legs R0-COUNT and R0-AUDIT read it.

## 1 The claim

kanon has two type formers, Lan and Ran.  Every type comes from one of the
two, applied to a shape and a diagram.  There are four schema
constructors: In and Elim for Lan, Sec and Out for Ran.  There is one
dispatch point, lib/rules.ml, which maps a shape to its rule pack.  No
other module in the kernel reads a shape name.

Every surface form in section 8 is sugar for one kernel constructor.  No
surface form is a former.

## 2 The closed grammar

The shape sum, the term sum and the erased form are declared whole at
Stage A (D-M0-2).  A constructor past M0 is refused by the module named
in its row, with its milestone name in the message.  A later milestone is
then a loud edit to an exhaustive match, not a new constructor.

### 2.1 Shapes, lib/shape.ml

| constructor | milestone | refused by |
| --- | --- | --- |
| `SPi of Quantity.t * string * 'a` | M0 | admitted |
| `SColl of int` | M0 | admitted |
| `SPar of 'a * 'a` | M2 | rules.ml |
| `SMu of string * 'a list` | M1 | admitted |
| `SNu of string * 'a list` | M2 | rules.ml |
| `SZk of Quantity.t * string * 'a` | V1 | admitted |
| `SFhc of 'a` | V2 | admitted |
| `SMpc of 'a * 'a` | V3 | admitted |

The type parameter is the kernel term.  lib/term.ml therefore spells no
shape name (SA-D5).

Strict positivity, M1 Stage G, lib/positivity.ml.  A constructor field
admits the family it declares only strictly positively.  An occurrence
to the right of an arrow is admitted.  An occurrence to the left of an
arrow, an occurrence in an argument of a former, and an occurrence under
any other former, are refused with the word `a family that is not
strictly positive arrives at M2`.  A nested inductive is therefore M2
and is never reduced to a positive form (D-M1-2, R-Q5).  The check runs
once, when the constructors are installed, and formation reads the
stored verdict (A4).

The fibered elimination, M1 Stage H, lib/rules.ml.  An `Elim` at a mu
shape takes a motive, and an `Elim` with `e_motive` of `None` is refused
with the word `an elimination at a mu shape needs a motive`:  the branch
types of an indexed family are not recoverable from the type of the
scrutinee alone (A7).  The `m_ind` of the motive names a family, and
that name is equal to the family of the scrutinee, so a motive built for
a sibling family is refused.  The `m_idx` of the motive binds one name
per index of that family, and the scrutinee stands at that many indices.
A branch is keyed by the constructor address `ACtor c`, and it binds one
binder per field of that constructor at the mark the field carries.  The
branch list is read in the declaration order of the family:  a
constructor with no branch is refused, a constructor with two branches
is refused, and a branch at a name the family does not declare is
refused.  The body of a branch is checked at `m_body`, read at that
constructor's result index expressions and at that constructor's own
introduction.  An `Elim` at `In (SMu .., ACtor c, args)` reduces to the
branch at `c` with the arguments substituted.

### 2.2 Terms, lib/term.ml

Thirteen constructors.  Two of them form types.

| constructor | milestone | refused by |
| --- | --- | --- |
| `Var of int` | M0 | admitted |
| `Univ of Level.t`.  Prop is `Univ zero` and `Type n` is `Univ (n + 1)` (SB-D2) | M0 | admitted |
| `Lan of t Shape.t * t` | M0 | rules.ml, per shape |
| `Ran of t Shape.t * t` | M0 | rules.ml, per shape |
| `In of t Shape.t * addr * t list` | M0 | rules.ml, per shape |
| `Elim of elim` | M0 | rules.ml, per shape |
| `Sec of t Shape.t * leg list` | M0 | rules.ml, per shape |
| `Out of t Shape.t * addr * t` | M0 | rules.ml, per shape |
| `Let of string * t * t * t` | M0 | admitted |
| `Ann of t * t` | M0 | admitted |
| `Global of string` | M0 | admitted |
| `Lit of Literal.t` | M0 | admitted |
| `Auto` | M2 | check.ml, "instances arrive at M2" |

Addresses.  `APt` is the point address and carries the argument.  `ALeg`
is the leg address.  `ACtor` is the constructor address of the two
recursive shapes, so it arrives at M1 and M2.

### 2.3 The erased form, lib/eterm.ml

| constructor | milestone | refused by |
| --- | --- | --- |
| `KVar KLit KGlobal KErased KLet` | M0 | admitted |
| `KClos KApp KTail` | M0 | admitted |
| `KStruct KProj KTag KCase` | M0 | admitted |
| `KDelay KForce` | M2 | emit.ml |
| `RI31 RStruct RUnion RFunc` | M0 | admitted |
| `RThunk` | M2 | emit.ml |
| `KFun KRec` | M0 | admitted |

`tid` and `fid` are symbolic names and never integers.  lib/link.ml
resolves them to indices in one pass, so the emitter never computes an
index.

lib/erase.ml maps each kernel form to one erased form.  The table below
has one row for each row of the erasure section of the plan.  The third
column gives the name the row writes, either a `tid` or a `fid`.

| kernel form | erased form | name |
| --- | --- | --- |
| `Var` | `KVar i` for a runtime binder, `KErased` for a dropped binder | none |
| `Univ`, `Lan`, `Ran` | `KErased` | none |
| `Sec` at `Ran SPi` | the lambda chain lifts to one `KFun` and the occurrence is `KClos (fid, arity, captures)` | `fid` is `NAME$N` |
| `Out` at `APt` | `KApp (head, args)`, `KTail (head, args)` in a tail position, or the head alone when no argument is runtime and source parameters remain | none |
| `In` at `Lan SPi` | `KStruct (tid, the runtime fields)`, `KErased` when no field is runtime | `tid` is `pair<R,R>` |
| `Elim` at `Lan SPi` | one `KLet` of the scrutinee, then one `KLet` over a `KProj` for each runtime binder | `tid` is `pair<R,R>` |
| `In` at `Lan (SColl n)` | `KTag (tid, k, the runtime payload)` | `tid` is `sum<R\|R>` |
| `Elim` at `Lan (SColl n)` | `KCase (tid, scrutinee, one branch for each leg in leg order)` | the checked scrutinee `tid` is `sum<R\|R>`, or `any` for an empty sum |
| `Sec` at `Ran (SColl n)` | `KStruct (tid, the runtime legs)` | `tid` is `tuple<R,R>` |
| `Out` at `ALeg k` | `KProj (tid, k renumbered over the runtime legs, the term)` | `tid` is `tuple<R,R>` |
| `In` at `Lan (SMu ..)` | `KTag (tid, the constructor index in declaration order, the runtime fields)`, and a tag with no payload for a constructor that takes no runtime field | `tid` is `mu<NAME>`, and an index argument never enters it, because every index binder carries the mark 0, so two constructors that differ only in indices give one tid and one tag |
| `Elim` at `Lan (SMu ..)` | `KCase (tid, scrutinee, one branch for each constructor in declaration order)`, and a branch body that is the recursive call itself is `KTail` | the checked scrutinee `tid` is `mu<NAME>`, and the rec group of the declaration also names the leg struct `leg<mu<NAME>,K,R,R>` of each constructor |
| `Let` | `KLet (x, value, body)` for a runtime value, and the binder is dropped for a value that is not | none |
| `Ann` | the term under it, erased | none |
| `Global` | `KGlobal name` | none |
| `Lit` | `KLit` | none |
| `In` at `Lan SZk` (`prove y w r`) | `KApp (KGlobal zkProve, [the instance, the witness])`, because the proof is a host blob; the slot holds the instance as its flag and the witness as its plaintext, and the erased blob type is `union any` | none |
| `Sec` and `Out` at `Ran SFhc` (`enc`, `eval`, `dec`) | `KApp (KGlobal fhcEnc, [the level, the plaintext])`, `KApp (KGlobal fhcEval, [the out level, f, the slot])` and `KApp (KGlobal fhcDec, [the slot])`; the slot holds the level and the plaintext, and only `dec` answers a Nat | none |
| `Sec` and `Out` at `Ran SMpc` (`input`, `mpc`, `open`) | `KApp (KGlobal mpcInput, [the plaintext])`, `KApp (KGlobal mpcShare, [the subset, f, the share slots])` and `KApp (KGlobal mpcOpen, [the slot])`; the slot holds the party flag, which is the constant `0` in v1, and the plaintext, and only `open` answers a Nat | none |
| `Auto`, `Sec` and `Out` at `SMu`, every form at `SPar` and at `SNu` | `Error (Not_yet ..)` with the milestone word | none |

A function type takes the repr `func fn<n>`, where n counts the runtime
points of the whole chain.  `Nat` takes the `nat` union repr.  A type that the table
does not name takes the tid `any`.

Constructor layouts are computed with the family parameters and earlier
fields bound as variables.  Each nominal family therefore has one layout
across parameter instantiations as well as indices.  A field that always
erases has no slot.  A generic slot instantiated at an erased type holds
`KErased`, preserving the positions of later fields and branch binders.

Function definitions and lifted functions take the parameters of their
whole type chain.  When the body supplies fewer lambdas, erasure adds
the remaining parameters and a tail application of the body.  Thus a
function alias and an explicit lambda have the same calling convention.
An application with only erased arguments preserves a function result,
including a function whose remaining binders all erase.  A fully applied
nullary function still emits a call with an empty argument list.

Erasure emits the original runtime syntax, retaining lets and primitive
calls.  Its checking environment retains let definitions for dependent
types, and a pair fibre receives the codomain instantiated at its point.
Each elimination branch receives the motive instantiated at that branch's
constructor.  These semantic values resolve types; they do not replace
the emitted runtime syntax.  Structural layouts still open dependent
codomains at fresh variables so a type has one layout across its values.

`kanon check --erased FILE` prints the erased program.  A `KFun` prints
as `fun FID (REPR, .., REPR) : REPR := KTM`, and a `KRec` prints as `rec
[TID; ..]`, one declaration to a line.  A repr prints as `i31`, `struct
TID`, `union TID`, `func TID` or `thunk TID`.  A ktm prints in prefix
form with its constructor name, then its scalar fields, then a subterm in
parentheses and a list in square brackets with semicolons.  A declaration
that carries nothing at runtime prints `erased NAME`.  A postulate prints
`axiom NAME : REPR`.  A name prints bare, without quotes.

An erased field leaves the struct, the tag and the tid, and a `KProj`
index counts the runtime fields alone.  A struct with no runtime field is
`KErased`.  A `KVar` counts runtime binders alone.  The erasure
environment maps each kernel binder to a runtime index or to erased, and
a use of an erased binder is `KErased`.

### 2.4 The circuit fragment, lib/circuit.ml

A definition is a circuit when its body computes a multiplicative depth
that is finite and known before the program runs. `Circuit.depth` walks
the closed term and answers `Ok d` or refuses with one head word.
`lib/circuit.ml` is a kernel file, so every rule below takes the side
that never reports less depth than the body can reach.

Admitted forms, with the depth each one gets:

| form | depth |
| --- | --- |
| `Univ`, `Lan`, `Ran`, `Lit`, a bound variable | 0 |
| a primitive name, applied or bare | `cost name` |
| a saturated primitive call | `cost name` plus the largest argument depth |
| `In` at `SColl`, and `In` at `SPi` | the largest depth in the address and the arguments |
| `In` at `SMu` | the largest field depth; a field that names the family must be a closed constructor tree, through acyclic global aliases |
| `Out` at `SColl`, a projection | the depth of the record |
| `Sec` at `SPi` with one leg | a closure; the depth of the body with each parameter read as 0 |
| `Out` at `SPi`, an application | the depth of the callee body with the argument depths in place |
| `Elim` at `SPi` or `SColl`, a case | the larger of the scrutinee depth and 1 plus the largest branch |
| `Elim` at `SMu` on a closed constructor tree | the largest branch; a branch that reads a field of its own constructor can fold, so the constructor height, counting the leaf, multiplies it |
| `Let` | the depth of the body with the bound value in place |
| `Ann` | the depth of the term inside |
| `Global` naming a definition | the depth of that definition body |

The cost table is flat and closed. Each of the five M0 primitives
`natAdd`, `natSub`, `natMul`, `natEq` and `natLt` costs 1, and
`Circuit.cost` answers `None` for every other name. A bare primitive
name costs the same as a saturated call, because v1 does not track
partial application.

D-7 gives eleven head words: `mu`, `auto`, `host op`, `SPar`, `SNu`,
`SZk`, `SFhc`, `SMpc`, `unbounded iteration`, `unknown global NAME` and
`opaque callee`. A shape that arrives at a later milestone refuses with
its own name. A global that is met a second time while its first
unfolding is still open refuses `mu`. A global with no body refuses
`unknown global NAME` where the reader evaluates it. In the scrutinee of
a match at `SMu` it refuses `unbounded iteration`, because the
finite-tree certificate runs before the evaluation and a global with no
body certifies no tree. An application whose callee is a plain value,
not a closure, refuses `opaque callee`.

`Circuit.depth` returns the bare head word as its `Error` payload.
`Circuit.word` adds the full sentence, `circuit fragment arrives at V5:
HEAD`. A rule pack that turns a refusal into `Error.Not_yet` calls
`Circuit.word`. The driver prints the bare head and strips no prefix.

An `Elim` at `SMu` accepts a finite constructor tree written at the match
site or reached through acyclic global definitions and annotations. Every
field must recursively be a constructor tree or a literal. Its height is
one plus the maximum child height of the matched family; literals and a
payload of another family have height zero. A scrutinee of height zero
reaches no branch of the match, so it refuses `unbounded iteration`. The
height multiplies the largest branch only when a branch reads a field
that its own constructor binds, because such a branch can fold over the
tree. A match whose branches read no field of their own constructor runs
one branch once, so its depth is the largest branch alone. The largest
branch counts the branch of a leaf match, and every field must pass,
which prevents a known child from hiding an opaque sibling. A product or
increment beyond the host depth integer refuses `unbounded iteration`.

Variables (including local let bindings), computed fields, functions,
unresolved globals and cycles cannot certify a match bound. Such matches
refuse `unbounded iteration`. A constructor value keeps the largest
depth of its fields, and refuses `mu` only when a field names its own
family and no certificate covers that field. A field of any other shape
is ordinary data at its own depth, and an unknown global inside a field
keeps the `unknown global NAME` refusal.
Recursive branch functions retain the global-cycle refusal. This
slice does not unroll recursive functions. Resolving a Zero-quantity
argument to a public bound remains deferred.

`kanon circuit FILE` prints one line for each definition in the file,
in source order: `NAME: depth D` when the definition is a circuit, and
`NAME: refused: HEAD` when it is not. The verb exits 1 when the file
holds at least one refused definition, and 0 when every definition is a
circuit. `test/circuit-spine.kan` holds one definition for each
admitted form and for each reachable head, and the CIRCUIT gate leg
diffs the output against `test/golden/circuit-spine.circuit`.

Seven head words cannot be reached by a file that passes `kanon check`
at this pin: `SPar`, `SNu`, `SZk`, `SFhc`, `SMpc`, `host op` and
`auto`. The five shapes are refused as whole shapes by `lib/rules.ml`
before `circuit` runs, and the surface language has no syntax that
builds a checked term of any of them; `Term.t` has no host operation at
all; and `lib/check.ml` refuses `Term.Auto` outright, so a file that
uses an instance fails the check before the circuit walk starts.

## R0 counts

`kanon spec-count` prints this block.  dev/r0-count.sh diffs the two.  A
count that grows fails the R0-COUNT gate leg.

```
formers 2: Lan Ran
schema constructors 4: In Elim Sec Out
shapes declared 8: SPi SColl SPar SMu SNu SZk SFhc SMpc
shapes admitted 6: SPi SColl SMu SZk SFhc SMpc
named rules declared 6: proof-irrelevance subsingleton-large-elimination literal-fast-path zk-fhc zk-mpc fhc-mpc
named rules present 3: proof-irrelevance subsingleton-large-elimination literal-fast-path
eta rows 3: Ran-SPi Lan-SPi Ran-SColl
no eta 9: Lan-SColl Ran-SMu Lan-SMu Ran-SZk Lan-SZk Ran-SFhc Lan-SFhc Ran-SMpc Lan-SMpc
```

Every number in the block is the length of the list printed after it.
lib/spec_count.ml reads the shape lists from Shape and the former and
schema lists from Term.

## 4 The eta table

The criterion is one test, from plan section 5: a shape gets an eta row
when it has a unique introduction address and its structural expansion
ends.  The table below is derived from that test, not declared.

| row | former and shape | expansion | present |
| --- | --- | --- | --- |
| Ran-SPi | Ran at SPi | `f` to `Sec [x => Out (APt x) f]` | yes |
| Lan-SPi | Lan at SPi | `p` to `In (APt p.1) [p.2]` | yes |
| Ran-SColl | Ran at SColl n | `t` to `Sec [Out (ALeg 0) t, .., Out (ALeg n-1) t]` | yes |
| Lan-SColl | Lan at SColl n | none | no |
| Ran-SZk | Ran at SZk | none | no |
| Lan-SZk | Lan at SZk | none | no |
| Ran-SFhc | Ran at SFhc | none | no |
| Lan-SFhc | Lan at SFhc | none | no |
| Ran-SMpc | Ran at SMpc | none | no |
| Lan-SMpc | Lan at SMpc | none | no |

Lan at SColl n has n introduction addresses, one per leg, so the
criterion fails and the row is absent.  Ran at SZk is refused, so it has
no expansion to write.  Lan at SZk has one introduction address, but a
proof does not project its witness, because the witness is erased, so
the expansion cannot be written and the row is absent.  Lan at SFhc is
refused, so it has no expansion to write.  Ran at SFhc has one
introduction address, the ciphertext section, but the shape has no beta,
so the elimination of an introduction does not give the parts back and
the expansion cannot be written.  Lan at SMpc is refused, so it has no
expansion to write.  Ran at SMpc has more than one introduction address,
because a share section, an input section and a joint section all
introduce the same share type, so the criterion fails.  Ran at SColl 0 holds, and it
gives Unit its eta.  conv.ml applies each row by expansion.

### 4.1 The rule pack, lib/rules.ml

`rules : 'a Shape.t -> (rule_pack, Error.t) result` is the one dispatch
point.  It gives a pack to the four admitted shapes.  It gives
`Error (Not_yet ..)` with the milestone word to the other four.  The
pack has these fields, as built.

| field | what it decides |
| --- | --- |
| `form_lan` | the level of `Lan s d`.  It reads the diagram and `expected : Level.t option` (SB-D6) |
| `form_ran` | the same for `Ran s d` |
| `intro_in` | checks `In` against an expected `Lan` |
| `elim_elim` | checks or infers `Elim`.  `expected : Value.t option` is the constant cocone of a motive free elimination |
| `intro_sec` | checks `Sec` against an expected `Ran` |
| `elim_out` | infers `Out` |
| `beta` | one reduction step at the shape.  The evaluator calls it |
| `eta` | the row of the eta table above, one flag per former |
| `diagram_arity` | how many binders the diagram opens.  Readback asks it, so no reader outside the pack knows (SB-D25) |
| `spine_ty` | one typed step along a neutral spine:  the type of the address argument and the type of the head after the step (SB-D25) |
| `expand_ran` | the eta expansion at the right former.  The SB-M1 site is on this field of the point pack |
| `expand_lan` | the eta expansion at the left former |
| `conv_diagram` | compares two diagrams at the shape |
| `ann_lvl_eq` | compares the carried universe of SB-D7.  Only the width zero collection reads it |
| `lan_lvl` | the level function of the left former |
| `ran_lvl` | the level function of the right former |

A rule reads the checker through an `ops` record, so rules.ml does not
depend on check.ml and no ref cell exists in lib/ (SB-D12).

### 4.2 The zk pack, veil D-9

The zk shape `SZk (q, w, W)` carries the quantity of the witness, the
name of the witness and its type.  The left former is the proof type and
the surface writes it `zk (q w : W) * R`.

| rule | what the pack decides |
| --- | --- |
| formation | `Lan (SZk (q, w, W)) R` stands at the universe of `W` joined with the universe of `R`, which is the join the point rules compute, so the proof type never sits at `Prop` |
| In | `prove x w r` is `In (SZk ..) (APt (q, w)) [r; x]`.  It checks against an expected left former, and the witness stands at the quantity the type declares |
| Elim | `verify x p` is an `Elim` at the left former with the leg address `ALeg 0`.  The one branch binds the witness and the relation |
| beta | `verify x (prove x w r)` converts to the relation at that witness, so a proof of the relation is a proof of the statement |
| no eta | neither former gets an eta row.  See section 4 |

The runtime proof is a plaintext slot holding the public instance and witness.
The ordinary runtime function `zkVerify` returns 1 only when the supplied
instance matches the stored instance and the supplied relation holds.
It returns 0 for a mismatch even if that witness satisfies another statement.
The relation is not bound into the slot, and the twin provides no cryptographic
security. Surface `verify` remains a proposition; the runtime function is
tested directly through the ABI described in [REACTOR.md](REACTOR.md).

The refusal words of the pack.  The right former answers `Ran SZk
arrives at V5`, because a co-proof has no meaning in v1.  The circuit
predicate answers `circuit fragment arrives at V5: HEAD` when the
relation reads a head the fragment cannot compile, for example a
postulate or a recursive family.

### 4.3 The fhc pack, veil D-10 and D-11

The homomorphic shape `SFhc l` carries the level of the ciphertext.  The
right former is the ciphertext type and the surface writes it
`fhc l T`.  The level is a `Nat` literal and `T` is a fragment type, that
is a type the circuit reader of section 2.4 can compile.

| rule | what the pack decides |
| --- | --- |
| formation | `Ran (SFhc l) T` stands at the universe of `T`, so a ciphertext type sits where its plaintext type sits |
| Sec, enc | `enc pk t` is `Sec (SFhc 0) [pk; t]`, a fresh ciphertext.  A fresh ciphertext starts at level 0 |
| Sec, eval | `eval f c` is `Sec (SFhc l) [f; c]`, the same section with a function as its first item.  The level of the result is the level of `c` plus the depth of `f`, which is the depth the circuit fragment of `f` reports |
| Out | `dec sk c` is `Out (SFhc l) (APt (One, sk)) c`.  The key is consumed once and the answer is the plaintext type |
| no beta | `dec sk (enc pk t)` does not convert to `t`.  A ciphertext is a host value, so the pack gives the shape no beta rule (D-10).  The evaluator answers `an elimination met a value it cannot eliminate` at such a term |
| no eta | neither former gets an eta row.  See section 4 |

The refusal words of the pack.  The left former answers `Lan SFhc
arrives at V5`, because a co-ciphertext has no meaning in v1.  Erasure of
a ciphertext type, of a key or of a ciphertext answers `host blobs
arrive at V4`, because each one is a host value and the erased form
carries no host value.  The circuit predicate answers `circuit fragment
arrives at V5: HEAD` when the function under `eval` reads a head the
fragment cannot compile, for example a postulate.  The check-time words
are `the level of a ciphertext type is a Nat literal`, `a ciphertext
carries a fragment type`, `a ciphertext needs a right former as its
expected type`, `a ciphertext section takes two arguments`, `the
argument of eval or dec is not a ciphertext`, `eval takes a function
from the plaintext type to the result type`, `the key of dec is consumed
once`, `enc starts at level 0` and `the level of the result is the level
of the argument plus the depth of the function`.  D-13 discloses the
framework axiom `fhc-correctness` at every program that holds the shape.

Three departures from the plan stand in v1.  `eval f c` takes ONE
ciphertext; the `eval f c1 .. cn` form arrives at V5.  A level is a `Nat`
literal, not a term.  A dependent function under `eval` is refused,
because the result type of the section is the plaintext type of the
answer and it cannot depend on the plaintext.

### 4.4 The mpc pack, veil D-12

The multi party shape `SMpc (P, A)` carries the party set `P` and the
authorization predicate `A`.  The right former is the share type and the
surface writes it `mpc[P, A] T`.  `P` is a finite enumeration, that is a
`Lan (SColl n)` whose every leg reduces to the empty record.  `Sub P` is
the record `Ran (SColl n)` of `n` membership flags, one `Nat` for each
party, `1` for present and `0` for absent.  `A` is the predicate over
`Sub P`, the type `(0 q : Sub P) -> Prop`, and the binder stands at
`Quantity.Zero`.

| rule | what the pack decides |
| --- | --- |
| formation | `Ran (SMpc (P, A)) T` stands at the universe of `T`, so a share type sits where its payload type sits.  The party set and the predicate never lift it |
| Sec, share | `share x` is `Sec (SMpc (P, A)) [x]`, the one leg section.  The payload stands at the payload type |
| Sec, input | `input p x` is `Sec (SMpc (P, A)) [p; x]`, the two leg section.  The party stands at `P` and the payload at the payload type |
| Sec, mpc | `mpc ps f c1 .. cn` is `Sec (SMpc (P, A)) [ps; f; c1; ..; cn]`, the joint section.  `ps` stands at `Sub P`, `f` is a function of the `n` share payload types and the pack reads the depth of its circuit fragment |
| Out | `open Q h c` is `Out (SMpc (P, A)) (APt (Zero, In (SPi (Zero, q, Sub P)) (APt (Zero, Q)) [h])) c`.  The address carries the party subset `Q` with the authorization proof `h` at the erased mark, and the answer is the payload type |

The share type has no beta and no eta.  A joint section does not give
its parts back, because the parts stand at the parties and not at the
kernel, so `beta` answers none and both eta rows of section 4 are
absent.  The left former answers `Session arrives at V5`.

The check-time words are `the party set of an mpc type is a finite
enumeration`, `a share needs a right former as its expected type`, `an
mpc section leg binds nothing`, `an mpc section takes one argument or
more`, `mpc takes a function from the share types to the result type`,
`the result of mpc is the type that remains after the last share`, `open
takes the party set address with the authorization proof`, `the
authorization proof of open is erased`, `open carries one authorization
proof` and `the argument of open is not a share`.  D-13 discloses the
framework axiom `mpc-simulatability` at every program that holds the
shape.

One departure from the plan stands in v1 (R-W3-8).  The joint function
is not dependent:  the pack peels one domain for each share and the
result after the last share must be the payload type, so a domain that
reads an earlier share arrives at V5.

## 5 The named rules ledger

These are the conversion rules that are not schema rules.  Three are
declared;  two are present at M0 and the third arrives at M1 Stage H.

| rule | status | where |
| --- | --- | --- |
| proof-irrelevance | present at M0 | conv.ml, step one: two terms at a type in `Univ zero` are equal |
| subsingleton-large-elimination | present | conv.ml, step one, through the `subsingleton` field of the rule pack.  The three-part criterion is tot's, at kan-lang-tot-pin/lib/check.ml:219 and :223 |
| literal-fast-path | present at M0 | conv.ml, step three: `Lit` compares by value and the five prims reduce on literal arguments |
| zk-fhc | declared | V5: an SZk value and an SFhc value never convert; declared now so R0 counts the boundary, discharged when fragment composition lands |
| zk-mpc | declared | V5: an SZk value and an SMpc value never convert; same boundary, declared now |
| fhc-mpc | declared | V5: an SFhc value and an SMpc value never convert; same boundary, declared now |

The criterion, M1 Stage H, lib/rules.ml `mu_zero_eliminable`, ported
part for part from kan-lang-tot-pin/lib/check.ml:223.  Part one: the
family has no constructor, which is the empty family and gives ex falso
(pin check.ml:227), or it has exactly one constructor (pin
check.ml:228).  Part two: every argument binder of that constructor is
at the mark `Zero` (pin check.ml:231).  Part three: that constructor is
not self recursive (pin check.ml:232).  A family under declaration and a
kernel family both answer false (pin check.ml:225-226), and a family
with two constructors or more answers false (pin check.ml:233).  A self
recursive family therefore never gets a large elimination, and the words
"the Prop-valued recursive shape" name the milestone that adds the
recursive shape and are not a permission for a recursive family (A1).
An elimination out of a family at the universe `Prop` into a motive
above that universe is admitted only when the family passes all three
parts;  it is refused with the word `a large elimination out of a
proposition needs a subsingleton family`, which carries the name of the
family that failed.  A family above `Prop`, and a motive at `Prop`, are
both small and neither asks the criterion.

Conversion applies the pack's subsingleton shortcut only to families
at `Prop`.  A `Type` family with erased fields can retain distinct type
payloads, so passing the large elimination criterion does not make its
inhabitants definitionally equal.  Such inhabitants use the remaining
conversion rules.

The Stage K agreement obligation follows the approved ruling of
2026-09-06 (d).  Five axiom-free unary SMu fixtures check all operand pairs
from 0 through 32 for `natAdd`, `natSub`, `natMul`, `natEq` and `natLt`:
1089 typed conversion witnesses each, 5445 total.  Each unary definition
and its observer avoid the primitive being tested.  A separate Python
integer oracle supplies 400 full-range cases per primitive, 2000 total,
including i31, host-integer, multi-limb and 100-digit boundaries.  The
kernel, Node and Wasmtime must agree with that oracle.  Both sets are
required finite evidence; they do not constitute a general agreement
theorem or execution of billion-constructor unary values.  The revised
finite obligation is discharged by Stage K SK-G5: all 7445 cases pass,
with the five unary sources in test/agreement and their parser and golden
checks retained by the dedicated gate.

Stage K distinguishes runtime mode from multiplicity.  `One` requires
exactly one runtime use on every reachable path.  Sequence adds uses,
declared argument quantities scale them, and case branches are
alternatives.  Types, annotations and Zero arguments contribute no
runtime uses.  Checked kernel entry points enforce the rule, including
function captures, constructor fields and let aliases (replacing SB-D3).

## 6 The framework axiom

Level rules are functions per shape (R-Q6).  `ran_lvl` at SPi is
`imax l l'`.  The equation

    imax l zero = zero

is a framework axiom of kanon.  It gives Prop its impredicativity.  M0
uses closed levels only.  Level variables arrive at M2.

As built, in lib/rules.ml under the comment `(* SB-M3 site *)`:

    let imax l l' = if Level.equal l' Level.zero then Level.zero
                    else Level.max l l'

`lan_lvl` at SPi is `Level.max`.  Both level functions at SColl n are the
maximum of the leg levels.  At n = 0 there is no leg, so the level comes
from the annotation and defaults to `Univ zero` (D-M0-6).

## 7 The sugar table

Every surface form maps to one kernel constructor.  Read the right-hand
column to confirm that no surface form is a former.

In the rows below, and in the surface forms of section 4, `q` stands for
the optional binder mark, `0` or `1` or no mark at all.  In those rows
and forms `q` is not a name.  A form such as `(q x : A)` is therefore
one binder, and not a binder group of the two names `q` and `x`.
Everywhere else `q` is an ordinary binder name:  in the mpc
authorization predicate `(0 q : Sub P) -> Prop` of section 4.4 the mark
is the literal `0` and `q` is the name of the binder.

| surface form | kernel form | note |
| --- | --- | --- |
| `fun (q x : A) => b` | `Sec (SPi (q, x, A)) [x => b]` | sugar, not former |
| `(q x : A) -> B` | `Ran (SPi (q, x, A)) B` | sugar, not former |
| `A -> B` | `Ran (SPi (Many, "_", A)) B` | sugar, not former |
| `(q x : A) * B` | `Lan (SPi (q, x, A)) B` | sugar, not former |
| `A * B` | `Lan (SPi (Many, "_", A)) B` | sugar, not former |
| `f a` | `Out (SPi ..) (APt (q, a)) f` | sugar, not former.  SA-D1 |
| `(a, b)` | `In (SPi ..) (APt (q, a)) [b]` | sugar, not former |
| `p.1` | `Elim` at `Lan (SPi ..)`, leg `ALeg 0`, first branch binder, with the projection motive | sugar, not former.  D-M0-3 |
| `p.2` | `Elim` at `Lan (SPi ..)`, leg `ALeg 0`, second branch binder, with the projection motive | sugar, not former.  D-M0-3 |
| `inj k of n t` | `In (SColl n) (ALeg k) [t]` | sugar, not former |
| `case t as x return M with \| k xs => b` | `Elim` at `Lan (SColl n)` | sugar, not former |
| `match t as x in F i1 .. im return M with \| c y1 .. yn => b` | `Elim` at `Lan (SMu (F, ..))`, constructor keys `ACtor c` | sugar, not former.  SL-D3; Stage H constructor `case` remains accepted |
| `tuple (t1, .., tn)` | `Sec (SColl n) [.. => t1; ..]` | sugar, not former |
| `sum (A1, .., An)` | `Lan (SColl n) (Sec (SColl n) [.. => A1; ..])` | sugar, not former.  SB-D1 |
| `zk (q w : W) * R` | `Lan (SZk (q, w, W)) R` | sugar, not former.  veil D-9 |
| `prove x w r` | `In (SZk (q, w, W)) (APt (q, w)) [r]` | sugar, not former.  veil D-9 |
| `verify x p` | `Elim` at `Lan (SZk ..)`, leg `ALeg 0`, with the statement motive | sugar, not former.  veil D-9 |
| `fhc l T` | `Ran (SFhc l) T` | sugar, not former.  veil D-10 |
| `enc pk t` | `Sec (SFhc 0) [pk; t]` | sugar, not former.  veil D-10 |
| `eval f c` | `Sec (SFhc l) [f; c]`, with `l` the level of `c` plus the depth of `f` | sugar, not former.  veil D-11 |
| `dec sk c` | `Out (SFhc l) (APt (One, sk)) c` | sugar, not former.  veil D-11 |
| `mpc[P, A] T` | `Ran (SMpc (P, A)) T` | sugar, not former.  veil D-12 |
| `share x` | `Sec (SMpc (P, A)) [x]` | sugar, not former.  veil D-12 |
| `input p x` | `Sec (SMpc (P, A)) [p; x]` | sugar, not former.  veil D-12 |
| `mpc ps f c1 .. cn` | `Sec (SMpc (P, A)) [ps; f; c1; ..; cn]` | sugar, not former.  veil D-12 |
| `open Q h c` | `Out (SMpc (P, A)) (APt (q, In (SPi (Zero, q, Sub P)) (APt (Zero, Q)) [h])) c`, with `q` the written mark of the proof and `Zero` when no mark is written | sugar, not former.  veil D-12 |
| `prod (A1, .., An)` | `Ran (SColl n) (Sec (SColl n) [.. => A1; ..])` | sugar, not former.  SB-D1 |
| `t.k` | `Out (SColl n) (ALeg k) t` | sugar, not former |
| `()` | `Sec (SColl 0) []` | sugar, not former |
| `absurd t` | `Elim` at `Lan (SColl 0)` with no branches | sugar, not former |
| `Prop` | `Univ zero` | sugar, not former |
| `Type n` | `Univ (n + 1)` | sugar, not former.  SB-D2 |
| `let x : A := d in b` | `Let (x, A, d, b)` | sugar, not former |
| `(t : A)` | `Ann (t, A)` | sugar, not former |
| `auto` | `Auto` | sugar, not former.  SA-D3 |
| `mu F params : indices -> Type n := ...` | a checked family record; references elaborate to `Lan (SMu (F, indices))` | declaration sugar.  SL-D1; the Stage G `with` spelling remains accepted |
| constructor `\| c binders : F args` | the existing constructor telescope and `In (SMu ..) (ACtor c)` introductions | binder sugar folds to arrows, preserving names and quantities.  SL-D1 |
| `mutual mu ... mu ... end` | one mutually checked family group | two or more members.  SL-D2; the Stage G `and` spelling remains accepted |
| `def rec f : A := body` and recursive `and` groups | a `Totality.guard_group` certificate admits `Order.translate`; the translated `Elim` body is checked and installed as `Global.Def` | sugar, not former.  SI-D9, SL-D9; no new term constructor |
| `nu` | none.  Reserved;  the parser refuses it with "nu arrives at M2" | SA-D3 |

SB-D1.  `sum` and `prod` are the two collection type words.  Both are
sugar rows and neither is a former:  the items are the legs of one
diagram, the diagram is a section at the collection shape, and the word
picks the left former or the right former over it.  The width zero forms
`sum ()` and `prod ()` are the empty and the unit type;  each takes its
universe from an annotation and sits at `Univ zero` without one (D-M0-6).

SB-D3, replaced at Stage K.  The binder mark `1` reads as `Quantity.One`
and requires exactly one runtime use on every reachable path.  The
surface representation and printer preserve all three quantity marks.

SA-D1.  Application by juxtaposition is a surface production and a sugar
row.  Plan sections 4 and 8 leave it out, and `natAdd` cannot be applied
without it.  It binds tighter than the arrow and the star, and looser
than the postfix `.1`, `.2` and `.k`.  It is left associative.

## 8 The encoder subset

wasm/gc_encode.ml encodes this subset and nothing else.  The gate leg
ENCODER-SUBSET fails when an opcode outside the table is emitted, so
growth is visible in a diff of this table.

| group | members |
| --- | --- |
| numbers | LEB128 unsigned, LEB128 signed |
| sections used | type, function, export, element (declarative segments only), code |
| sections refused | table, memory, global, start, data |
| composite types | struct, array, func, in rec groups, final subtypes only |
| rec groups | a group of one composite is the bare composite, which keeps the M0 bytes; a group of two or more composites is `0x4E`, the member count, then one `0x4F` sub final entry with an empty supertype vector for each member, in declaration order (D-M1-5) |
| control | `block`, `loop`, `if`, `br`, `br_if`, `br_on_cast`, `return`, `unreachable` |
| calls | `call`, `return_call`, `call_ref`, `return_call_ref` |
| locals | `local.get`, `local.set`, `local.tee` |
| numeric | `i32.const`, `i32.add`, `i32.sub`, `i32.mul`, `i32.div_u`, `i32.eq`, `i32.ne`, `i32.lt_u`, `i32.gt_u` |
| references | `ref.i31`, `i31.get_s`, `i31.get_u`, `ref.cast`, `ref.func`, `ref.null`, `ref.is_null` |
| structs | `struct.new`, `struct.get` |
| arrays | `array.new`, `array.get`, `array.set`, `array.len` |

Stage K adds a mutable i32 array composite (`0x5E`, field mutability
`0x01`).  The array instruction encodings are `0xFB 0x06` plus type index
for `array.new`, `0xFB 0x0B` plus type index for `array.get`, `0xFB 0x0E`
plus type index for `array.set`, and `0xFB 0x0F` for `array.len`.
Distinct limbs require `array.set` because `array.new` repeats a single
initializer.  Stores populate fresh result arrays; shared operands are
never modified.  Struct fields remain immutable.

M0 emits WasmGC core modules only (R-Q4).  There is no linear memory, no
tag, and no import beyond the gate's export.

The text form of a module is the print of the binary, so it can hold
printer presentation words this table does not list.  The printer writes
`drop` around a value
that stays on the stack in front of an `unreachable`, which the case
dispatch of SD-D5 leaves there when no leg casts.  dev/encoder-subset.sh
reads that word as the printer's and not as an opcode of
wasm/gc_encode.ml (SD-D24).

Stage K printer accounting: Binaryen can print an inferred block result
as `(ref (exact $1))`.  `exact` qualifies the printed reference type;
it is a structural word in dev/encoder-subset.sh.  The byte encoder has
no exact-reference form: `Ref h` remains `0x64` followed by the existing
heap-type encoding, and a defined heap type remains its signed index.
This printer exemption adds no instruction or binary type encoding.

### 8.1 The emission table

wasm/emit.ml writes one wasm form for every row.  A shape that is not in
this table is a refusal, not a guess.

| shape | erased form | wasm form |
| --- | --- | --- |
| a call of a known function | `KTail (KGlobal f) [a; ..]` | `call` of the typed signature, and `return_call` in tail position |
| a primitive | `KApp (KGlobal natAdd) [a; b]` | dispatch on i31 or big Nat, exact arithmetic with promotion and normalization, then a Nat or Bool result |
| a closure | `KClos f n [c; ..]` | `struct.new` of the closure type with the arity, `ref.func` of the wrapper and the environment |
| a call of a closure | `KTail (KVar 0) [a; ..]` | `struct.get` of the environment and of the code, `ref.cast` to `fn<n>`, then `call_ref` or `return_call_ref` |
| an application of an unknown arity | `KApp (KVar 0) [a]` | `call` of the helper `apply<k>` |
| a partial application | the same, with a larger arity | `struct.new` of `pap<m,k>` and a closure of the wrapper `papw:m:k` |
| a let | `KLet x v b` | a typed local, `local.set`, then the body |
| a pair or a tuple | `KStruct t [f; ..]` | one `struct.new` of the type of the tid |
| a projection | `KProj t k x` | `ref.cast` to the type of the tid, then `struct.get` and a cast from eq to the field repr |
| a tag with no payload | `KTag t k []` | `ref.i31` of the tag |
| a tag with a payload | `KTag t k [p]` | `struct.new` of the leg type, the tag first |
| a case | `KCase t s [{..}]` | the retained tid supplies the leg types; one `block` per leg shape, `br_on_cast` to i31 and to each leg type, then an `i32.eq` chain on the tag |
| an erased argument | `KErased` | `ref.i31` of zero |
| a literal | `KLit n` | `i32.const` and `ref.i31` for small Nat; fresh limb array and immutable big Nat struct otherwise |
| the export | the definition the caller names | a function with no parameter that calls the definition, casts the answer to i31 and reads it with `i31.get_s` |

The closure (SD-D2).  A closure is a struct of three fields.  The first
field is the arity as an i32.  The second field is the code as a function
reference.  The third field is the environment as an eq reference.  A
closure with no capture holds a tagged zero in the third field.  Every
field is immutable.

Two conventions (SD-D3).  A function with a known name and a known arity
has a typed signature.  Its parameters and its answer keep their repr.
Every other call goes through the generic signature `fn<n>`, where the
environment, each argument and the answer are eq references.  A wrapper
joins the two conventions.  It reads the captures out of the
environment, it casts each capture and argument to its repr, and it tail
calls the typed code.  Registration, construction and the wrapper use
the capture prefix of the lifted function's signature as the environment
tid.  A value goes from the typed form to the generic form at no
cost, because each typed form is a subtype of eq.  A value comes back
with one `ref.cast`.

Generic application (SD-D4).  The helper `apply<k>` applies k arguments
to a closure whose arity the caller does not know.  It reads the arity
out of the closure and compares it with k.  An equal arity gives a
`return_call_ref` of the code.  A smaller arity calls the code and gives
the arguments that are left to `apply<k-m>`.  A larger arity builds a
partial application:  a struct `pap<m,k>` holds the closure and the k
arguments, and a new closure of arity m-k names the wrapper `papw:m:k`.
That wrapper reads the saved arguments, adds the new ones and calls the
target.  The set of helpers is closed:  each helper adds the helpers it
needs, until nothing is new.

Sums (SD-D5).  A leg with no payload is its tag in an i31.  A leg with a
payload is a struct.  The first field of that struct is the tag in an
i31 and the second field is the payload as an eq reference.  Payload
legs have equivalent runtime struct types, and the tag tells them apart.
A payload read casts the eq reference to its checked repr.  A case reads
the tag first.  It uses `br_on_cast` to i31 and one `br_on_cast` for each
leg type.  It then compares the tag with the tag of each branch.

The value types (SD-D6, corrected after review).  A pair and a tuple are
one struct each, with one immutable eq reference field for each runtime
component.  Environments use the same storage convention.  Instantiating
an erased type parameter changes the field's checked repr but leaves its
storage type unchanged; nested aggregates retain this property.  The
emitter casts each field read from eq to its checked repr.  The symbolic
tids stay distinct, but same-width aggregates have equivalent final
Wasm struct types.  link.ml maps each repr to a value type for locals and
function signatures.  The
repr `i31` gives a reference to i31.  A pair or a tuple gives a
reference to its struct type.  A function gives a reference to the
closure type.  A sum and the tid `any` give an eq reference.

A case carries its checked scrutinee tid through erasure.  The emitter
uses that tid for dispatch and payload binders even when a generic call
returns the scrutinee as `any`.  An empty case needs no leg type and emits
`unreachable`.

Naturals (Stage K replaces SD-D7 and SD-D23).  Check-time integers use
the total Bignum boundary over Zarith 1.14.  Decimal Nat literals have no
machine-integer digit ceiling.  Negative forged literals are refused as
Nat inputs.  Grammar quantities, universes and leg indices retain checked
bounded conversions.

Runtime Nat is an eq-reference union.  Values from 0 through 1073741823
use i31; larger values use an immutable struct containing sign 1 and an
i32 limb array.  Limbs are little-endian base 32768.  Arithmetic removes
leading zero limbs and normalizes zero and other small answers to i31.
Fresh output arrays preserve aliased operands.  A schoolbook product
accumulates at most 1073741823 in each i32 intermediate.  Helpers use
tail calls, and no host arithmetic import or linear memory is required.
Small operations promote before overflow.  All five primitives accept
mixed representations.  `natSub` truncates at zero; `natEq` and `natLt`
return the two-leg Bool sum with true at leg 1 and false at leg 0.

The export (SD-D8).  The caller names one definition.  That definition
must be a `Nat` of arity zero.  The module exports a function with no
parameter and an i32 answer.  That function calls the definition and
casts the answer to i31 and reads it with `i31.get_s`.  Large internal
values remain exact and may produce a small exported observation.  Only
an out-of-i31 export traps, with driver exit 4 on every execution host.

## 9 The surface grammar

```
decl    ::= 'def' name ':' term ':=' term
          | 'def' name binder+ ':' term ':=' term
          | 'axiom' name ':' term
          | 'def' 'rec' rec-member ('and' rec-member)*
          | mu-decl ('and' mu-member)*
          | 'mutual' mu-decl mu-decl+ 'end'
mu-decl ::= 'mu' mu-member
mu-member ::= name binder* ':' term (':=' | 'with') ctor*
ctor    ::= '|' name binder* ':' term
rec-member ::= name ':' term ':=' term
term    ::= 'fun' binder+ '=>' term
          | binder '->' term  |  term '->' term
          | binder '*' term   |  term '*' term
          | term term                              (* SA-D1 *)
          | '(' term ',' term ')'  |  term '.1'  |  term '.2'
          | 'inj' nat 'of' nat term
          | 'case' term ['as' name ['in' name name*] 'return' term] 'with'
              ('|' nat binder* '=>' term | '|' name field* '=>' term)*
          | 'match' term ['as' name ['in' name name*] 'return' term] 'with'
              ('|' name field* '=>' term)*
          | 'tuple' '(' (term (',' term)*)? ')'  |  term '.' nat
          | 'sum' '(' (term (',' term)*)? ')'       (* SB-D1 *)
          | 'prod' '(' (term (',' term)*)? ')'      (* SB-D1 *)
          | '()'  |  'absurd' term
          | 'Prop'  |  'Type' nat?  |  nat
          | 'natAdd' | 'natSub' | 'natMul' | 'natEq' | 'natLt'
          | 'zk' binder '*' term                    (* veil D-9 *)
          | 'prove' term term term                  (* veil D-9 *)
          | 'verify' term term                      (* veil D-9 *)
          | 'fhc' term term                         (* veil D-10 *)
          | 'enc' term term                         (* veil D-10 *)
          | 'eval' term term                        (* veil D-11 *)
          | 'dec' term term                         (* veil D-11 *)
          | 'mpc' '[' term ',' term ']' term        (* veil D-12 *)
          | 'share' term                           (* veil D-12 *)
          | 'input' term term                      (* veil D-12 *)
          | 'mpc' term term term+                  (* veil D-12 *)
          | 'open' term ('0' | '1')? term term     (* veil D-12 *)
          | 'let' name ':' term ':=' term 'in' term
          | 'auto'                                 (* SA-D3 *)
          | 'nu'                                  (* reserved, arrives at M2 *)
          | '(' term ':' term ')'  |  name  |  '(' term ')'
binder  ::= '(' mark? name+ ':' term ')'
field   ::= mark? name | binder                    (* M1 Stages H and L *)
mark    ::= nat                                    (* value 0 or value 1 *)
```

Precedence, loosest first: the arrow and the star, then application, then
the postfix projections `.1`, `.2` and `.k`.  The arrow and the star are
right associative.  Application is left associative.

The binder mark is one of three:  `0` is `Quantity.Zero`, `1` is
`Quantity.One` and an absent mark is `Quantity.Many` (SB-D3).  The
parser reads the mark by value, so every natural literal equal to zero
or to one is a mark, including `00` and `01`.  A literal of any other
value is not a mark, and the parser then expects a binder name.  The
printer writes `0 `, `1 ` and the empty text back, so a marked binder
round trips.

A `def` may take one or more binders before its `:`.  The parser
rewrites `def NAME binder+ : TYPE := BODY` to the arrow-header form
`def NAME : binder+ -> TYPE := fun binder+ => BODY` before elaboration
sees it (R-W2-5).  A `def` with no binder keeps its plain form.

A binder group such as `(1 x y : Nat)` abbreviates the consecutive
binders `(1 x : Nat) (1 y : Nat)`, in that order.  Each name receives
the written type and quantity.  This expansion applies to `def` and
`fun` parameters, arrow and pair types, family and constructor
telescopes, typed branch fields, and the binders of a numeric case
leg.  Types are checked sequentially,
just as in the expanded spelling, so earlier names are in scope in
later annotations.  The printer uses the expanded spelling.  `zk`
continues to select the first expanded pair binder as its witness.
A parenthesized annotation such as `(f x : Nat)` remains an expression
when no arrow or star follows it.  Before either operator, the group
reading wins; write `((f x) : Type 0) -> Nat` to use an annotated type
application as the domain.

`sum`, `prod`, `mu`, `mutual`, `match`, `end` and `nu` are reserved
words, and so are the veil words `zk`, `prove`, `verify`, `fhc`, `enc`,
`eval`, `dec`, `mpc`, `share`, `input` and `open`.  The one word `mpc`
heads the share type and the joint section;  the bracket after it picks
the type row.  The optional mark in `open` is the written quantity of
the authorization proof, and an absent mark stands for
`Quantity.Zero`.  `mu` opens a declaration; its parameter binders precede the
colon, and its index telescope is the arrow chain after it.  Constructor
binders before the colon abbreviate the same arrow chain in the
constructor type.  `mutual` requires two or more `mu` declarations and
an explicit `end`.  The earlier `mu ... with` and `and` grammar remains
accepted.  The printer normalizes families to `:=` and groups of two or
more to `mutual ... end` (SL-D1, SL-D2, SL-D5).

`match` admits constructor keys and requires a family scrutinee, even
when its branch list is empty.  Numeric `case` remains the collection
eliminator, and the Stage H constructor `case` form remains compatible.
Both forms share the existing elaboration rules.  A constructor field
may be a quantity and a name or a typed binder; an explicit type must
agree with its constructor field type under all preceding fields.
Every branch binder retains its written quantity (SL-D3, SL-D4).

Match and case bodies extend to the right; parentheses delimit nested
eliminations before a following outer branch.  `end` closes a mutual
declaration group only.  The index clause of Stage H remains available
for indexed motives.  The parser accepts the optional-motive grammar,
and the existing kernel requirement for a fibered motive still applies.
`nu` retains the parser refusal "nu arrives at M2" in both declaration
and term positions; `auto` retains its M2 checker refusal (SL-D6).

## 10 Obligations at M0

M0 leaves these six obligations.  Each one names the milestone that
closes it.

| obligation | milestone | note |
| --- | --- | --- |
| linear counting for `One` | M1 | discharged by Stage K SK-G3: exact path usage, 27 direct kernel checks and 22 surface path cases, including duplication negatives |
| arbitrary precision Nat | M1 | discharged by Stage K SK-G4: Zarith 1.14, exact kernel and Wasm arithmetic, both runtime hosts and separate export-boundary checks |
| finite agreement of the literal fast path | M1 | discharged by Stage K SK-G5 under ruling 2026-09-06 (d): all 5445 unary witnesses and 2000 independent full-range cases described in section 5 pass |
| subsingleton large elimination | M1 | discharged by Stage H SH-G7: singleton and empty Prop families admit large elimination, non-subsingleton and self-recursive families are refused.  Section 5 records the criterion and its origin in tot |
| structural recursion certificate | M1 | the elaborator calls `Totality.guard` before it translates a recursive definition into `Elim`.  M0 holds the entry point and no caller.  discharged at M1 Stage I: surface/elab.ml:1004 calls `Totality.guard_group` and only a certificate reaches `Order.translate` at surface/elab.ml:1029 (SI-D9, SI-D13) |
| the `any` repr | M1 | discharged at Stage D: a runtime value of a variable type takes the tid `any`, which link.ml maps to eqref (SD-D6) |
