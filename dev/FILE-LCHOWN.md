# Entry ownership without following a final symlink

Operation 46 accepts `[path, uid, gid]`, validates both IDs and makes one
`lchown` call. A final symlink receives the ownership update itself,
including when its target is missing or cyclic. Files, directories and
hard links retain their native ownership behavior. Success returns status
0 with an empty answer. No file contents are opened and no entry is
created or replaced.

IDs use the same canonical decimal format as operation 45: integers in
0..4294967294, without signs, leading zeros, whitespace, fractions or
exponents. Zero is valid. The all-ones ID 4294967295 is rejected because
hosts can interpret it as "leave unchanged". There is no sentinel for
preserving one field. Both IDs must pass validation before the host call.
Operation 39 follows a final symlink, so it cannot read the link's own
IDs for this purpose.

Argument-count and ID errors resume with status 1 and an `IO:` message.
Host failures preserve their error code and also resume with status 1;
subsequent requests can continue. The request body is ignored within the
shared traversal bound, including bodies larger than 65536 bytes. NUL or
invalid UTF-8 in any argument ends the run during shared decoding, before
the host call or a resume.

Paths pass literally to the host, with relative paths using the process
working directory. Parent symlinks, dot segments and trailing slashes keep
native semantics. In particular, a trailing slash can require traversing
a symlink to a directory. The operation does not prevent traversal through
parent components or concurrent path changes. It supplies the host's
`lchown` behavior, not a general path containment guarantee.

The host controls allowed ownership changes, ctime updates and clearing of
special permission bits. An accepted numeric ID does not imply a known
account or permission to store that ID. Hosts without this operation
return their normal unsupported-operation error. See the Node
[`lchown`](https://nodejs.org/api/fs.html#fspromiseslchownpath-uid-gid)
reference for the host binding.

## Regressions

Nine runtime tests and the shared arity matrix cover live, dangling and
cyclic links, target metadata preservation, binary contents, composition
with link creation, inspection and unlink, actual group changes, ordinary
files, hard links, directories, relative Unicode paths and parent symlinks.
They also cover native path errors, both ID positions, unsigned bounds,
undecodable arguments, ignored bodies and continuation after host errors.

The group-change test selects a distinct process membership group and
restores a membership group in a `finally` block. It skips when no distinct
group is available. Native ownership tests skip on Windows. Mocks verify
ordered IDs, a single host call, validation before effects and no content
access. Native missing-path requests exercise high unsigned IDs without
changing ownership.

The compiled `file-lchown.kan` fixture exercises operation 46 through the
normal compiler, WebAssembly ABI and CLI. It checks literal argument
bytes, binary answer forwarding, output failure status and terminal-state
stability. Native runs cover live, dangling and cyclic links, unchanged
target metadata, path errors, malformed IDs and missing or surplus args.

Results and reproducible defect controls are in the
[validation record](validation/2026-09-16-file-lchown/README.md).

## Review 2026-09-16 (file lchown)

- B-4, low: carried for a user ruling, the seventh carry. The private FIFO
  test guards bind only `fsPromises`, and the harness is sha256 pinned, so
  the only repair would edit runtime evidence. Files: `dev/runtime-test.mjs`.
- Five candidate findings were refuted by probe (a read-back claim about
  operation 39, a defect-control reproduction claim, a defect-control-count
  claim, a baseline tracked-file-count claim and a line-width claim), and
  one candidate was dropped as a duplicate. None changed record or code
  bytes. The link line named by the line-width claim was still wrapped
  to 80 columns under the review-kit width rule.
- The close ladder ran GATES-OK, LADDER-EXIT 0, under an empty waiver: no
  leg needed a load waiver. RUNTIME `# pass 289 of 289`, `# fail 0`,
  RUNTIME-EXIT 0. HOST-NAT 16/16. `reactor: 3520 checks passed`,
  REACTOR-EXIT 0. TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK.
  Start load1 11.36, end load1 15.97. Full log pinned at
  `validation/2026-09-16-file-lchown/gates-review.log`.
