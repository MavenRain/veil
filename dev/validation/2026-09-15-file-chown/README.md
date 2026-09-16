# Ownership update validation, 2026-09-15

Base: `e253e46a3b4518c3ec6b923af2464f1433628382`.
Validated checkout: `/Users/oobi/Documents/gpt3/veil-file-chown`.
Host: macOS arm64, Node v23.10.0. The compiler binary matches the preceding
file-times validation record. `results.json` pins the three gate scripts
`dev/gates.sh`, `dev/house.sh` and `dev/trusted-lines.sh` by hash. It pins
no compiler source file. The statement that the compiler sources keep their
base content is an author observation over 2038 tracked files, recorded as
`validation_scope.compiler_sources_and_gates_unchanged`, and no capture
holds that comparison. To recheck it, compare the compiler sources with
base `e253e46` through `git`. This slice changes the JavaScript host, its
tests, one Kanon fixture and documentation. The full compiler and
milestone ladder was not rerun.

| Check | Result |
| --- | --- |
| Full runtime suite | 279 passed, ten more than the base |
| Full compiled reactor suite | 3330 checks passed, 202 more than the base |
| HOST-NAT | 16/16 |
| Positive ownership control | 9 passed, zero failures or skips |
| Defect controls | All 14 failed assertions |
| JavaScript syntax | Runtime and both test harnesses passed |
| HOUSE | Passed |
| TRUSTED-LINES | Kernel 5246/5250, encoder 246/600 |
| Whitespace | Passed |

The initial compiled reactor attempt hit its 30-second watchdog without a
verdict. `reactor-initial-timeout.json` records that expiry, with
`exit_code` 124, `timed_out` true and empty output. The machine was heavily
loaded at that moment. The author read a system load average of 55.24 just
after completion, but no capture holds that measurement. The isolated
retry passed all 3330 checks within the same 30-second limit; the gate
definition and watchdog were unchanged. Both attempts are saved
as `reactor-initial-timeout.json` and `reactor.json`.

The runtime tests include an actual change to a supplementary group and
restoration, without privileged account changes. Native missing-path calls
check both unsigned ID endpoints at the host binding. Mocks cover ordered
IDs, boundary forwarding and permission failures. These checks do not
establish that arbitrary accounts or ID values can be stored on every host.
Windows was not exercised. Native ownership tests skip there; the group
change test also skips when the process has no group other than the restore
group. That test restores the entry to its initial group when the process is
a member of that group, and to the process group in all other cases. A
temporary directory can give an entry a group that is outside the process
membership, and the restore target stays a membership group there. No
ownership test skipped in this record.

`results.json` pins the compiler, fixture and harness source hashes, along
with hashes for every captured result. Capture files preserve commands,
working directories, statuses and complete stdout/stderr. Control captures
name temporary directories that were removed after their runs.

## Reproduce

With the compiler built at `_build/default/bin/kanon.exe`, run:

```sh
kanon-wait run -- kanon-exec run --budget 4000 --timeout 30000 -- kanoncho test dev/runtime-test.mjs
kanon-wait run -- kanon-exec run --budget 4000 --timeout 30000 -- node dev/reactor-test.mjs _build/default/bin/kanon.exe
kanon-wait run -- kanon-exec run --budget 4000 --timeout 30000 -- node dev/host-nat-test.mjs
kanon-wait run -- kanon-exec run --budget 4000 --timeout 30000 -- zsh dev/house.sh .
kanon-wait run -- kanon-exec run --budget 4000 --timeout 30000 -- zsh dev/trusted-lines.sh .
kanon-wait run -- kanon-exec run --budget 4000 -- python3 -I dev/validation/2026-09-15-file-chown/reproduce-controls.py --output /tmp/veil-chown-controls-new
```

The control output directory must not exist. The script copies only the
runtime and its test harness into temporary directories, applies one
mutation at a time and requires assertion failures. The positive run must
show nine passed tests and no skip, thus a host that skips ownership tests
fails the reproduction and does not certify the unmutated runtime.
`controls.json` records
the exact replacements and mutated runtime hashes. The variants omit the
operation or arity entry, swap IDs, coerce unsigned IDs to signed values,
accept the sentinel or negative IDs, reject zero, drop canonical formatting
or range checks, normalize paths, repeat the update, update before the
second ID is validated, read contents, or change the symlink itself.

The source-review packet's only indexing gaps were the three existing
malformed byte-literal fixtures. Those fixtures remain covered by the
passing compiled reactor suite. Source review and validation identified no
remaining defect in this slice.

## Review 2026-09-16

Close ladder run 02:5x, start load1 8.91, end load1 10.63.
LADDER-EXIT 0, every named leg PASS, no FAIL row. The check loop closed
under an empty waiver: no leg needed a load waiver. The full log is pinned
at `gates-review.log`.

Numbers read from that log: TRUSTED-LINES kernel=5246/5250
encoder=246/600 OK. RUNTIME `# pass 279 of 279`, `# fail 0`,
RUNTIME-EXIT 0. HOST-NAT 16/16, HOST-NAT-EXIT 0.
`reactor: 3330 checks passed`, REACTOR-EXIT 0.

This review changed `dev/runtime-test.mjs`: the group test now restores the
entry to a membership group. The frozen capture `controls.json` still pins
the pre-review hash of that file,
`66206101021a433104fa0a7edabf99c50df6fc43e0633f7d5080b21fb1edc497`. Its
fifteen control rows record runs against the pre-review harness. The
`source_sha256` row of `dev/runtime-test.mjs` in `results.json` holds the
reviewed bytes. The controls were not re-recorded in this review.

This review recomputed the stale source_sha256 rows from the fixed, staged
bytes. It added the new capture_sha256 row
`dev/validation/2026-09-15-file-chown/gates-review.log`, pinning
that log. It then recomputed the source_sha256 row of this README last,
since the section you are reading changed the README's own bytes.
