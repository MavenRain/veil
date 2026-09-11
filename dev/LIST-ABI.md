# Reactor list predicates

The JavaScript reactor now requires `bytesEmpty` and `wordsEmpty` to return
the numeric flag 0 or 1 on every call while decoding a request. Invalid
results throw a `RangeError` naming the export. The CLI prints one
`kanon reactor: invalid ABI predicate NAME: expected 0 or 1` line on stderr
and exits 2. The request is rejected before dispatch, and the reactor removes
its signal listeners without calling `resume`.

Previously, JavaScript truthiness interpreted a result of 2 as an empty list.
A malformed `wordsEmpty` could hide surplus arguments from the arity check,
and a malformed `bytesEmpty` could silently truncate an argument or payload.
For example, the compiled regression's body mode returned 2 after the first
payload byte, which allowed that byte to reach stdout as a successful write.

The checks enforce the existing flag encoding. A returned 0 still asks the
host to read a head and tail, and 1 still ends traversal. This does not prove
that an export describes its list accurately or that traversal terminates.
Terminal operation 0 does not read request arguments or payloads.

The existing gate legs cover the change:

- RUNTIME checks 15 invalid values at the first two traversal positions and
  at the end-of-list call in each of three places: the word list, an
  argument's bytes and the payload bytes. The word list ends at the second
  call, so the three places give 8 positions and 120 cases. All cases require
  rejection, unchanged file contents, no `resume` call and restored signal
  listeners. Valid flags preserve empty and binary payloads, and terminal
  requests never call either request-list accessor.
- REACTOR compiles `test/fixtures/reactor/list-predicates.kan` without imports
  and runs it through `runtime/run.mjs`. Its three malformed modes require
  exit 2, the exact diagnostic and empty stdout. Its valid mode writes the
  exact bytes `[65, 0, 255]`. These add 14 checks to the existing suite.

Reproduce from the repository root:

```sh
zsh dev/dunecho.sh build
node --test --test-reporter=tap dev/runtime-test.mjs
node dev/reactor-test.mjs _build/default/bin/kanon.exe
zsh dev/gates.sh
```

Reproduce the recorded baseline of the base runtime from the tree. Build the
fixture with the sixteen exports, take `runtime/run.mjs` and
`runtime/reactor.mjs` from the base commit, then run the four modes:

```sh
mkdir -p /tmp/list-abi-base/runtime
git show 78a921a:runtime/run.mjs > /tmp/list-abi-base/runtime/run.mjs
git show 78a921a:runtime/reactor.mjs > /tmp/list-abi-base/runtime/reactor.mjs
_build/default/bin/kanon.exe build test/fixtures/reactor/list-predicates.kan \
  -o /tmp/list-abi-base/list-predicates.wasm \
  --export emptyBytes --export consBytes --export bytesEmpty --export bytesHead \
  --export bytesTail --export emptyWords --export consWords --export wordsEmpty \
  --export wordsHead --export wordsTail --export init --export resume \
  --export requestCode --export requestArgs --export requestBody --export exitCode
for mode in words argument body valid; do
  node /tmp/list-abi-base/runtime/run.mjs \
    /tmp/list-abi-base/list-predicates.wasm $mode
done
```

The base runtime gives exit 0 and the stdout bytes `41 00 ff` for mode
`words`, exit 1 and empty stdout for mode `argument`, exit 0 and the single
byte `41` for mode `body`, and exit 0 with the bytes `41 00 ff` for mode
`valid`. The three malformed modes show the old behaviour: hidden word
arguments, a truncated byte argument and a partial payload write.

Validation captures and source hashes are retained in
`dev/validation/2026-09-10-list-abi/`. The new runtime regressions fail in all
three rejection groups against the base runtime; the valid-payload control
already passes. The fixed targeted run passes all six tests, including the
two terminal-request cases, and the compiled suite passes 117 checks.
The complete gate battery passes all 27 legs with `GATES-OK`, including
RUNTIME, REACTOR, HOST-NAT, the compiler suites and the three timing legs.
No gate thresholds or compiler sources changed.

## Review 2026-09-10 (list ABI)

- B-1, low: the rejection tests now inject each invalid flag at the
  end-of-list call of every region, which gives 8 positions and 120 cases.
  Files: `dev/runtime-test.mjs`, `dev/LIST-ABI.md`.
- C-2, low: this note now gives the in-tree commands and the four expected
  results that reproduce the baseline capture of the base runtime.
  File: `dev/LIST-ABI.md`.
- C-1, low: the suite counts of the request-arity note are now scoped to
  that revision, because this slice raises both counts.
  File: `dev/REQUEST-ARITY.md`.
- C-3, low: the sentence about compiler reuse in
  `dev/validation/2026-09-10-list-abi/README.md` named the targeted runtime
  check, which spawns no compiler. The close corrected it after round 1: it
  now names the `compiled-before` and `reactor` checks, and the review
  section of that file records the edit.
  File: `dev/validation/2026-09-10-list-abi/README.md`.
- The check loop closed with no waiver. All gate legs pass.
- The closing gate run is retained as
  `dev/validation/2026-09-10-list-abi/gates-review.log`: 27 of 27 legs PASS,
  no leg FAIL, `TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK`, RUNTIME
  `# pass 53` and `# fail 0`, `HOST-NAT 16/16`, `reactor: 117 checks passed`,
  `PASS HOST programs=3 zk-instance=10/10`, `GATES-OK` and `LADDER-EXIT 0`
  at load1 16.65 rising to 22.17.
