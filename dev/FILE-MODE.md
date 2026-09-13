# Filesystem permission changes

Operation 31 exposes
[`fsPromises.chmod`](https://nodejs.org/api/fs.html#fspromiseschmodpath-mode)
through the reactor. It accepts exactly `path, mode`, returns empty bytes
on success, and returns host errors as status 1 with `CODE: message`.
The state machine can continue after an error. Its binary payload is unused.

Modes are ASCII decimal strings in the range 0 to 511. These values cover
octal `0000` to `0777`, including mode zero and all nine ordinary permission
bits. Leading zeros retain decimal interpretation: use `493` for octal
`0755` and `420` for octal `0644`. Symbolic modes, signs, whitespace,
fractions, octal prefixes and unsafe integers return
`IO: invalid OS numeric argument`. Safe integers above 511 return
`IO: file mode exceeds permission bit range`. Validation happens before
the call to `chmod`, so rejected requests cannot change permissions.

Existing files and directories retain their identity and contents. Hard
links share the change, and final symlinks are followed without replacing
the link. Missing entries and dangling targets are not created. The runtime
passes NUL-free UTF-8 paths unchanged, leaving relative paths, parent links,
dot segments and trailing separators to native resolution.

The host controls ACLs, special-bit handling and metadata updates. The
request cannot set special bits. A successful request writes the full
permission word, so it clears the setuid, setgid and sticky bits that the
entry already holds. Windows changes only the write permission;
see [Node's file-mode rules](https://nodejs.org/api/fs.html#file-modes).
The native tests ran on macOS; Windows, ACL interactions and concurrent
path replacement were not exercised. This operation provides no path-race
isolation or rollback guarantee.

Nine top-level `^file mode` runtime tests cover file identity and binary
content, zero and maximum permissions, directory changes, generated program
execution, hard links, final and parent symlinks, Unicode relative paths,
path errors, malformed arguments, invalid OS strings and injected errors.
A call adapter verifies every accepted numeric mode from 0 to 511, leading
zeros, exact path forwarding and an ignored 65537-byte payload. The arity
matrix also includes operation 31.

The compiled `file-mode.kan` fixture issues operation 31, reports the answer
through operation 6, and combines operation and output statuses at exit.
The reactor harness checks literal argument bytes, its ignored binary body,
success and error state transitions, output failure, terminal stability,
real permissions, file identity, rejected modes and missing paths.

Run from the repository root with a built compiler, using the existing
watchdogs:

```sh
gtimeout 30 node --test --test-reporter=tap --test-name-pattern '^file mode' dev/runtime-test.mjs
gtimeout 30 node --test --test-reporter=tap dev/runtime-test.mjs
gtimeout 30 node dev/reactor-test.mjs _build/default/bin/kanon.exe
gtimeout 30 node dev/host-nat-test.mjs _build/default/bin/kanon.exe
zsh dev/house.sh
zsh dev/trusted-lines.sh
```

The [validation record](validation/2026-09-13-file-mode/README.md) records
results, negative controls, validation scope and source hashes.

## Review 2026-09-13 (file mode)

- C-1 (medium): the validation README now states that it appears in both hash
  maps of `results.json` and must match both after an edit
  (`dev/validation/2026-09-13-file-mode/README.md`).
- D-2 (low): both contracts now state that a successful request writes the full
  permission word and clears setuid, setgid and sticky bits that the entry
  already holds (`REACTOR.md`, `dev/FILE-MODE.md`).
- B-1 (low): the operation 31 limits text in the contract now states that the
  request gives no path-race isolation and that a failure is not a rollback
  guarantee (`REACTOR.md`).
- D-1 (low): the regression commands now state the repository root and include
  the house and trusted-lines legs (`dev/FILE-MODE.md`).

The check loop closed with no waiver. The fix round 1 ladder
(`validation/2026-09-13-file-mode/gates-review.log`) gives GATES-OK with
LADDER-EXIT 0 and 27 PASS legs of 27. No leg is red, so the load1 waiver
threshold of twenty-five applies to no leg. RUNTIME gives `# pass 154` with
`# fail 0`, the reactor harness gives `reactor: 1070 checks passed`, and
HOST-NAT gives `HOST-NAT 16/16`. These lines are never waived by load.
