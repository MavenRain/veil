# Closed proposition translation validation, 2026-09-17

Base: `bd610e6451a94f6931238e55da552d5a35e0487d`.
Commands ran in `/Users/oobi/Documents/gpt3/veil-m2-prop`, an isolated copy
of the clean Veil checkout. The checker was reused from that base after
matching every source hash and its binary hash against the committed
`dev/m2-translation/results.json`. The retained checker hash is
`ba114dff6ab0e6f38753321393c0502c76b4937ff9896989ee962498e94a4ed0`.
No new compiler build is claimed. Compiler and runtime sources are unchanged.

| Capture | Command | Result |
| --- | --- | --- |
| translation-tests | `python3 -I dev/m2-translate-test.py --live` | 33 passed, six live integrations |
| declaration-tests | `python3 -I dev/m2-declarations-test.py` | 30 passed, two skipped |
| record | `python3 -I dev/m2-translate.py record --output dev/m2-translation-prop-candidate` | exit 0 |
| live | `python3 -I dev/m2-translate.py verify --live` | exit 0 |
| house | `zsh dev/house.sh` | HOUSE OK |
| trusted-lines | `zsh dev/trusted-lines.sh` | kernel 5246/5250, encoder 246/600 |
| parity-gate | `python3 -I dev/m2-parity.py gate` | expected exit 1 |

The verified candidate record was promoted to `dev/m2-translation` before
the final suite and live verification. It retains all 44 exported names,
with five rechecked declarations and 39 explicit gaps. `True` and its
constructor share the new artifact. These finite sample results credit no
full-inventory parity successes: the 51,980-name baseline and its gate remain
open. The inventory, exporter and Lean sources are unchanged.

Synthetic inputs additionally exercise empty families and theorem bodies.
The live proof test requires direct, implication and let-bound proofs to
erase. It requires a proof consumer to have no runtime proof argument and
checks its computed result by indexed-family conversion. Changing that
expected result to zero fails. A false proof fails. A data-valued theorem
fails its generated `Prop` guard; removing that guard makes the same data
definition pass. The suite also checks that opaque proof dependencies stay
gaps and that one failed artifact does not suppress the other family's
successful checks.

Run from the repository root:

```sh
python3 -I dev/validation/2026-09-17-m2-prop/verify.py
python3 -I dev/m2-translate.py verify --live
```

The first command checks exact source and capture sets, hashes, commands,
statuses, test counts, gate results and the sample's offline verification.
The second needs a built checker and reruns its kernel, erasure and axiom
checks. Build with `zsh dev/dunecho.sh build` if a checker is unavailable.
Captures are copied without editing; their manifests retain the original
absolute working directory and artifact paths. Hashes detect alteration
relative to this record, not a self-consistent rewrite of all evidence.

The final capture sources were frozen while their checks ran. Earlier
diagnostics remain in the workspace's `.kanon-exec` directory. An initial
baseline attempt overlapped translator edits and failed its fingerprint
check; it is excluded from the final validation evidence. Two later test
corrections fixed an expected diagnostic and a one-artifact test fixture.
No full M1 gate ladder, Lean re-export, timing claim, general proof
preservation or M2 exit is claimed. Documentation and this record were
assembled after the final executable checks.
