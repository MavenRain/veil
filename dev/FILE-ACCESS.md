# Filesystem access checks

Operation 48 accepts `[path, mode]` and checks the host's current access
rules without creating or opening an entry. Mode is one ASCII digit:

| Mode | Required access |
| --- | --- |
| 0 | Existence |
| 1 | Execute, or directory search on POSIX |
| 2 | Write |
| 3 | Write and execute |
| 4 | Read |
| 5 | Read and execute |
| 6 | Read and write |
| 7 | Read, write and execute |

The runtime translates these bits to Node's `F_OK`, `R_OK`, `W_OK` and
`X_OK` flags and awaits one [`access` call][node-access]. Success resumes
with status 0 and an empty answer. Missing paths, denied access and other
host failures resume with status 1 and the native error code and message.
Later requests can continue after an error.

Mode text must be canonical. Leading zeros, signs, whitespace, fractions,
exponents and values outside 0..7 fail before the host call, as do missing
or surplus arguments. These errors resume with status 1 and an `IO:`
message. NUL or invalid UTF-8 in either argument ends the run before
dispatch or resume. The body is ignored within the shared traversal bound,
including bodies larger than 65536 bytes.

Paths pass literally to the host. Relative paths use the process working
directory. Parent and final symlinks are followed; dangling and cyclic
links return native errors. Dot segments and trailing slashes retain
native semantics. No lexical normalization or containment check is added.
Regular files, directories, hard links and special files use host rules.

An access result is a snapshot. It does not lock a path, reserve permission
or guarantee a later read, write or execution. Applications should perform
the desired operation and handle its error instead of using this request
as authorization for a later effect. Host credentials, ACLs and filesystem
rules can differ from the permission bits returned by operation 32.
On Windows, `X_OK` checks existence and Node's access binding does not
inspect Windows ACLs. The operation inherits these host limitations.

[node-access]: https://nodejs.org/api/fs.html#fspromisesaccesspath-mode

## Regressions

Eight runtime tests and the shared arity matrix cover every mode against
native access results, metadata and content preservation, links, FIFOs,
literal Unicode paths, native parent resolution, path errors, recovery,
composition with chmod, malformed modes and undecodable arguments.
Injected calls check the exact path and flag arguments, one awaited call,
ignored bodies and denied or unsupported host operations. POSIX path,
symlink and FIFO tests skip on Windows.

The compiled `file-access.kan` fixture checks operation 48, ordered
argument bytes, an ignored binary body, exact status and answer forwarding,
output failures and stable terminal states. Its subprocess tests compare
real access results against native checks, exercise links and literal
paths, and reject malformed requests without changing the file.
The existing REACTOR and RUNTIME gates include these checks.

Validation evidence is in
[the validation record](validation/2026-09-16-file-access/README.md).

## Review 2026-09-16 (file access)

- D-1, low: the arity counter now reads operations 1 to 48 (REACTOR.md).
- D-2, low: the regression link list now indexes operation 48 and this
  document (REACTOR.md).
- C-2, low: the record states that the baseline harness copy is not
  retained and names the retained timing probe
  (validation/2026-09-16-file-access/README.md).
- C-4, low: the record states that the harness split, the concurrent run
  and the load averages are run-time observations and not part of the
  captures (validation/2026-09-16-file-access/README.md).
- C-1, low: the reproduction block points at the watchdog section and
  prints the diagnostic invocation
  (validation/2026-09-16-file-access/README.md).
- B-1, medium: carried for a user ruling. No fixture is denied read or
  write access, so a directory short-circuit defect survives the eight
  tests. The repair edits the pinned dev/runtime-test.mjs.
- A-1, low: carried for a user ruling, eighth carry. The private FIFO
  guards bind only the promise bindings, and the test has no timeout. The
  repair edits the pinned dev/runtime-test.mjs.
- The check loop closed with no waiver. The runtime suite passed 307 of
  307 tests. The reactor suite passed 4018 checks. HOST-NAT passed 16 of
  16 checks. These four results were never waived.

The close ladder ran at load1 11.26 start, 15.34 end (23:0x).
LADDER-EXIT 0, every named leg PASS, no FAIL row, under an empty waiver: no
leg needed a load waiver. TRUSTED-LINES kernel=5246/5250 encoder=246/600
OK. RUNTIME `# pass 307 of 307`, `# fail 0`. HOST-NAT 16/16.
`reactor: 4018 checks passed`. The full log is pinned at
`validation/2026-09-16-file-access/gates-review.log`.
