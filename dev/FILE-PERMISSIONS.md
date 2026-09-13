# Filesystem permission inspection

Operation 32 accepts exactly one path and returns its nine ordinary permission
bits as ASCII decimal bytes from `0` to `511`. The answer has no leading zeros
or terminator. Octal `0755`, for example, returns `493`. This is the same decimal
format accepted by operation 31. The request calls `stat` and masks out file
type, setuid, setgid and sticky bits. It does not change the entry's permissions,
identity or contents, including any special bits already present.

Regular files, directories and special files are accepted. Final symlinks are
followed, and hard links report their shared entry's permissions. NUL-free
UTF-8 paths are passed unchanged, so relative paths, parent symlinks, dot
segments and trailing separators retain native resolution. Missing paths,
dangling targets, loops and other host failures return status 1 with
`CODE: message`. The state machine can continue after an error. No missing
entry is created, and no file contents are opened. The payload is unused;
the shared request decoding and traversal limits still apply.

The answer describes a metadata observation. Another actor may change or
replace the entry before a subsequent request. The reported bits do not
describe ACLs or guarantee access. Passing a saved answer to operation 31
restores the ordinary bits and clears special bits, as that operation's
contract specifies. It does not restore the complete permission word.
Native tests cover macOS; Windows, ACL interactions and concurrent path
replacement were not exercised.

Eight top-level `^file permissions` runtime tests cover decimal formatting,
zero permissions, executable bits, unchanged identity and contents,
directories, a character device, preservation of sticky bits, final and
parent symlinks, hard links, relative Unicode paths, saving and restoring
ordinary bits, native path errors and continuation after failures.
Call adapters cover masking of every special-bit category, literal path
forwarding, an ignored 65537-byte body, rejected counts and OS strings,
and host errors with and without an error code. The existing arity matrix
also sends operation 32 with zero arguments and with two arguments.

The compiled `file-permissions.kan` fixture issues operation 32 and forwards
its answer through operation 6. The reactor harness checks literal path bytes,
its ignored binary body, success and error responses, output failure and
stable termination. Native compiled runs check permissions after operation
31 changes them, plus directory and symlink reads, count errors and missing
paths.

Run from the repository root with a built compiler and the existing watchdogs:

```sh
gtimeout 30 node --test --test-reporter=tap --test-name-pattern '^file permissions' dev/runtime-test.mjs
gtimeout 30 node --test --test-reporter=tap dev/runtime-test.mjs
gtimeout 30 node dev/reactor-test.mjs _build/default/bin/kanon.exe
gtimeout 30 node dev/host-nat-test.mjs _build/default/bin/kanon.exe
zsh dev/house.sh
zsh dev/trusted-lines.sh
```

The [validation record](validation/2026-09-13-file-permissions/README.md)
records results, validation scope and source hashes.

## Review 2026-09-13 (file permissions)

Round 1 of the slice review, 11:4x local time. Seven findings were fixed.

- C-1 medium: the record and the build log now state that no defect controls
  were run for this slice. Files: dev/validation/2026-09-13-file-permissions/README.md,
  dev/REACTOR-BUILD-LOG.md.
- A-1 low: the coverage paragraph now names the two requests the arity matrix
  sends, zero arguments and two arguments. File: dev/FILE-PERMISSIONS.md.
- B-1 low: the mocked adapter test now records that no `open` or `readFile`
  call receives the request path, which pins the "no file contents are
  opened" sentence. File: dev/runtime-test.mjs.
- C-2 low: the record now pins only the files this run recorded, and it names
  `gates-review.log` as unpinned. File:
  dev/validation/2026-09-13-file-permissions/README.md.
- C-3 low: the review kit hypothesis H13 now refreshes the
  `capture_sha256["README.md"]` row only, because this record has no
  `source_sha256` row for the record README. File: the review kit
  hypotheses.md, outside the repository.
- D-1 low: the build-log section heading now uses the feature-first form of
  every other section, and the kit moves the pinned literal with it. File:
  dev/REACTOR-BUILD-LOG.md.
- C-4 low: the record now states that the compiler row hashes a build
  artifact that the commit does not track. File:
  dev/validation/2026-09-13-file-permissions/README.md.

Round 2 of the slice review, 12:1x local time. No finding was fixed.

- GATE-1 high: no file changed. The REACTOR leg runs under a 30 second
  watchdog. The baseline run measured 29.591 s and the round 1 run stopped at
  30.041 s, and the AGREEMENT leg stopped at its 300 second watchdog. A direct
  run of the reactor harness gives `reactor: 1141 checks passed` with exit
  code 0, and the runtime suite gives 163 pass and 0 fail, so these legs stop
  on the watchdog and not on a failed check. The legs M0-TIME, M0-RATIO and
  M1-CORPUS measure speed on a loaded machine. A repair must move a bound in
  dev/gates.sh, which this slice does not change, so the item is carried for a
  user ruling. Files: none.

Close of the slice review, 13:0x local time. The review is closed under the
single heading above. The seven findings of round 1 are:

- C-1 medium: the record dropped the mutation controls of the nine preceding
  records without a word.
- A-1 low: the arity matrix coverage sentence did not name the two requests.
- B-1 low: the sentence "no file contents are opened" had no test pin.
- C-2 low: the `capture_sha256` sentence turned false at close.
- C-3 low: the close plan named a `source_sha256` row for the record README
  that this record does not carry.
- D-1 low: the build-log heading did not use the feature-first form.
- C-4 low: the compiler row hashes an untracked build artifact.

Round 2 carried one item, GATE-1 high, which is a gate verdict and not a
defect of this slice.

The review edited dev/runtime-test.mjs after the record was frozen. That file
holds the B-1 test. The runtime capture of the record was produced before that
edit, so the capture keeps the pre-review run of 163 tests. The count did not
move, because the B-1 fix adds assertions inside an existing test.

Fix ladder gates-fix-1.log, start 11:50:33 at load 32.57, end 11:59:09 at
load 50.13. Every check leg passed: BUILD, CARRY, R0-COUNT, R0-AUDIT,
SUITE-KERNEL, SUITE-WASM, ENCODER-SUBSET, AXIOMS, M0-E2E main=521,
TRUSTED-LINES, CIRCUIT lines=28 with CIRCUIT-BOUNDS 18/18, ZK, FHC, MPC,
HOST programs=3 zk-instance=10/10, HOST-NAT checks=16/16, DENOMINATORS,
HOUSE, PIN sha=8cf0b8b, POSITIVITY fixtures=25, M1-SUITE and RUNTIME with
RUNTIME-EXIT 0. The red legs are M0-TIME median_ms=569.047 bound_ms=150
load1=38.640, M0-RATIO ratio=7.218705 bound=2.000 load1=38.108, M1-CORPUS
elapsed_ms=2245.332 bound_ms=713 load1=36.025, AGREEMENT at the 300 second
watchdog after it printed all 7445 cases, and REACTOR at the 30 second
watchdog. LADDER-EXIT 1.

Fix ladder gates-fix-2.log, start 12:14:20 at load 33.59, end 12:19:38 at
load 27.55. Every check leg passed again, and AGREEMENT passed with
cases=7445 unary=5445 full-range=2000, RUNTIME passed with RUNTIME-EXIT 0 and
the standalone reactor section printed REACTOR-EXIT 0. The red legs are
M0-TIME median_ms=516.340 bound_ms=150 load1=27.825, M0-RATIO ratio=7.573627
bound=2.000 load1=27.825, M1-CORPUS elapsed_ms=773.699 bound_ms=713
load1=26.958 and REACTOR, whose measured leg stopped at exit=124 after
30029 ms under the 30 second ceiling. LADDER-EXIT 1.

The red legs are timing artifacts. M0-TIME, M0-RATIO and M1-CORPUS measure
speed, and they go red when the machine is loaded. The REACTOR and AGREEMENT
legs stop on a watchdog, not on a failed check: the same run prints
`reactor: 1141 checks passed` with exit code 0 in its standalone section.

Closing ladder gates-close.log, start 12:32:13 at load 64.45, end 12:36:48 at
load 26.89. Every check leg passed: BUILD, CARRY, R0-COUNT, R0-AUDIT,
SUITE-KERNEL, SUITE-WASM, ENCODER-SUBSET, AXIOMS, M0-E2E main=521,
TRUSTED-LINES, CIRCUIT lines=28 with CIRCUIT-BOUNDS 18/18, ZK, FHC, MPC,
HOST programs=3 zk-instance=10/10, HOST-NAT checks=16/16, DENOMINATORS,
HOUSE, PIN sha=8cf0b8b, POSITIVITY fixtures=25, M1-SUITE, AGREEMENT
cases=7445 and RUNTIME with RUNTIME-EXIT 0. The red legs are M0-TIME
median_ms=386.310 bound_ms=150 load1=43.368, M0-RATIO ratio=3.454383
bound=2.000 load1=43.368, M1-CORPUS elapsed_ms=1625.496 bound_ms=713
load1=43.058 and the measured REACTOR leg at exit=124 after 30108 ms, while
the standalone reactor section of the same run prints
`reactor: 1141 checks passed` and REACTOR-EXIT 0. LADDER-EXIT 1. Every red
leg ran above load1 30, so the standing load rule waives it.
