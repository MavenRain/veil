# Modification time validation

Base: `246e9b216d5d7a43934edd00e7d76deba872cef8`.

Operation 33 reads exact signed modification-time nanoseconds. This slice
changes the JavaScript host, runtime tests, compiled reactor fixture and
documentation. `results.json` pins the final source and compiler hashes,
capture hashes, command arguments and validation scope. Per-command records
retain full-stream hashes and paths to the local captures. This README is
covered by `capture_sha256["README.md"]` only. Recompute that entry if this
file changes.

| Check | Result |
| --- | --- |
| Focused `^file modified` tests, 30-second watchdog | 8 passed, no skips |
| RUNTIME, 30-second watchdog | 172 passed, no skips |
| REACTOR, first 30-second attempt | Exit 124, no verdict |
| REACTOR, 120-second diagnostic | 1245 checks passed |
| REACTOR, final 30-second attempt | Capture wrapper exit 2 during process-group cleanup; no complete verdict |
| HOST-NAT, 30-second watchdog | 16/16 |
| JavaScript syntax, HOUSE, TRUSTED-LINES | Passed |
| Tracked whitespace | Passed; staging also checks added paths |
| Five isolated controls under the same focused selection | All rejected |

`controls.json` describes the base runtime and four isolated defects: rounding
through Number, returning ctime instead of mtime, using lstat and omitting the
operation's arity. Each control has its own runtime hash and command record.
All eight focused tests ran for each control, with failures and no skips or
cancellations. The tested implementation stayed unchanged.

The host load average was 114.00 after the first reactor timeout. The longer
diagnostic establishes functional success; it does not satisfy the normal
30-second gate. The final attempt is retained as incomplete evidence, with
the capture wrapper's exact error. Gate scripts and thresholds were not edited.

The prior validated compiler executable was reused by SHA-256, with compiler
sources unchanged. The full compiler and milestone battery were not repeated.
The `_build/default/bin/kanon.exe` row hashes a build artifact that the commit
does not track. To repeat that row, rebuild the compiler to the same bytes.
The review gate log `gates-review.log` is added after this run, and it is not
pinned.
Native filesystem tests ran on macOS. Negative timestamps and signed 64-bit
endpoints used an injected filesystem response; Windows and concurrent path
replacement were not exercised. Timestamp units do not promise filesystem
resolution or reliable content-change detection.

## Review 2026-09-13

The review ladder of the close run is kept as `gates-review.log` in this
directory. It passes 23 of 27 legs. The numbers after the review are:

- `TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK`
- RUNTIME `# pass 172`, `# fail 0`, `RUNTIME-EXIT 0`
- `HOST-NAT 16/16`, `HOST-NAT-EXIT 0`
- `reactor: 1245 checks passed`, `REACTOR-EXIT 0`
- `PASS HOST programs=3 zk-instance=10/10`, `HOST-EXIT 0`
- `BUILD-EXIT 0`

The red legs of that run, each with its load average, are:

- `FAIL M0-TIME median_ms=517.280 bound_ms=150 load1=27.885 samples=3x5`
- `FAIL M0-RATIO kanon_ms=52.725 tot_ms=103.662 ratio=4.139184 bound=2.000
  load1=27.885`
- `FAIL M1-CORPUS elapsed_ms=1310.431 bound_ms=713 load1=29.510`
- `FAIL REACTOR`, which is `MEASURE REACTOR tier=MED elapsed_ms=30023.184
  exit=124`, the 30-second gate ceiling, at a one-minute load of 40.85 at the
  end of the run

The three timing legs measure elapsed time against a fixed bound above the
load threshold of 25. The REACTOR leg is a ceiling timeout, because the
standalone reactor section of the same log gives `reactor: 1245 checks
passed` with exit 0. The compiler binary hash `ba114dff` did not change, so
no red leg is a defect of this slice.

The check loop closed under this waiver after check 2: every item of the
round is fixed and new_defects is empty. The red legs of that earlier ladder
were `FAIL M0-TIME median_ms=462.791 bound_ms=150 load1=27.987 samples=3x5`
and `FAIL M0-RATIO kanon_ms=38.831 tot_ms=103.662 ratio=3.048433 bound=2.000
load1=28.228`, at a one-minute load of 32.19 at the start and 27.47 at the
end. Each red leg is a timing leg and is waivable under the load rule. The
kernel bound did not move: `TRUSTED-LINES kernel=5246/5250 encoder=246/600
OK`.

The sections above describe the scoped checks that were recorded before the
review: runtime 172 of 172, focused 8 of 8 under the pattern `^file
modified`, reactor 1245 checks, trusted lines kernel 5246/5250 and encoder
246/600, house six checks OK, and a clean `git diff --check`.

The review changed prose only. It recomputed these `source_sha256` entries
from the staged bytes: `REACTOR.md`, `dev/FILE-MODIFIED.md` and
`dev/REACTOR-BUILD-LOG.md`. It also recomputed the `capture_sha256` entry
`README.md`, because this section is added to this file. Every other entry,
every capture file and `controls.json` stay unchanged.

Three findings are carried for a user ruling and are not fixed: C-1 (high),
B-1 (medium) and B-4 (low). Each fix would edit `dev/runtime-test.mjs`,
whose bytes the frozen `controls.json` `tests_sha256` row pins.

The five control variants of `controls.json` stay as recorded, and the review
did not run them again: `base-runtime`, `rounded-number`, `wrong-timestamp`,
`inspect-symlink` and `omit-arity`.
