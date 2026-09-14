# Filesystem status-change time

Operation 35 accepts exactly one path and returns its status-change time as
signed ASCII decimal nanoseconds since the Unix epoch. The answer has no
leading zeros, plus sign, newline or terminator. The epoch returns `0` and
one nanosecond before it returns `-1`. The host formats `ctimeNs` from
`stat(path, { bigint: true })` directly, without conversion through a Number,
Date or millisecond value. Nanoseconds specify the answer's units; the
filesystem determines timestamp resolution. See the
[Node timestamp contract](https://nodejs.org/api/fs.html#statsctimens).

Regular files, directories and special files are accepted. Final symlinks
are followed, and hard links report their shared entry's status-change time.
NUL-free UTF-8 paths pass unchanged, preserving native resolution of relative
paths, parent symlinks, dot segments and trailing separators. Host failures
return status 1 and `CODE: message`, allowing subsequent requests to continue.
Missing entries are not created. Invalid UTF-8 or embedded NUL ends the run
before dispatch. The request does not open contents or set timestamps; its
payload is unused, subject to shared decoding and traversal limits.

Status changes include permission changes. Creation time is the separate
host `birthtime` field; modification and access times have operations 33 and
34. The host and filesystem determine which changes update `ctime` and the
precision available. It is a metadata observation with no guaranteed unique
revision or ordering, and it does not lock the entry for a later operation.
Signed timestamps remain byte strings in Kanon and cannot always be read
as a `Nat`. This operation only observes the host value and cannot set it.

Eight focused runtime tests cover:

- Native `ctimeNs` agreement, distinction from modification and access time,
  ignored binary payload, repeated reads and preservation of contents and all
  inspected metadata.
- A real permission change through operation 31, followed by an updated
  status timestamp with preserved contents, identity, size, access and
  modification times. The test retries alternating modes for at most
  2.5 seconds to accommodate coarse timestamp resolution.
- Private FIFOs, directories, final symlinks and explicit equality between
  hard-link timestamps.
- Relative Unicode paths, parent symlink traversal with dot segments and a
  separate decoy entry.
- Missing paths and parents, dangling and cyclic links, non-directory
  components, file trailing separators, empty paths and successful recovery.
- Missing and surplus arguments, embedded NUL and invalid UTF-8, with a
  `stat` spy proving that rejected requests never reach the filesystem.
- Injected zero, sub-millisecond values, exact values above `2^53`, negative
  values and signed 64-bit endpoints. A literal-path spy checks bigint
  options, distinct timestamp fields, and fresh metadata for each request.
  Open and read spies reject content access while allowing the harness to
  load the runtime source.
- Injected `EACCES`, `EIO`, `EOVERFLOW` and an error without a code, followed
  by a successful request.

The shared arity matrix includes operation 35. The compiled
`test/fixtures/reactor/file-changed.kan` fixture requests the timestamp and
writes the answer to stdout. Direct Wasm checks pin argument and payload
bytes, signed answer propagation, output failures and terminal-state
stability. Host runs cover files, directories, links, relative Unicode
paths, a permission change, malformed argument counts and native errors.

Native tests ran on macOS. Negative status timestamps and exact signed
endpoints use injected metadata; no system clock changes or native pre-epoch
`ctime` setup were performed. Windows was not exercised. These tests do not
establish every filesystem's update policy or timestamp resolution.

The [validation record](validation/2026-09-13-file-changed/README.md) retains
commands, complete captures, source hashes and reproducible defect controls.

## Review 2026-09-13 (file changed)

- B-1 (medium): carried for a user ruling, no edit. The FIFO test installs no
  spy, so the repair must edit `dev/runtime-test.mjs`, which `controls.json`
  pins. Files: dev/runtime-test.mjs.
- C-1 (low): the record README now limits the `capture_sha256` claim to the
  files that this run wrote and states that `gates-review.log` is added after
  the run and is not pinned. Files:
  dev/validation/2026-09-13-file-changed/README.md.
- D-4 (low): the operation list is rewrapped so that each added line stays
  inside 80 columns. Files: REACTOR.md.
- Close ladder ran at 02:3x and passed 28 of 28 legs, no red leg. The
  check loop closed under no waiver. RUNTIME `# pass 190`, HOST-NAT
  16/16, `reactor: 1469 checks passed`, TRUSTED-LINES kernel=5246/5250
  encoder=246/600 OK. Log: dev/validation/2026-09-13-file-changed/gates-review.log.
