# M1 closure validation, 2026-09-17

The candidate passes all 27 gates.  Validation used an independent clone of
`f0f3561dff00af8f4de90d1e0eec89e9130ef777` at
`/Users/oobi/Documents/gpt3/veil-m2-readiness`.  The initial 2,187 tracked file
hashes and vendored commit matched the clean Veil checkout.  The final run adds
`dev/cli-batch.mjs`, its regression suite, eight batched groups in the reactor
harness, and those regressions to the existing RUNTIME gate.

The compiler and host runtime did not change.  The groups retain all 84 CLI
invocations and their assertions.  Each invocation has a separate process,
closed stdin, the original cwd, a 20-second timeout and a 1 MiB output limit.
At most four children run in a batch.  Results retain input order and the
whole batch finishes before an invalid invocation is reported.  The selected
groups already inspect filesystem state after the group.  Stateful success
cases remain sequential.

| Check | Result |
| --- | --- |
| Original full battery | 25 of 27 PASS.  M0-TIME was 240.220 ms at load1 45.666; REACTOR hit its 30-second watchdog. |
| Original reactor diagnostic | 4,128 checks passed in 33,096.749 ms under a separate 120-second diagnostic limit.  This did not pass the gate. |
| Profile | 523 child invocations.  The 459 runtime CLI invocations consumed 30,725.571 ms. |
| Revised full battery | 27 of 27 PASS, `GATES-OK`, exit 0. |
| Revised REACTOR | 18,121.015 ms against the unchanged 30-second watchdog. |
| Revised RUNTIME | 6,630.078 ms, including the four CLI batch regression tests. |
| M0-TIME | 106.063 ms against 150 ms; load1 12.512; three five-run medians. |
| M0-RATIO | 1.230804 against 2.000; load1 12.512. |
| M1-CORPUS | 214.371 ms against 713 ms; 1,000 lines, main=814. |
| AGREEMENT | 7,445 of 7,445 cases. |
| Helper controls | Baseline passes.  Zeroed exit status, hidden timeout and premature rejection each fail the regression suite. |

Load changed between runs.  These timings establish the final gate result;
they are not a controlled estimate of the speedup caused by batching.
No watchdog, performance threshold or existing oracle was relaxed.
The final BUILD was incremental after the first run built the fresh clone.

`results.json` records commands, capture locations, stream hashes, all 27
measurements from each full run and the profiling summary.  The `.stdout` and
`.stderr` files retain complete captured streams.  `gate-sources.json` pins
the exact file contents at the passing run, including the two new helper
files.  README, the build log and this handoff record were written afterward;
`final-sources.json` and `captures.json` seal the final handoff separately.

The latest Lean base-change evidence was checked without rebuilding Lean.
All 56 pinned `meta/` source files and every retained capture matched.  The
existing checker exits 1 because only its historical README fingerprint
differs from the current README.  `lean-evidence-check.stdout` records that
exact mismatch.  The old record is unchanged.

Reproduce the executable checks from the repository root:

```sh
kanon-wait run -- kanon-exec run --budget 4000 -- zsh dev/gates.sh
kanon-wait run -- kanon-exec run --budget 4000 -- kanoncho test dev/cli-batch-test.mjs
kanon-wait run -- kanon-exec run --budget 4000 -- python3 -I dev/validation/2026-09-17-m2-readiness/controls.py
```

The controls operate on temporary copies.  They print their result and leave
the source and retained evidence unchanged.  Run
`python3 -I dev/validation/2026-09-17-m2-readiness/verify.py` to check the
source and capture fingerprints without rebuilding.  M1 exit ratification
and M2 implementation remain open;
[the handoff](../../M2-READINESS.md) lists the remaining entry steps.
