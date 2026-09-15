# File owner validation, 2026-09-14

Base: `72ccf34fff6237d0a96cde1f5b467d76d6405228`.
Working copy: `/Users/oobi/Documents/gpt3/veil-owner`.
The compiler executable was copied from the primary Veil checkout after
matching its SHA-256 against the preceding link-count validation record.
Compiler sources and gate definitions match the base; no rebuild was needed.

| Check | Result | Capture |
| --- | --- | --- |
| Focused ownership plus shared argument counts | 48/48 | `focused-arity.json` |
| Full runtime through `kanoncho` | 226 passed | `runtime.json` |
| Compiled reactor | 2118 checks, +159 from the preceding slice | `reactor.json` |
| HOST-NAT | 16/16 | `host-nat.json` |
| JavaScript syntax | Three files passed | `syntax-*.json` |
| HOUSE | Passed | `house.json` |
| TRUSTED-LINES | Kernel 5246/5250, encoder 246/600 | `trusted-lines.json` |
| Tracked whitespace | Passed | `diff-check.json` |
| Positive control | 8/8 | `positive.json` |
| Defect controls | All 15 rejected by assertions | `controls.json`, individual captures |

Each command capture records its argv, working directory, exit status,
complete stdout and stderr, and their hashes. The timed commands also
record an outer watchdog, and each control capture records its process
timeout. Commands ran with the working-copy paths above; relative commands
can be rerun from another checkout, and explicit compiler arguments must
be adjusted to that checkout.
The focused, runtime, reactor, HOST-NAT and control-reproducer commands
used 120-second outer watchdogs. Each control's Node process had a
20-second timeout. No control timed out, cancelled or skipped tests. Only
the unchanged runtime passed.

`results.json` pins the changed source and documentation files, supporting
runtime files, the reactor fixtures, control reproducer, compiler executable
and gate scripts. It also pins the JSON captures and the review gate log,
excluding itself. This README is included in the source hashes. To edit a
pinned source or test, rerun affected checks and regenerate the
corresponding captures and `results.json`. Prose-only edits require
refreshing that file's source hash. The compiler is an untracked, reused
artifact, not a checked-in build product.

To reproduce all controls from this checkout without overwriting this record:

```sh
kanon-wait run -- kanon-exec run --budget 4000 --timeout 120000 -- python3 -I dev/validation/2026-09-14-file-owner/reproduce-controls.py --output /tmp/veil-owner-controls
```

The reproducer makes an isolated temporary copy, runs the positive control,
then runs the base runtime and 14 single-defect variants. It requires eight
tests per run, assertion failures for every broken variant and no skips or
cancellations. The source checkout is not mutated. The output captures
include temporary paths and timing, so hashes can differ between reruns,
and a control whose defect depends on the host's own user and group IDs
(`reject-zero`) can fail a different number of tests on another host or
from another temporary directory; every defect control still exits 1 with
assertion failures.

The full compiler and milestone gate ladder was not rerun. The compiled
reactor command was a direct run under its recorded watchdog; it does not
establish the separate 30-second gate verdict, and no waiver is claimed.
Native tests ran on macOS. Large integers, zero fields and selected host
errors use injected metadata. Native ownership changes and Windows were
not exercised.

## Review 2026-09-14

A review ran after staging, close run at 22:4x. The check loop closed
without a waiver. The review fixed five low findings in `REACTOR.md` and
this README, carried one (the reproducer has no guard against an existing
output directory) and refuted two. `dev/FILE-OWNER.md` lists them.

The final gate log, filed as `gates-review.log`, reports these numbers.
TRUSTED-LINES: kernel 5246/5250, encoder 246/600. RUNTIME: 226 of 226
tests passed, zero failed. HOST-NAT: 16/16. The reactor line reads
`reactor: 2118 checks passed`. HOST: programs 3 of 3, zk-instance 10 of
10. No leg failed. The ladder line reads `LADDER-EXIT 0`. Start load1
11.86, end load1 17.51.

The sections above describe the scoped checks recorded before the
review: positive 8 of 8 under the pattern `^file owner`, focused arity
48 of 48, runtime 226 of 226, reactor 2118 checks, trusted lines kernel
5246/5250 and encoder 246/600, HOST-NAT 16/16 and 15 rejected defect
controls. `gates-review.log` is pinned in `capture_sha256`; the source
rows for `REACTOR.md`, `dev/FILE-OWNER.md` and this README were
refreshed after the review edits, this README last.
