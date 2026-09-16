# Link ownership validation, 2026-09-16

Base: `5c9becf1e0eb91ec463aeac3ef73d5c1f200fb10`.
Validated checkout: `/Users/oobi/Documents/gpt3/veil-file-lchown`.
Host: macOS arm64, Node v23.10.0.

| Check | Result |
| --- | --- |
| Full runtime suite | 289 passed, ten more than the base |
| Full compiled reactor suite | 3520 checks passed, 190 more than the base |
| HOST-NAT | 16/16 |
| Positive link ownership control | Nine passed, zero failures or skips |
| Defect controls | All seven failed assertions |
| JavaScript syntax | Runtime and both test harnesses passed |
| HOUSE | Passed |
| TRUSTED-LINES | Kernel 5246/5250, encoder 246/600 |
| Whitespace | Passed |

The first compiled reactor run expired at its 30-second watchdog without
a verdict. `reactor-initial-timeout.json` preserves that attempt. The
isolated retry passed all 3520 checks under the same 30-second watchdog.
No gate definition or timeout was changed. `reactor.json` records the
successful retry. These checks do not establish timing on an idle host.

This slice changes the host runtime, two test harnesses, one Kanon fixture
and documentation. The compiler binary matches the preceding file-chown
record. `source-scope.json` records the comparison against all 2071
baseline tracked files and pins the unchanged compiler sources and gate
scripts. The compiler was reused, and the full milestone ladder was not
rerun. `results.json` pins the tested sources and every capture in this
directory. Native tests ran on macOS; Windows was not exercised.

The positive control includes an actual supplementary-group change on a
symlink and restoration to a process membership group. It also checks
unchanged target metadata. Arbitrary owner changes requiring privilege
were not exercised. Mocks cover ordered high unsigned IDs and injected
host errors; missing-path calls check that the native binding accepts the
unsigned range without changing any ownership. These observations do not
promise that every host can store every accepted ID.

## Reproduce

With the compiler built at `_build/default/bin/kanon.exe`, run from the
repository root:

```sh
kanon-wait run -- kanon-exec run --budget 4000 --timeout 30000 -- kanoncho test dev/runtime-test.mjs
kanon-wait run -- kanon-exec run --budget 4000 --timeout 30000 -- node dev/reactor-test.mjs _build/default/bin/kanon.exe
kanon-wait run -- kanon-exec run --budget 4000 --timeout 30000 -- node dev/host-nat-test.mjs _build/default/bin/kanon.exe
kanon-wait run -- kanon-exec run --budget 4000 -- zsh dev/house.sh
kanon-wait run -- kanon-exec run --budget 4000 -- zsh dev/trusted-lines.sh
kanon-wait run -- kanon-exec run --budget 4000 -- python3 -I dev/validation/2026-09-16-file-lchown/reproduce-controls.py --output /tmp/veil-lchown-controls-new
```

The control output directory must not exist. The script copies the
runtime and test harness into temporary directories and runs nine focused
tests with a 30-second watchdog per variant. The positive run requires
nine passes and no skip. A host that lacks the native operation or a
distinct supplementary group cannot certify this control. Each defect
must produce a test assertion failure, so timeouts and setup errors do
not qualify. Temporary directories are removed after the run; the JSON
captures retain their commands, working directories and full output.

The seven defects remove the operation, remove its arity entry, follow the
target, swap IDs, normalize paths, update before validating the group ID,
or admit the all-ones sentinel. `controls.json` pins the source hashes,
exact replacement strings, mutated hashes and counts. The captures use
the same runtime and test harness bytes as the final staged slice.

## Review 2026-09-16

A slice review found no fault in the seven checked candidates: five were
refuted by probe and one was dropped as a duplicate of a refuted probe.
One low finding, B-4, is carried for a user ruling: the private FIFO test
guards bind only `fsPromises`, and this harness is sha256 pinned, so the
seventh carry stands and no repair was made.

Close ladder run 11:4x, start load1 11.36, end load1 15.97. LADDER-EXIT 0,
every named leg PASS, no FAIL row. The check loop closed under an empty
waiver: no leg needed a load waiver. The full log is pinned at
`gates-review.log`.

Numbers read from that log: TRUSTED-LINES kernel=5246/5250
encoder=246/600 OK. RUNTIME `# pass 289 of 289`, `# fail 0`,
RUNTIME-EXIT 0. HOST-NAT 16/16, HOST-NAT-EXIT 0.
`reactor: 3520 checks passed`, REACTOR-EXIT 0.

This review changed no runtime evidence and no capture. It appended prose
to this file and to `dev/FILE-LCHOWN.md`, wrapped one link line of
`dev/FILE-LCHOWN.md` to 80 columns, and refreshed the results.json source
rows of those two files.
