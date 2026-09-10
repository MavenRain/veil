(** Stage L parser boundaries and sugar equivalence.  Parser refusals
    live here because the kernel suite round-trips every negative fixture. *)
open Kanon_kernel
open Kanon_surface

let ( let* ) = Result.bind

(** Parse one source text and render any parser error as a string. *)
let parse (source : string) : (Syntax.decl list, string) result =
  Parser.parse source |> Result.map_error Error.to_string

(** Check that printing a parsed tree and parsing it again gives the same tree. *)
let round_trip (source : string) : (unit, string) result =
  let* first = parse source in
  let* second = parse (Syntax.print first) in
  if first = second then Ok () else Error "printed tree changed"

(** Check that a source is refused with exactly the given error message. *)
let parse_refusal (source : string) (message : string) : (unit, string) result =
  Parser.parse source
  |> Result.fold
       ~ok:(fun (_tree : Syntax.decl list) -> Error "invalid source parsed")
       ~error:(fun (e : Error.t) ->
         if String.equal (Error.message e) message then Ok ()
         else Error (Error.to_string e))

(** Check that two sources parse to the same family tree. *)
let same_tree (first : string) (second : string) : (unit, string) result =
  let* a = parse first in
  let* b = parse second in
  if a = b then Ok () else Error "sugar changed the family tree"

(** Elaborate one source and return its checked form. *)
let checked (source : string) : (string, string) result =
  Elab.check_text Global.initial source
  |> Result.map Elab.checked_form |> Result.map_error Error.to_string

(** Check that two sources elaborate to the same checked form. *)
let same_checked (first : string) (second : string) : (unit, string) result =
  let* a = checked first in
  let* b = checked second in
  if String.equal a b then Ok () else Error "match changed checked elimination"

(** Check that a source elaborates to exactly the given refusal message. *)
let checked_refusal (source : string) (message : string) : (unit, string) result =
  Elab.check_text Global.initial source
  |> Result.fold
       ~ok:(fun (_rows : (string * Global.entry) list) -> Error "invalid source elaborated")
       ~error:(fun (e : Error.t) ->
         if String.equal (Error.message e) message then Ok ()
         else Error (Error.to_string e))

(** A family whose constructor fields hold two different types, so a
    shared annotation cannot agree with both of them. *)
let two_typed_fields =
  "mu Tag : Type 0 := | tag : Tag\n\
   mu Box : Type 0 := | box (m : Nat) (t : Tag) : Box\n"

(** The Stage L constructor field sugar for the natural number family. *)
let family = "mu N : Type 0 := | zero : N | succ (n : N) : N\n"

(** The same family in the legacy arrow form, without field sugar. *)
let legacy_family = "mu N : Type 0 with | zero : N | succ : (n : N) -> N\n"

(** A predecessor definition written with the match sugar. *)
let matched = family ^
  "def pred : N -> N := fun (n : N) => match n as x in N return N with | zero => zero | succ (p : N) => p"

(** The same predecessor definition written with case over the legacy family. *)
let cased = legacy_family ^
  "def pred : N -> N := fun (n : N) => case n as x in N return N with | zero => zero | succ p => p"

(** Two families in one explicit mutual group closed by end. *)
let mutual = "mutual mu A : Type 0 := | a (b : B) : A mu B : Type 0 := | b : B end"

(** The same two families in the legacy and chained form. *)
let legacy_mutual = "mu A : Type 0 with | a : (b : B) -> A and B : Type 0 with | b : B"

(** Every named case of this suite, each returning unit or one error message. *)
let cases : (string * (unit -> (unit, string) result)) list =
  [ "constructor-sugar", (fun () -> same_tree family legacy_family);
    "mutual-sugar", (fun () -> same_tree mutual legacy_mutual);
    "match-elaboration", (fun () -> same_checked matched cased);
    "mu-roundtrip", (fun () -> round_trip family);
    "legacy-mu-roundtrip", (fun () -> round_trip legacy_family);
    "mutual-roundtrip", (fun () -> round_trip mutual);
    "legacy-mutual-roundtrip", (fun () -> round_trip legacy_mutual);
    "match-roundtrip", (fun () -> round_trip matched);
    "case-roundtrip", (fun () -> round_trip cased);
    "mixed-fields-roundtrip", (fun () -> round_trip
      "def f : Nat := match n as x in N return Nat with | c (0 i : N) x (1 y : Nat) => y");
    "nested-match-roundtrip", (fun () -> round_trip
      "def f : Nat := match n as x in N return Nat with | z => 0 | s p => (match p as y in N return Nat with | z => 1 | s q => 2)");
    "empty-match-roundtrip", (fun () -> round_trip
      "mu Void : Prop := def exFalso : Void -> Type 0 := fun (v : Void) => match v as x in Void return Type 0 with");
    "case-numeric-roundtrip", (fun () -> round_trip
      "def f : Nat := case b with | 0 (x : Nat) => x | 1 (x : Nat) => x");
    "match-numeric-refusal", (fun () -> parse_refusal
      "def f : Nat := match n with | 0 (x : Nat) => x"
      "a match branch keys a constructor, not a leg number");
    "mutual-empty-refusal", (fun () -> parse_refusal "mutual end"
      "a mutual group needs at least two mu declarations");
    "mutual-singleton-refusal", (fun () -> parse_refusal "mutual mu N : Type 0 := end"
      "a mutual group needs at least two mu declarations");
    "mutual-unclosed-refusal", (fun () -> parse_refusal
      "mutual mu A : Type 0 := mu B : Type 0 :="
      "expected 'mu' or 'end' in a mutual group, found end of input");
    "mutual-and-refusal", (fun () -> parse_refusal
      "mutual mu A : Type 0 := and B : Type 0 := end"
      "expected 'mu' or 'end' in a mutual group, found 'and'");
    "grouped-def", (fun () -> same_tree
      "def f (0 A B : Type 0) (x y : Nat) (1 z : Nat) : Nat := natAdd x (natAdd y z)"
      "def f (0 A : Type 0) (0 B : Type 0) (x : Nat) (y : Nat) (1 z : Nat) : Nat := natAdd x (natAdd y z)");
    "grouped-fun", (fun () -> same_tree
      "def f : (1 x y : Nat) -> Nat := fun (1 x y : Nat) => natAdd x y"
      "def f : (1 x : Nat) -> (1 y : Nat) -> Nat := fun (1 x : Nat) (1 y : Nat) => natAdd x y");
    "grouped-star", (fun () -> same_tree
      "axiom p : (x y : Nat) * Nat"
      "axiom p : (x : Nat) * (y : Nat) * Nat");
    "grouped-family", (fun () -> same_tree
      "mu P (0 A B : Type 0) : Type 0 := | pair (x y : A) (z : B) : P A B"
      "mu P (0 A : Type 0) (0 B : Type 0) : Type 0 := | pair (x : A) (y : A) (z : B) : P A B");
    "grouped-branch", (fun () -> same_tree
      "def f : Nat := match p with | pair (1 x y : Nat) z => natAdd x (natAdd y z)"
      "def f : Nat := match p with | pair (1 x : Nat) (1 y : Nat) z => natAdd x (natAdd y z)");
    "grouped-branch-annotation", (fun () -> checked_refusal
      (two_typed_fields ^
       "def bad : Box -> Nat := fun (b : Box) => \
        match b as self in Box return Nat with | box (m t : Nat) => 0")
      "the annotation of constructor field t differs from its declared type");
    "grouped-case", (fun () -> same_tree
      "def f : Nat := case p with | 0 (x y : Nat) => natSub x y"
      "def f : Nat := case p with | 0 (x : Nat) (y : Nat) => natSub x y");
    "grouped-roundtrip", (fun () -> round_trip
      "def f (0 A B : Type 0) (1 x y : Nat) : Nat := natAdd x y");
    "grouped-dependent-check", (fun () -> same_checked
      "def f (0 A : Type 0) (x y : A) : A := x"
      "def f (0 A : Type 0) (x : A) (y : A) : A := x");
    "grouped-linear-check", (fun () -> same_checked
      "def f (1 x y : Nat) : Nat := let used : Nat := x in y"
      "def f (1 x : Nat) (1 y : Nat) : Nat := let used : Nat := x in y");
    "grouped-annotation-fallback", (fun () -> same_tree
      "axiom f : Nat -> Nat def n : Nat := (f 3 : Nat)"
      "axiom f : Nat -> Nat def n : Nat := ((f 3) : Nat)");
    "grouped-name-annotation-fallback", (fun () -> same_tree
      "axiom f : Nat -> Nat axiom x : Nat def n : Nat := (f x : Nat)"
      "axiom f : Nat -> Nat axiom x : Nat def n : Nat := ((f x) : Nat)");
    "grouped-empty-refusal", (fun () -> parse_refusal
      "def f (0 : Nat) : Nat := 0" "expected a binder name and ':', found ':'");
    "grouped-missing-colon-refusal", (fun () -> parse_refusal
      "def f (x y) : Nat := 0" "expected ':', found ')'");
    "grouped-missing-close-refusal", (fun () -> parse_refusal
      "def f (x y : Nat := 0" "expected ')', found ':='");
    "grouped-zk-expansion", (fun () -> same_tree
      "axiom P : zk (0 x y : Nat) * prod ()"
      "axiom P : zk (0 x : Nat) * (0 y : Nat) * prod ()");
    "nu-term-refusal", (fun () -> parse_refusal "def f : Type 0 := nu" "nu arrives at M2");
    "nu-declaration-refusal", (fun () -> parse_refusal "nu N : Type 0 :=" "nu arrives at M2") ]

let () =
  let passed = List.fold_left
      (fun (count : int) ((name : string), (run : unit -> (unit, string) result)) ->
        run () |> Result.fold
          ~ok:(fun () -> Printf.printf "SL-SURFACE %s OK\n" name; count + 1)
          ~error:(fun (message : string) ->
            Printf.printf "SL-SURFACE %s FAIL: %s\n" name message; count))
      0 cases in
  Printf.printf "SL-SURFACE-OK %d/%d\n" passed (List.length cases);
  if Int.equal passed (List.length cases) then print_endline "SL-SURFACE OK"
  else (print_endline "SL-SURFACE FAIL"; exit 1)
