(** The circuit predicate, veil D-8: a definition is a circuit when its
    body computes a finite, statically bounded multiplicative depth. *)

val depth : (string -> Term.t option) -> Term.t -> (int, string) result
(** [depth glookup t]: [Ok d] when [t] is a circuit of multiplicative
    depth [d]; [Error head] with the bare D-7 head word when it is
    refused: `mu`, `auto`, `host op`, `opaque callee`, `unbounded
    iteration`, `unknown global NAME`, or the name of a shape that
    arrives at a later milestone (SPEC section 2.4 lists all eleven).
    [glookup] resolves a global name to its definition body. *)

val cost : string -> int option
(** [cost name]: [Some 1] for each of the five M0 primitives
    (`natAdd natSub natMul natEq natLt`), [None] otherwise. *)

val word : string -> string
(** [word head] adds the full D-7 sentence to a bare head word:
    ["circuit fragment arrives at V5: " ^ head]. *)
