# Reactor blob store isolation

Each call to `runReactor` now owns its blob store. Previously, the JavaScript
reactor exported one module-wide map and cleared it whenever any run started.
An overlapping run could replace an existing proof with its own slot 1, or
clear all slots even when it failed in `init`. The first run would then return
a false verification verdict or report an unknown slot.

The request loop now passes its private map to the host operations. Every
run allocates indices starting at 1 and resolves all eight host operations
against its own map. Removing the exported global `blobs` map also removes
the module's reference to completed runs' plaintext data. The request ABI and
the Kanon twin's ordinary `Slot` values are unchanged.

Three regressions are part of `dev/runtime-test.mjs`, which the existing
RUNTIME gate runs:

- Pause a first run after it allocates a proof, ciphertext and two shares.
  Run a second invocation to completion. It cannot read the first run's slots,
  allocates its own indices starting at 1 and reads its own values. Resume the
  first run, verify its proof, decrypt its large natural, evaluate its ciphertext
  and compute over its shares. Both runs restore their signal listeners.
- Repeat the overlap with a second invocation that throws in `init`. Its
  failure must leave the first run's values and allocation sequence intact.
- Finish one invocation, then start another. The next run rejects the old
  slot and starts its own allocation sequence at 1.

The overlap uses a controlled output callback as a barrier, with no timing
sleep. It runs the actual JavaScript request loop through a scripted byte-list
ABI. Both overlap cases fail against base commit `c122c642ad27bb79d6617d846d95498ca57f8d4c`.
They pass after the change, along with all 29 runtime tests of that revision.
Later slices add runtime tests, so the runtime count of a fresh run is larger.

Validation logs and source hashes are retained under
`dev/validation/2026-09-10-blob-isolation/`. Reproduce the scoped checks from
the repository root after building the compiler:

```sh
node --test --test-reporter=tap dev/runtime-test.mjs
node dev/host-nat-test.mjs _build/default/bin/kanon.exe
node dev/reactor-test.mjs _build/default/bin/kanon.exe
```

This slice changes the JavaScript runtime, tests and documentation. Validation
reuses the existing compiler executable and does not claim a fresh full gate
ladder run.

## Review 2026-09-10 (blob isolation)

- B-1 (low): REACTOR.md no longer claims that the module drops the store after
  a run, because no regression proves that property. The sentence now states
  what the suite proves. Files: REACTOR.md.
- D-3 (low): the patched `process.stdout.write` of the overlap tests takes rest
  parameters and accepts the three-argument stream signature. Files:
  dev/runtime-test.mjs.
- D-2 (low): the mock instances are read by index with a counter instead of
  `shift()`, and a third instantiation fails with a readable message. Files:
  dev/runtime-test.mjs.
- D-1 (low): `slotScript` and six tests drop the unused test-context parameter.
  Files: dev/runtime-test.mjs.
- C-1 (low): dev/HOST-NAT.md scopes its counts to the 2026-09-10 host-nat run,
  so the 26/26 runtime count is a record and not a present count. Files:
  dev/HOST-NAT.md.
- The check loop closed with no waiver. The review recorded no ruling, no
  refuted item and no dropped item.
- The gate ladder of the fix round is
  dev/validation/2026-09-10-blob-isolation/gates-review.log. That run passed 25
  of 27 legs, with `# pass 29` and `# fail 0` for the runtime suite,
  `TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK`, `HOST-NAT 16/16`,
  `reactor: 103 checks passed` and
  `PASS HOST programs=3 zk-instance=10/10`. Two timing legs are red:
  `FAIL M0-TIME median_ms=172.881 bound_ms=150 load1=21.831` and
  `FAIL M0-RATIO ratio=7.941973 bound=2.000 load1=21.831`.
- The `sha256` entry of dev/runtime-test.mjs in
  dev/validation/2026-09-10-blob-isolation/results.json was recomputed from the
  staged bytes, because the D-3, D-2 and D-1 fixes changed that file. The eight
  capture files are unchanged.
