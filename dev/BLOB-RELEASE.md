# Host blob release

Operation 18 lets a long-running JavaScript reactor release a proof,
ciphertext or share without ending the run. It takes one decimal slot index
and returns status 0 with an empty answer after removing that live slot.
Releasing an unknown or already released index returns status 1 and
`IO: unknown blob slot INDEX`. Invalid argument counts and numeric strings
are rejected before changing the store.

The store tracks its next index independently of its live entry count.
Indices start at 1 for each invocation and are never reused within it.
For example, allocating slots 1 and 2, releasing 1, then allocating again
returns 3 and preserves slot 2. Even releasing every slot does not reset
the counter. All readers reject retired indices, including verification,
evaluation, decryption, joint computation and share opening. Derived blobs
retain their own values after an input is released.

The final representable index is 9007199254740991. Subsequent allocations
return `IO: blob slot index exhausted` without modifying the store. Existing
slots can still be read and released. Calls in other reactor invocations
cannot read, release or reset this invocation's slots.

Release removes the stored reference, allowing garbage collection of data
that is no longer reachable. It does not wipe plaintext from memory or
guarantee when the collector runs. The Wasm twin's ordinary `Slot` values
already follow WasmGC lifetimes, so this operation changes only the host
request protocol. Operations 10 to 17 keep their current arguments and
results. Operation 19 is now the first unknown operation code.

The RUNTIME suite covers each slot-producing operation, stale reads through
all consumers, malformed releases, duplicate release, live sibling and
derived slots, repeated allocation after the store becomes empty, and
release during overlapping reactor runs. The REACTOR suite compiles
`test/fixtures/reactor/blob-release.kan` with `runtime/reactor.kan` and runs
it through the CLI. The fixture releases slot 1, allocates slot 2, and checks
stale-handle errors alongside successful reads and release of slot 2.

Reproduce from the repository root:

```sh
zsh dev/dunecho.sh build
node --test --test-reporter=tap dev/runtime-test.mjs
node dev/reactor-test.mjs _build/default/bin/kanon.exe
zsh dev/gates.sh
```

Validation captures and source hashes are retained in
`dev/validation/2026-09-11-blob-release/`.

## Review 2026-09-11 (blob release)

- D-1, low: REACTOR.md now says the arity regressions cover all 18 rows and
  the release regressions cover the behavior of operation 18. Files:
  REACTOR.md.
- C-2, low: the validation README records that the before capture ran the
  runtime of d169af3 over the staged tests. Files:
  dev/validation/2026-09-11-blob-release/README.md.
- C-1, low: the arity note now says operations 1 to 18 are validated.
  Files: dev/REQUEST-ARITY.md.
- ND-1-1, medium: the arity note now says all 18 request rows reject each
  missing argument prefix. Files: dev/REQUEST-ARITY.md.
- Gate result after fix round 2: the log
  dev/validation/2026-09-11-blob-release/gates-review.log records 23 of 27
  ladder legs PASS and LADDER-EXIT 1. The red legs are FAIL M0-TIME
  median_ms=674.387 bound_ms=150 load1=33.575 samples=3x5, FAIL M0-RATIO
  kanon_ms=76.649 kanon_lines=1000 tot_ms=103.662 tot_lines=8138
  ratio=6.017341 bound=2.000 load1=33.769, FAIL M1-CORPUS elapsed_ms=1411.958
  bound_ms=713 lines=1000 main=814 load1=34.220 and FAIL RUNTIME at a
  one-minute load of 30.75 before the launch and 42.15 after LADDER-EXIT.
  The dispatcher waived each red leg under the load rule after check-2:
  every item of the round is fixed, new_defects is empty, and an
  independent run of the runtime suite reported "# fail 0". The kernel
  bound is unchanged: TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK.
