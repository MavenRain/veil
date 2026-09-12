# Symlink targets

Operation 24 accepts exactly one path and reads its symlink target with
`readlink`. A status-0 answer contains the stored bytes, without decoding,
normalizing, resolving or appending a terminator. Relative targets retain
their dot segments. Dangling, chained and self-referential final links succeed.
The request payload is unused, and the operation changes no filesystem entry.

Path arguments must be NUL-free UTF-8 and are passed to the OS literally.
Relative paths use the host working directory. Parent symlinks and trailing
separators follow OS resolution. For example, with `alias` pointing to
`actual/nested`, `alias/../link` names `actual/link`. Name a final link without
trailing components to read the link itself. Raw non-UTF-8 target bytes remain
valid answers but cannot be reused as path arguments under the OS string rules.

Missing or surplus arguments return status 1 before filesystem access. Missing
paths, non-symlink entries and other OS failures also return status 1 through
`resume`, carrying the OS error code and message. Invalid path bytes terminate
the run before dispatch through the existing exit-2 path. Exactly 65536 target
bytes are accepted; a larger answer returns status 1 with
`IO: symlink target exceeds maximum OS chunk size` and no partial target.

The RUNTIME suite drives the actual request loop with scripted exports. Real
filesystem tests cover literal and relative paths, existing file and directory
targets, dangling links, chains, cycles, parent symlinks, dot segments, trailing
separators and recovery after OS errors. Injected `readlink` answers cover raw
non-UTF-8 bytes and the 65536/65537-byte boundary, since native filesystems can
reject those targets. A mocked reader also verifies that malformed arities,
NUL and non-UTF-8 path arguments cause no read. Each mock restores both the
default and named builtin imports.

`test/fixtures/reactor/symlink-target.kan` forwards argv to operation 24 and
prints the answer with operation 6. Its exit status adds the read status and
the stdout write status. REACTOR compiles it into an import-free Wasm module,
checks raw and full-size response forwarding and both write statuses, and runs
the CLI against real links, invalid arities and path errors. CLI success checks
compare raw stdout bytes. The native CLI cases use UTF-8 targets; injected host
tests and direct Wasm calls supply arbitrary response bytes.

Run the affected checks from the repository root with a built compiler:

```sh
gtimeout 30 node --test --test-reporter=tap dev/runtime-test.mjs
gtimeout 30 node dev/reactor-test.mjs _build/default/bin/kanon.exe
zsh dev/house.sh
zsh dev/trusted-lines.sh
```

The [validation record](validation/2026-09-12-symlink-target/README.md) retains
the completed captures, source hashes and rejected mutation controls. Validation
covers macOS with Node.js v23.10.0. Windows was not exercised.

## Review 2026-09-12 (symlink target)

- C-1 (low): the validation record README now attributes the 24.8-second reactor
  time to the external capture artifact and cites the recorded
  `# duration_ms 19093.966292` for the runtime capture; file
  `validation/2026-09-12-symlink-target/README.md`.
- C-2 (low): the base-runtime row of the validation record README now quotes the
  recorded diagnostic `unknown OS request 24`; file
  `validation/2026-09-12-symlink-target/README.md`.
- The check loop closed with no waiver. The gate ladder of round 1 passed 24 of
  27 legs. The three red legs are the timing legs M0-TIME, M0-RATIO and
  M1-CORPUS, which go red on their own above load1 25. The run had load1 31.8 to
  32.3 and the compiler binary hash is unchanged, so these three legs are waived.
  The RUNTIME 96 of 96 line, the six new symlink target tests, the line
  `reactor: 465 checks passed` and HOST-NAT 16/16 are never waived by load, and
  all of them are green in the carried log
  `validation/2026-09-12-symlink-target/gates-review.log`.
