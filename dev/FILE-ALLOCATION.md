# File allocation

Operation 40 accepts exactly one path and returns `blocks:blksize` from one
`stat(path, { bigint: true })` result. The first field preserves the host's
allocated block count. The second preserves its block size for filesystem
I/O. Both use exact ASCII decimal digits, separated by one colon, with no
sign, leading zero, whitespace or terminator. Zero fields are preserved,
and formatting never converts through Number. See Node's
[`stats.blocks`](https://nodejs.org/api/fs.html#statsblocks) and
[`stats.blksize`](https://nodejs.org/api/fs.html#statsblksize) contracts.

The operation follows final symlinks and accepts directories and special
files. It passes literal paths to the host, including relative paths and
parent segments after symlinks. It reads metadata without opening contents
or creating entries. The body is unused under the shared decoding limits,
including bodies larger than the file-I/O chunk limit. Host errors resume
with status 1 and `CODE: message`; later requests may continue. Missing or
surplus arguments are rejected before stat. Invalid UTF-8 and NUL-containing
path bytes fail in the shared string decoder before stat.

Each request resolves its path again and reads fresh metadata. Hard links
to the same entry agree at a given instant. Writes and truncation can change
allocation according to filesystem policy, including sparse files. No test
assumes that allocation rises with logical file size or that a sparse
extension reserves storage. The block count's unit is host-defined, while
`blksize` is an I/O hint. Multiplying these two fields is not a supported
conversion to bytes. The pair does not establish physical disk usage,
unique storage, free space or quota.

Eight focused runtime tests cover:

- Native fields and preservation of contents and metadata.
- Empty files, append, sparse extension, truncation, hard links, rename
  and unlink, compared to fresh native metadata at each step.
- Directories, private FIFOs and final symlinks. The FIFO test guards
  content opens and reads, rejects lstat and has a five-second timeout.
- Relative Unicode paths and native parent-symlink resolution, with an
  absent path where lexical normalization would incorrectly look.
- Missing paths, dangling and cyclic links, invalid parents and recovery.
- Argument counts, invalid UTF-8 and embedded NUL before stat.
- Exact zero and large integer pairs, distinct field order, one fresh
  bigint stat per request, literal paths and no content opens or reads.
- Injected EACCES, EIO, EOVERFLOW and generic errors followed by success.

The compiled `test/fixtures/reactor/file-allocation.kan` fixture checks
request bytes, unused body bytes, exact answer forwarding, output failures
and stable terminal states. Native runs cover files, directories, hard
links, symlinks, relative paths and request failures. Injected fixture
answers check the compiled state machine; separate runtime mocks check
formatting of host fields. The shared argument-count matrix includes
operation 40.

Native tests ran on macOS. Zero and large integer endpoints also use
injected metadata. Windows was not exercised, and the runtime preserves
the fields supplied by the host without synthesizing allocation values.
The [validation record](validation/2026-09-14-file-allocation/README.md)
contains commands, captures, source hashes and reproducible defect controls.

## Review 2026-09-15 (file allocation)

- C-1, medium: the output-guard checker now finds its repository root and
  its reproducer from its own path, accepts an optional output directory
  and stops when the reproducer is absent.
  File: validation/2026-09-14-file-allocation/check-output.py.
- D-1, low: the regression-document chain now has a row for operation 40.
  File: ../REACTOR.md.
- C-2, low: the record states that the output-guard capture ran a
  byte-identical copy of the checker from outside the working copy, and it
  gives the rerun command for the pinned file.
  File: validation/2026-09-14-file-allocation/README.md.
- C-3, low: the record names `control-run.json` in the defect-control row
  and in the control prose.
  File: validation/2026-09-14-file-allocation/README.md.

The close ladder ran at load1 11.63 start, 17.76 end (01:1x). LADDER-EXIT
0, 27 of 27 named legs PASS, no FAIL row, under an empty waiver: no leg
needed a load waiver. TRUSTED-LINES kernel=5246/5250 encoder=246/600 OK.
RUNTIME `# pass 235`, `# fail 0`. HOST-NAT 16/16.
`reactor: 2276 checks passed`. HOST PASS programs=3 zk-instance=10/10.
The full log is pinned at
`validation/2026-09-14-file-allocation/gates-review.log`.
