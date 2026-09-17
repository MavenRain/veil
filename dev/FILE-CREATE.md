# Exclusive file creation

Operation 49 takes `[path]` and creates a new file from the raw request
body. Empty files and binary bodies up to 65536 bytes are accepted. The
runtime awaits one `writeFile` call with flag `wx` and mode `0o600`.
Success resumes with status 0 and an empty answer. No parent is created.

On POSIX, the host applies its umask to the requested owner-only permissions.
Existing files, directories and links are refused. On POSIX, exclusive
creation also refuses a dangling or cyclic final symlink without following
it. This uses the host's exclusive flag directly, without a preceding
existence check. Its guarantees depend on the filesystem; Node documents
that exclusive flags may be unreliable on network filesystems.
See [Node's filesystem flags][node-flags].

Relative paths use the host working directory. Parent symlinks, repeated
separators, dot segments and trailing slashes retain native semantics.
The runtime adds no lexical normalization or containment checks.

Host failures resume with status 1 and the native error code and message.
Oversized bodies and missing or surplus arguments fail before the write
with status 1 and an `IO:` message. NUL or invalid UTF-8 in a path ends the
run before dispatch and resume. Later requests can follow a resumed error.

The file becomes visible when opened, before its complete contents have
necessarily been written. There is no whole-payload atomic publication,
rollback or durability flush. A host write or close failure can leave an
empty, partial or complete new file. The runtime keeps that entry and
reports the error. Callers decide how to recover. Node's
[`writeFile` documentation][write-doc] describes the underlying writes.

[node-flags]: https://nodejs.org/docs/latest-v23.x/api/fs.html#file-system-flags
[write-doc]: https://nodejs.org/api/fs.html#fspromiseswritefilefile-data-options

## Regressions

Ten runtime tests cover empty, binary and maximum-size payloads; umask;
existing files, directories, hard links and final symlinks; literal paths;
native denied access; native path failures without created parents;
decoding and size guards; exact host flags; awaiting completion; injected
host errors; and retention of an injected partial write. The shared arity
matrix covers operation 49. Native permission and symlink tests skip on
Windows; denied access also skips when running as root.

The compiled `file-create.kan` fixture checks ordered argument and payload
bytes, exact status and answer forwarding, output failures and stable
terminal states. Its subprocess checks exercise creation, rejected
existing entries including a private FIFO, literal paths, malformed
requests and recovery. FIFO creation and execution have subprocess
timeouts. The fixture uses its own temporary subdirectory.

The existing RUNTIME and REACTOR suites include these checks. Validation
scope, source hashes and reproducible defect controls are recorded in
[the validation record](validation/2026-09-16-file-create/README.md).

## Review 2026-09-16 (file create)

- B-2, low: the regression summary now names the native path failure test.
  Files: dev/FILE-CREATE.md, dev/REACTOR-BUILD-LOG.md.
- C-2, low: the record README now states the five-count `checks` shape and
  the key relativity of the two hash maps.
  File: dev/validation/2026-09-16-file-create/README.md.
- C-3, low: the record README now states that the defect controls rerun the
  ten runtime tests only.
  File: dev/validation/2026-09-16-file-create/README.md.
- D-1, low: added prose lines are at 80 columns or less.
  Files: dev/FILE-CREATE.md, dev/validation/2026-09-16-file-create/README.md.
- D-3, low: the build-log bullet names all nine defect controls.
  File: dev/REACTOR-BUILD-LOG.md.
- B-1, medium, CARRIED for a user ruling: the refusal rows pin the error
  code prefix only, so an existence pre-check before the exclusive write
  survives. The repair edits the sha256-pinned dev/runtime-test.mjs.
- B-3, low, CARRIED for a user ruling, eighth carry: the private FIFO
  guards bind only `fsPromises` in the sha256-pinned harness.

The close ladder ran at load1 12.51 start, 10.48 end (02:0x).
LADDER-EXIT 0, every named leg PASS, no FAIL row, under an empty waiver: no
leg needed a load waiver. TRUSTED-LINES kernel=5246/5250 encoder=246/600
OK. RUNTIME `# pass 318 of 318`, `# fail 0`. HOST-NAT 16/16.
`reactor: 4128 checks passed`. The full log is pinned at
`validation/2026-09-16-file-create/gates-review.log`.
