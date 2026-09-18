import Lean

/- Translator input from a fresh Init environment, not a translation certificate. -/
namespace Veil.DeclarationExport
open Lean

def tagged (tag : String) (fields : Array Json := #[]) : Json :=
  Json.arr (#[toJson tag] ++ fields)

def level : Nat → Level → Except String Json
  | 0, (_value) => .error "universe expression exceeds depth limit"
  | fuel + 1, value => do
    match value with
    | .zero => pure (tagged "zero")
    | .succ arg => pure (tagged "succ" #[← level fuel arg])
    | .max left right => pure (tagged "max" #[← level fuel left, ← level fuel right])
    | .imax left right => pure (tagged "imax" #[← level fuel left, ← level fuel right])
    | .param name => pure (tagged "param" #[toJson name.toString])
    | .mvar (_id) => .error "unresolved universe metavariable"

def binder : BinderInfo → String
  | .default => "explicit"
  | .implicit => "implicit"
  | .strictImplicit => "strict_implicit"
  | .instImplicit => "instance"

structure Graph where
  nodes : Array Json := #[]
  indices : ExprStructMap Nat := {}
  refs : Array Name := #[]

abbrev Encode := StateT Graph (Except String)

def fail {α : Type} (message : String) : Encode α := fun (_state) => .error message

def checked {α : Type} (result : Except String α) : Encode α :=
  match result with
  | .ok value => pure value
  | .error message => fail message

def reference (name : Name) : Encode Json := do
  modify fun state => { state with refs := state.refs.push name }
  pure (toJson name.toString)

partial def expression (value : Expr) : Encode Nat := do
  if let some index := (← get).indices[ExprStructEq.mk value]? then return index
  let node ← match value with
    | .bvar index => pure (tagged "bvar" #[toJson index])
    | .sort sortLevel => pure (tagged "sort" #[← checked (level 512 sortLevel)])
    | .const name universes => do
      let levels ← checked (universes.mapM (level 512))
      pure (tagged "const" #[← reference name, toJson levels])
    | .app fn arg => pure (tagged "app" #[toJson (← expression fn), toJson (← expression arg)])
    | .lam name domain body info => pure (tagged "lam" #[toJson name.toString,
        toJson (binder info), toJson (← expression domain), toJson (← expression body)])
    | .forallE name domain body info => pure (tagged "forall" #[toJson name.toString,
        toJson (binder info), toJson (← expression domain), toJson (← expression body)])
    | .letE name type value body nondep => pure (tagged "let" #[toJson name.toString,
        toJson (← expression type), toJson (← expression value),
        toJson (← expression body), toJson nondep])
    | .lit (.natVal value) => do
      let _name ← reference `Nat
      pure (tagged "nat" #[toJson (toString value)])
    | .lit (.strVal value) => do
      let _name ← reference `String
      pure (tagged "string" #[toJson value])
    | .proj name index struct => pure (tagged "proj" #[← reference name,
        toJson index, toJson (← expression struct)])
    | .mdata (_data) inner => return ← expression inner
    | .fvar (_id) => fail "free variable in a closed declaration"
    | .mvar (_id) => fail "unresolved expression metavariable"
  let state ← get
  if state.nodes.size >= 100000 then fail "declaration exceeds expression node limit"
  else
    let index := state.nodes.size
    set { state with nodes := state.nodes.push node, indices := state.indices.insert ⟨value⟩ index }
    pure index

def references (names : List Name) : Encode Json := do
  pure (toJson (← names.mapM reference))

def kind : ConstantInfo → String
  | .axiomInfo (_value) => "axiom"
  | .defnInfo (_value) => "definition"
  | .thmInfo (_value) => "theorem"
  | .opaqueInfo (_value) => "opaque"
  | .quotInfo (_value) => "quotient"
  | .inductInfo (_value) => "inductive"
  | .ctorInfo (_value) => "constructor"
  | .recInfo (_value) => "recursor"

def details (info : ConstantInfo) : Encode Json := do
  match info with
  | .axiomInfo value => pure (Json.mkObj [("unsafe", toJson value.isUnsafe)])
  | .defnInfo value =>
    let safety := match value.safety with
      | .safe => "safe" | .unsafe => "unsafe" | .partial => "partial"
    let hints := match value.hints with
      | .opaque => tagged "opaque" | .abbrev => tagged "abbrev"
      | .regular height => tagged "regular" #[toJson height.toNat]
    pure (Json.mkObj [("safety", toJson safety), ("hints", hints),
      ("mutual", ← references value.all)])
  | .thmInfo value => pure (Json.mkObj [("mutual", ← references value.all)])
  | .opaqueInfo value => pure (Json.mkObj [("unsafe", toJson value.isUnsafe),
      ("mutual", ← references value.all)])
  | .quotInfo value =>
    let form := match value.kind with
      | .type => "type" | .ctor => "ctor" | .lift => "lift" | .ind => "ind"
    pure (Json.mkObj [("form", toJson form)])
  | .inductInfo value => pure (Json.mkObj [
      ("parameters", toJson value.numParams), ("indices", toJson value.numIndices),
      ("mutual", ← references value.all), ("constructors", ← references value.ctors),
      ("nested", toJson value.numNested), ("recursive", toJson value.isRec),
      ("unsafe", toJson value.isUnsafe), ("reflexive", toJson value.isReflexive)])
  | .ctorInfo value => pure (Json.mkObj [
      ("inductive", ← reference value.induct), ("index", toJson value.cidx),
      ("parameters", toJson value.numParams), ("fields", toJson value.numFields),
      ("unsafe", toJson value.isUnsafe)])
  | .recInfo value =>
    let rules ← value.rules.mapM fun rule => do
      pure (Json.mkObj [("constructor", ← reference rule.ctor),
        ("fields", toJson rule.nfields), ("rhs", toJson (← expression rule.rhs))])
    pure (Json.mkObj [("mutual", ← references value.all),
      ("parameters", toJson value.numParams), ("indices", toJson value.numIndices),
      ("motives", toJson value.numMotives), ("minors", toJson value.numMinors),
      ("rules", toJson rules), ("k", toJson value.k), ("unsafe", toJson value.isUnsafe)])

def declaration (env : Environment) (name : Name) (info : ConstantInfo) :
    Except String (Json × Array Name) := do
  let moduleName ← match env.getModuleIdxFor? name with
    | none => .error s!"missing module for {name}"
    | some index => match env.header.moduleNames[index.toNat]? with
      | none => .error s!"invalid module index for {name}"
      | some moduleName => pure moduleName.toString
  let encode : Encode (Nat × Option Nat × Json) := do
    let type ← expression info.type
    let value ← (info.value? (allowOpaque := true)).mapM expression
    pure (type, value, ← details info)
  let ((type, value, payload), graph) ← encode.run {}
  pure (Json.mkObj [("name", toJson name.toString), ("module", toJson moduleName),
    ("kind", toJson (kind info)), ("levels", toJson (info.levelParams.map Name.toString)),
    ("private", toJson (isPrivateName name)), ("type", toJson type), ("value", toJson value),
    ("details", payload), ("nodes", toJson graph.nodes),
    ("dependencies", toJson (graph.refs.map Name.toString))], graph.refs)

partial def closure (env : Environment) (fuel : Nat) (pending : List Name)
    (seen : NameSet) (rows : Array Json) : Except String (Array Json) := do
  match pending with
  | [] => pure rows
  | name :: rest =>
    if seen.contains name then closure env fuel rest seen rows
    else if fuel == 0 then .error "dependency closure exceeds 4096 declarations"
    else
      let info ← match env.find? name with
        | some info => pure info | none => .error s!"missing dependency {name}"
      let (row, refs) ← declaration env name info
      closure env (fuel - 1) (refs.toList ++ rest) (seen.insert name) (rows.push row)

def collect (requested : List String) : IO (Except String Json) := do
  let loaded ← (do
    initSearchPath (← findSysroot)
    importModules #[{ module := `Init }] {} (level := .private)).toBaseIO
  pure do
    let env ← loaded.mapError toString
    if requested.isEmpty then .error "at least one Init declaration is required"
    else
      let names ← env.constants.fold (init := .ok ({} : Std.HashMap String Name)) fun acc name (_info) => do
        let names ← acc
        if names.contains name.toString then .error s!"ambiguous name rendering: {name}"
        else pure (names.insert name.toString name)
      let roots ← requested.mapM fun name => match names[name]? with
        | some name => .ok name | none => .error s!"unknown Init declaration: {name}"
      let rows ← closure env 4096 roots {} #[]
      pure (Json.mkObj [("schema", toJson (1 : Nat)), ("root", toJson "Init"),
        ("import_level", toJson "private"), ("requested", toJson requested),
        ("modules", toJson (env.header.moduleNames.map Name.toString)),
        ("declarations", toJson rows)])

end Veil.DeclarationExport

def main (args : List String) : IO UInt32 := do
  let result ← Veil.DeclarationExport.collect args
  let printed ← (match result with
    | .ok declarations => IO.println declarations.compress
    | .error message => IO.eprintln s!"Init declarations: {message}").toBaseIO
  pure (if result.isOk && printed.isOk then 0 else 1)
