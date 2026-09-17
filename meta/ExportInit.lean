import Lean

/- Inventory driver only. The imported environment is fresh and contains Init,
   independent of the Lean modules used to implement this driver. -/
namespace Veil.InitInventory

open Lean

set_option linter.unusedVariables false in
def kind : ConstantInfo → String
  | .axiomInfo value => "axiom"
  | .defnInfo value => "definition"
  | .thmInfo value => "theorem"
  | .opaqueInfo value => "opaque"
  | .quotInfo value => "quotient"
  | .inductInfo value => "inductive"
  | .ctorInfo value => "constructor"
  | .recInfo value => "recursor"

def declaration (env : Environment) (name : Name) (info : ConstantInfo) : Json :=
  let moduleName := do
    let index ← env.getModuleIdxFor? name
    let moduleName ← env.header.moduleNames[index.toNat]?
    pure moduleName.toString
  Json.mkObj [
    ("name", toJson name.toString),
    ("module", toJson moduleName),
    ("kind", toJson (kind info)),
    ("levels", toJson (info.levelParams.map Name.toString)),
    ("private", toJson (isPrivateName name))]

def collect : IO (Except IO.Error Json) :=
  (do
    initSearchPath (← findSysroot)
    let env ← importModules #[{ module := `Init }] {} (level := .exported)
    let declarations := env.constants.fold
      (fun rows name info => rows.push (declaration env name info)) #[]
    pure (Json.mkObj [
      ("schema", toJson (1 : Nat)),
      ("root", toJson "Init"),
      ("import_level", toJson "exported"),
      ("modules", toJson (env.header.moduleNames.map Name.toString)),
      ("declarations", toJson declarations)]) : IO Json).toBaseIO

end Veil.InitInventory

def main : IO UInt32 := do
  let result ← Veil.InitInventory.collect
  let printed ← (match result with
    | .ok inventory => IO.println inventory.compress
    | .error error => IO.eprintln s!"Init inventory: {error}").toBaseIO
  pure (if result.isOk && printed.isOk then 0 else 1)
