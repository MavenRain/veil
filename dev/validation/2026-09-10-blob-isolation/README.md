# Blob isolation validation

Base: `c122c642ad27bb79d6617d846d95498ca57f8d4c`.

| Check | Result | Capture |
| --- | --- | --- |
| New regressions against the base runtime | Two overlap failures, sequential case passes | `regressions-before.stdout` |
| Complete runtime suite after the fix | 29/29, no skips | `runtime.stdout` |
| Compiled large-natural fixtures | 16/16 | `host-nat.stdout` |
| Compiled reactor integration | 103 checks pass | `reactor.stdout` |

Each capture has a separate stderr file. `results.json` records the original
command, exit status, Node version, final source hashes and reused compiler
hash. Retained logs strip trailing whitespace from each line; metadata keeps
the original byte counts and capture locations.
The overlap tests run the actual JavaScript request loop with a scripted
byte-list ABI and a controlled output callback. The integration harnesses
compile real fixtures to Wasm and run them with the changed runtime.

These are scoped runtime checks. The compiler was reused from the main Veil
checkout; the full gate ladder was not rerun. Reproduction commands and the
test scenarios are in [BLOB-ISOLATION.md](../../BLOB-ISOLATION.md).

## Review 2026-09-10

The slice review ran one fix round and one check round. The check loop closed
with no waiver. All five findings (B-1, D-3, D-2, D-1, C-1) are fixed. No
ruling, no refuted item and no dropped item came from the review.

The gate ladder of the fix round is in `gates-review.log`. That run passed 25
of 27 ladder legs. The numbers after the review are:

- `TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK`
- runtime suite: `# pass 29`, `# fail 0`, `RUNTIME-EXIT 0`
- `HOST-NAT 16/16` with `HOST-NAT-EXIT 0`
- `reactor: 103 checks passed` with `REACTOR-EXIT 0`
- `PASS HOST programs=3 zk-instance=10/10` with `HOST-EXIT 0`

Two legs are red, both of them timing legs:

- `FAIL M0-TIME median_ms=172.881 bound_ms=150 load1=21.831 samples=3x5`
- `FAIL M0-RATIO kanon_ms=101.165 kanon_lines=1000 tot_ms=103.662
  tot_lines=8138 ratio=7.941973 bound=2.000 load1=21.831`

The ladder tail is `GATES-FAIL` with `LADDER-EXIT 1` and
`RUN end=20:55:53 load=19.62 23.71 34.87`. The gate runner reported the run as
GREEN, because only timing legs are red.

Fix D-3, D-2 and D-1 changed `dev/runtime-test.mjs`. The review recomputed the
`sha256` entry of `dev/runtime-test.mjs` in `results.json` from the staged
bytes. This is the only hash that the review recomputed. The seven other
hashes are unchanged.

The sections above this one describe the scoped checks that were recorded
before the review (regressions-before 1 of 3 with the two overlap failures,
runtime 29 of 29, host-nat 16 of 16, reactor 103 checks) and no full ladder
run.
