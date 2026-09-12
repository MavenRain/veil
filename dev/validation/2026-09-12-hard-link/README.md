# Hard-link validation, 2026-09-12

Base commit: `e099b831b8ec3fe3b5b09d9a35720bcb688dc875`.

Operation 26 creates a hard link to an existing entry. Regular files share
identity and contents, destination conflicts preserve existing entries, and
errors return through `resume`. See [HARD-LINK.md](../../HARD-LINK.md) for the
contract and the native and injected test cases.

| Check | Result |
| --- | --- |
| RUNTIME | 111 tests passed, 0 failures, 0 skipped |
| REACTOR | 627 checks passed |
| Focused runtime tests | 7 passed |
| Same focused tests with the base runtime | All 7 fail |
| Seven mutation controls | Each rejected by at least one focused test |
| JavaScript syntax | Runtime and both test files pass |
| HOUSE | Pass |
| TRUSTED-LINES | Kernel 5246/5250, encoder 246/600 |
| Diff whitespace | Pass |

The existing compiler was reused after checking its hash against the preceding
symlink-creation validation record. Compiler, elaborator, emitter, Lean sources,
gate scripts and thresholds are unchanged. The compiled fixture passes through
the normal CLI and produces an import-free Wasm module. The full compiler and
milestone battery was not repeated for this runtime slice.

RUNTIME and REACTOR ran separately with their existing 30-second watchdogs.
An initial sandboxed REACTOR attempt produced empty streams and the capture
wrapper error `IO: process group cleanup failed`. Its manifest remained marked
running, so it supplies no test verdict. The same command passed with
process-control access. [reactor-initial.json](reactor-initial.json) retains
that failure, separately from the passing [reactor.json](reactor.json).

The focused tests ran first against the old runtime, then passed with operation
26. The base runtime and all mutation controls were also run on isolated copies
of the final test file. The tests check shared file identity, contents and
lifetime, atomic replacement, literal path forwarding, destination preservation,
error propagation and pre-effect request validation. Each control finishes with
seven completed tests and at least one assertion failure, without timeout or
cancelled tests. [controls.json](controls.json) records the exact replacements
and hashes of each runtime and its unchanged test copy.

The shared request-arity matrix also holds a row for operation 26, at
`dev/runtime-test.mjs:774`. That row is a subtest of a differently named
top-level test, so the anchored pattern `^hard-link creation` does not select
it. The full RUNTIME run is the only run that covers it. The rows "7 passed"
and "All 7 fail" above, and each control result, exclude that row.

Native behavior was exercised on macOS. Cross-device, permission and link-limit
failures use injected filesystem errors, without exhausting resources or
requiring another filesystem. Windows was not exercised.

From the repository root, rerun the primary checks. The runtime and reactor
commands keep the unchanged 30-second watchdog. The focused, house and
trusted-lines commands run without a watchdog, as they did in the record:

```sh
kanon-wait run -- kanon-exec run --budget 4000 -- gtimeout 30 node --test --test-reporter=tap dev/runtime-test.mjs
kanon-wait run -- kanon-exec run --budget 4000 -- gtimeout 30 node dev/reactor-test.mjs _build/default/bin/kanon.exe
kanon-wait run -- kanon-exec run --budget 4000 -- node --test --test-name-pattern='^hard-link creation' dev/runtime-test.mjs
kanon-wait run -- kanon-exec run --budget 4000 -- zsh dev/house.sh
kanon-wait run -- kanon-exec run --budget 4000 -- zsh dev/trusted-lines.sh
```

[results.json](results.json) pins source and evidence hashes and records the
platform, Node version, validation scope and per-command summaries. Each
`summary` record holds the exit code and the counts only. The exact arguments,
the working directory, the completed capture path and the stream hashes live in
the per-command capture files that `capture_sha256` lists. Full TAP streams remain
in the local `capture_artifact` directories and are readable with
`kanon-exec read ARTIFACT --command N --lines START:END --budget 4000`.

`source_sha256` pins two prose files, `dev/HARD-LINK.md` and
`dev/REACTOR-BUILD-LOG.md`. A later review edit of one of those files, or an
appended review section, refreshes its row after the edit, never before it.
The capture files, `controls.json` and every recorded stream hash stay byte
identical. This README is deliberately outside `source_sha256`, so a review can
correct its prose without a hash refresh.

## Review 2026-09-12

A four-lens review of this slice ran on 2026-09-12. The full gate ladder of the
fix round is kept in [gates-review.log](gates-review.log). That run gives
`GATES-OK` and `LADDER-EXIT 0`, with 28 of 28 legs PASS and no FAIL leg. The
load averages were 23.73 at the start and 32.50 at the end. The check loop
closed with no waiver. The waiver threshold stays at load1 above twenty-five.
The RUNTIME 111 of 111 line, the seven new hard-link creation tests, the
`reactor: 627 checks passed` line and HOST-NAT 16/16 are never waived by load
alone.

The numbers after the review, read from that log:

- `TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK`
- RUNTIME `# pass 111` with `# fail 0`, `RUNTIME-EXIT 0`
- `HOST-NAT 16/16`, `HOST-NAT-EXIT 0`
- `reactor: 627 checks passed`, `REACTOR-EXIT 0`
- `PASS HOST programs=3 zk-instance=10/10`, `HOST-EXIT 0`
- No FAIL leg, thus no load1 to report for a red leg.

The sections above describe the scoped checks recorded before the review:
runtime 111 of 111 with no skips, the seven new tests failing against the HEAD
runtime in `runtime-before` with 0 of 7 passing under the pattern
`^hard-link creation`, reactor 627 checks, trusted lines kernel 5246/5250 and
encoder 246/600, house six checks OK, and a clean `git diff --check`.

The review fixed six findings and carried one. B-1, C-1, B-2, C-3, C-4 and C-5
are fixed in prose only. D-1 is carried for a user ruling, because its repair
edits the pinned fixture and `dev/reactor-test.mjs` inside the frozen 627-check
capture. The review edited `dev/HARD-LINK.md`, `REACTOR.md` and this README.
The `source_sha256` rows `dev/HARD-LINK.md` and `REACTOR.md` were recomputed
from the staged bytes after the edits. Every other `source_sha256` row, the
`capture_sha256` rows, `controls.json` and the capture files stay byte
identical.
