# File copy validation, 2026-09-12

Base: `addeb7a814c65e2c965e56a79d92f18cb704dd99`.

- RUNTIME: 119 tests pass, no failures, cancellations, skips or todo cases.
- REACTOR: 715 checks pass, including actual CLI copying and the repaired
  hard-link reporting state.
- JavaScript syntax, HOUSE and TRUSTED-LINES pass. The kernel is 5246/5250
  lines; the encoder is 246/600.
- The seven focused copy tests reject the base runtime. Six mutated runtimes
  are rejected: overwrite, hard link, normalized source, normalized destination,
  reversed arguments and a missing arity entry.
- A direct compiled reporting-state check passes on the repaired hard-link
  fixture and rejects the previous constant-1 result. The rejecting run used
  the pre-repair fixture at base `addeb7a` (blob `eba59e8b`, pinned as
  `base_fixture_sha256`) through the live repository path. This slice repairs
  that path, so the same recorded command on the current tree passes.

RUNTIME and REACTOR use the unchanged 30-second watchdog. Initial sandboxed
REACTOR runs for both the modified and unchanged source timed out with empty
streams. A nearby load1 reading was 91.32. The modified suite passed with
normal child-process access using the same command and limit. The two timeout
records remain failures and do not contribute to the passing verdict.
`focused-initial.json` retains the test expectation failure before accepting
macOS ENOTSUP for directory sources; it is superseded by the full RUNTIME pass.

`results.json` pins the tested runtime, both test suites, both relevant
fixtures, compiler executable, gate scripts and final documentation including
the build log. Compiler sources and gates match the base. Their existing
validated executable was reused; no compiler rebuild or full milestone ladder
was required for this host-runtime slice.

`results.json` hashes this file twice: in `source_sha256` under the repository
path `dev/validation/2026-09-12-file-copy/README.md`, and in `capture_sha256`
as `README.md`. Both rows hold the same digest. An edit of this file, a review
section included, must refresh both rows after the edit, never before it.

Each command record contains its exact arguments, working directory, capture
path and stdout/stderr hashes. TAP records retain totals and failed test names;
the complete streams remain at the recorded capture paths. `results.json`
contains exit codes and totals in `summary` and hashes of the retained records
in `capture_sha256`. `controls.json` includes exact mutation replacements and
test/runtime hashes. The reporting-state control script is retained as
`reporting-state.mjs`, with the same bytes as the script used by its captures.
`reporting-control.json` is a retained record, not a command capture, so
`summary` holds no row for it. It pins three hashes: `script_sha256` for
`reporting-state.mjs`, `base_fixture_sha256` for the hard-link fixture at the
base commit, and `fixed_fixture_sha256` for the repaired fixture of this slice.

The runtime controls use identical copies of the final test suite. The anchored
`^file copy` selection runs seven top-level tests; the extra arity matrix row
is a nested test covered by the full RUNTIME run. Native filesystem validation
covers macOS, not Windows. No real disk exhaustion or permission revocation
was performed.

Rerun from the repository root with the recorded compiler:

```sh
gtimeout 30 node --test --test-reporter=tap dev/runtime-test.mjs
gtimeout 30 node dev/reactor-test.mjs _build/default/bin/kanon.exe
node --check runtime/reactor.mjs
node --check dev/runtime-test.mjs
node --check dev/reactor-test.mjs
zsh dev/house.sh
zsh dev/trusted-lines.sh
```

The first two commands keep the watchdog; the syntax and static checks have
no watchdog. Running these through the installed capture helpers preserves
their output and exit codes. The final staging check validates every promoted
file against the reviewed patch and the Git index, checks whitespace, and
requires no unstaged or untracked files in the main checkout.

## Review 2026-09-12

The review of this slice edited `README.md` of this record, `REACTOR.md`,
`dev/FILE-COPY.md` and `dev/HARD-LINK.md`.
The `source_sha256` rows `REACTOR.md`, `dev/FILE-COPY.md` and
`dev/validation/2026-09-12-file-copy/README.md`, and the `capture_sha256` row
`README.md`, were refreshed after those edits.
No capture, control or summary row changed. The captures of this record stay
as recorded.

The final ladder of the review, the close ladder run after all fixes, is kept
in [gates-review.log](gates-review.log). That run gives `GATES-OK` and
`LADDER-EXIT 0`, with 28 of 28 legs PASS and no FAIL leg at load1 27.855.
The numbers of that run:
`TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK`, the runtime `# pass 119`
and `# fail 0` with `RUNTIME-EXIT 0`, `HOST-NAT 16/16` with `HOST-NAT-EXIT 0`,
`reactor: 715 checks passed` with `REACTOR-EXIT 0`, and
`PASS HOST programs=3 zk-instance=10/10` with `HOST-EXIT 0`.
The log is a capture of the review ladder and is not listed under
`capture_sha256`.
