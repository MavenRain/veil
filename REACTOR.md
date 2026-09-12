# Reusable WebAssembly modules

`kanon build` checks, erases, and compiles an ordered set of Kanon source
files to one WebAssembly module. Each `--export` names an ordinary Kanon
definition. Source files share one declaration environment, and later
files may use earlier definitions. The compiler inserts a newline between
files; reported line numbers refer to their concatenation.

```sh
kanon build types.kan app.kan -o app.wasm \
  --export initialState --export updateState --export stateCount
```

`-o` must occur once, and at least one source and one export are required.
Repeated export names are rejected. A function can take zero or more
runtime arguments and return a natural or an aggregate. Exported values
are called with zero arguments. For a constructor, provide an ordinary
definition, for example:

```kanon
mu Bytes : Type 0 with
| bytesNil : Bytes
| bytesCons : Nat -> Bytes -> Bytes

def emptyBytes : Bytes := bytesNil
def consBytes : Nat -> Bytes -> Bytes :=
  fun (n : Nat) (tail : Bytes) => bytesCons n tail
```

The existing `emit` and `run` commands retain their original ABI and
output. `build` does not use an application-specific compiler adapter,
rewrite source outside the parser, add trusted kernel forms, or import
operating-system capabilities. The host performs I/O and calls ordinary
exported Kanon functions.

## Host values

The supported Nat boundary is an `i32` in `0..1073741823`. The exported
wrapper checks the incoming unsigned value before creating an i31. It
checks results after extracting the i31. Negative and larger i32 inputs
trap; a computed large Nat also traps at this boundary. Kanon arithmetic
inside the module continues to support arbitrary precision.

JavaScript's raw WebAssembly API coerces arguments to i32 before entering
the wrapper. A JavaScript host must first check `Number.isInteger(value)`
and `0 <= value && value <= 1073741823` if it needs to reject fractions,
NaN, strings, or integers that wrap modulo 2^32. The compiler cannot inspect
the original JavaScript value after this engine conversion.

Aggregates cross as opaque, immutable WasmGC struct references. The host
must preserve and pass these references without reading their payloads.
Even an empty sum has an opaque handle. Separate erased representations
receive distinct wrapper struct shapes. The WebAssembly function
signature and an explicit cast reject null, arbitrary JavaScript objects,
numbers, and handles of another representation before the typed payload
is read. A result is stored in its typed envelope. These are runtime
representation distinctions, not a nominal type or per-instance identity
guarantee across independently compiled modules. Host function and thunk
values are not supported.

```js
const { instance } = await WebAssembly.instantiate(wasmBytes);
const e = instance.exports;
const bytes = e.consBytes(65, e.emptyBytes());
```

## Byte literals

`b"text"` expands in the standard parser to ordinary calls of
`bytesCons BYTE TAIL`, ending in `bytesNil`. The program supplies those
names, so literals have the same checked semantics as handwritten
constructor applications. Source UTF-8 is preserved byte for byte.
Supported escapes are `\n`, `\r`, `\t`, `\0`, `\\`, `\"`, and exactly two
hexadecimal digits after `\x`. Literal source newlines, unknown escapes,
invalid hexadecimal escapes, and missing closing quotes are parse errors.
There is no new kernel type or primitive.

## Generic OS runtime

`runtime/reactor.mjs` exports `runReactor(wasmPath, argv)` for Node with
WebAssembly GC support. It drives a pure Kanon state machine using these
ordinary exports:

```text
emptyBytes, consBytes, bytesEmpty, bytesHead, bytesTail
emptyWords, consWords, wordsEmpty, wordsHead, wordsTail
init, resume, requestCode, requestArgs, requestBody, exitCode
```

`init` receives argv as a list of byte strings and returns opaque state.
Request accessors return an operation number, a list of byte strings, and
payload bytes. `resume(state, status, answer)` receives status 0 on success
or 1 with an error string and returns the next state. Operation 0 ends the
loop with `exitCode(state)` unless an interruption is latched, in which
case it preserves the signal status. The runtime never interprets
application state. Empty-list predicates return 1 for empty and 0 otherwise.
The host validates each `bytesEmpty` and `wordsEmpty` result before using it
to traverse request arguments or payload bytes. Any other result ends the run
with `kanon reactor: invalid ABI predicate NAME: expected 0 or 1` and exit 2.
The malformed request performs no host operation and receives no `resume`
call. This check also applies after reading earlier elements of a list;
operation 0 still terminates without reading either list. See the
[list predicate regressions](dev/LIST-ABI.md).

Each nonterminal request may traverse at most 1048576 nonempty list nodes.
The count includes one node per argument and one per byte in all arguments
and the payload, sharing one budget across the complete request. Empty-list
checks do not consume nodes. The budget resets for each request, and repeated
references count on every visit. A request exactly at the limit is accepted.
The next nonempty node ends the run with
`kanon reactor: reactor request exceeds 1048576 list nodes` and exit 2,
before dispatch or `resume`. This bounds cycles and accessors that keep
returning fresh nodes, provided each accessor call returns. It does not bound
execution inside a Wasm export or the number of requests in a run. The host
does not depend on handle identity, which export wrappers need not preserve.
See the [request traversal regressions](dev/REQUEST-BOUNDS.md).

`runtime/reactor.kan` supplies the ordinary `Bytes` and `Words` inductive
types and the ten list exports above. `Bytes` is a list of naturals used
for bytes, and `Words` is a list of `Bytes`. Every element of a `Bytes`
list that the host reads must be 0..255. A larger element ends the run with
the `kanon reactor:` line and exit 2, like a rejected OS string argument,
and never reaches the state machine as an answer. It also defines
`bytesAppend : Bytes -> Bytes -> Bytes` for building response text. Compile
this source before an application that uses these definitions. The helper
is available inside the module and need not be exported to the host.
`bytesAppend` traverses its left list twice using structural tail calls,
so the emitted module uses constant Wasm call-stack space. It allocates
two list nodes per left element and shares the right list. This permits
appending a full 65536-byte answer from operation 2 without growing the
call stack with the answer length. Time and allocation remain linear in
the left list's length.

| Operation | Arguments | Result |
| --- | --- | --- |
| 1 | root, prefix | Create a private temporary directory; return its absolute path |
| 2 | path, offset, length | Read at most 65536 raw bytes |
| 3 | path; payload is content | Atomically replace a private file |
| 4 | stdout path, stderr path, cwd, timeout ms, executable, argv... | Execute directly with captured streams and wait |
| 5 | path | Return regular-file size in decimal |
| 6 | payload is content | Write stdout |
| 7 | payload is content | Write stderr |
| 8 | path | Resolve an existing path through realpath |
| 9 | base, path | Resolve a path relative to a base |
| 10 | instance, witness | Write a proof slot; return its index |
| 11 | slot, instance, relation | Return 1 when the stored instance matches and the relation holds, else 0 |
| 12 | level, plaintext | Write a ciphertext slot; return its index |
| 13 | level, f, slot | Write the evaluated slot at the level; return its index |
| 14 | slot | Return the plaintext of a ciphertext slot |
| 15 | plaintext | Write a share slot; return its index |
| 16 | subset, f, slot... | Write the joint slot; return its index |
| 17 | slot | Return the plaintext of a share slot |
| 18 | slot | Release a host blob slot; return an empty answer |
| 19 | path | Unlink a file or symlink; return an empty answer |
| 20 | path | Remove an empty directory; return an empty answer |
| 21 | source, destination | Rename a file, symlink or directory; return an empty answer |
| 22 | path | List direct entry names in byte order, each followed by NUL; at most 65536 bytes |
| 23 | path | Inspect an entry with lstat; return file, directory, symlink or other |
| 24 | path | Read a symlink's stored target as raw bytes; at most 65536 bytes |
| 25 | target, destination | Create a symlink without replacing an existing entry; return an empty answer |

Operations 1 to 25 check argument counts before performing the operation.
Each fixed row requires exactly the listed arguments. Operation 4 requires
at least five arguments, including the executable; further arguments are
passed to that executable. Operation 16 requires a subset, a function code
and at least one share slot. A request whose arguments decode, but whose
count is missing or surplus, returns status 1 through `resume`, before any
filesystem operation, output write, process spawn, slot allocation or release. The
error identifies the operation, expected count and supplied count. An
argument that the host cannot decode ends the run with the `kanon reactor:`
line and exit 2, as above, and the count check does not run. Operation 0 terminates without reading arguments or body.
The [request arity regressions](dev/REQUEST-ARITY.md) cover the original rows;
the [cleanup regressions](dev/FILE-CLEANUP.md) extend the matrix through operation 20,
the [rename regressions](dev/FILE-RENAME.md) cover operation 21,
the [directory listing regressions](dev/DIRECTORY-LISTING.md) cover operation 22,
the [entry kind regressions](dev/ENTRY-KIND.md) cover operation 23,
the [symlink target regressions](dev/SYMLINK-TARGET.md) cover operation 24,
and the [symlink creation regressions](dev/SYMLINK-CREATE.md) cover operation 25.
The [release regressions](dev/BLOB-RELEASE.md) cover the behavior of operation 18.

Operations 19 and 20 let a reactor clean up its files and temporary directories.
Each requires exactly one path and returns status 0 with empty bytes on success.
Operation 19 uses `unlink`: it removes a file or the final symlink itself and
refuses directories. Operation 20 uses `rmdir`: it removes an empty directory,
refuses files and final symlinks, and never removes directory contents recursively.
These path-kind and symlink rules are the POSIX rules. Windows was not exercised.
Missing paths return status 1 with `ENOENT`; other filesystem failures return
status 1 with the OS error code and message. The program decides whether a missing
path counts as already cleaned up. Relative paths use the host working directory;
parent symlinks follow normal OS path resolution. Applications choose the paths
and own their cleanup order. These operations are not restricted to paths that
the reactor created, and they are not a filesystem sandbox. See [the cleanup regressions](dev/FILE-CLEANUP.md).

Operation 21 calls the OS `rename` operation with exactly two paths. It returns
status 0 with an empty answer on success, or status 1 with the OS error code
and message on failure. It can move an existing file or directory between
existing parent directories. It does not create destination parents or fall
back to copying and deleting when the OS refuses the move, including `EXDEV`
across filesystems. Its payload is unused.

Under POSIX rules, a source file can replace a destination file, and a source
directory can replace an empty destination directory. A nonempty destination
directory or incompatible path kinds are refused. A final source symlink moves
as a link; a final destination symlink is replaced as a link. Their targets are
not moved or overwritten. Parent symlinks follow normal OS resolution, relative
paths use the host working directory, and a rename to the same file is a successful
no-op. Operation 21 retains the filesystem's rename atomicity, without a
durability guarantee across a crash. Applications choose both paths; no sandbox
or restriction to reactor-created paths is added. The
[rename regressions](dev/FILE-RENAME.md) cover macOS; Windows was not exercised.

Operation 22 lists the direct entries of one directory. The successful answer
contains each raw entry name followed by one NUL byte, including the last name.
An empty directory answers with empty bytes. Names are sorted lexicographically
by unsigned byte value, without locale rules, UTF-8 decoding or escaping.
Hidden entries, directories and symlinks are included; `.` and `..` are omitted.
Entry names have no path prefix, and the host does not descend into entries or
follow their symlink targets. A requested directory path can itself contain or
end in a symlink, which follows normal OS resolution. Relative paths use the
host working directory. The request payload is unused.

The complete answer may contain at most 65536 bytes, including every NUL.
Exactly that size succeeds. A larger listing returns status 1 with
`IO: directory listing exceeds maximum OS chunk size`, with no partial listing.
Entries are read incrementally; the host stops when the answer would exceed
the limit and closes the directory handle on success or failure. Missing paths,
non-directory paths and other OS errors also return status 1 through `resume`.
The directory can change while it is read; this operation promises neither a
filesystem snapshot nor pagination. Raw non-UTF-8 entry bytes are preserved in
answers, but later path arguments still obey the existing UTF-8 and NUL rules.
See the [directory listing regressions](dev/DIRECTORY-LISTING.md).

Operation 23 inspects one filesystem entry with `lstat`. On success it returns
status 0 and exactly one ASCII word: `file`, `directory`, `symlink` or `other`,
without a newline or NUL terminator. `other` covers special entries such as
devices, FIFOs and sockets. The operation does not open the entry or read its
contents, and its payload is unused. A final symlink named directly is reported
as `symlink`, including a dangling link or a link to itself.

Paths are passed to the OS without lexical normalization. Parent symlinks
follow normal OS resolution, and relative paths use the host working directory.
On POSIX, a trailing separator requires directory resolution and can follow a
directory symlink. To inspect the link itself, name it without trailing path
components. Missing paths, non-directory parent components and other OS failures
return status 1 with their error code and message; a missing path is not `other`.
Invalid UTF-8 and NUL in a path retain the existing exit-2 behavior before dispatch.
This operation observes the entry at inspection time; later requests may see a
changed filesystem. See the [entry kind regressions](dev/ENTRY-KIND.md).

Operation 24 reads one symlink with `readlink`. On success it returns status 0
and the stored target bytes without a newline or NUL terminator. Relative
targets, dot segments and non-UTF-8 bytes are preserved. The host does not
resolve the target or require it to exist, so directly named dangling links,
chains and self-referential links can be read. The request payload is unused.

The path argument follows the existing UTF-8 and NUL rules and is passed to
the OS without lexical normalization. Relative paths use the host working
directory; parent components and trailing separators follow OS resolution.
Name the link without trailing components to read the link itself. Missing
paths, entries that are not symlinks and other OS failures return status 1
with their error code and message. A target of exactly 65536 bytes succeeds;
a larger target returns status 1 with
`IO: symlink target exceeds maximum OS chunk size`, without a partial target.
Raw target bytes that fail the OS string rules cannot be reused as path
arguments. The [symlink target regressions](dev/SYMLINK-TARGET.md) cover these
responses and successful requests after an error.

Operation 25 calls `symlink(target, destination)` and returns status 0 with an
empty answer on success. Both arguments must be NUL-free UTF-8. The payload is
unused. On POSIX, the stored target retains its bytes, including relative paths,
dot segments, repeated separators and newlines. The target need not exist:
dangling links, chains and self-referential links can be created. Relative
targets are interpreted from the link's parent when the link is later followed.
The operation does not create or modify a target entry.

The destination is passed to the OS without lexical normalization. Relative
destinations use the host working directory; parent symlinks and trailing
separators follow OS resolution. The parent directory must exist. An existing
destination, including a dangling symlink, reports an OS error without replacing
it. Missing parents, non-directory parents and other OS failures return status 1
with their error code and message. Empty targets are passed to the OS, whose
acceptance varies by platform. The call uses Node's default symlink behavior.
Validation covers macOS; Windows was not exercised. The
[symlink creation regressions](dev/SYMLINK-CREATE.md) exercise operation 25
through the request loop and a compiled Wasm fixture.

Operation 1 resolves the root against the host working directory, creates it
if needed, and creates a fresh private directory directly inside it. The
prefix is literal filename text: empty, `.` and `..` prefixes are accepted
and get the random suffix inside the root. A prefix containing `/` or `\`
returns status 1 through `resume` with
`IO: temporary directory prefix must not contain path separators`, before
creating the root or any temporary directory. The host normalizes the root
text lexically before any filesystem access, so a `..` segment removes the
name before it. The host does not follow a symlink and does not test that
the removed name exists. The OS follows symlinks only for the components
that stay after the normalization.
The [temporary-directory regressions](dev/TEMP-DIRECTORY.md)
cover parent placement, literal prefixes, uniqueness and private permissions.

Operations 10 to 17 are the veil host operations. A blob is a slot that holds
a flag and a plaintext. The flag holds the instance for the zk operations, the
level for the fhc operations, and the party flag for the mpc operations. The
party flag is the constant 0 in version one. Operation 10 `zk-prove` writes a
slot that holds the instance and the witness and answers its index. Operation
11 `zk-verify` reads a proof slot and an instance. It answers 1 only when
the supplied instance equals the stored instance and the witness satisfies
the relation. An instance mismatch answers 0 without applying the relation;
the host twin rejects an unknown relation code first. On the host side the
relation answers a natural number, and the verdict is 1 only when that number
equals the supplied instance, so the table below holds arithmetic functions,
not predicates. The relation itself is supplied at verification and is not
stored in the slot.
Operation 12 `fhc-enc` writes a slot that holds the level and the plaintext and
answers its index. Operation 13 `fhc-eval` reads a slot, applies `f`, writes a
new slot at the given level, and answers its index. Operation 14 `fhc-dec`
reads a slot and answers the plaintext. Operation 15 `mpc-input` writes a slot
that holds the party flag and the plaintext and answers its index. Operation 16
`mpc-share` reads the subset and the argument slots, applies `f` to their
plaintexts in order, writes a new slot, and answers its index; this operation
is the joint computation over shares, not the surface word `share`. Operation
17 `mpc-open` reads a slot and answers the plaintext.

`runtime/reactor.kan` defines the eight operations as the ordinary Kanon
functions `zkProve`, `zkVerify`, `fhcEnc`, `fhcEval`, `fhcDec`, `mpcInput`,
`mpcShare` and `mpcOpen`, which the erased veil programs call. That twin holds
a slot as an ordinary `Slot` value and applies `f` as a Kanon function value,
so operations 13 and 16 apply `f` in WebAssembly. The relation of `zkVerify`
answers the two leg sum that the primitives answer, and leg 1 is true, so the
verdict is 1 for leg 1 and 0 for leg 0. `runtime/reactor.mjs` holds
the host side of the same slot layout in a slot store, and a slot index is a
decimal byte string like every other numeric argument. A function value cannot
cross the request boundary, which carries byte strings only, and the runtime
adds no export for one, so the host twin names `f` and the relation with a code
into a fixed table: 0 is the sum, 1 is the product, 2 is the square of the sum,
and 3 is the successor of the sum. Neither twin has security. They exist to
test the ABI and the three postulates.

The instance, witness, level and plaintext arguments of operations 10 to 17
are arbitrary-precision naturals. They must be nonempty ASCII decimal digit
strings. Leading zeros are accepted; plaintext results use canonical decimal
digits. Signs, spaces, fractions, exponent notation and alternate bases are
rejected with status 1 through `resume`, without allocating a slot. The
JavaScript slot store holds flags and plaintexts as `BigInt`, and all four
host arithmetic functions preserve exact results beyond both the i31 and
safe-integer limits. Slot indices, function codes and the subset count of
operation 16 still use safe integers. The direct numeric WebAssembly export
ABI still requires i31 values; large slot data crosses the host request
boundary as bytes. [Validation](dev/HOST-NAT.md) exercises both paths.

Each `runReactor` invocation owns a fresh slot store. Slot indices start at 1,
increase with each allocation, and refer only to that invocation, even when
multiple runs overlap in one JavaScript process. Starting, completing or
failing another run cannot clear or overwrite its slots. The module no longer exports the former global `blobs`
map, and no run can read or clear the slots of another run.
The [isolation regressions](dev/BLOB-ISOLATION.md) cover proof verification,
ciphertext evaluation and joint share computation across overlapping runs.

Operation 18 releases a live slot from the JavaScript host store. It takes
exactly one safe-integer decimal slot index and answers status 0 with empty
bytes on success. An unknown or previously released index answers status 1
with `IO: unknown blob slot INDEX`. Releasing a slot leaves other live slots
and already computed results intact. Future allocations never reuse released
indices within that invocation, including after the store becomes empty.
Allocation beyond index 9007199254740991 answers status 1 with
`IO: blob slot index exhausted` and creates no slot. Release remains available.

A program can release proofs, ciphertexts and shares once it no longer needs
them. Retaining a copy of the index does not keep the slot alive. Release
removes the host's reference so its stored data can be garbage collected;
it does not promise memory wiping or immediate memory reclamation. This
operation manages the JavaScript host store. The Wasm twin uses ordinary
`Slot` values whose lifetime is managed by WasmGC. See [BLOB-RELEASE.md](dev/BLOB-RELEASE.md).

OS numeric arguments use decimal byte strings and must fit a JavaScript safe
integer. Timeouts additionally fit `0..2147483647`. A timeout of 0 sets no
deadline. OS string arguments must be valid UTF-8: a byte string that a UTF-8
round trip would change is rejected, never silently substituted. A rejected
argument ends the run with an error, not a resume. Operation 4
returns five NUL-separated fields: exit code, signal number, timeout flag,
interruption flag, and spawn error text. Flags use 0 or 1. Timeout exits use 124
and spawn failures use 127. The deadline governs the leading command only, so a
leader that exits first reports its own status. Commands inherit the environment
with closed stdin. On POSIX the runtime tracks a process group, escalates
termination after 250 ms, and waits at most 250 ms for the remaining group
members after the leader exits. It then kills the group, so no deadline leaves
the call waiting without end. Descendants that create another session are
outside that group. Process and filesystem failures are returned to the Kanon
state machine.

A SIGINT or SIGTERM during the run is latched. Operation 4 stops the command it
is running and sets the interruption flag of its response. That one report earns
the program a single further request, so it can write a summary or release what
it holds. The loop then stops and returns 128 plus the signal number. A signal
latched during any other operation stops the loop before the next request, with
the same status. If the further request is terminal operation 0, it also returns
the latched status, even when the application reports exit code 0. The module
also exports `spawns`, a counter of started processes that the suite reads to
observe that no command began.

The driver performs OS operations and byte marshalling only. Applications own
their argument parsing, paths, serialization, selection, and resource policies.
This is a host adapter, not an effect primitive or kernel extension.

## Running a reactor application

`examples/reactor-realpath.kan` accepts exactly one path. It requests
operation 8 to resolve the path, then writes the result and a newline to
stdout through operation 6 and exits 0. A resolution failure writes the
host's error and a newline to stderr through operation 7 and exits 1.
A failed output write also makes an otherwise successful run exit 1.
Zero or multiple arguments print usage on stderr and exit 64.

From the repository root, build the compiler and compile the shared source
followed by the application, exporting all 16 functions required by the host:

```sh
zsh dev/dune.sh build bin/kanon.exe
_build/default/bin/kanon.exe build runtime/reactor.kan \
  examples/reactor-realpath.kan -o /tmp/reactor-realpath.wasm \
  --export emptyBytes --export consBytes \
  --export bytesEmpty --export bytesHead --export bytesTail \
  --export emptyWords --export consWords \
  --export wordsEmpty --export wordsHead --export wordsTail \
  --export init --export resume --export requestCode \
  --export requestArgs --export requestBody --export exitCode
node runtime/run.mjs /tmp/reactor-realpath.wasm .
```

The CLI syntax is `node runtime/run.mjs MODULE.wasm [ARG ...]`. A missing
module argument prints usage on stderr and exits 64. A sole `--help`
prints usage on stdout and exits 0. Every argument after the module path
is passed literally to the application, including `--help`. The process
keeps the caller's working directory, so relative application paths are
resolved there.

The CLI returns the application's exit code or the runtime's interruption
status. That code is a whole number in 0..255, the range a POSIX status
holds. A code outside the range never reaches the shell, which would
truncate it: the CLI prints the `kanon reactor:` line and exits 2.
Module loading and runtime errors print one `kanon reactor: MESSAGE`
line on stderr and exit 2. Requested OS operation failures are delivered
to the state machine, which chooses its response and exit code. A failed
operation 6 or operation 7 write is such a failure: a closed pipe reaches
the state machine as status 1 with the host's error text, not as a crash.
A usage write that fails prints the same `kanon reactor:` line and exits 2,
because no application is running yet.

## Validation

From the compiler repository root:

```sh
zsh dev/dune.sh build bin/kanon.exe test/main.exe test/wasm.exe test/sl_surface.exe
node dev/reactor-test.mjs
node --test dev/runtime-test.mjs
_build/default/test/main.exe
_build/default/test/wasm.exe
_build/default/test/sl_surface.exe
```

The gate battery runs both suites as its REACTOR and RUNTIME legs, after
AGREEMENT, so a break in the compiler surface or in the host runtime turns
the battery red.

The installed `dunecho` only accepts one mode argument, so
`dev/dunecho.sh build bin/kanon.exe` cannot express a scoped build. The
existing `dev/dune.sh` runner uses the same OCaml switch. `dunecho test`
builds the test executables, but the existing fixture suites need the
repository root as their working directory instead of Dune's sandbox.
The focused reactor suite builds its fixtures through the normal CLI,
checks the ABI in Node, rejects invalid arguments and literals, and
compares a legacy emitted module byte for byte with its checked-in
artifact. Its multi-file and negative fixtures live in
`test/fixtures/reactor/`, outside the legacy suite's flat golden set.
It also compiles the shared reactor source and realpath application and
runs the CLI against a relative UTF-8 path, a missing path, wrong argument
counts and a literal `--help` path. CLI usage, help, missing modules and
missing required exports are checked separately. The runtime suite checks
that terminal operation 0 preserves both normal application exits and
latched SIGINT or SIGTERM status.
