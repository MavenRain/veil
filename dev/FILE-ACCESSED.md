# Filesystem access time

Operation 34 accepts exactly one path and returns its last access time as
signed ASCII decimal nanoseconds since the Unix epoch. The answer has no
leading zeros, plus sign, newline or terminator. The epoch returns `0` and
one nanosecond before it returns `-1`. The host formats `atimeNs` from
`stat(path, { bigint: true })` directly, without conversion through a Number,
Date or millisecond value. Nanoseconds specify the answer's units; the
filesystem determines timestamp resolution. See the
[Node timestamp contract](https://nodejs.org/api/fs.html#statsatimens).

Regular files, directories and special files are accepted. Final symlinks
are followed, and hard links report their shared entry's access time.
NUL-free UTF-8 paths pass unchanged, preserving native resolution of relative
paths, parent symlinks, dot segments and trailing separators. Host failures
return status 1 and `CODE: message`, allowing subsequent requests to continue.
Missing entries are not created. Invalid UTF-8 or embedded NUL ends the run
before dispatch. The request does not open contents or set timestamps; its
payload is unused, subject to shared decoding and traversal limits.

Access-time updates depend on filesystem and mount policy. Reading contents
need not change this value, and explicit timestamp changes can move it in
either direction. It is neither an audit log of reads nor a monotonic counter.
An observation does not lock the entry for a later operation. Signed timestamps
remain byte strings in Kanon and cannot always be interpreted as a `Nat`.

The runtime tests cover native timestamp updates, metadata and content
preservation, a pre-epoch Date, final symlinks, hard links, directories, a
private FIFO, Unicode paths, parent symlink resolution and native failures.
The FIFO uses the POSIX `mkfifo` utility and is never opened. The tests set
access times explicitly rather than depending on read-induced updates.
Injected host results pin nanosecond precision beyond `2^53`, signed 64-bit
endpoints, literal path forwarding, ignored payload bytes and error recovery.
Host spies reject attempts to open or read the requested entry's contents.
The arity matrix rejects missing and surplus arguments; a dedicated spy
checks that malformed requests never call `stat`.

`test/fixtures/reactor/file-accessed.kan` drives the same operation through
compiled Wasm. The reactor checks its request bytes, answer forwarding,
terminal states and both output statuses, then runs it on native paths and
a pre-epoch timestamp. Native tests ran on macOS; Windows was not exercised.

Reproduce from the repository root with an existing compiler build:

```sh
node --test --test-name-pattern 'file (accessed|modified)|request arities' dev/runtime-test.mjs
node --test --test-reporter=tap dev/runtime-test.mjs
node dev/reactor-test.mjs _build/default/bin/kanon.exe
node dev/host-nat-test.mjs _build/default/bin/kanon.exe
```

The [validation record](validation/2026-09-13-file-accessed/README.md) pins
the tested sources, reused compiler, captured results and defect controls.

## Review 2026-09-13 (file accessed)

- C-1, low: the validation record README now limits its pinning claim to the
  files that the run wrote, and it discloses that the later `gates-review.log`
  is not pinned (`dev/validation/2026-09-13-file-accessed/README.md`).
- B-1, medium: carried for a user ruling. The two FIFO tests install no open
  spy, so an arm that opens the requested entry blocks the RUNTIME leg instead
  of failing. The repair edits `dev/runtime-test.mjs`, which the pinned record
  does not permit in this round (`dev/runtime-test.mjs`).
- GATE-1, high: no source change. The ladder failed only on the timing legs
  M0-TIME and M0-RATIO under a load average above 20. The compiler binary is
  unchanged, and a repair moves a kernel bound, which this review does not
  permit. The slice legs pass again: 181 runtime tests, 1353 reactor checks,
  HOST-NAT 16/16 and PASS HOST (no files changed).
- Close ladder 2026-09-13 22:2x, `dev/validation/2026-09-13-file-accessed/
  gates-review.log`: `GATES-OK` with `LADDER-EXIT 0` and no FAIL leg. The
  run reports `TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK`, RUNTIME
  `# pass 181` with `# fail 0`, `HOST-NAT 16/16`, `reactor: 1353 checks
  passed` and `PASS HOST programs=3 zk-instance=10/10`. The timing legs
  also pass: M0-TIME median_ms=146.958 bound_ms=150 load1=19.526, M0-RATIO
  ratio=1.534461 bound=2.000 and M1-CORPUS elapsed_ms=375.978 bound_ms=713
  load1=18.763. The check loop applied no waiver. The waiver threshold
  stays a load1 above thirty, and the RUNTIME count, the eight file
  accessed tests, the reactor checks line and HOST-NAT are never waived by
  load alone.
