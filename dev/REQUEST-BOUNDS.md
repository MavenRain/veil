# Bounded request traversal

The JavaScript reactor allows at most 1048576 nonempty list-node visits per
nonterminal request. It counts each word-list node and each byte-list node
in every argument and the body. Empty-list predicates are still checked at
the boundary but do not consume the budget. The host refuses a surplus node
before reading its head. A request exactly at the limit remains valid.

This closes an unbounded synchronous loop in request decoding. A module
could return its input from `bytesTail` or `wordsTail`, or construct a fresh
nonempty node on every call. A repeated-handle check alone is insufficient:
the compiled export wrappers can return different handles for repeated
underlying values. Counting visits covers both cases.

Rejection throws `RangeError` with `reactor request exceeds 1048576 list nodes`.
The CLI writes that message with the `kanon reactor:` prefix to stderr and
exits 2. The reactor removes its signal listeners, performs no host operation
for that request, and does not call `resume`. Earlier requests retain their
effects. Operation 0 still exits without decoding arguments or the body.

The counter resets for every request and is shared across all its lists.
Sharing tails or entire byte lists is valid, and every visit counts. For
example, an atomic write to a path encoded in P bytes can carry at most
1048576 - 1 - P body bytes. Larger requests must use a different application
protocol or fail; the host does not silently truncate them. Arguments passed
to `init` and answers passed to `resume` are outside this request budget.

This bounds host traversal when each accessor returns. It does not impose
a time limit on a Wasm export, a bound on allocations inside that export,
or a limit on the total number of requests. The counter takes constant
space; the already decoded arguments and body still take linear space.

The existing RUNTIME and REACTOR gate legs exercise the change:

- Scripted requests cover self-cycles, a prefix leading to a self-cycle,
  two-node cycles and a prefix leading to a two-node cycle in words,
  argument bytes and body bytes. A deterministic test guard makes the old
  runtime fail without hanging the test runner.
- Exact-limit requests succeed twice in succession. One surplus node fails
  before an existing file is overwritten. Two separately bounded arguments
  cannot exceed the shared total, and freshly allocated endless nodes fail.
- Shared byte lists remain valid across arguments, bodies and requests.
- `test/fixtures/reactor/list-cycles.kan` compiles without imports. Three
  modes exercise cyclic exported tails through the real CLI and require
  exit 2, the exact diagnostic and empty stdout. A finite control preserves
  the binary payload `[65, 0, 255]`.

Reproduce from the repository root:

```sh
zsh dev/dunecho.sh build
node --test --test-reporter=tap --test-name-pattern 'request traversal' dev/runtime-test.mjs
node dev/reactor-test.mjs _build/default/bin/kanon.exe
zsh dev/gates.sh
```

Validation captures and source hashes are retained in
`dev/validation/2026-09-11-request-bounds/`.

## Review 2026-09-11 (request bounds)

- B-1, medium: the cycle tests now also walk a cycle of empty words, which
  consumes no byte node. Only the word-list budget stops that cycle, so the
  tests now fail when the word loop does not consume a node.
  File: `dev/runtime-test.mjs`.
- C-1, low: the validation note now states that `gates.stdout` holds no test
  count and no line count, and it names the two commands that print them.
  File: `dev/validation/2026-09-11-request-bounds/README.md`.
- C-2, low: the compiled suite count of the list ABI note is now scoped to
  that revision, because this slice raises the count.
  File: `dev/LIST-ABI.md`.
- The check loop closed with no waiver. Each of the three findings has a fix.
  No item stayed open.
- Closing gate run `dev/validation/2026-09-11-request-bounds/gates-review.log`:
  25 of 27 ladder legs pass. The two red legs are timing legs: M0-TIME
  (median 167.857 ms against 150 ms, load1 19.203) and M0-RATIO (ratio
  2.066020 against 2.000, load1 19.203). The run reports
  `TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK`, `# pass 59` with
  `# fail 0`, `HOST-NAT 16/16`, `reactor: 131 checks passed` and
  `PASS HOST programs=3 zk-instance=10/10`.
