(** Direct circuit-reader regressions for cycles and machine depth limits
    that cannot be expressed by a well-typed surface program. Checked
    source examples live in circuit-spine.kan and the fixture suite. *)
open Kanon_kernel

let shape : Term.t Shape.t = Shape.SMu ("Bound", [])
let ctor (args : Term.t list) : Term.t = Term.In (shape, Term.ACtor "node", args)
let leaf : Term.t = ctor []
let three : Term.t = ctor [ ctor [ leaf ] ]
let leaf_lit : Term.t = ctor [ Term.Lit (Literal.LInt Bignum.zero) ]

(** A second family, to hold a payload that the matched family does not
    own. Its layers carry their own height and add nothing to the height
    of the matched family. *)
let other_shape : Term.t Shape.t = Shape.SMu ("Other", [])
let other (args : Term.t list) : Term.t = Term.In (other_shape, Term.ACtor "o", args)

(** A collection value of two fields. Its depth is the largest field
    depth, so it holds a term next to a field read and adds nothing. *)
let pair_coll (a : Term.t) (b : Term.t) : Term.t =
  Term.In (Shape.SColl 2, Term.ALeg 0, [ a; b ])

let lookup (name : string) : Term.t option =
  List.assoc_opt name [
    "alias", Term.Global "tree"; "tree", three;
    "cycleA", Term.Global "cycleB"; "cycleB", ctor [ Term.Global "cycleA" ];
  ]

let branch (scrut : Term.t) (body : Term.t) : Term.t =
  Term.Elim {
    e_shape = shape; e_scrut = scrut; e_scrut_q = Quantity.Many;
    e_motive = None;
    e_branches = [ Term.ACtor "node", { l_binders = []; l_body = body } ];
  }

(** A branch that binds one field and reads it. Such a branch can be a
    fold, so it runs once for each layer of the scrutinee and the height
    multiplies it. The field read carries depth 0, so the branch depth is
    the depth of [body] alone. *)
let fold_branch (scrut : Term.t) (body : Term.t) : Term.t =
  Term.Elim {
    e_shape = shape; e_scrut = scrut; e_scrut_q = Quantity.Many;
    e_motive = None;
    e_branches = [ Term.ACtor "node",
      { l_binders = [ Quantity.Many, "x" ];
        l_body = pair_coll (Term.Var 0) body } ];
  }

let rec scaled (n : int) : Term.t =
  if n <= 0 then Term.Global "natMul" else fold_branch three (scaled (n - 1))

(** The same chain with branches that read no field: every match runs one
    branch once, so the height of the scrutinee does not multiply. *)
let rec scaled_once (n : int) : Term.t =
  if n <= 0 then Term.Global "natMul" else branch three (scaled_once (n - 1))

let increment (body : Term.t) : Term.t =
  let pi = Shape.SPi (Quantity.Many, "x", Term.Global "Nat") in
  let apply (head : Term.t) (arg : Term.t) : Term.t =
    Term.Out (pi, Term.APt (Quantity.Many, arg), head)
  in
  apply (apply (Term.Global "natMul") body) (Term.Lit (Literal.LInt Bignum.zero))

let rec near_limit (n : int) : Term.t =
  if n <= 0 then Term.Global "natMul"
  else increment (fold_branch (ctor [ leaf ]) (near_limit (n - 1)))

let limit : Term.t = near_limit (Sys.int_size - 2)
let case_limit : Term.t =
  Term.Elim {
    e_shape = Shape.SColl 1; e_scrut = Term.Lit (Literal.LInt Bignum.zero);
    e_scrut_q = Quantity.Many; e_motive = None;
    e_branches = [ Term.ALeg 0, { l_binders = []; l_body = limit } ];
  }

let cases : (string * Term.t * (int, string) result) list = [
  "alias", fold_branch (Term.Global "alias") (Term.Global "natMul"), Ok 3;
  "alias-once", branch (Term.Global "alias") (Term.Global "natMul"), Ok 1;
  "leaf-work", branch leaf (Term.Global "natMul"), Ok 1;
  "literal-field", fold_branch leaf_lit (Term.Global "natMul"), Ok 1;
  "literal-scrutinee", branch (Term.Lit (Literal.LInt Bignum.zero)) (Term.Global "natMul"),
    Error "unbounded iteration";
  "foreign-payload", fold_branch (ctor [ other [ other [ other [] ] ] ])
    (Term.Global "natMul"), Ok 1;
  "opaque-sibling", branch (ctor [ leaf; Term.Var 0 ]) (Term.Lit (Literal.LInt Bignum.zero)),
    Error "unbounded iteration";
  "coll-field-value",
    ctor [ pair_coll (Term.Lit (Literal.LInt Bignum.zero))
             (Term.Lit (Literal.LInt Bignum.zero)) ], Ok 0;
  "recursive-field-uncertified",
    ctor [ ctor [ pair_coll (Term.Lit (Literal.LInt Bignum.zero))
                    (Term.Lit (Literal.LInt Bignum.zero)) ] ], Error "mu";
  "unknown-field-global", ctor [ Term.Global "nosuch" ],
    Error "unknown global nosuch";
  "cycle-bound", branch (Term.Global "cycleA") (Term.Global "natMul"),
    Error "unbounded iteration";
  "cycle-value", Term.Global "cycleA", Error "mu";
  "representable-depth", scaled 10, Ok 59049;
  "no-fold-depth", scaled_once 10, Ok 1;
  "overflow", scaled Sys.int_size, Error "unbounded iteration";
  "integer-limit", limit, Ok max_int;
  "primitive-overflow", increment limit, Error "unbounded iteration";
  "case-overflow", case_limit, Error "unbounded iteration";
]

let () =
  let passed = List.fold_left
    (fun (count : int) ((name, term, expected) : string * Term.t * (int, string) result) ->
      let got = Circuit.depth lookup term in
      let same = Result.equal ~ok:Int.equal ~error:String.equal got expected in
      Printf.printf "%s %s\n" (if same then "PASS" else "FAIL") name;
      if same then count + 1 else count)
    0 cases
  in
  let total = List.length cases in
  Printf.printf "CIRCUIT-BOUNDS %d/%d\n" passed total;
  (* An empty case list is not a pass: the count line alone cannot tell a
     deleted case from a green run, so the gate leg holds the count
     against its own expected value too. *)
  exit (if Int.equal passed total && total > 0 then 0 else 1)
