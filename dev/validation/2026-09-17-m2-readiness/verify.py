"""Verify the gate inputs, final handoff files and retained captures."""

import hashlib
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


gate_sources = json.loads((HERE / 'gate-sources.json').read_text())
final_sources = json.loads((HERE / 'final-sources.json').read_text())
sources = {**gate_sources, **final_sources}
# The final pin supersedes the gate pin on a shared key.  Report the keys that
# moved, because the declared post-gate document edits are not an error.
gate_drift = sorted(name for name, expected in gate_sources.items()
                    if name in final_sources and final_sources[name] != expected)
captures = json.loads((HERE / 'captures.json').read_text())
errors = [{'source': name} for name, expected in sources.items() if digest(ROOT / name) != expected]
errors += [{'capture': name} for name, expected in captures.items() if digest(HERE / name) != expected]
actual = {str(path.relative_to(HERE)) for path in HERE.rglob('*') if path.is_file()}
for name in sorted(actual ^ (set(captures) | {'captures.json'})):
    errors.append({'capture_inventory': name})
stdout = (HERE / 'gates-after.stdout').read_text()
rows = re.findall(r'^MEASURE (\S+) tier=\S+ elapsed_ms=[\d.]+ exit=(\d+)$', stdout, re.M)
if len(rows) != 27 or len({name for name, code in rows}) != 27 or any(code != '0' for name, code in rows):
    errors.append({'gate_measurements': rows})
if not stdout.endswith('GATES-OK\n'):
    errors.append({'gate_verdict': 'missing'})
controls = json.loads((HERE / 'controls.stdout').read_text())
if not controls['passed'] or controls['test_sha256'] != digest(ROOT / 'dev/cli-batch-test.mjs'):
    errors.append({'controls': 'failed or stale'})
if controls['variants']['baseline']['source_sha256'] != digest(ROOT / 'dev/cli-batch.mjs'):
    errors.append({'controls': 'helper source differs'})
print(json.dumps({'passed': not errors, 'gate_sources': len(gate_sources), 'final_sources': len(final_sources),
                  'gate_drift': gate_drift, 'captures': len(captures), 'errors': errors}))
raise SystemExit(0 if not errors else 1)
