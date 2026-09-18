/- The Python regression runner appends this fixture to ExportDeclarations.lean
   in a temporary file, so it tests the current source without stale oleans. -/
namespace Veil.DeclarationExport.Tests
open Lean

def cases : Except String Json := do
  let domain := Expr.sort (.param `u)
  let explicit := Expr.lam `x domain (.bvar 0) .default
  let implicit := Expr.lam `x domain (.bvar 0) .implicit
  let renamed := Expr.lam `y domain (.bvar 0) .default
  let encode : Encode (Nat × Nat × Nat × Nat × Nat) := do
    let first ← expression explicit
    let second ← expression implicit
    let third ← expression renamed
    let repeated ← expression explicit
    let metadata ← expression (.mdata {} explicit)
    let _app ← expression (.app explicit (.lit (.natVal (2^100))))
    let _let ← expression (.letE `x domain (.lit (.strVal "λ\n雪")) (.bvar 0) false)
    let _forall ← expression (.forallE `x domain (.bvar 0) .strictImplicit)
    let _instance ← expression (.lam `x domain (.bvar 0) .instImplicit)
    let _constant ← expression (.const `Test.constant [.imax (.param `u) (.max .zero (.succ .zero))])
    let _projection ← expression (.proj `Test.Structure 0 (.bvar 0))
    pure (first, second, third, repeated, metadata)
  let ((first, second, third, repeated, metadata), graph) ← encode.run {}
  let freeRejected := !((expression (.fvar ⟨`free⟩)).run {}).isOk
  let metaRejected := !((expression (.mvar ⟨`meta⟩)).run {}).isOk
  let universeRejected := !(level 512 (.mvar ⟨`universeMeta⟩)).isOk
  let limitRejected := !(level 0 .zero).isOk
  pure (Json.mkObj [
    ("binder_annotations_distinct", toJson (first != second)),
    ("binder_names_distinct", toJson (first != third)),
    ("sharing_preserved", toJson (first == repeated)),
    ("metadata_erased", toJson (first == metadata)),
    ("free_variable_rejected", toJson freeRejected),
    ("metavariable_rejected", toJson metaRejected),
    ("universe_metavariable_rejected", toJson universeRejected),
    ("level_limit_rejected", toJson limitRejected),
    ("nodes", toJson graph.nodes), ("references", toJson (graph.refs.map Name.toString))])

def printCases : IO Unit := do
  let result := match cases with
    | .ok value => value
    | .error message => Json.mkObj [("error", toJson message)]
  let _written ← (IO.println result.compress).toBaseIO
  pure ()

#eval printCases
end Veil.DeclarationExport.Tests
