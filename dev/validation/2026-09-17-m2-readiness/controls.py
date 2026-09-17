"""Check that the CLI batch regression suite detects three failure modes."""

import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]
source = (ROOT / 'dev/cli-batch.mjs').read_text()
tests = (ROOT / 'dev/cli-batch-test.mjs').read_text()


def replace_once(old, new):
    assert source.count(old) == 1, old
    return source.replace(old, new, 1)


variants = {
    'baseline': source,
    'zero-exit': replace_once(
        'status: child.killed ? null : error ? (Number.isInteger(error.code) ? error.code : null) : 0,',
        'status: 0,'),
    'hide-timeout': replace_once('status: child.killed ? null : error ?', 'status: error ?'),
    'early-reject': (
        'const waitAll = promises => Promise.all(promises.map(promise => '
        "promise.then(value => ({ status: 'fulfilled', value }))));\n"
        + replace_once('Promise.allSettled(', 'waitAll(')),
}
results = {}
for name, contents in variants.items():
    with tempfile.TemporaryDirectory(prefix='kanon-cli-control-') as directory:
        work = Path(directory)
        (work / 'cli-batch.mjs').write_text(contents)
        (work / 'cli-batch-test.mjs').write_text(tests)
        run = subprocess.run(['kanoncho', 'test', str(work / 'cli-batch-test.mjs')],
                             cwd=ROOT, capture_output=True, text=True, timeout=30)
        results[name] = {
            'exit_code': run.returncode,
            'source_sha256': hashlib.sha256(contents.encode()).hexdigest(),
            'stdout': run.stdout,
            'stderr': run.stderr,
        }
passed = results['baseline']['exit_code'] == 0 and all(
    result['exit_code'] == 1 for name, result in results.items() if name != 'baseline')
print(json.dumps({
    'passed': passed,
    'test_sha256': hashlib.sha256(tests.encode()).hexdigest(),
    'variants': results,
}, indent=2))
raise SystemExit(0 if passed else 1)
