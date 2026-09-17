# Link timestamp validation, 2026-09-16

Base: `4422f308d97cf4cccdaf4a24f8a59a9168031c02`.

Operation 47 updates access and modification times without following a final
symlink. The contract is in [FILE-LUTIMES.md](../../FILE-LUTIMES.md).
Validation ran in an isolated checkout on macOS with Node v23.10.0.

| Check | Result | Capture |
| --- | --- | --- |
| Focused runtime and arity matrix | 56 passed, no failures | `focused.json` |
| Complete runtime suite | 298 passed, no failures or skips | `runtime.json` |
| Complete compiled reactor suite | 3811 checks passed | `reactor.json` |
| Host naturals | 16/16 | `host-nat.json` |
| Positive control | Eight passed, no failures or skips | `positive.json` |
| Defect controls | All eight failed assertions | `controls.json` |
| JavaScript syntax | All three files passed | `syntax-*.json` |
| Repository conventions | HOUSE OK | `house.json` |
| Trusted lines | Kernel 5246/5250; encoder 246/600 | `trusted-lines.json` |
| Whitespace | Passed | `diff-check.json` |

The runtime count increased by nine: eight new tests and the shared arity
subtest. The compiled suite increased by 291 checks. Runtime tests use real
live, dangling and cyclic symlinks, and check target metadata and contents
before reads that could change access time. They also cover non-symlink
entries, path failures, ignored bodies, both timestamp positions, exact
Date arguments, pre-epoch values and continuation after host failures.

The compiled fixture verifies operation 47, ordered argument bytes,
an ignored binary body, byte-for-byte answer forwarding, output failures
and stable terminal states. The same compiled Wasm runs through the actual
command runner for filesystem updates and rejected requests.

`results.json` records source hashes, capture hashes and platform details.
`source-scope.json` checks all baseline tracked files, pins unchanged
compiler and gate files, and records the reused compiler's SHA-256 from
the operation 46 validation. No compiler sources, kernel code, gate scripts,
thresholds or existing tests were weakened. The compiler and full milestone
ladder were not rebuilt or rerun. Windows was not exercised. Full Date range
endpoints and unsupported host errors use injected calls; native filesystem
tests cover epoch, pre-epoch and modern millisecond values on macOS.

From the repository root, reproduce the main checks with the verified
compiler available at `_build/default/bin/kanon.exe`:

```sh
node --test --test-reporter=tap dev/runtime-test.mjs
node dev/reactor-test.mjs _build/default/bin/kanon.exe
node dev/host-nat-test.mjs _build/default/bin/kanon.exe
node --check runtime/reactor.mjs
node --check dev/runtime-test.mjs
node --check dev/reactor-test.mjs
zsh dev/house.sh
zsh dev/trusted-lines.sh
git diff --check HEAD
```

The captures retain the exact arguments, working directories, exit statuses,
stdout and stderr. Validation here did not impose an additional command
watchdog. Individual test timeouts remain intact. Reproduce the controls on
a host supporting native `lutimes` with a fresh output directory:

```sh
python3 -I dev/validation/2026-09-16-file-lutimes/reproduce-controls.py \
  --output /tmp/veil-lutimes-controls
```

The script copies the runtime and test harness to temporary directories.
Its positive control passes all eight targeted tests. It separately removes
dispatch or arity validation, follows the final link, swaps times, normalizes
paths, updates before validating the second time, passes numeric negative
seconds, and accepts noncanonical timestamp text. Each mutation must fail
an assertion. Each control has a 30-second watchdog. `controls.json` records
each mutation, source hash and result; individual JSON files retain output.

## Review 2026-09-16

- C-2 (low, fixed): the focused-run table row was 94 columns, over the
  80-column rule. The row now reads 78 columns. File: `README.md` line 11.
- D-1 (low, fixed): the added prose line in `dev/FILE-LUTIMES.md` was 98
  columns. The Node `lutimes` link now uses reference style, so no line
  in that file is more than 80 columns.
- B-2 (low, carried for a user ruling): no test pins the syscall token of
  a native error. The only repair edits the sha256-pinned
  `dev/runtime-test.mjs`, so the record cannot fix it here.
- B-1 (low, carried for a user ruling, the eighth carry): the private
  FIFO no-open guards of test 3 bind only `fsPromises`. The only repair
  edits the sha256-pinned `dev/runtime-test.mjs`, so the record cannot
  fix it here.

Close ladder run 19:5x, start load1 12.12, end load1 19.51.
LADDER-EXIT 0, every named leg PASS, no FAIL row. The check loop closed
under an empty waiver: no leg needed a load waiver. The full log is pinned
at `gates-review.log`.

Numbers read from that log: TRUSTED-LINES kernel=5246/5250
encoder=246/600 OK. RUNTIME `# pass 298 of 298`, `# fail 0`,
RUNTIME-EXIT 0. HOST-NAT 16/16, HOST-NAT-EXIT 0.
`reactor: 3811 checks passed`, REACTOR-EXIT 0.

This review recomputed the stale source_sha256 rows from the fixed, staged
bytes. It added the new capture_sha256 row
`dev/validation/2026-09-16-file-lutimes/gates-review.log`, pinning
that log. It then recomputed the source_sha256 row of this README last,
since the section you are reading changed the README's own bytes.
