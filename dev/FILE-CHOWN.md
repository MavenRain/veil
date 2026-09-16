# File ownership updates

Operation 45 accepts `[path, uid, gid]` and changes an existing entry's
numeric owner and group IDs through one `chown` call. Both IDs must be
canonical decimal integers in 0..4294967294. Zero is valid. Signs, leading
zeros, whitespace, fractions, exponent notation, hexadecimal and Unicode
digits are rejected. The all-ones ID 4294967295 is excluded because hosts
can interpret it as "leave unchanged". There is no unchanged-field sentinel.
To retain one ID, read the pair with operation 39 and supply that ID again.
The read and update are separate operations and do not prevent races.

The argument-count check and both ID validations finish before the host
call. Success returns an empty answer with status 0. Input validation
errors resume with status 1 and an `IO:` message. Host failures also resume
with status 1, retaining the host error code. Later requests can continue.
The body is unused, including bodies larger than 65536 bytes within the
shared request traversal bound. NUL or invalid UTF-8 in any argument fails
shared decoding before a host call or resume.

The runtime passes the literal path to the host without normalization or
expansion. Relative paths use the process working directory. Parent and
final symlinks follow native resolution; a final symlink changes the
target's ownership. Hard links share the updated inode. Directories and
special files are supported when the host allows the update. Dangling links
and missing paths fail without creating an entry. The operation does not
open file contents or replace an entry.

Host permissions determine whether an update succeeds, even when the
supplied IDs match current metadata. Ownership updates may change ctime and
clear set-user-ID or set-group-ID bits. The operation makes no promise to
preserve those fields. Accepted numeric IDs do not imply that the host
recognizes the account or permits the requested ownership. This operation
follows symlinks and does not offer `lchown` semantics.

## Regressions

Nine runtime tests cover file identity and binary contents, composition
with operation 39, an actual supplementary-group change and restoration,
directories, a FIFO, hard links, symlinks, literal Unicode and relative
paths, path errors, both ID positions, bounds and undecodable bytes.
The supplementary-group test skips only when the process has no group
other than the restore group. The test restores the entry to its initial
group when the process is a member of that group, and to the process group
in all other cases. A temporary directory can give an entry a group that is
outside the process membership, thus the restore target is a membership
group and the test does not fail there. Native ownership tests skip on
Windows.

Mocks check zero and high unsigned IDs, argument order, a single host call,
ignored body bytes, pre-effect validation of both IDs, no content access,
and continuation after injected permission, read-only, unsupported and
generic errors. Native missing-path calls additionally check that the
host binding accepts the unsigned ID range without changing metadata.
The shared arity matrix includes row 45.

The compiled `file-chown.kan` fixture checks operation and argument bytes,
binary answer forwarding, output failures and terminal-state stability.
Native compiled runs cover files, directories, links, preservation,
invalid IDs, argument counts and path errors. The fixture uses the normal
compiler and generic runtime, with no additional imports or kernel rules.

Validation results and reproducible defect controls are recorded in
[the validation record](validation/2026-09-15-file-chown/README.md).

## Review 2026-09-16 (file chown)

- A-1, medium: the group test restored the entry to the group it inherited
  and did not check the process membership, thus the test failed when the
  temporary directory gave a foreign group. Fixed by the GATE-1 change
  below, in the pinned `dev/runtime-test.mjs`. Files: `dev/runtime-test.mjs`.
- B-1, low: the regressions prose now gives the second precondition, that
  the process must belong to the initial group of the entry. Files:
  `dev/FILE-CHOWN.md`, `dev/validation/2026-09-15-file-chown/README.md`.
- B-2, low: carried for a user ruling, the sixth carry. The FIFO test
  guards bind only `fsPromises` and the test has no own timeout. Files:
  `dev/runtime-test.mjs`.
- C-1, low: the positive control gate now requires nine passed tests and no
  skip, thus a host that skips cannot certify the runtime. Files:
  `dev/validation/2026-09-15-file-chown/reproduce-controls.py`,
  `dev/validation/2026-09-15-file-chown/README.md`.
- C-3, low: the record now states that no compiler source row and no
  capture back the compiler-source claim, and it gives the recheck against
  the base. Files: `dev/validation/2026-09-15-file-chown/README.md`.
- C-4, low: the record now gives the load average 55.24 as an unrecorded
  host observation, and it names the capture of the watchdog expiry. Files:
  `dev/validation/2026-09-15-file-chown/README.md`.
- GATE-1, high: the supplementary-group test now restores the entry to the
  process group when the process is not a member of the initial group, thus
  the runtime leg passes on a host whose temporary directory inherits a
  foreign group. Files: `dev/runtime-test.mjs`, `dev/FILE-CHOWN.md`,
  `dev/validation/2026-09-15-file-chown/README.md`.
- ND-2-2, low: the GATE-1 change edited `dev/runtime-test.mjs`, and the
  frozen capture `controls.json` still pins the pre-review hash of that
  file. The record README discloses the stale pin. The controls were not
  re-recorded. Files: `dev/validation/2026-09-15-file-chown/README.md`.

The close ladder ran at load1 8.91 start, 10.63 end (02:5x).
LADDER-EXIT 0, every named leg PASS, no FAIL row, under an empty waiver: no
leg needed a load waiver. TRUSTED-LINES kernel=5246/5250 encoder=246/600
OK. RUNTIME `# pass 279 of 279`, `# fail 0`. HOST-NAT 16/16.
`reactor: 3330 checks passed`. The full log is pinned at
`validation/2026-09-15-file-chown/gates-review.log`.
