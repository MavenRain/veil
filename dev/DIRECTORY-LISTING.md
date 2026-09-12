# Directory listing

Operation 22 accepts exactly one directory path and returns its direct entry
names through the ordinary reactor response. Each name ends with NUL, including
the final name. Empty directories return empty bytes. The host sorts names
by unsigned byte value and preserves spaces, newlines, Unicode and raw filename
bytes. It includes hidden entries, directories and symlinks, omits `.` and `..`,
and does not recurse. The answer carries names only, without type information.

The whole answer, including terminators, is limited to 65536 bytes. Exactly
65536 bytes succeeds; one more byte returns status 1 and
`IO: directory listing exceeds maximum OS chunk size`. Oversized listings and
read failures never return partial success. The directory handle closes after
enumeration, overflow or a read failure. Node's directory reader buffers a
bounded number of entries, so the host stops gathering names as soon as the
answer exceeds the limit. The implementation uses
[`fsPromises.opendir`](https://nodejs.org/download/release/v23.10.0/docs/api/fs.html#fspromisesopendirpath-options).

Relative paths and requested directory symlinks follow normal OS resolution.
Entry symlinks are listed as names, including dangling links, without reading
their targets. Missing paths and non-directory paths report their OS error
through `resume` with status 1. Invalid UTF-8 or NUL in a request path ends the
run with exit 2 before dispatch, as for the existing operations. The request
payload is unused. This is an observation of a potentially changing directory,
without a snapshot or pagination guarantee. Returned raw non-UTF-8 names still
cannot be used as path arguments under the existing OS-string restrictions.

`dev/runtime-test.mjs` exercises the real request loop with scripted exports.
It covers missing and surplus arguments, direct enumeration, byte ordering,
framing, empty directories, relative paths, symlinks, errors and recovery.
An exact 65536-byte directory and a 65537-byte directory check the answer limit,
including multibyte names and terminators. Read-failure and close observations
verify resource cleanup. Raw non-UTF-8 entry bytes are injected into the reader:
the local sandbox refuses to create those filenames. Other enumeration tests
use real files and directories. The response helper uses constant-time cons
to keep the boundary tests linear in answer size.

`test/fixtures/reactor/directory-listing.kan` forwards its argv to operation 22,
prints the raw answer with operation 6, and adds the output status to the
request status for its exit status. The checks exercise the request status
only, because the output status is 0 in each of their scenarios.
`dev/reactor-test.mjs` compiles it to an import-free Wasm module
and runs it through the CLI. Checks include empty and populated directories,
relative paths, malformed arities, OS errors, the full answer limit and overflow.

Run the affected checks from the repository root after building the compiler:

```sh
gtimeout 30 node --test --test-reporter=tap dev/runtime-test.mjs
gtimeout 30 node dev/reactor-test.mjs _build/default/bin/kanon.exe
zsh dev/house.sh
zsh dev/trusted-lines.sh
```

The [validation record](validation/2026-09-11-directory-listing/README.md)
retains outputs, source hashes and negative controls. Validation covers macOS
with Node.js v23.10.0. Windows and directories changing during enumeration were
not exercised. Compiler sources, gates and thresholds are unchanged.

## Review 2026-09-11 (directory listing)

- A-1, low: ruling, no change. A `close()` rejection in the `finally` of
  `listDirectory` replaces the original listing error. A fix removes the
  literal that the frozen `unclosed-directory` control replaces, so it waits
  for the next freeze. Files: runtime/reactor.mjs.
- D-1, low: the `requested` arm of `exitCode` now reports 1, as the sibling
  fixtures do, in place of 0. Files:
  test/fixtures/reactor/directory-listing.kan.
- D-2, low: the fixture paragraph now says that the fixture adds the output
  status to the request status, and that the checks exercise the request
  status only. Files: dev/DIRECTORY-LISTING.md.
- GATE-1, high: ruling, no change. The red legs of the second ladder are the
  three timing legs and the AGREEMENT hang ceiling at load1 48 to 62. The
  AGREEMENT leg alone exits 0 with `PASS AGREEMENT cases=7445 unary=5445
  full-range=2000` at load1 29, and the RUNTIME, REACTOR, HOST and HOST-NAT
  legs are green. Files: none.
- Close, 2026-09-11: the carried ladder is
  `validation/2026-09-11-directory-listing/gates-review.log` (tag fix-2). It
  passed 24 of 27 legs. The check loop closed under a dispatcher waiver after
  check-2: every item of the round is fixed and new_defects is empty. The red
  legs are `FAIL M0-TIME median_ms=500.597 bound_ms=150 load1=31.137
  samples=3x5`, `FAIL M0-RATIO ratio=5.018127 bound=2.000 load1=31.137` and
  `FAIL M1-CORPUS elapsed_ms=972.197 bound_ms=713 load1=33.428`, at load
  averages 33.21 36.58 43.24. Each red leg is a timing leg above the waiver
  threshold of load1 25. The kernel bound is unchanged: `TRUSTED-LINES
  kernel=5246/5250 encoder=246/600 OK`. RUNTIME reports `# pass 83` with
  `# fail 0`, the reactor reports 351 checks passed, HOST-NAT reports 16/16
  and the HOST leg reports programs=3. Files: none.
