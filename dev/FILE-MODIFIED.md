# Filesystem modification time

The access-time slice also strengthens these regressions: a private FIFO
replaces the shared `/dev/null` timestamp, hard-link timestamp equality is
explicit, and host spies reject content opens and reads. The
[access-time validation record](validation/2026-09-13-file-accessed/README.md)
pins these test changes; earlier captured records describe their own revision.

Operation 33 accepts exactly one path and returns its last modification time
as signed ASCII decimal nanoseconds since the Unix epoch. The answer has no
leading zeros, plus sign, newline or terminator. A timestamp one nanosecond
before the epoch returns `-1`, and the epoch returns `0`. The host requests
`stat(path, { bigint: true })` and formats `mtimeNs` directly, preserving the
integer without conversion through floating point or milliseconds. These are
the units of the answer; the underlying filesystem determines its resolution.
See the [Node filesystem timestamp contract](https://nodejs.org/api/fs.html#statsmtimens).

Regular files, directories and special files are accepted. Final symlinks
are followed, and hard links report their shared entry's timestamp. NUL-free
UTF-8 paths pass unchanged, preserving native resolution of relative paths,
parent symlinks, dot segments and trailing separators. Missing entries,
dangling targets, loops and other host failures return status 1 with
`CODE: message`, allowing the state machine to continue. No missing entry is
created. The request reads metadata without opening file contents or changing
timestamps. The payload is unused, subject to shared decoding and traversal
limits.

Programs can compare observations to detect stale files. A timestamp is not
a content digest or a monotonic revision counter: filesystem resolution,
explicit timestamp changes and concurrent writers can hide content changes.
The observation describes the entry at the time of the host call. It does
not lock the entry for a later operation. Signed timestamps remain byte strings
in Kanon and cannot always be interpreted as a `Nat`.

Eight focused `^file modified` runtime tests cover native metadata preservation,
updates through append and truncate, files, directories, special files, final
and parent symlinks, hard links, relative Unicode paths, native path errors,
malformed requests and continuation after host failures. A filesystem adapter
covers zero, negative times, nanosecond remainders and values beyond JavaScript's
safe integer range, including both signed 64-bit endpoints. It checks exact
path and BigInt-option forwarding and an ignored 65537-byte request body.

The compiled `test/fixtures/reactor/file-modified.kan` fixture forwards operation
33, literal arguments and binary payload bytes. REACTOR checks exact answer
forwarding, host and output failure statuses, stable termination, native
filesystem answers and CLI errors. Native validation runs on macOS; timestamps
before the epoch and signed 64-bit endpoints use an injected filesystem result.
Windows and concurrent path replacement are not exercised.

Commands, source hashes and results are retained in
[the validation record](validation/2026-09-13-file-modified/README.md).

## Review 2026-09-13 (file modified)

- C-3, medium: the validation record README now states that
  `capture_sha256["README.md"]` covers it and must be recomputed when it
  changes (validation/2026-09-13-file-modified/README.md).
- C-4, medium: the record README now discloses that the
  `_build/default/bin/kanon.exe` row hashes an untracked build artifact and
  that `gates-review.log` is added after the run and is not pinned
  (validation/2026-09-13-file-modified/README.md).
- D-1, low: the operation 33 stanza now states its evidence scope, native
  macOS tests with injected results for pre-epoch and signed 64-bit values
  (REACTOR.md).
- D-2, low: the REACTOR bullet now leads with the diagnostic run, gives the
  increase of 104 executed checks and states that the gate gave no verdict
  (REACTOR-BUILD-LOG.md).
- GATE-1, high: no source change. The red legs are M0-TIME, M0-RATIO and
  M1-CORPUS, which measure time under a load average above 20, and REACTOR,
  which the 30-second watchdog stopped. A rerun of the reactor harness
  without a watchdog gave `reactor: 1245 checks passed` with exit 0, and the
  compiler binary hash did not change (gate legs only, no file).
- Close, 2026-09-13: the review ladder ran again and is kept at
  `validation/2026-09-13-file-modified/gates-review.log`. 23 of 27 legs pass.
  The red legs are M0-TIME (median_ms=517.280, bound_ms=150, load1=27.885),
  M0-RATIO (ratio=4.139184, bound=2.000, load1=27.885), M1-CORPUS
  (elapsed_ms=1310.431, bound_ms=713, load1=29.510) and REACTOR (exit 124 at
  30023 ms under the 30-second gate ceiling, one-minute load 40.85 at the end
  of the run). The three timing legs measure time against a fixed bound above
  the load threshold of 25, and the REACTOR leg is a ceiling timeout, because
  the standalone reactor section of the same log gives
  `reactor: 1245 checks passed` with exit 0. The never-waived lines all hold:
  RUNTIME `# pass 172` with `# fail 0` and exit 0, HOST-NAT 16/16,
  `reactor: 1245 checks passed`, `PASS HOST programs=3 zk-instance=10/10` and
  TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK. The compiler binary hash
  ba114dff is unchanged, so no red leg is a defect of this slice.
- Check loop waiver, after check 2: every item of the round is fixed and
  new_defects is empty. The red legs of that ladder were M0-TIME
  (median_ms=462.791, bound_ms=150, load1=27.987, samples=3x5) and M0-RATIO
  (kanon_ms=38.831, tot_ms=103.662, ratio=3.048433, bound=2.000,
  load1=28.228), at a one-minute load of 32.19 at the start and 27.47 at the
  end. Each red leg is a timing leg and is waivable under the load rule. The
  kernel bound did not move: TRUSTED-LINES kernel=5246/5250 encoder=246/600
  OK.
- Rulings carried, not fixed: C-1 (high), B-1 (medium) and B-4 (low). Each
  fix would edit dev/runtime-test.mjs, whose bytes the frozen
  `controls.json` `tests_sha256` row pins, so they need a user ruling.
- Close run, 2026-09-13 at 17:0x: the ladder started at 17:07:47 and ended
  at 17:15:02.
