# File mode validation, 2026-09-13

Base: `c3fc55351cce6153abc8493c80747619107d8b8a`.
The production change adds operation 31 to `runtime/reactor.mjs`, including
its exact arity and a decimal permission-mode bound. See the
[contract and tests](../../FILE-MODE.md).

| Check | Result |
| --- | --- |
| Focused `^file mode` tests | 9 pass, 0 fail, 0 skip |
| Full RUNTIME | 154 pass, 0 fail, 0 skip |
| REACTOR diagnostic | 1070 checks passed with a 120-second watchdog |
| HOST-NAT | 16/16 |
| JavaScript syntax | Runtime and both test harnesses pass |
| HOUSE | Pass |
| TRUSTED-LINES | Kernel 5246/5250, encoder 246/600 |
| Tracked whitespace check | Pass |

The focused tests, successful full runtime run and host-natural harness
used 30-second watchdogs. Two reactor runs under the existing 30-second
ceiling exited 124 without a verdict. The subsequent 120-second diagnostic
passed all 1070 checks. It does not satisfy the 30-second REACTOR gate, and
no waiver or change to the permanent gate is recorded here.

The first full runtime attempt ended with wrapper exit 2 and
`IO: process group cleanup failed`. Its capture remained incomplete, with
no final test verdict. The unchanged rerun passed in about 12.5 seconds.
`runtime-incomplete.json` records that failed attempt; `reactor-timeout-1.json`
and `reactor-timeout-2.json` retain the two reactor failures. Machine load
was 50.97 when inspected after the first failed runs. That is environmental
context, not proof of the cause of either failure.

The existing compiler executable was reused with SHA-256
`ba114dff6ab0e6f38753321393c0502c76b4937ff9896989ee962498e94a4ed0`.
Compiler sources, runtime Kanon definitions, gate scripts and gate limits
were unchanged. No full compiler or milestone battery was rerun. Native
permission and link behavior was exercised on macOS. Windows, ACL
interactions and concurrent path replacement were not exercised. Injected
EACCES, EPERM, EROFS and EIO failures check response propagation separately
from native filesystem behavior.

The same nine focused tests ran against the base runtime and eight isolated
defects. Every control exited 1, completed all nine tests, and had no skips
or cancellations:

| Control | Failed tests |
| --- | --- |
| Base runtime without operation 31 | 9 |
| Missing operation 31 arity entry | 1 |
| Missing permission-mode upper bound | 1 |
| Octal parsing in place of decimal parsing | 8 |
| Forwarding the mode as a string | 7 |
| Lexically normalizing the path | 3 |
| Always applying mode 0600 | 7 |
| Omitting chmod | 8 |
| Swallowing chmod errors | 2 |

`controls.json` records exact substitutions and control source hashes.
Each check's JSON records its argv, working directory, exit code, stream
hashes and TAP counts where available. Complete raw captures remain at
the referenced local artifact paths. `runtime-incomplete.json` records
the incomplete capture separately and does not claim a test verdict.
`results.json` pins the final source bytes, compiler bytes and every other
file in this evidence directory. This README appears in both hash maps, as
the `source_sha256` row `dev/validation/2026-09-13-file-mode/README.md` and
the `capture_sha256` row `README.md`, and must match both if it is edited.
Its validation scope distinguishes the successful diagnostic run from the
unresolved standard reactor watchdog.

## Review 2026-09-13

The review of this slice kept four findings, C-1 (medium), D-2 (low), B-1 (low)
and D-1 (low). All four are prose. Fix round 1 corrected them. No capture,
no `controls.json` byte and no `summary` or `validation_scope` value changed.

The final gate ladder of the review is `gates-review.log`, tag fix-1, root
/Users/oobi/Documents/veil, start 03:38:20 load 17.78 22.10 27.99, end 03:39:29
load 14.53 20.23 26.82. It gives GATES-OK with LADDER-EXIT 0 and 27 PASS legs
of 27. No leg is red, so no leg is waived. The check loop closed with no
waiver. The waiver threshold stays load1 above twenty-five, and the RUNTIME
154 of 154 line, the nine new file mode tests, the reactor 1070 line and
HOST-NAT 16/16 are never waived by load alone.

The numbers after the review, read from `gates-review.log`:

- `TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK`
- RUNTIME `# pass 154` with `# fail 0`
- `HOST-NAT 16/16`
- `reactor: 1070 checks passed`
- `PASS HOST programs=3 zk-instance=10/10`
- FAIL legs: none.

The sections above describe the scoped checks recorded before the review:
runtime 154 of 154 with no skips, the nine new tests failing against the HEAD
runtime in `runtime-before.json` with 0 of 9 passing under the pattern
`^file mode`, reactor 1070 checks, trusted lines kernel 5246/5250 and encoder
246/600, house six checks OK, and `git diff --check` clean.

The review recomputed these `results.json` hashes from the staged bytes:
the `source_sha256` rows `REACTOR.md`, `dev/FILE-MODE.md` and
`dev/validation/2026-09-13-file-mode/README.md`, and the `capture_sha256` row
`README.md`. Every other row stays byte-identical.
