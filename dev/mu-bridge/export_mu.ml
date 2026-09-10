(** Export checked recursive-family fixtures to Lean raw syntax.
    Unsupported syntax returns an explicit error. *)
open Kanon_kernel

let ( let* ) = Result.bind

let quoted (s : string) : (string, string) result =
  if String.for_all (fun c -> Char.code c >= 32 && Char.code c <= 126) s then
    Ok (Printf.sprintf "%S" s)
  else Error "the bridge exporter requires printable ASCII names"

let natural (n : int) : (string, string) result =
  if n >= 0 then Ok (string_of_int n) else Error "negative raw index or arity"

let quantity (q : Quantity.t) : string =
  match q with
  | Quantity.Zero -> ".zero"
  | Quantity.One -> ".one"
  | Quantity.Many -> ".many"

let rec sequence (f : 'a -> (string, string) result) (xs : 'a list) :
    (string list, string) result =
  match xs with
  | [] -> Ok []
  | x :: rest ->
      let* first = f x in
      let* tail = sequence f rest in
      Ok (first :: tail)

let list (f : 'a -> (string, string) result) (xs : 'a list) :
    (string, string) result =
  Result.map (fun parts -> "[" ^ String.concat ", " parts ^ "]") (sequence f xs)

let optional (f : 'a -> (string, string) result) (x : 'a option) :
    (string, string) result =
  Option.fold ~none:(Ok "none")
    ~some:(fun value -> Result.map (fun s -> "(some " ^ s ^ ")") (f value)) x

let binder ((q, name) : Quantity.t * string) : (string, string) result =
  let* name = quoted name in
  Ok ("(" ^ quantity q ^ ", " ^ name ^ ")")

(** Cover every kernel constructor, refusing forms without a mirror. *)
let rec term (t : Term.t) : (string, string) result =
  match t with
  | Term.Var n -> Result.map (fun s -> "(.var " ^ s ^ ")") (natural n)
  | Term.Univ level -> Ok ("(.univ " ^ Level.to_string level ^ ")")
  | Term.Lan (s, body) -> former "lan" s body
  | Term.Ran (s, body) -> former "ran" s body
  | Term.In (s, a, args) ->
      let* s = shape s in
      let* a = address a in
      let* args = list term args in
      Ok ("(.intro " ^ s ^ " " ^ a ^ " " ^ args ^ ")")
  | Term.Elim e ->
      let* s = shape e.e_shape in
      let* scrut = term e.e_scrut in
      let* motive = optional motive e.e_motive in
      let* branches = list branch e.e_branches in
      Ok ("(.elim " ^ s ^ " " ^ scrut ^ " " ^ quantity e.e_scrut_q ^
          " " ^ motive ^ " " ^ branches ^ ")")
  | Term.Sec (s, legs) ->
      let* s = shape s in
      let* legs = list leg legs in
      Ok ("(.sec " ^ s ^ " " ^ legs ^ ")")
  | Term.Out (s, a, body) ->
      let* s = shape s in
      let* a = address a in
      let* body = term body in
      Ok ("(.out " ^ s ^ " " ^ a ^ " " ^ body ^ ")")
  | Term.Let (name, ty, value, body) ->
      let* name = quoted name in
      let* ty = term ty in
      let* value = term value in
      let* body = term body in
      Ok ("(.letIn " ^ name ^ " " ^ ty ^ " " ^ value ^ " " ^ body ^ ")")
  | Term.Ann (value, ty) ->
      let* value = term value in
      let* ty = term ty in
      Ok ("(.ann " ^ value ^ " " ^ ty ^ ")")
  | Term.Global name -> Result.map (fun s -> "(.global " ^ s ^ ")") (quoted name)
  | Term.Lit (Literal.LInt n) ->
      if Bignum.sign n >= 0 then Ok ("(.lit " ^ Bignum.to_string n ^ ")")
      else Error "negative literal has no natural-number mirror"
  | Term.Lit (Literal.LString _) -> Error "string literal has no raw mirror"
  | Term.Auto -> Error "Auto has no raw mirror"

and former (tag : string) (s : Term.t Shape.t) (body : Term.t) :
    (string, string) result =
  let* s = shape s in
  let* body = term body in
  Ok ("(." ^ tag ^ " " ^ s ^ " " ^ body ^ ")")

and shape (s : Term.t Shape.t) : (string, string) result =
  match s with
  | Shape.SPi (q, name, dom) ->
      let* name = quoted name in
      let* dom = term dom in
      Ok ("(.SPi " ^ quantity q ^ " " ^ name ^ " " ^ dom ^ ")")
  | Shape.SColl n -> Result.map (fun s -> "(.SColl " ^ s ^ ")") (natural n)
  | Shape.SMu (name, indices) ->
      let* name = quoted name in
      let* indices = list term indices in
      Ok ("(.SMu " ^ name ^ " " ^ indices ^ ")")
  | Shape.SPar (_, _) -> Error "SPar has no raw mirror"
  | Shape.SNu (_, _) -> Error "SNu has no raw mirror"
  | Shape.SZk (_, _, _) -> Error "SZk has no raw mirror"
  | Shape.SFhc _ -> Error "SFhc has no raw mirror"
  | Shape.SMpc (_, _) -> Error "SMpc has no raw mirror"

and address (a : Term.addr) : (string, string) result =
  match a with
  | Term.APt (q, arg) ->
      let* arg = term arg in
      Ok ("(.apt " ^ quantity q ^ " " ^ arg ^ ")")
  | Term.ALeg n -> Result.map (fun s -> "(.aleg " ^ s ^ ")") (natural n)
  | Term.ACtor name -> Result.map (fun s -> "(.actor " ^ s ^ ")") (quoted name)

and leg (l : Term.leg) : (string, string) result =
  let* binders = list binder l.l_binders in
  let* body = term l.l_body in
  Ok ("(.mk " ^ binders ^ " " ^ body ^ ")")

and branch ((a, l) : Term.addr * Term.leg) : (string, string) result =
  let* a = address a in
  let* l = leg l in
  Ok ("(" ^ a ^ ", " ^ l ^ ")")

and motive (m : Term.motive) : (string, string) result =
  let* ind = optional quoted m.m_ind in
  let* idx = list quoted m.m_idx in
  let* self = quoted m.m_self in
  let* body = term m.m_body in
  Ok ("(.mk " ^ ind ^ " " ^ idx ^ " " ^ self ^ " " ^ body ^ ")")

let field ((q, name, ty) : Quantity.t * string * Term.t) :
    (string, string) result =
  let* name = quoted name in
  let* ty = term ty in
  Ok ("(" ^ quantity q ^ ", " ^ name ^ ", " ^ ty ^ ")")

let constructor (c : Positivity.ctor) : (string, string) result =
  let* name = quoted c.c_name in
  let* args = list field c.c_args in
  let* indices = list term c.c_res_idx in
  let* arity = natural c.c_full_arity in
  Ok ("{ name := " ^ name ^ ", args := " ^ args ^ ", resultIndices := " ^
      indices ^ ", fullArity := " ^ arity ^ ", selfRecursive := " ^
      string_of_bool c.c_self_rec ^ " }")

let status (s : Positivity.ctor_status) : (string, string) result =
  match s with
  | Positivity.Provisional -> Ok ".provisional"
  | Positivity.Builtin -> Ok ".builtin"
  | Positivity.Complete names -> Result.map (fun s -> "(.complete " ^ s ^ ")") (list quoted names)

let declaration (f : Positivity.family) : (string, string) result =
  let* name = quoted f.f_name in
  let* params = list field f.f_params in
  let* indices = list field f.f_indices in
  let* status = status f.f_status in
  let* constructors = list constructor f.f_ctors in
  Ok ("{ name := " ^ name ^ ", params := " ^ params ^ ", indices := " ^ indices ^
      ", level := " ^ Level.to_string f.f_level ^ ", status := " ^ status ^
      ", constructors := " ^ constructors ^ ", positive := " ^
      string_of_bool f.f_positive ^ " }")

let definition (rows : (string * Global.entry) list) (name : string) :
    (string, string) result =
  let* entry = List.assoc_opt name rows
    |> Option.to_result ~none:("missing checked definition " ^ name) in
  match entry with
  | Global.Axiom _ | Global.Prim _ -> Error ("not a definition: " ^ name)
  | Global.Def d ->
      let* body = term d.def in
      let* ty = term d.ty in
      let* rec_arg = optional natural d.rec_arg in
      Ok ("def " ^ name ^ " : Term :=\n  " ^ body ^ "\n\n" ^
          "def " ^ name ^ "Type : Term :=\n  " ^ ty ^ "\n\n" ^
          "def " ^ name ^ "RecArg : Option Nat := " ^ rec_arg ^ "\n" ^
          "def " ^ name ^ "Partial : Bool := " ^ string_of_bool d.partial ^ "\n" ^
          "def " ^ name ^ "Reducible : Bool := " ^ string_of_bool d.reducible ^ "\n")

let export (source : string) : (string, string) result =
  let* globals, rows = Kanon_surface.Elab.check_in Global.initial source
    |> Result.map_error Error.to_string in
  let* family = Global.find_family "N" globals
    |> Option.to_result ~none:"the checked fixture has no N family" in
  let* decl = declaration family in
  let* definitions = sequence (definition rows) ["three"; "double"] in
  Ok ("/- Generated by dev/mu-bridge/export_mu.ml from the checked fixture. -/\n" ^
      "import KanonMeta.MuNat\n\nnamespace KanonMeta.MuNat.Generated\n\n" ^
      "def declaration : Declaration :=\n  " ^ decl ^ "\n\n" ^
      String.concat "\n" definitions ^ "\nend KanonMeta.MuNat.Generated\n")

let export_tree (source : string) : (string, string) result =
  let* globals, rows = Kanon_surface.Elab.check_in Global.initial source
    |> Result.map_error Error.to_string in
  let* family = Global.find_family "Tree" globals
    |> Option.to_result ~none:"the checked fixture has no Tree family" in
  let* decl = declaration family in
  let* definitions = sequence (definition rows) ["sample"; "mirror"] in
  Ok ("/- Generated by dev/mu-bridge/export_mu.ml from the checked fixture. -/\n" ^
      "import KanonMeta.MuTree\n\nnamespace KanonMeta.MuTree.Generated\n\n" ^
      "def declaration : MuNat.Declaration :=\n  " ^ decl ^ "\n\n" ^
      String.concat "\n" definitions ^ "\nend KanonMeta.MuTree.Generated\n")

let export_vector (source : string) : (string, string) result =
  let* globals, rows = Kanon_surface.Elab.check_in Global.initial source
    |> Result.map_error Error.to_string in
  let* natural_family = Global.find_family "N" globals
    |> Option.to_result ~none:"the checked fixture has no N family" in
  let* vector_family = Global.find_family "V" globals
    |> Option.to_result ~none:"the checked fixture has no V family" in
  let* natural_decl = declaration natural_family in
  let* vector_decl = declaration vector_family in
  let* definitions = sequence (definition rows) ["sample"; "copy"] in
  Ok ("/- Generated by dev/mu-bridge/export_mu.ml from the checked fixture. -/\n" ^
      "import KanonMeta.MuVector\n\nnamespace KanonMeta.MuVector.Generated\n\n" ^
      "def naturalDeclaration : MuNat.Declaration :=\n  " ^ natural_decl ^ "\n\n" ^
      "def declaration : MuNat.Declaration :=\n  " ^ vector_decl ^ "\n\n" ^
      String.concat "\n" definitions ^ "\nend KanonMeta.MuVector.Generated\n")

let export_finitary (name : string) (source : string) : (string, string) result =
  let* globals, rows = Kanon_surface.Elab.check_in Global.initial source
    |> Result.map_error Error.to_string in
  let* family = Global.find_family name globals
    |> Option.to_result ~none:("the checked fixture has no " ^ name ^ " family") in
  let* decl = declaration family in
  let* sample = definition rows "sample" in
  Ok ("/- Generated by dev/mu-bridge/export_mu.ml from the checked fixture. -/\n" ^
      "import KanonMeta.MuFinitary\n\nnamespace KanonMeta.MuFinitary.Generated\n\n" ^
      "def declaration : MuNat.Declaration :=\n  " ^ decl ^ "\n\n" ^
      sample ^ "\nend KanonMeta.MuFinitary.Generated\n")

(** The fixture text, given to [exporter].  A missing path and a
    directory are rejected by the two guards.  The read itself goes
    through [Sys_io.read_file], the one catch site of the repository
    (SD-D14), so a path that passes both guards but fails to open
    returns the declared error, and the process still exits 1. *)
let export_file (exporter : string -> (string, string) result) (path : string) :
    (string, string) result =
  if Sys.file_exists path && not (Sys.is_directory path) then
    Sys_io.read_file path
    |> Result.fold ~ok:exporter
         ~error:(fun (_ : string) -> Error ("cannot read fixture " ^ path))
  else Error ("cannot read fixture " ^ path)

let main (args : string list) : (string, string) result =
  let usage =
    "usage: export_mu [--tree|--vector] FIXTURE.kan | --finitary FAMILY FIXTURE.kan" in
  match args with
  | [_exe; "--tree"] | [_exe; "--vector"] | [_exe; "--finitary"] ->
      Error usage
  | [_exe; path] -> export_file export path
  | [_exe; "--tree"; path] -> export_file export_tree path
  | [_exe; "--vector"; path] -> export_file export_vector path
  | [_exe; "--finitary"; family; path] -> export_file (export_finitary family) path
  | [] | [_] | [_; _; _] | _ :: _ :: _ :: _ :: _ ->
      Error usage

let () =
  main (Array.to_list Sys.argv)
  |> Result.fold ~ok:print_string ~error:(fun message -> prerr_endline message; exit 1)
