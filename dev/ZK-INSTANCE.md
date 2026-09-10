# Proof instance binding

On base `4a1304f092a3f3b9ae3f64e608a0e7b1e2ac9541`, both runtime twins
stored the public instance in a proof slot but ignored it during verification.
The JavaScript twin accepted a slot for instance 9 and witness 3 at instance
3 with the identity relation. The compiled Kanon twin accepted a slot for
instance 10 and witness 3 at instance 9 with the squaring relation.

Both twins now compare the supplied instance with the stored instance before
applying the relation. A mismatch returns 0. A matching instance still requires
the relation to hold. Zero is a valid instance. This is a plaintext ABI rule:
the relation is still supplied at verification, slots are ordinary runtime
values, and this change introduces no cryptographic security or kernel rule.
Surface `verify` remains a proposition.

Validation on 2026-09-10 used the isolated checkout
`/Users/oobi/Documents/gpt3/veil-instance` from the base above.
The logs in `validation/2026-09-10-zk-instance/` record:

- `js-before.log`: the new operation 11 cases fail against the original
  JavaScript runtime because mismatched instances return 1.
- `wasm-before.log`: the compiled runtime regression fails at
  `squareCheck(10, 9, 3)`, returning 1 instead of 0. This baseline invocation
  used the existing base compiler in `/Users/oobi/Documents/veil`.
- `js-after.log`: the operation 11 regression passes after the fix.
- `wasm-after.log`: all ten compiled checks pass after the fix with the
  isolated checkout's compiler. They cover matching and mismatched instances,
  false relations, a relation accepting every input, zero and stored flags.
- `gates.log`: the full suite passes 24 of 26 legs. M0-TIME records
  231.551 ms against 150 ms at load1 52.610. M0-RATIO records 2.141463
  against 2.000 at load1 51.680. These are the only failures; no threshold
  or timing treatment was changed. HOST includes the ten compiled checks,
  and RUNTIME includes the expanded operation 11 cases.

Trailing whitespace in the JavaScript baseline log is stripped for Git hygiene.

The compiler builds with zero errors and warnings. The trusted kernel stays
at 5,246/5,250 lines, and the encoder stays at 246/600.
`source-manifest.json` pins the changed executable sources used by the suite.

Reproduce from the repository root:

```sh
zsh dev/dunecho.sh build
node --test --test-name-pattern 'operation 11' dev/runtime-test.mjs
node dev/zk-instance-test.mjs
zsh dev/gates.sh
```

The HOST gate requires a successful process exit and a `ZK-INSTANCE N/N`
verdict line, where the pass count equals the case count. The compiled check
holds ten cases, so the line reads `ZK-INSTANCE 10/10`. The JavaScript
regression changes only the operation 11 case sequence;
the other runtime tests retain their existing assertions.

## Review 2026-09-10 (zk instance)

- B-1 (medium): the HOST leg reads the `ZK-INSTANCE N/N` verdict line and
  compares the two counts, in place of a whole-file match with one literal.
  The compiled check prints the pass count against the case count. An added
  passing case or an extra output line no longer turns the leg red.
  Files: `dev/gates.sh`, `dev/zk-instance-test.mjs`, `dev/ZK-INSTANCE.md`.
- A-1 (low): the operation 11 text states that a host relation answers a
  natural number, and that the verdict is 1 only when that number equals the
  supplied instance. Files: `REACTOR.md`.
- A-2 (low): the operation 11 comment states again that the relation receives
  the instance and the slot witness. Files: `runtime/reactor.kan`.
- A-3 (low): the instance mismatch sentence records that the host twin rejects
  an unknown relation code first. Files: `REACTOR.md`.
- D-1 (low): the operation 11 test uses `slots.at()` and `script.at()`, which
  is the accessor of the sibling test. Files: `dev/runtime-test.mjs`.
- D-2 (low): the reproduce block states the working directory.
  Files: `dev/ZK-INSTANCE.md`.
- GATE-1 (high): no file changed. The `M0-TIME` leg measures the compiler
  driver, and this slice changes no compiler source. A repeat of the leg on
  this tree at load 44.930 prints
  `PASS M0-TIME median_ms=117.987 bound_ms=150 samples=3x5`. The same leg on a
  copy with the sixteen slice paths reverted to 4a1304f prints
  `PASS M0-TIME median_ms=133.024 bound_ms=150 samples=3x5` at load 43.374.
  The bound stays at 150 ms.

The final gate ladder after the review is `gates-review.log`, a copy of the
round-2 ladder log. It passes 25 of 26 legs at load1 68.111. The red leg is
`M0-TIME`, which records a median of 236.935 ms against the 150 ms bound.
This is a timing leg. The baseline at load1 40 passed it at 119.534 ms. The
runtime suite went red once on a signal-timing subtest at that load. It passed
22 of 22 on two reruns. The log records TRUSTED-LINES 5,246/5,250 and 246/600,
`ZK-INSTANCE 10/10`, and HOST programs=3. The review changes no bound and no
recorded log. The sections above the review block describe the run recorded in
`gates.log` before the review, so their counts, 24 of 26 legs with the two red
timing legs, are the counts of that run. `source-manifest.json` now carries the
sha256 of the four sources that the review edited, and `gates.log` with the four
before and after logs stay as recorded.
