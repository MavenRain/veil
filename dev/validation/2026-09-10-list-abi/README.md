# List ABI validation, 2026-09-10

Validated in `/Users/oobi/Documents/gpt3/veil-list-abi` on base
`78a921ab8ef02395fe63e0dfa30b9e153803cd0e`.

| Capture | Result |
| --- | --- |
| `runtime-before` | Expected exit 1: three new rejection tests fail against the base runtime; the valid-payload control passes |
| `runtime-targeted` | Exit 0: all six selected tests pass, including 90 malformed-flag cases and the two terminal-request cases |
| `compiled-before` | Exit 0: confirms the old behavior in all four compiled fixture modes, including a successful partial stdout write |
| `reactor` | Exit 0: 117 compiled ABI and CLI checks pass |
| `gates` | Exit 0: all 27 legs pass and the run ends with `GATES-OK` |

`runtime-before` used the new test file with the unmodified base runtime.
`compiled-before` compiled the new fixture and ran it with `runtime/run.mjs`
and `runtime/reactor.mjs` extracted from the base commit. Its exit 0 means
the expected old results were reproduced; it does not mean those malformed
requests were correctly rejected. The word-list case hid a surplus argument,
the argument-byte case reached the arity error, and the body case wrote `A`.
The fixed CLI rejects each malformed mode with exit 2 and empty stdout.

The `compiled-before` and `reactor` checks reused the compiler executable in
`/Users/oobi/Documents/veil/_build/default/bin/kanon.exe`. The
`runtime-before` and `runtime-targeted` checks run `dev/runtime-test.mjs`
with `node --test` only. That test file spawns no compiler. The full gate
battery built and used the compiler in the isolated validation copy. It
includes the complete RUNTIME suite and the compiled REACTOR, HOST and
HOST-NAT legs. No timing exceptions were needed.

Each check retains stdout and stderr separately. Trailing whitespace is
removed from retained text for Git hygiene. `results.json` records the
original capture manifests, base runtime hash, validation test hash,
compiler hashes and source hashes. The final patch was checked for whitespace
errors and copied to the primary repository only after validation.

## Review 2026-09-10

A multi-agent review of this slice closed on 2026-09-10. It kept four low
findings: B-1, C-3, C-2 and C-1. Round 1 fixed B-1, C-2 and C-1. B-1 added the
end-of-list call to the rejection tests of each region, which gives 8 positions
and 120 cases (`dev/runtime-test.mjs`, `dev/LIST-ABI.md`). C-2 added the
in-tree commands and the four expected results that reproduce the
`compiled-before` capture (`dev/LIST-ABI.md`). C-1 scoped the suite counts of
`dev/REQUEST-ARITY.md` to the revision that states them. The close fixed C-3
after round 1: the sentence above about compiler reuse named the targeted
runtime check, which spawns no compiler. It now names the `compiled-before`
and `reactor` checks, the two checks that ran the compiler executable, and
states that the runtime checks spawn none. This section is the provenance
record of that edit. No capture file was changed. The check loop closed with
no waiver.

The final gate run is retained as `gates-review.log`. It reports 27 of 27 legs
PASS and no FAIL leg, therefore no load-bound red leg. Its numbers after the
review are `TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK`, RUNTIME
`# pass 53` with `# fail 0`, `HOST-NAT 16/16`, `reactor: 117 checks passed`,
`PASS HOST programs=3 zk-instance=10/10`, `GATES-OK` and `LADDER-EXIT 0`, at
load1 16.65 at the start and 22.17 at the end.

The review refreshed two `sha256` entries of `results.json` from the staged
bytes: `dev/runtime-test.mjs` and `dev/LIST-ABI.md`. All other fields of
`results.json` and all ten capture files are unchanged.

The sections above describe the scoped checks that were recorded before the
review: `runtime-before` 1 of 4 with the three list ABI failures,
`runtime-targeted` 6 of 6, `compiled-before` with the four reproduced BASELINE
modes, `reactor` with 117 checks, and `gates` with 27 PASS legs and `GATES-OK`.
