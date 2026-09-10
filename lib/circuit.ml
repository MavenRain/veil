(** The circuit predicate, veil D-8.  A definition is a circuit when its
    body computes a finite, statically bounded multiplicative depth over
    the five [Prim] primitives, finite [SColl] structure and
    non-recursive function application; [depth] answers that bound or
    refuses with the milestone head word of D-7.  [cost] is the one flat
    cost table the packs read (SPEC section 2, "Circuit fragment").

    Soundness matters more than precision here: [lib/circuit.ml] is a
    kernel file (D-4), so a wrong answer that UNDER-counts depth admits a
    program that is not really a bounded circuit.  Every choice below
    that had to pick a convention (documented in CONTRACT-wave0.md) picks
    the side that never reports less depth than the term can actually
    reach, never the side that is easiest to compute.

    The walk below is a small evaluator over integers instead of terms:
    [value] holds either a known depth ([VD]) or an unapplied function
    ([VClo], a leg plus the environment captured where it was written).
    Applying a [VClo] pushes the argument's own depth onto that captured
    environment and re-enters the body, which is what "the depth of the
    body at the arguments" (D-8) means without literally substituting
    terms.  A name already being resolved when [Term.Global] reaches it
    again is a cycle, refused as [mu]: a plain self-referential
    definition is exactly as unbounded as a general [mu] elimination,
    and the closed [string -> Term.t option] lookup carries no other way
    to see that a definition is [def rec].

    [depth]/[Error] payloads are the bare head word only (`mu`, `auto`,
    `opaque callee`, `SPar`, ...); callers that surface a refusal as a
    checker error wrap it with [word] to get the full D-7 sentence. *)

let word (head : string) : string = "circuit fragment arrives at V5: " ^ head

(** A definition-time cost.  [Prim.of_name] closes the whole table: every
    M0 primitive costs 1 and nothing else is a primitive. *)
let cost (name : string) : int option =
  Prim.of_name name |> Option.map (fun (_ : Prim.t) -> 1)

type value =
  | VD of int  (** a term whose multiplicative depth is known *)
  | VClo of Term.leg * value list * string list
      (** an unapplied function: its one leg, the environment captured
          where it was written, and the globals that were open (being
          unfolded) at that same point.  The third field is what keeps
          [depth] total: a closure written inside the body of a global
          can be applied much later, at a call site whose own [seen]
          list no longer names that global, so the cycle check must
          travel with the closure. *)

(** Depth read off a value.  A closure used as plain data (an
    unapplied function stored in a record field, say) carries no
    circuit cost of its own until it is called, so it reads 0. *)
let vd_of (v : value) : int = match v with VD n -> n | VClo (_, _, _) -> 0

let bounded_depth (n : Bignum.t) : (value, string) result =
  Bignum.to_int n
  |> Option.fold ~none:(Error "unbounded iteration")
       ~some:(fun (d : int) -> Ok (VD d))

(** The globals open at a closure's birth, joined with the globals open
    at its call site.  Order does not matter, only membership: a name in
    either list is a name whose body is still being unfolded, so meeting
    it again is a cycle. *)
let union_seen (a : string list) (b : string list) : string list =
  List.fold_left
    (fun (acc : string list) (name : string) ->
      if List.mem name acc then acc else name :: acc)
    b a

(** Total de Bruijn lookup, written out rather than through the standard
    library, because the house rules ban every name that reads like a
    partial index: an index past the environment cannot arise in a
    closed, checked term, and 0 is a harmless default. *)
let rec nth_value (env : value list) (i : int) : value =
  match env with
  | [] -> VD 0
  | v :: rest -> if i <= 0 then v else nth_value rest (i - 1)

(** The type formers carry no computation of their own; only the five
    milestone shapes stop the walk, exactly as an occurrence of them
    anywhere else does (D-8). *)
let eval_type_shape (s : Term.t Shape.t) : (value, string) result =
  match s with
  | Shape.SPi (_, _, _) -> Ok (VD 0)
  | Shape.SColl _ -> Ok (VD 0)
  | Shape.SMu (_, _) -> Ok (VD 0)
  | Shape.SPar (_, _) -> Error "SPar"
  | Shape.SNu (_, _) -> Error "SNu"
  | Shape.SZk (_, _, _) -> Error "SZk"
  | Shape.SFhc _ -> Error "SFhc"
  | Shape.SMpc (_, _) -> Error "SMpc"

(** A closed constructor tree of the family [fam], allowing literal
    fields and acyclic global aliases. Count the layers that belong to
    [fam], including the leaf: even a match on a leaf executes a branch.
    A layer of another family passes its own height on without adding
    one, which keeps a mutually recursive tree at its true [fam] height
    and keeps a plain payload of another family out of the count. Every
    field must pass, so one known child cannot hide an opaque sibling.
    Variables, functions and computed fields remain outside this
    finite-data fragment.

    One alias body can name the same alias in more than one field, so the
    alias graph is a directed acyclic graph and a plain walk pays the
    number of paths, not the number of aliases. [memo] carries the answer
    of each alias name of one certification as an immutable list, and each
    step returns the list that it grew, which makes the walk linear in the
    number of aliases. The key is the name alone, because [fam] is fixed
    for one list and the answer of a name does not depend on the path that
    reaches it: a name that [seen] holds is a name that reaches itself,
    and such a name answers [None] from every start, because every field
    must pass. *)
let rec literal_mu_bound (memo : (string * int option) list)
    (glookup : string -> Term.t option) (fam : string)
    (seen : string list) (t : Term.t) :
    int option * (string * int option) list =
  match t with
  | Term.Var _ -> (None, memo)
  | Term.Univ _ -> (None, memo)
  | Term.Lan (_, _) -> (None, memo)
  | Term.Ran (_, _) -> (None, memo)
  | Term.In (s, _a, args) -> literal_mu_bound_in memo glookup fam seen s args
  | Term.Elim _ -> (None, memo)
  | Term.Sec (_, _) -> (None, memo)
  | Term.Out (_, _, _) -> (None, memo)
  | Term.Let (_, _, _, _) -> (None, memo)
  | Term.Ann (tm, _ty) -> literal_mu_bound memo glookup fam seen tm
  | Term.Global name -> literal_mu_bound_global memo glookup fam seen name
  | Term.Lit _ -> (Some 0, memo)
  | Term.Auto -> (None, memo)

and literal_mu_bound_global (memo : (string * int option) list)
    (glookup : string -> Term.t option) (fam : string)
    (seen : string list) (name : string) :
    int option * (string * int option) list =
  match () with
  | () when List.mem name seen -> (None, memo)
  | () when List.mem_assoc name memo ->
      (Option.join (List.assoc_opt name memo), memo)
  | () ->
      let answer, grown =
        Option.fold ~none:(fun () -> (None, memo))
          ~some:(fun (body : Term.t) () ->
            literal_mu_bound memo glookup fam (name :: seen) body)
          (glookup name) ()
      in
      (answer, (name, answer) :: grown)

and literal_mu_bound_in (memo : (string * int option) list)
    (glookup : string -> Term.t option) (fam : string)
    (seen : string list) (s : Term.t Shape.t) (args : Term.t list) :
    int option * (string * int option) list =
  match s with
  | Shape.SMu (name, _) ->
      let best, grown =
        List.fold_left
          (fun ((acc : int option), (m : (string * int option) list))
               (arg : Term.t) ->
            Option.fold ~none:(fun () -> (None, m))
              ~some:(fun (best : int) () ->
                let got, m2 = literal_mu_bound m glookup fam seen arg in
                (Option.map (max best) got, m2))
              acc ())
          (Some 0, memo) args
      in
      ( Option.map
          (fun (n : int) -> if String.equal name fam then n + 1 else n)
          best,
        grown )
  | Shape.SPi (_, _, _) -> (None, memo)
  | Shape.SColl _ -> (None, memo)
  | Shape.SPar (_, _) -> (None, memo)
  | Shape.SNu (_, _) -> (None, memo)
  | Shape.SZk (_, _, _) -> (None, memo)
  | Shape.SFhc _ -> (None, memo)
  | Shape.SMpc (_, _) -> (None, memo)

(** The scrutinee of a match at [SMu] must be a constructor tree of the
    matched family: height 0 answers a literal, or a value of another
    family, which reaches no branch of this match, so it is no bound.
    Each call starts an empty [memo], because the answers hold for one
    family only, and it drops the grown list, because the list holds no
    answer that a later call can use. *)
and literal_mu_scrut (glookup : string -> Term.t option) (fam : string)
    (seen : string list) (t : Term.t) : int option =
  Option.bind
    (fst (literal_mu_bound [] glookup fam seen t))
    (fun (n : int) -> if Int.equal n 0 then None else Some n)

(** Does a constructor value at [SMu] carry a certificate of the family
    [fam]?  This is the introduction side of the same walk, so it also
    starts its own [memo]. *)
and literal_mu_certified (glookup : string -> Term.t option) (fam : string)
    (seen : string list) (s : Term.t Shape.t) (args : Term.t list) : bool =
  Option.is_some
    (fst (literal_mu_bound_in [] glookup fam seen s args))

(** Does a branch body read one of the [k] fields that its own branch
    binds?  A body that reads none of them holds the same depth at every
    field depth, so a fold over the scrutinee (rules.ml [mu_beta] passes
    the recursive result in a field) stays at the depth of one pass and
    the scrutinee height does not multiply it.  Positions that [eval]
    reads as a type or as a motive carry depth 0, so they cannot pass a
    field depth on and are not occurrences here. *)
let reads_field (k : int) (body : Term.t) : bool =
  let rec occurs (d : int) (tm : Term.t) : bool =
    match tm with
    | Term.Var i -> i >= d && i < d + k
    | Term.Univ _ -> false
    | Term.Lan (_, _) -> false
    | Term.Ran (_, _) -> false
    | Term.In (_, a, args) -> occurs_addr d a || List.exists (occurs d) args
    | Term.Elim e ->
        occurs d e.Term.e_scrut
        || List.exists
             (fun ((a : Term.addr), (lg : Term.leg)) ->
               occurs_addr d a
               || occurs (d + List.length lg.Term.l_binders) lg.Term.l_body)
             e.Term.e_branches
    | Term.Sec (_, legs) ->
        List.exists
          (fun (lg : Term.leg) ->
            occurs (d + List.length lg.Term.l_binders) lg.Term.l_body)
          legs
    | Term.Out (_, a, head) -> occurs_addr d a || occurs d head
    | Term.Let (_, _ty, def, inner) -> occurs d def || occurs (d + 1) inner
    | Term.Ann (tm, _ty) -> occurs d tm
    | Term.Global _ -> false
    | Term.Lit _ -> false
    | Term.Auto -> false
  and occurs_addr (d : int) (a : Term.addr) : bool =
    Term.as_apt a
    |> Option.fold ~none:false ~some:(fun ((_q : Quantity.t), (arg : Term.t)) ->
           occurs d arg)
  in
  k > 0 && occurs 0 body

(** Does any branch of a match read a field of its own constructor? *)
let branches_read_fields (branches : (Term.addr * Term.leg) list) : bool =
  List.exists
    (fun ((_a : Term.addr), (lg : Term.leg)) ->
      reads_field (List.length lg.Term.l_binders) lg.Term.l_body)
    branches

(** [app_spine] peels a chain of [SPi] applications down to its ultimate
    head and the full, in-order argument list, purely structurally (no
    evaluation): the pattern [Out (SPi, APt (_, b), Out (SPi, APt (_, a),
    Global "natAdd")))] answers [(Global "natAdd", [a; b])], so a
    saturated primitive call is recognised regardless of how many
    [SPi] layers it took to write it.  Every [Term.t] and [Shape.t]
    constructor is enumerated explicitly (no catch-all): anything that
    is not an [Out] built on [SPi] is already its own spine head with no
    arguments. *)
let rec app_spine (t : Term.t) : Term.t * Term.t list =
  match t with
  | Term.Var _ -> (t, [])
  | Term.Univ _ -> (t, [])
  | Term.Lan (_, _) -> (t, [])
  | Term.Ran (_, _) -> (t, [])
  | Term.In (_, _, _) -> (t, [])
  | Term.Elim _ -> (t, [])
  | Term.Sec (_, _) -> (t, [])
  | Term.Out (s, a, head) -> app_spine_out s a head t
  | Term.Let (_, _, _, _) -> (t, [])
  | Term.Ann (_, _) -> (t, [])
  | Term.Global _ -> (t, [])
  | Term.Lit _ -> (t, [])
  | Term.Auto -> (t, [])

and app_spine_out (s : Term.t Shape.t) (a : Term.addr) (head : Term.t) (whole : Term.t) :
    Term.t * Term.t list =
  match s with
  | Shape.SPi (_, _, _) ->
      let inner_head, inner_args = app_spine head in
      let this_arg =
        Term.as_apt a |> Option.fold ~none:[] ~some:(fun (_, arg) -> [ arg ])
      in
      (inner_head, inner_args @ this_arg)
  | Shape.SColl _ -> (whole, [])
  | Shape.SMu (_, _) -> (whole, [])
  | Shape.SPar (_, _) -> (whole, [])
  | Shape.SNu (_, _) -> (whole, [])
  | Shape.SZk (_, _, _) -> (whole, [])
  | Shape.SFhc _ -> (whole, [])
  | Shape.SMpc (_, _) -> (whole, [])

let rec eval (glookup : string -> Term.t option) (seen : string list)
    (env : value list) (t : Term.t) : (value, string) result =
  match t with
  | Term.Var i -> Ok (nth_value env i)
  | Term.Univ _ -> Ok (VD 0)
  | Term.Lan (s, _d) -> eval_type_shape s
  | Term.Ran (s, _d) -> eval_type_shape s
  | Term.In (s, a, args) -> eval_in glookup seen env s a args
  | Term.Elim e -> eval_elim glookup seen env e
  | Term.Sec (s, legs) -> eval_sec glookup seen env s legs
  | Term.Out (s, _a, head) as whole -> eval_out glookup seen env s head whole
  | Term.Let (_name, _ty, def, body) ->
      Result.bind (eval glookup seen env def) (fun (d : value) ->
          eval glookup seen (d :: env) body)
  | Term.Ann (tm, _ty) -> eval glookup seen env tm
  | Term.Global name -> eval_global glookup seen env name
  | Term.Lit _ -> Ok (VD 0)
  | Term.Auto -> Error "auto"

(** A record field or a sum's payload: the finite argument list of an
    admitted [In]/[Sec], folded by the largest depth any one of them
    reaches (D-8 "records and sums: max over legs"). *)
and max_args (glookup : string -> Term.t option) (seen : string list)
    (env : value list) (args : Term.t list) : (value, string) result =
  List.fold_left
    (fun (acc : (int, string) result) (arg : Term.t) ->
      Result.bind acc (fun (best : int) ->
          Result.map (fun (v : value) -> max best (vd_of v)) (eval glookup seen env arg)))
    (Ok 0) args
  |> Result.map (fun (n : int) -> VD n)

and fold_max_legs (glookup : string -> Term.t option) (seen : string list)
    (env : value list) (legs : Term.leg list) : (value, string) result =
  List.fold_left
    (fun (acc : (int, string) result) (leg : Term.leg) ->
      Result.bind acc (fun (best : int) ->
          let env' =
            List.fold_left
              (fun (e : value list) (_ : Quantity.t * string) -> VD 0 :: e)
              env leg.Term.l_binders
          in
          Result.map (fun (v : value) -> max best (vd_of v))
            (eval glookup seen env' leg.Term.l_body)))
    (Ok 0) legs
  |> Result.map (fun (n : int) -> VD n)

(** The address of an [In]/[Elim] branch: [APt] carries a term (the
    point argument or the deconstructed payload) whose own depth counts;
    every other address carries none. *)
and addr_depth (glookup : string -> Term.t option) (seen : string list)
    (env : value list) (a : Term.addr) : (int, string) result =
  Term.as_apt a
  |> Option.fold ~none:(Ok 0) ~some:(fun ((_q, arg) : Quantity.t * Term.t) ->
         Result.map vd_of (eval glookup seen env arg))

and eval_in (glookup : string -> Term.t option) (seen : string list)
    (env : value list) (s : Term.t Shape.t) (a : Term.addr) (args : Term.t list) :
    (value, string) result =
  match s with
  | Shape.SPi (_, _, _) ->
      Result.bind (addr_depth glookup seen env a) (fun (ad : int) ->
          Result.map
            (fun (v : value) -> VD (max ad (vd_of v)))
            (max_args glookup seen env args))
  | Shape.SColl _ -> max_args glookup seen env args
  | Shape.SMu (fam, _) ->
      (* A field that never names the family is ordinary data at its own
         depth, as it was before the constructor certificate arrived.
         Only a family-recursive field that no certificate covers
         refuses [mu].  The arguments are read first, so an unknown
         global inside a field keeps its own head word. *)
      Result.bind (max_args glookup seen env args) (fun (v : value) ->
          let certified = literal_mu_certified glookup fam seen s args in
          let recursive =
            List.exists (Term.exists_name ~include_families:true [ fam ]) args
          in
          if certified || not recursive then Ok v else Error "mu")
  | Shape.SPar (_, _) -> Error "SPar"
  | Shape.SNu (_, _) -> Error "SNu"
  | Shape.SZk (_, _, _) -> Error "SZk"
  | Shape.SFhc _ -> Error "SFhc"
  | Shape.SMpc (_, _) -> Error "SMpc"

and eval_sec (glookup : string -> Term.t option) (seen : string list)
    (env : value list) (s : Term.t Shape.t) (legs : Term.leg list) :
    (value, string) result =
  match s with
  | Shape.SPi (_, _, _) -> (
      match legs with
      | [ leg ] -> Ok (VClo (leg, env, seen))
      | [] -> Error "auto"
      | _ :: _ :: _ -> Error "auto")
  | Shape.SColl _ -> fold_max_legs glookup seen env legs
  | Shape.SMu (_, _) -> Error "mu"
  | Shape.SPar (_, _) -> Error "SPar"
  | Shape.SNu (_, _) -> Error "SNu"
  | Shape.SZk (_, _, _) -> Error "SZk"
  | Shape.SFhc _ -> Error "SFhc"
  | Shape.SMpc (_, _) -> Error "SMpc"

(** [Out (SPi, ..)] is application, read off the whole spine so a
    saturated primitive call costs [cost name] once, not once per
    curried layer; [Out (SColl, ..)] is a projection, read at the
    record's own depth since the address carries no term of its own to
    isolate one field's cost. *)
and eval_out (glookup : string -> Term.t option) (seen : string list)
    (env : value list) (s : Term.t Shape.t) (head : Term.t) (whole : Term.t) :
    (value, string) result =
  match s with
  | Shape.SPi (_, _, _) -> eval_app glookup seen env whole
  | Shape.SColl _ ->
      Result.map (fun (hv : value) -> VD (vd_of hv)) (eval glookup seen env head)
  | Shape.SMu (_, _) -> Error "mu"
  | Shape.SNu (_, _) -> Error "SNu"
  | Shape.SPar (_, _) -> Error "SPar"
  | Shape.SZk (_, _, _) -> Error "SZk"
  | Shape.SFhc _ -> Error "SFhc"
  | Shape.SMpc (_, _) -> Error "SMpc"

and eval_app (glookup : string -> Term.t option) (seen : string list)
    (env : value list) (whole : Term.t) : (value, string) result =
  let head, args = app_spine whole in
  match head with
  | Term.Global name ->
      (Option.fold (cost name)
         ~none:(fun () -> eval_app_generic glookup seen env head args)
         ~some:(fun (c : int) -> fun () -> eval_app_prim glookup seen env c args))
        ()
  | Term.Var _ -> eval_app_generic glookup seen env head args
  | Term.Univ _ -> eval_app_generic glookup seen env head args
  | Term.Lan (_, _) -> eval_app_generic glookup seen env head args
  | Term.Ran (_, _) -> eval_app_generic glookup seen env head args
  | Term.In (_, _, _) -> eval_app_generic glookup seen env head args
  | Term.Elim _ -> eval_app_generic glookup seen env head args
  | Term.Sec (_, _) -> eval_app_generic glookup seen env head args
  | Term.Out (_, _, _) -> eval_app_generic glookup seen env head args
  | Term.Let (_, _, _, _) -> eval_app_generic glookup seen env head args
  | Term.Ann (_, _) -> eval_app_generic glookup seen env head args
  | Term.Lit _ -> eval_app_generic glookup seen env head args
  | Term.Auto -> eval_app_generic glookup seen env head args

(** The five M0 primitives, cost 1 plus the deepest argument (D-8). *)
and eval_app_prim (glookup : string -> Term.t option) (seen : string list)
    (env : value list) (c : int) (args : Term.t list) : (value, string) result =
  Result.bind (max_args glookup seen env args) (fun (m : value) ->
      bounded_depth (Bignum.add (Bignum.of_int c) (Bignum.of_int (vd_of m))))

(** Any other application: evaluate the head to a function value, then
    consume the arguments one at a time. *)
and eval_app_generic (glookup : string -> Term.t option) (seen : string list)
    (env : value list) (head : Term.t) (args : Term.t list) : (value, string) result =
  Result.bind (eval glookup seen env head) (fun (hv : value) ->
      apply_all glookup seen env hv args)

(** [VClo] consumes one argument by pushing its depth onto the
    environment captured where the function was written, then re-enters
    the body: this is D-8's "depth of the body at the arguments" without
    literally substituting terms.  A [VD] cannot be called: a function
    value that arrived through a bound variable rather than a literal
    [fun] or a resolved global is a callee the circuit fragment cannot
    see through statically, refused with its own head word (R-2:
    [opaque callee], not [auto]). *)
and apply_all (glookup : string -> Term.t option) (seen : string list)
    (env : value list) (fv : value) (args : Term.t list) : (value, string) result =
  match args with
  | [] -> Ok fv
  | arg :: rest -> (
      match fv with
      | VD _ -> Error "opaque callee"
      | VClo (leg, captured_env, captured_seen) ->
          Result.bind (eval glookup seen env arg) (fun (av : value) ->
              Result.bind
                (eval glookup
                   (union_seen captured_seen seen)
                   (av :: captured_env) leg.Term.l_body)
                (fun (rv : value) -> apply_all glookup seen env rv rest)))

(** A bare occurrence of a global name.  A primitive answers its flat
    cost directly (an unapplied primitive reference costs the same as a
    saturated call: v1 does not track partial application, see
    CONTRACT-wave0.md); anything else is looked up, added to [seen] so a
    second visit before this one returns is a cycle, and re-entered with
    an empty environment, since a global's own definition is closed. *)
and eval_global (glookup : string -> Term.t option) (seen : string list)
    (env : value list) (name : string) : (value, string) result =
  let _ = env in
  (Option.fold (cost name)
     ~none:(fun () -> eval_global_user glookup seen name)
     ~some:(fun (c : int) -> fun () -> Ok (VD c)))
    ()

and eval_global_user (glookup : string -> Term.t option) (seen : string list)
    (name : string) : (value, string) result =
  if List.mem name seen then Error "mu"
  else
    (glookup name
    |> Option.fold
         ~none:(fun () -> Error ("unknown global " ^ name))
         ~some:(fun (body : Term.t) -> fun () -> eval glookup (name :: seen) [] body))
      ()

(** "case", the pair projection of D-M0-3 and a finite [SColl] case
    alike: [1 + max over branches] (D-8), folded against the
    scrutinee's own depth so a costly scrutinee is never hidden under a
    cheap branch. *)
and eval_elim (glookup : string -> Term.t option) (seen : string list)
    (env : value list) (e : Term.elim) : (value, string) result =
  match e.Term.e_shape with
  | Shape.SPi (_, _, _) -> eval_elim_case glookup seen env e
  | Shape.SColl _ -> eval_elim_case glookup seen env e
  | Shape.SMu (fam, _) -> eval_elim_mu glookup seen env fam e
  | Shape.SNu (_, _) -> Error "SNu"
  | Shape.SPar (_, _) -> Error "SPar"
  | Shape.SZk (_, _, _) -> Error "SZk"
  | Shape.SFhc _ -> Error "SFhc"
  | Shape.SMpc (_, _) -> Error "SMpc"

and eval_elim_case (glookup : string -> Term.t option) (seen : string list)
    (env : value list) (e : Term.elim) : (value, string) result =
  Result.bind (eval glookup seen env e.Term.e_scrut) (fun (sv : value) ->
      Result.bind (fold_max_branches glookup seen env e.Term.e_branches)
        (fun (bmax : int) ->
          Result.map (fun (v : value) -> VD (max (vd_of sv) (vd_of v)))
            (bounded_depth (Bignum.add Bignum.one (Bignum.of_int bmax)))))

and fold_max_branches (glookup : string -> Term.t option) (seen : string list)
    (env : value list) (branches : (Term.addr * Term.leg) list) :
    (int, string) result =
  List.fold_left
    (fun (acc : (int, string) result) ((a, leg) : Term.addr * Term.leg) ->
      Result.bind acc (fun (best : int) ->
          Result.bind (addr_depth glookup seen env a) (fun (ad : int) ->
              let env' =
                List.fold_left
                  (fun (e : value list) (_ : Quantity.t * string) -> VD ad :: e)
                  env leg.Term.l_binders
              in
              Result.map (fun (v : value) -> max best (vd_of v))
                (eval glookup seen env' leg.Term.l_body))))
    (Ok 0) branches

(** The bound comes from a closed constructor tree of the matched
    family, inline or through acyclic globals. A branch that reads a
    field of its own constructor can be a fold, so it runs once for each
    layer of that tree and the height multiplies the largest branch. A
    match whose branches read no field of their own constructor runs its
    one branch once, so the bound is the largest branch alone; the leaf
    branch still counts, because the branch maximum counts it. An
    unrepresentable depth refuses rather than wrapping the host integer.
    Recursive branch functions still fail the ordinary global cycle check. *)
and eval_elim_mu (glookup : string -> Term.t option) (seen : string list)
    (env : value list) (fam : string) (e : Term.elim) : (value, string) result =
  Result.bind (fold_max_branches glookup seen env e.Term.e_branches) (fun (bmax : int) ->
      literal_mu_scrut glookup fam seen e.Term.e_scrut
      |> Option.fold
            ~none:(Error "unbounded iteration")
            ~some:(fun (n : int) ->
              (if branches_read_fields e.Term.e_branches then
                 Bignum.mul (Bignum.of_int n) (Bignum.of_int bmax)
               else Bignum.of_int bmax)
              |> bounded_depth))

(** An unapplied function definition has no caller to supply its
    parameter, so [depth] reports the depth of its body with every one
    of its own parameters read as a plain, depth-0 value: the function's
    own contribution, matching how [cost] reports a primitive's charge
    independent of what it is later applied to (see CONTRACT-wave0.md). *)
let rec unwrap_closures (glookup : string -> Term.t option) (v : value) :
    (int, string) result =
  match v with
  | VD n -> Ok n
  | VClo (leg, captured_env, captured_seen) ->
      Result.bind
        (eval glookup captured_seen (VD 0 :: captured_env) leg.Term.l_body)
        (unwrap_closures glookup)

let depth (glookup : string -> Term.t option) (t : Term.t) : (int, string) result =
  Result.bind (eval glookup [] [] t) (unwrap_closures glookup)
