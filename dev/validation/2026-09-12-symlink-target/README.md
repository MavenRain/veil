# Symlink target validation, 2026-09-12

Base: `10a97e77bc7c36925317dca44af2f449cb70ab73`.

`results.json` records source hashes, the Node version, platform, compiler hash,
and each completed capture's status and hashes. Each capture file contains its
command argv, working directory, exit code and full stdout/stderr. The `command`
number in the record identifies the position inside the external capture artifact.
Tracked capture files retain the evidence without requiring those local artifacts.

| Capture | Result |
| --- | --- |
| `runtime-before.json` | All six new focused tests fail against the base runtime with `unknown OS request 24` |
| `runtime.json` | 96/96 tests pass, zero failures, cancellations or skips |
| `reactor.json` | 465 checks pass, including the compiled symlink target fixture |
| `house.json` | All five HOUSE legs pass |
| `trusted-lines.json` | Kernel 5246/5250, encoder 246/600 |
| `diff-check.json` | No whitespace errors |
| `runtime-parallel-timeout.json`, `reactor-parallel-timeout.json` | Initial concurrent attempts exit 124 under the unchanged 30-second watchdogs |

The observed load1 after the concurrent timeouts was 88.30. Individual runs of
the same source and commands passed within 30 seconds. The timeout captures are
retained as failed attempts, not counted as successful validation. The passing
runtime capture records `# duration_ms 19093.966292` in its stdout, that is 19.1
seconds. `reactor.json` records no duration. The external capture artifact shows
about 24.8 seconds for the reactor run, including capture overhead.

`controls.json` records five single-replacement mutations and the hashes of each
mutated runtime and its unchanged test copy. Each control runs the same six
focused tests with a 30-second watchdog and exits 1 through assertion failures:

- `resolve-target.json`: rejects returning the resolved target path.
- `decode-target.json`: rejects replacing raw target bytes through UTF-8 decoding.
- `normalize-path.json`: rejects lexical normalization before OS path resolution.
- `omit-bound.json`: rejects returning an oversized target as success.
- `omit-arity.json`: rejects dispatch without the operation's argument-count check.

The exact replacement text in `controls.json` recreates each mutation from the
staged runtime. The commands and assertion output are in the corresponding capture.
The base-runtime capture uses the final focused tests against the unchanged base
runtime; `before_runtime_sha256` identifies that source.

Native runtime and CLI tests use real links with UTF-8 targets. Mocked reader
results cover non-UTF-8 target bytes and the 65536/65537-byte answer boundary.
Direct calls into the compiled fixture also check raw and full-size response
forwarding and the combined read and write statuses. These injected cases do
not claim that the native filesystem accepted those target sizes or byte values.

The compiler executable matches the prior entry-kind validation record. Compiler
sources, gate scripts and thresholds did not change in this slice. The source
hash list includes the affected runtime and test sources, the new fixture,
documentation, the reused compiler, and `gates.sh`, `house.sh` and
`trusted-lines.sh`. The full milestone and performance ladder was not run.
Windows was not exercised.

## Review 2026-09-12

The review of the symlink target slice kept two low findings, C-1 and C-2. Round
1 corrected the two prose defects in this file: C-1 attributes the 24.8-second
reactor time to the external capture artifact and cites the recorded
`# duration_ms 19093.966292` for the runtime capture, and C-2 quotes the recorded
diagnostic `unknown OS request 24` in the base-runtime row. No ruling was made,
no finding was refuted and no finding was dropped.

The gate ladder of round 1 is carried in `gates-review.log`. It passed 24 of 27
legs. The numbers after the review, read from that log:

- `TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK`
- RUNTIME `# tests 96`, `# pass 96`, `# fail 0`, `RUNTIME-EXIT 0`
- `HOST-NAT 16/16`, `HOST-NAT-EXIT 0`, and the ladder leg
  `PASS HOST-NAT checks=16/16`
- `reactor: 465 checks passed`, `REACTOR-EXIT 0`, and the ladder leg
  `PASS REACTOR`
- `PASS HOST programs=3 zk-instance=10/10`, `HOST-EXIT 0`
- `PASS BUILD` with `BUILD-EXIT 0`, and `PASS RUNTIME`

The three FAIL legs of that run are:

- `FAIL M0-TIME median_ms=379.583 bound_ms=150 load1=31.847 samples=3x5`
- `FAIL M0-RATIO kanon_ms=59.401 kanon_lines=1000 tot_ms=103.662 tot_lines=8138
  ratio=4.663284 bound=2.000 load1=31.847`
- `FAIL M1-CORPUS elapsed_ms=1162.700 bound_ms=713 lines=1000 main=814
  load1=32.260`

The log ends with `GATES-FAIL`, `LADDER-EXIT 1` and
`RUN end=04:03:25 load=20.71 28.97 33.15`.

The check loop closed with no waiver. All three red legs are timing legs, which
go red on their own above load1 25. The run had load1 31.8 to 32.3 and the
compiler binary hash is unchanged, so these three legs are waived. The RUNTIME 96
of 96 line, the six new symlink target tests, the reactor 465 line and HOST-NAT
16/16 are never waived by load, and all of them are green in the carried log.

The review refreshed one entry of `results.json` under `source_sha256`,
`dev/SYMLINK-TARGET.md`, because the review block of that file changed. All other
hashes, the 13 capture files and `controls.json` are unchanged.

The sections above describe the scoped checks recorded before the review: runtime
96 of 96 with no skips, the six new tests failing against the HEAD runtime in
`runtime-before` with 0 of 6 passing under the pattern `^symlink target`, reactor
465 checks, trusted lines kernel 5246/5250 and encoder 246/600, house five checks
OK, and a clean `git diff --check`.
