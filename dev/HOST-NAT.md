# Exact host naturals

On base `f3b92cd`, the JavaScript reactor parsed private-computation data as
machine numbers and narrowed slot fields to i31. For example, storing
`1073741824` failed with `invalid ABI natural`, and evaluating the successor
of `1073741823` could not allocate its result. The compiled Kanon twin already
supported arbitrary-precision `Nat` internally.

The JavaScript twin now parses instances, witnesses, levels and plaintexts
directly from decimal bytes to `BigInt`. Its sum, product, square-of-sum and
successor-of-sum functions use exact arithmetic. Slots retain exact flags and
payloads, and operations 14 and 17 return canonical decimal bytes. Instance
binding distinguishes adjacent numbers above the JavaScript safe-integer
limit. The slot, function and subset indices retain their safe-integer checks.
The kernel, compiler, compiled runtime and direct numeric export ABI do not
change. Both runtime twins remain plaintext implementations.

`dev/runtime-test.mjs` drives the actual request loop through a scripted
byte-list ABI. Four added tests cover 81 roundtrip requests, 26 arithmetic
requests, malformed decimal arguments and bounded index refusals. They include
zero, leading zeros, the i31 boundary, the safe-integer boundary and a 60-digit
natural. Rejected arguments return status 1 and leave the slot count intact.

`dev/host-nat-test.mjs` compiles `test/host/host-nat.kan` and
`test/host/nat-bytes.kan` with `runtime/reactor.kan`. Twelve small exported
observations check large ZK, FHC and MPC results in the compiled twin. Four
real reactor runs send decimal data through WebAssembly byte lists, evaluate
its successor in the JavaScript host and read the exact decimal answer back.
The `HOST-NAT` gate requires a successful process exit and one `HOST-NAT`
verdict line whose two counts agree, so an added passing check keeps it green.
The harness also checks minimum case counts, successful compilation and an
empty module import list.

Reproduce from the repository root:

```sh
zsh dev/dunecho.sh build
node --test --test-reporter=tap dev/runtime-test.mjs
node dev/host-nat-test.mjs
zsh dev/gates.sh --leg host-nat
zsh dev/gates.sh
zsh dev/house.sh
zsh dev/trusted-lines.sh
```

Validation captures and source hashes are in
`validation/2026-09-10-host-nat/`. The baseline capture runs the new four
runtime tests against the original runtime: the roundtrip and arithmetic
tests fail at the old narrowing boundary, and the malformed-decimal test
fails on the old diagnostic. The bounded-index test already passes.

The compiler build reports zero errors and warnings. The runtime suite passes
26/26 tests, and the compiled/byte-stream harness passes 16/16 checks. The
full gate run passes 25/27 legs, including HOST, HOST-NAT and RUNTIME. The only
failures are M0-TIME (217.069 ms against 150 ms) and M0-RATIO (9.833476 against
2.000), both at load1 71.641. Their thresholds and timed compiler sources are
unchanged. The trusted kernel remains 5,246/5,250 lines and the encoder remains
246/600. Captures preserve stdout followed by stderr with trailing whitespace
stripped for Git hygiene.

## Review 2026-09-10 (host naturals)

- A-1 (high): the arithmetic script now reads the level of operation 13 back
  through operation 11 at two adjacent levels above the safe-integer limit
  (`dev/runtime-test.mjs`).
- B-1 (medium): the `HOST-NAT` leg compares the two counts of the verdict line
  in `leg_host_nat`, as the `HOST` leg does, so an added passing check cannot
  turn it red (`dev/gates.sh`, `dev/HOST-NAT.md`).
- D-1 (medium): the dead function-valued `args` branch of `slotScript` is gone
  (`dev/runtime-test.mjs`).
- C-1 (low): the gate leg list names twenty-seven legs and holds CIRCUIT, ZK,
  FHC, MPC, HOST and HOST-NAT (`README.md`).
- C-2 (low): the reproduce list holds `zsh dev/gates.sh` and the new
  `--leg host-nat` selector (`dev/HOST-NAT.md`).
- D-3 (low): the harness counts both case groups with `filter(...).length`, as
  `dev/zk-instance-test.mjs` does (`dev/host-nat-test.mjs`).

The check loop closed with no waiver. All six kept findings are fixed. No
finding was ruled, one was merged (D-2 into C-1) and one was dropped (A-2).
The closing gate run is
`dev/validation/2026-09-10-host-nat/gates-review.log` (tag fix-1, start 15:06,
end 15:09). That run gives `BUILD-EXIT 0`,
`TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK`, `HOST-NAT 16/16` with
`HOST-NAT-EXIT 0`, `PASS HOST programs=3 zk-instance=10/10` and the ladder legs
`PASS HOST-NAT checks=16/16`, `PASS RUNTIME` and `PASS TRUSTED-LINES`. Three
timing legs are red at load1 about 79, which the load rule makes GREEN:
`FAIL M0-TIME median_ms=648.686 bound_ms=150 load1=79.020`,
`FAIL M0-RATIO ratio=7.413869 bound=2.000 load1=79.020` and
`FAIL M1-CORPUS elapsed_ms=769.519 bound_ms=713 load1=78.217`. The runner
RUNTIME section of that log shows `# pass 22` `# fail 4` and the rerun shows
`# pass 23` `# fail 3`, all on the pre-existing signal-timing subtests; the
ladder leg of the same run reports `PASS RUNTIME`. The fixes changed
`dev/runtime-test.mjs`, `dev/gates.sh` and `dev/host-nat-test.mjs`, so the
three sha256 rows of those files in
`dev/validation/2026-09-10-host-nat/source-manifest.json` were recomputed from
the staged bytes.
