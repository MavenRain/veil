# Filesystem rename validation, 2026-09-11

Base: `6fbd6dd0d14503b64635453ceea651df9455db99`.

| Check | Result |
| --- | --- |
| RUNTIME, existing 30-second watchdog | 76 tests passed, zero failures, cancellations or skips. |
| REACTOR, existing 30-second watchdog | 321 checks passed, including the new compiled rename fixture. |
| HOUSE | All five checks passed. |
| TRUSTED-LINES | Kernel 5246/5250 and encoder 246/600, passed. |
| Base runtime with the final rename tests | Four failures; the existing invalid-path decoder test passes. |
| Rename replaced by a no-op | Rejected. |
| Rename replaced by copying and unlinking | Rejected. |
| Source resolved through realpath first | Rejected. |
| Destination resolved through realpath first | Rejected. |

All focused controls run the same five tests matching `^filesystem rename`
against isolated runtime copies. Each control finishes with exit 1 and
zero cancellations or skips. The original runtime is byte-identical to
the base commit. `results.json` records the literal mutation transforms,
runtime and test hashes, per-command status and capture hashes.

Each `captures/*.json` file stores complete stdout and stderr as JSON
strings. Decoding those strings as UTF-8 reproduces the original capture
bytes, including whitespace in Node assertion diagnostics. The record
stores both the stream hashes and the JSON file hashes. This preserves
the failed controls without adding whitespace-only lines to the Git diff.

The compiler executable is copied from the base checkout and matches the
hash in the preceding file-cleanup validation. It compiled the new Kanon
fixture to Wasm, which the reactor harness executes through the CLI.
Kernel, compiler, Lean sources, gate scripts and thresholds are unchanged.
These scoped runtime checks do not repeat the full milestone or performance
battery or ratify M1 exit. Validation ran on macOS with Node.js v23.10.0;
Windows, cross-filesystem mounts and crash durability were not exercised.

## Review 2026-09-11

The review ladder is `gates-review.log`, tag fix-1, start 20:20:00 and end
20:21:52 at load1 16.14 to 16.44. The ladder shows 25 PASS rows of 27 legs.

Numbers after the review, read from that log:

- `TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK`
- RUNTIME `# pass 76` with `# fail 0`, RUNTIME-EXIT 0
- `HOST-NAT 16/16`, HOST-NAT-EXIT 0
- `reactor: 321 checks passed`, REACTOR-EXIT 0
- `PASS HOST programs=3 zk-instance=10/10`, HOST-EXIT 0
- BUILD-EXIT 0

Two legs are red, and both are timing legs of the compiler binary:

- `FAIL M0-TIME median_ms=208.076 bound_ms=150 load1=14.486 samples=3x5`
- `FAIL M0-RATIO kanon_ms=30.516 kanon_lines=1000 tot_ms=103.662
  tot_lines=8138 ratio=2.395663 bound=2.000 load1=14.486`

The log ends with GATES-FAIL and LADDER-EXIT 1 because of those two rows.
The check loop closed with no waiver text. The two red legs time the
compiler binary, which this slice does not change, and the waiver threshold
stays load1 above 25. The RUNTIME 76 of 76 line, the five new filesystem
rename tests, the reactor 321 line and HOST-NAT 16/16 are never waived by
load alone, and all four are green in this log.

The fixes of this review changed prose only: `dev/FILE-RENAME.md`,
`REACTOR.md` and `dev/REQUEST-ARITY.md`. No file under `source_sha256`
changed, so no hash was recomputed, and `control_test_sha256`, the controls
and the nine captures stay as recorded. All ten `source_sha256` entries and
`control_test_sha256` were verified again against the staged blobs and the
compiler binary on disk, and all eleven match.

The sections above describe the scoped checks recorded before the review:
runtime 76 of 76, four of the five new tests failing against the HEAD runtime
in `runtime-before`, reactor 321 checks, trusted lines kernel 5246/5250 and
encoder 246/600, and house five checks OK.

The close ladder ran after the review edits, from 20:27 to 20:30 with load1
21 to 26, into the review kit log `gates-close.log` (not carried). Its
standalone legs match the carried log: TRUSTED-LINES kernel=5246/5250
encoder=246/600 OK, RUNTIME 76 of 76, HOST-NAT 16/16, reactor 321 checks and
HOST programs=3. Three timing legs of the unchanged compiler were red under
load: M0-TIME 192.726 ms against 150, M0-RATIO 2.828 against 2.000 and
M1-CORPUS 1127.780 ms against 713, all at load1 21 to 23.
