"""Check link ownership regressions against isolated runtime defects."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
repo = Path(__file__).resolve().parents[3]
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=False)
source = (repo / 'runtime/reactor.mjs').read_text()
tests = (repo / 'dev/runtime-test.mjs').read_bytes()
operation = '''    case 46: {
      const uid = ownerId(args[1]);
      const gid = ownerId(args[2]);
      await lchown(args[0], uid, gid);
      return Buffer.alloc(0);
    }
'''
call = 'await lchown(args[0], uid, gid);'
variants = [
    ('positive', None, None),
    ('missing-operation', operation, ''),
    ('missing-arity', ', 3, 3, 3];', ', 3, 3];'),
    ('follow-target', call, 'await chown(args[0], uid, gid);'),
    ('swap-ids', call, 'await lchown(args[0], gid, uid);'),
    ('normalize-path', call, 'await lchown(resolve(args[0]), uid, gid);'),
    ('update-before-validation', operation, operation.replace(
        'const gid = ownerId(args[2]);',
        'await lchown(args[0], uid, 0); const gid = ownerId(args[2]);')),
    ('allow-sentinel', 'id > 4294967294', 'id > 4294967295'),
]
results = []
for name, old, new in variants:
    changed = source
    if old is not None:
        assert source.count(old) == 1, (name, 'mutation must have one exact site')
        changed = source.replace(old, new, 1)
    with tempfile.TemporaryDirectory(prefix='veil-lchown-control-') as directory:
        work = Path(directory)
        (work / 'runtime').mkdir()
        (work / 'dev').mkdir()
        (work / 'runtime/reactor.mjs').write_text(changed)
        (work / 'dev/runtime-test.mjs').write_bytes(tests)
        command = ['node', '--test', '--test-reporter=tap', '--test-name-pattern=^file lchown ',
                   'dev/runtime-test.mjs']
        done = subprocess.run(command, cwd=work, capture_output=True, text=True, timeout=30)
        counts = {}
        for key in ['pass', 'fail', 'skipped']:
            match = re.search(r'^# ' + key + r' (\d+)$', done.stdout, re.M)
            assert match is not None, (name, key, done.stdout, done.stderr)
            counts[key] = int(match.group(1))
        record = {'argv': command, 'cwd': str(work), 'exit_code': done.returncode,
                  'watchdog_ms': 30000, 'stdout': done.stdout, 'stderr': done.stderr,
                  'stdout_sha256': hashlib.sha256(done.stdout.encode()).hexdigest(),
                  'stderr_sha256': hashlib.sha256(done.stderr.encode()).hexdigest()}
        (output / f'{name}.json').write_text(json.dumps(record, indent=2) + '\n')
        if name == 'positive':
            assert done.returncode == 0 and counts == {'pass': 9, 'fail': 0, 'skipped': 0}, record
        else:
            assert done.returncode != 0 and counts['fail'] > 0 and 'ERR_ASSERTION' in done.stdout, record
        results.append({'name': name, 'old': old, 'new': new, 'exit_code': done.returncode,
                        'passed': counts['pass'], 'failed': counts['fail'], 'skipped': counts['skipped'],
                        'runtime_sha256': hashlib.sha256(changed.encode()).hexdigest()})
        print(f'{name}: exit={done.returncode} counts={counts}', flush=True)
report = {'source_sha256': {
    'runtime/reactor.mjs': hashlib.sha256(source.encode()).hexdigest(),
    'dev/runtime-test.mjs': hashlib.sha256(tests).hexdigest()}, 'controls': results}
(output / 'controls.json').write_text(json.dumps(report, indent=2) + '\n')
print(f'positive passed; {len(results) - 1} defect controls failed assertions', flush=True)
