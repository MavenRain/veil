# Monomorphic translation validation, 2026-09-17

Base: `a7534cedeac82d396de8e23058ee6bc990560f65`.
Commands ran in `/Users/oobi/Documents/gpt3/veil-m2-translation`, an isolated
copy of the clean Veil checkout. The compiled checker is a new build from
that copy's unchanged compiler sources. Its binary hash is retained in
`dev/m2-translation/results.json`; the executable is not checked in.

| Capture | Command | Result |
| --- | --- | --- |
| build | `zsh dev/dunecho.sh build` | 0 errors, 0 warnings |
| translation-tests | `python3 -I dev/m2-translate-test.py --live` | 22 passed |
| declaration-tests | `python3 -I dev/m2-declarations-test.py` | 30 passed, 2 skipped |
| record | `python3 -I dev/m2-translate.py record --output dev/m2-translation` | exit 0 |
| live | `python3 -I dev/m2-translate.py verify --live` | exit 0 |
| house | `zsh dev/house.sh` | HOUSE OK |
| trusted-lines | `zsh dev/trusted-lines.sh` | kernel 5246/5250, encoder 246/600 |
| parity-gate | `python3 -I dev/m2-parity.py gate` | expected exit 1 |

The sample records three rechecked names and 41 explicit translation gaps.
Its shared natural-family artifact passes kernel, erasure and empty-axiom
checks. No sample result receives full-inventory parity credit. The baseline
still retains 51,980 names, zero attempts and an open gate.

`results.json` binds each complete capture manifest and stdout/stderr stream,
the source files, documentation, test suite and sample artifacts. Captures
are copied without editing. The manifests retain their original absolute
working directory and capture paths. Source hashes describe the final
candidate; only documentation and this validation bundle were assembled
after the final translation tests and sample capture.

Run from the repository root:

```sh
python3 -I dev/validation/2026-09-17-m2-translation/verify.py
```

The verifier checks exact source and capture sets, hashes, commands, exits,
signals, the recorded test counts and verdicts, and the sample's offline
translation verification. It does not regenerate stored capture outcomes.
To re-run the compiler checks, build with `zsh dev/dunecho.sh build`, then
run `python3 -I dev/m2-translate.py verify --live`. Hashes detect alteration
relative to this record; they do not authenticate a self-consistent rewrite
of all files and fingerprints.

All three live translation tests ran. The declaration suite ran without
`--live`, so its two Lean integrations were skipped. Lean and exporter
sources are unchanged.
The `translation-tests` capture records the suite as it stood at capture
time, 22 tests. The review added four offline tests after the capture, so
the suite now holds 26 tests. The capture was not re-run.
No full M1 gate ladder, timing claim, Lean re-export, language-soundness
proof or M2 exit is claimed. Earlier diagnostic captures remain in the
workspace's `.kanon-exec` directory and are not passing evidence here.
