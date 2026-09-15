# Filesystem inode validation, 2026-09-15

Base: `e6b15f7da830d8e8baca27aa4d6673b44d24d87f`.
Recorded checkout: `/Users/oobi/Documents/gpt3/veil-filesystem-inodes`.
Native validation used macOS and Node v23.10.0. Windows was not exercised.

| Check | Result | Capture |
| --- | --- | --- |
| Inodes and shared argument counts | 50/50 | `focused-arity.json` |
| Full runtime suite | 251 passed | `runtime.json` |
| Compiled reactor suite | 2672 checks | `reactor.json` |
| HOST-NAT | 16/16 | `host-nat.json` |
| Positive control | 7/7 | `positive.json` |
| Defect controls | 16 rejected | `controls.json`, named captures |
| JavaScript syntax | passed | `syntax-*.json` |
| HOUSE | passed | `house.json` |
| TRUSTED-LINES | kernel 5246/5250, encoder 246/600 | `trusted-lines.json` |
| Tracked whitespace | passed | `diff-check.json` |

Each command capture records its arguments, working directory, status,
watchdog, stdout and stderr with hashes. Focused, runtime, reactor and
HOST-NAT runs used 30-second outer watchdogs. The control sweep used a
120-second outer watchdog and a 20-second bound per variant. The compiled
harness `dev/reactor-test.mjs` gains one additive test block in this slice
and keeps its existing 20-second bound per runtime child.

The `focused-initial.json` capture used the test name pattern
`filesystem inodes|OS requests reject`. The second alternative matched no
test, so that capture covers the same seven inode tests as the positive
control. `results.json` reports `runtime_delta` 8 and `reactor_delta` 219
against the predecessor operation 41 totals, 243 runtime tests and 2453
reactor checks, which the predecessor record
`dev/validation/2026-09-15-filesystem-capacity/results.json` records as
`runtime_passed` and `reactor_checks`.

The compiler at `_build/default/bin/kanon.exe` is an ignored local artifact.
It was reused after verifying its SHA-256 against the preceding capacity
record, with compiler sources verified against the base. `results.json`
pins the compiler, relevant sources, fixture inputs and captured evidence.
`source_sha256` does not pin `dev/host-nat-test.mjs`, the harness behind the
HOST-NAT count; only its `host-nat.json` capture is pinned.
Compiler sources, gate scripts and thresholds did not change. The complete
compiler and milestone gate ladder was not rerun; these captures establish
the scoped commands listed above.

Both runtime and compiled native tests compare both response fields with
the exact statfs result used by the request. The compiled observer also
records its arguments and requires exactly one call. Inode counts can
change during a test, so no test requires equality between separate native
snapshots. Injected fields establish distinct ordering, integers above
2^53, signed values and zero endpoints, independently of host values.
The body remains unused under the shared decoding bounds, including a
65,537-byte runtime body. Malformed argument counts and undecodable strings
are rejected before statfs, and recoverable host errors allow later requests
to succeed.

## Reproduce the defect controls

From the repository root, choose a new output directory and run:

```sh
python3 -I dev/validation/2026-09-15-filesystem-inodes/reproduce-controls.py \
  --output /tmp/veil-inodes-controls-new
```

The reproducer leaves repository sources intact. It copies the runtime
tests to a temporary directory, applies one mutation at a time, and runs
the seven inode tests. The positive variant must pass all seven tests.
Each defective variant must exit 1 with an assertion failure and no skipped,
cancelled or pending tests. A variant that exceeds its 20-second bound is
written with `timed_out` true and `exit_code` null, and the sweep then
stops on that variant. Full captures and hashes go to the new output
directory; existing directories are rejected. `control-run.json` records
the original complete sweep. `controls.json` stores the exact replacements,
source and test hashes, per-variant counts and capture hashes:

- `missing-operation`, `missing-arity`: remove the operation or count check.
- `swap-fields`, `wrong-total`, `wrong-free`: reorder fields or substitute
  block counts for inode counts.
- `round-files`, `round-ffree`, `missing-bigint`: lose integer precision or
  remove the required host option.
- `normalize-path`, `duplicate-statfs`: normalize the literal path or make
  a second host call.
- `read-contents`, `stat-instead`: read file contents or call stat.
- `reject-zero-files`, `reject-zero-ffree`: reject a zero field.
- `clamp-negative-files`, `clamp-negative-ffree`: replace a negative field
  with zero.

`results.json` excludes itself from hash maps. It pins this README and the
reproducer in `source_sha256`, and pins the remaining JSON evidence in
`capture_sha256`. Documentation edits require refreshing the source hashes;
test or runtime edits require new dependent test and control captures.
Captured stdout, stderr and control replacements are preserved verbatim.

## Review 2026-09-15

The review closed at 10:2x with a full close ladder logged to
`gates-review.log` (also pinned in `capture_sha256`, see below). The
scoped checks recorded before the review, listed above, still stand:
runtime 251 of 251, focused 7 of 7 under the pattern `^filesystem
inodes`, reactor 2672 checks, trusted lines kernel 5246/5250 and encoder
246/600, house six checks OK, and `git diff --check` clean.

Numbers after the review, read from `gates-review.log` (started 10:19:13
at load1 12.87, ended 10:20:45 at load1 12.13):

- TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK.
- RUNTIME `# pass 251` `# fail 0`, RUNTIME-EXIT 0.
- HOST-NAT checks=16/16, HOST-NAT-EXIT 0.
- REACTOR `reactor: 2672 checks passed`, REACTOR-EXIT 0, PASS REACTOR.
- HOST `PASS HOST programs=3 zk-instance=10/10`, HOST-EXIT 0.
- PASS M0-TIME median_ms=101.314 bound_ms=150 load1=14.282 samples=3x5.
- PASS M0-RATIO ratio=1.234415 bound=2.000.
- PASS M1-CORPUS elapsed_ms=194.811 bound_ms=713 lines=1000 main=814
  load1=13.618.
- PASS AGREEMENT cases=7445 unary=5445 full-range=2000, AGREEMENT OK
  7445/7445.
- GATES-OK, LADDER-EXIT 0.

An earlier close ladder, started 10:01:15 at load1 8.94, ended
LADDER-EXIT 1: M0-TIME median_ms=202.618 and M0-RATIO ratio=2.277591 at
load1 19.511, plus a REACTOR leg timeout beside a standalone REACTOR-EXIT
0 with the same `reactor: 2672 checks passed`. Neither timing leg touches
the reactor operation under review, and the compiled binary hash is
unchanged; that log was not filed.

Findings closed in this review: D-1, C-6, C-3, C-5, C-4 and C-2 (all
low, fixed in fix round 1); ND-1-1 (medium, fixed in fix round 2,
`.gitignore` gains `__pycache__/`). B-1 (low) is CARRIED for a user
ruling; no file changed for B-1. C-1, C-7 and D-2 were REFUTED by the
verifier and dropped.

This review refreshed the `source_sha256` rows of `dev/FILESYSTEM-INODES.md`
and `dev/validation/2026-09-15-filesystem-inodes/reproduce-controls.py`
for the fix-round edits, and it added the `capture_sha256` row
`gates-review.log` so `results.json` pins every file in this directory.
The `source_sha256` row for this README is refreshed last, after the
text above is final.
