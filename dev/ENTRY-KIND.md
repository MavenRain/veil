# Filesystem entry kinds

Operation 23 accepts exactly one path and inspects it with `lstat`. Its status-0
answer is exactly `file`, `directory`, `symlink` or `other`, without a newline or
NUL terminator. Special entries such as devices, FIFOs and sockets are `other`.
The operation reads metadata without opening the entry or reading its contents.
The request payload is unused.

A directly named final symlink reports `symlink` even if its target is missing
or it points to itself. Parent symlinks follow normal OS path resolution.
Relative paths use the host working directory, and no lexical normalization is
applied. Under POSIX rules, a trailing separator requires a directory and can
follow a directory symlink. Name the link without trailing components to inspect
the link itself.

Missing and surplus arguments return status 1 before filesystem access. Missing
paths and other OS failures also return status 1 through `resume`, with the OS
error code and message. A missing entry is an error, never `other`. Invalid UTF-8
and embedded NUL terminate the run before dispatch, using the existing exit-2
path. Inspection is an observation at one point in time, without a guarantee
that a later filesystem operation sees the same entry.

`dev/runtime-test.mjs` exercises the actual request loop with scripted exports
and real filesystem entries. Coverage includes file and directory kinds, relative
paths, Unicode, spaces and newlines, ignored payloads, dangling and cyclic links,
parent links, trailing separators, a character device, arities, path errors,
undecodable arguments and successful requests following an error.

`test/fixtures/reactor/entry-kind.kan` forwards argv to operation 23 and prints
the response with operation 6. Its exit status adds the inspection status and the
stdout write status. `dev/reactor-test.mjs` compiles the fixture into an import-free
Wasm module and runs the CLI against files, directories, links, a device,
malformed arities and missing paths. Each scenario has a successful stdout write,
so those checks exercise the inspection status.

Run the affected checks from the repository root with a built compiler:

```sh
gtimeout 30 node --test --test-reporter=tap dev/runtime-test.mjs
gtimeout 30 node dev/reactor-test.mjs _build/default/bin/kanon.exe
zsh dev/house.sh
zsh dev/trusted-lines.sh
```

The [validation record](validation/2026-09-12-entry-kind/README.md) retains
outputs, source hashes and negative controls. Validation covers macOS with
Node.js v23.10.0. Windows was not exercised.

## Review 2026-09-12 (entry kind)

- C-1, low: the arity note now counts operations 1 to 23 and points to this
  file for row 23. File: `dev/REQUEST-ARITY.md`.
- C-2, low: the record note now states that each capture file holds the argv
  and that the `command` number is an external artifact position. File:
  `dev/validation/2026-09-12-entry-kind/README.md`.
- C-3, low: the controls paragraph now states that the control copies reuse
  the staged test file and that `controls.json` pins the runtime hash only.
  File: `dev/validation/2026-09-12-entry-kind/README.md`.
- C-4, low: the unchanged-sources sentence now claims only the staged path
  list and states that gate-script hashes are outside the record. File:
  `dev/validation/2026-09-12-entry-kind/README.md`.
- GATE-1, high: not fixed. The two compiler benchmark legs M0-TIME and
  M0-RATIO are red under machine load, and this slice stages no compiler,
  no kernel and no gate source.

Round 1 corrected C-1 in `dev/REQUEST-ARITY.md` and C-2, C-3 and C-4 in the
validation record README. Round 2 changed no file and returned GATE-1 as a
machine-timing item.

The final ladder is
[gates-review.log](validation/2026-09-12-entry-kind/gates-review.log), tag
fix-2, with 26 PASS rows and 2 FAIL rows. The check loop closed with no
waiver text. The red legs are
`FAIL M0-TIME median_ms=282.632 bound_ms=150 load1=19.086` and
`FAIL M0-RATIO ratio=2.989319 bound=2.000 load1=19.086`. The waiver
threshold stays load1 above 25. The RUNTIME 89 of 89 line, the five new
entry kind tests, `reactor: 390 checks passed` and HOST-NAT 16/16 are never
waived by load, and all of them are green in that log.
