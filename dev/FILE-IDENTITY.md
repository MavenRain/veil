# File identity

Operation 37 accepts exactly one path and returns the `dev` and `ino` fields
from one `stat(path, { bigint: true })` call. The answer is `dev:ino`: two
ASCII decimal integers separated by one colon, with no leading zeros, plus
signs, whitespace, newline or terminator. Each integer is formatted directly
without conversion through Number. Zero fields pass through unchanged.
Node defines [`dev`](https://nodejs.org/api/fs.html#statsdev) as the device
containing the file and [`ino`](https://nodejs.org/api/fs.html#statsino) as
the filesystem's inode number.

The request follows final symlinks and accepts directories and special files.
Relative paths use the working directory. Path text reaches stat unchanged,
including dot segments after parent symlinks. Missing entries, dangling or
cyclic links and other host errors resume with status 1 and `CODE: message`.
Missing or surplus arguments are rejected before stat. NUL and invalid UTF-8
paths fail shared request decoding. The body is unused under the shared
limits. Inspection does not open or read contents or create entries.

Hard links report the same pair. Append and rename preserve that entry.
Atomic replacement installs a different entry while other hard links can
keep the previous entry alive. Each request reads fresh metadata from one
stat result, so its fields come from the same host call. The pair is scoped
to the host and filesystem. Identifiers can be reused after deletion, and
concurrent pathname changes can invalidate a comparison before a subsequent
operation. Later operations resolve their paths again.

Eight focused runtime tests cover:

- Native metadata and content preservation, including an unused binary body.
- Composition with hard-link creation, append, rename, atomic replacement
  and unlink. The original inode remains alive during the replacement check.
- Directories, private FIFOs, final symlinks and relative Unicode paths.
- Native parent-symlink resolution with a distinct decoy entry.
- Missing paths, dangling and cyclic links, nondirectory components, trailing
  separators, the empty path and recovery after errors.
- Arity and string rejection before stat, plus the shared arity matrix.
- Injected zero fields, separator-sensitive pairs, integers above 2^53 and
  unsigned 64-bit endpoints, with changing pairs at the same path. Tests pin
  the bigint option, literal path and one stat call per request. Content-open
  and content-read mocks reject any attempt to access entry contents.
- Injected permission, I/O, overflow and generic errors, followed by success.

The compiled `test/fixtures/reactor/file-identity.kan` fixture checks request
code, literal argument and payload bytes, exact answer propagation, output
failures and stable terminal states. It runs through the native host against
files, directories, links, replacement and rejected requests.

Native tests ran on macOS. Other platforms and native 64-bit endpoint values
were not exercised. The
[validation record](validation/2026-09-14-file-identity/README.md) records
commands, source hashes, captures and reproducible defect controls.

## Review 2026-09-14 (file identity)

- D-1, low, fixed: `REACTOR.md` now says that the inode field identifies the
  entry inside that filesystem, not that it identifies the filesystem.
  Files: `REACTOR.md`.
- C-1, low, close task: the validation README says that `results.json` pins
  every other file of the record, so the close pins `gates-review.log`.
  Files: `validation/2026-09-14-file-identity/README.md`.
- B-1, medium, carried for a user ruling: the FIFO test sends no open spy and
  no per-test timeout, and the repair edits a hash-pinned test file.
  Files: `runtime-test.mjs`.
- Close ladder ran at 15:2x with load1 51.7 at the start and 39.8 at the
  end (load5 103.8, load15 129.0): TRUSTED-LINES kernel 5246/5250 encoder
  246/600, RUNTIME 208 pass of 208 with RUNTIME-EXIT 0, HOST-NAT 16/16,
  reactor 1799 checks passed with REACTOR-EXIT 0, HOST programs=3
  zk-instance=10/10, AGREEMENT cases=7445, and the ladder REACTOR and
  RUNTIME rows passed under the thirty-second watchdog. LADDER-EXIT 1
  because three timing legs failed with load1 above thirty, the waiver
  threshold: M0-TIME load1=129.750, M0-RATIO load1=129.750 and M1-CORPUS
  load1=114.064. No other row failed. The check loop closed under no
  named waiver. Log: dev/validation/2026-09-14-file-identity/gates-review.log.
- A first close ladder at 15:0x ran at load1 148 to 262 and failed the
  standalone runtime suite on both of its runs, each on one pre-existing
  test outside the eight file identity tests (`not ok 12`, a leader
  deadline test, and `not ok 99`, a file mode test, each 207 pass of
  208). That log stays in the review kit and is not filed here; the
  ladder was rerun at a lower load as the close above.
