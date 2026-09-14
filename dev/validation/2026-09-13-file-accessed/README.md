# Access-time validation, 2026-09-13

Base: `1b1dc234968bca647f5fdc5567c345b24ef4d35a`.
Checks ran in `/Users/oobi/Documents/gpt3/veil-accessed` on macOS with Node
v23.10.0. Each capture records its exact command and working directory.

The combined timestamp and arity selection passed 51/51 tests; the full
runtime suite passed 181/181 without failures, cancellations or skips.
The compiled reactor suite passed 1353 checks under a 120-second watchdog,
an increase of 108 from the preceding slice. This direct scoped command does
not establish the separate 30-second gate bound. HOST-NAT passed 16/16.
Syntax, HOUSE, TRUSTED-LINES and tracked whitespace checks also passed.
Kernel lines remain 5246/5250 and encoder lines remain 246/600.

The compiler executable was copied from the main checkout after verifying
its hash against the preceding slice's record. Its `source_sha256` row pins
the reused, untracked executable; it is not a Git source blob or evidence of
a fresh compiler rebuild. Compiler sources and gate definitions are unchanged.
The full compiler and milestone ladder was not rerun; no timing waiver is
claimed. Windows was not exercised.

Native tests cover a pre-epoch Date and explicitly set access times. Injected
results pin exact nanoseconds beyond floating-point precision and signed
64-bit endpoints. Native path tests cover final symlinks, hard links,
directories, a private FIFO and parent-symlink resolution. No test depends on
access time changing after a read. Host spies reject content opens and reads.
The modification-time regression now uses a private FIFO, asserts hard-link
timestamp equality and checks content access explicitly.

`controls.json` describes each isolated defect and pins its runtime, tests
and full capture. Every control exited 1 with failing tests and no skips or
cancellations:

| Control | Failing tests |
| --- | --- |
| Base runtime without operation 34 | 8/8 |
| Return modification time | 7/8 |
| Round through Number | 3/8 |
| Inspect the final symlink | 4/8 |
| Omit operation 34 arity | 1/8 |
| Normalize the path lexically | 3/8 |
| Open access-time contents | 1/1 |
| Read modification-time contents | 1/1 |

Reproduce the controls into a new directory from the repository root:

```sh
python3 -I dev/validation/2026-09-13-file-accessed/reproduce-controls.py --output /tmp/veil-accessed-controls-new
```

The reproducer creates temporary runtime/test copies, records their commands,
and leaves production files untouched. See [the operation note](../../FILE-ACCESSED.md)
for the positive checks. `results.json` pins source bytes and every other
file that this run wrote in this directory, including this README and the
reproducer. It excludes itself to avoid a hash cycle. The review gate log
`gates-review.log` is added after this run, and it is not pinned.
Refresh these hashes after prose changes; source
or test changes also require rerunning affected checks and controls. Captured
outputs are immutable. Earlier validation directories describe their own
revision and have not been rewritten.

## Review 2026-09-13

The review of the file accessed slice ran two fix rounds and a close ladder.
The close ladder log is `gates-review.log` in this directory.

Numbers after the review, read from `gates-review.log`:

- `TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK`
- RUNTIME `# pass 181` with `# fail 0` and `RUNTIME-EXIT 0`
- `HOST-NAT 16/16` with `HOST-NAT-EXIT 0`
- `reactor: 1353 checks passed` with `REACTOR-EXIT 0`
- `PASS HOST programs=3 zk-instance=10/10`
- FAIL legs: none. `GATES-OK` with `LADDER-EXIT 0` at load 16.41.

The timing legs pass on this run: `PASS M0-TIME median_ms=146.958
bound_ms=150 load1=19.526 samples=3x5`, `PASS M0-RATIO ratio=1.534461
bound=2.000` and `PASS M1-CORPUS elapsed_ms=375.978 bound_ms=713
load1=18.763`. The check loop applied no waiver. The waiver threshold
stays a load1 above thirty, and the RUNTIME 181 of 181 line, the eight
new file accessed tests, the reactor 1353 line and HOST-NAT 16/16 are
never waived by load alone.

The sections above describe the scoped checks recorded before the review
(runtime 181 of 181, focused 51 of 51 under the pattern `^file accessed`,
reactor 1353 checks, trusted lines kernel 5246/5250 and encoder 246/600,
house six checks OK, `git diff --check` clean).

Review findings: C-1 (low) was fixed in this README, which now limits its
pinning claim to the files that the run wrote and discloses the unpinned
`gates-review.log`. B-1 (medium) is carried for a user ruling, because the
repair edits `dev/runtime-test.mjs`. GATE-1 (high) needed no source change,
and the close ladder shows no red leg.

Hashes recomputed for this review, from the staged bytes:
`source_sha256` row `dev/FILE-ACCESSED.md` and `capture_sha256` row
`README.md`. All other rows stay byte-identical. No capture file and no
`controls.json` was edited.
