"""Run isolated allocation controls without changing this checkout."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[3]
output = args.output.absolute()
if output.exists() or output.is_symlink():
    parser.error('output must be a new directory')
base = '07ebd5c25ea469d1109608d679f4cd95440040b9'
runtime = (root / 'runtime/reactor.mjs').read_text()
tests = (root / 'dev/runtime-test.mjs').read_bytes()
arm = '''    case 40: {
      const info = await stat(args[0], { bigint: true });
      return Buffer.from(`${info.blocks}:${info.blksize}`);
    }'''
assert runtime.count(arm) == 1
arity = re.search(r'^const requestArities = \[([^\n]+)\];$', runtime, re.MULTILINE)
assert arity is not None
arities = arity[1].split(', ')
assert len(arities) == 41 and arities[-1] == '1'
base_runtime = subprocess.check_output(['git', '-C', str(root), 'show', f'{base}:runtime/reactor.mjs']).decode()
variants = [('positive', runtime), ('base-runtime', base_runtime)]
mutations = {
    'swapped-fields': arm.replace('${info.blocks}:${info.blksize}', '${info.blksize}:${info.blocks}'),
    'wrong-count-field': arm.replace('info.blocks', 'info.size'),
    'wrong-size-field': arm.replace('info.blksize', 'info.ino'),
    'rounded-count': arm.replace('${info.blocks}', '${Number(info.blocks)}'),
    'rounded-size': arm.replace('${info.blksize}', '${Number(info.blksize)}'),
    'multiply-fields': arm.replace('${info.blocks}', '${info.blocks * info.blksize}'),
    'omit-bigint': arm.replace(', { bigint: true }', ''),
    'inspect-symlink': arm.replace('await stat(', 'await lstat('),
    'normalize-path': arm.replace('stat(args[0],', 'stat(resolve(args[0]),'),
    'extra-stat': arm.replace('${info.blksize}', '${(await stat(args[0], { bigint: true })).blksize}'),
    'omit-separator': arm.replace('${info.blocks}:${info.blksize}', '${info.blocks}${info.blksize}'),
    'open-contents': arm.replace('      return Buffer', "      await (await open(args[0], 'r')).close();\n      return Buffer"),
    'read-contents': arm.replace('      return Buffer', '      await readFile(args[0]);\n      return Buffer'),
    'reject-zero': arm.replace('      return Buffer', "      if (info.blocks === 0n || info.blksize === 0n) throw new Error('zero allocation');\n      return Buffer"),
}
assert all(changed != arm for changed in mutations.values())
variants.extend((name, runtime.replace(arm, changed)) for name, changed in mutations.items())
variants.append(('omit-arity', runtime.replace(arity[0],
    'const requestArities = [' + ', '.join(arities[:-1]) + '];')))
# Exclusive creation also rejects a path created since the initial check.
output.mkdir(parents=True, exist_ok=False)
records = []
with tempfile.TemporaryDirectory(prefix='veil-allocation-controls-') as temporary:
    work = Path(temporary)
    (work / 'runtime').mkdir()
    (work / 'dev').mkdir()
    for source in (root / 'runtime').glob('*.mjs'):
        shutil.copy2(source, work / 'runtime' / source.name)
    (work / 'dev/runtime-test.mjs').write_bytes(tests)
    for name, source in variants:
        (work / 'runtime/reactor.mjs').write_text(source)
        argv = ['node', '--test', '--test-reporter=tap', '--test-name-pattern=^file allocation ',
                'dev/runtime-test.mjs']
        completed = subprocess.run(argv, cwd=work, capture_output=True, timeout=20, check=False)
        stdout, stderr = completed.stdout.decode(), completed.stderr.decode()
        counts = {key: int(value) for key, value in re.findall(
            r'^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$', stdout, re.MULTILINE)}
        assert stderr == '', (name, stderr)
        assert counts.get('tests') == 8, (name, counts)
        assert all(counts.get(key) == 0 for key in ['cancelled', 'skipped', 'todo']), (name, counts)
        if name == 'positive':
            assert completed.returncode == 0 and counts['pass'] == 8 and counts['fail'] == 0
        else:
            assert completed.returncode == 1 and counts['fail'] > 0, (name, counts)
            assert 'ERR_ASSERTION' in stdout, (name, 'failure was not an assertion')
        record = {'name': name, 'argv': argv, 'cwd': str(work), 'timeout_seconds': 20,
                  'exit_code': completed.returncode, 'counts': counts,
                  'runtime_sha256': digest(source.encode()), 'tests_sha256': digest(tests),
                  'stdout_sha256': digest(completed.stdout), 'stderr_sha256': digest(completed.stderr),
                  'stdout': stdout, 'stderr': stderr}
        (output / f'{name}.json').write_text(json.dumps(record, indent=2) + '\n')
        records.append({key: value for key, value in record.items() if key not in ['stdout', 'stderr']})
        print(f"{name}: exit={completed.returncode} pass={counts['pass']} fail={counts['fail']}", flush=True)
summary = {'base': base, 'runtime_sha256': digest(runtime.encode()), 'tests_sha256': digest(tests),
           'reproducer_sha256': digest(Path(__file__).read_bytes()), 'controls': records}
(output / 'controls.json').write_text(json.dumps(summary, indent=2) + '\n')
print(f'All {len(records) - 1} defect controls rejected; positive control passed.')
