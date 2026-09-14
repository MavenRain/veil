"""Run deliberate defects in temporary copies; preserve recorded captures."""

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


def replace_once(source, old, new):
    assert source.count(old) == 1, f'Expected one mutation anchor: {old}'
    return source.replace(old, new)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    node = shutil.which('node')
    assert node, 'Node is required'
    source = (root / 'runtime/reactor.mjs').read_text()
    tests = (root / 'dev/runtime-test.mjs').read_bytes()
    base = '9654b0de0b07669b4950fef5fe225254e24520a4'
    baseline = subprocess.check_output(['git', '-C', str(root), 'show',
        base + ':runtime/reactor.mjs']).decode()
    arm = 'case 36: return Buffer.from(String((await stat(args[0], { bigint: true })).birthtimeNs));'
    arities = next(line for line in source.splitlines() if line.startswith('const requestArities ='))
    exact = '^file created preserves exact'
    variants = [
        ('base-runtime', baseline, '^file created', 'Runtime from the base commit lacks operation 36.'),
        ('modification-time', replace_once(source, arm, arm.replace('.birthtimeNs', '.mtimeNs')),
         exact, 'Return modification time instead of the creation-time field.'),
        ('status-time', replace_once(source, arm, arm.replace('.birthtimeNs', '.ctimeNs')),
         exact, 'Return status-change time instead of the creation-time field.'),
        ('rounded-number', replace_once(source, arm,
         'case 36: return Buffer.from(String(Number((await stat(args[0], { bigint: true })).birthtimeNs)));'),
         exact, 'Round the creation timestamp through Number before formatting.'),
        ('omit-bigint', replace_once(source, arm, arm.replace(', { bigint: true }', '')),
         exact, 'Omit the bigint option required for native nanosecond fields.'),
        ('inspect-symlink', replace_once(source, arm, arm.replace('await stat(', 'await lstat(')),
         '^file created', 'Inspect the final symlink instead of following it.'),
        ('omit-arity', replace_once(source, arities, arities.removesuffix(', 1];') + '];'),
         '^file created rejects argument', 'Remove the arity entry for operation 36.'),
        ('normalize-path', replace_once(source, arm, arm.replace('stat(args[0],', 'stat(resolve(args[0]),')),
         exact, 'Lexically normalize paths before native symlink resolution.'),
        ('open-contents', replace_once(source, arm, "case 36: await open(args[0], 'r'); " + arm.removeprefix('case 36: ')),
         exact, 'Open the requested entry before reading its metadata.'),
        ('read-contents', replace_once(source, arm, 'case 36: await readFile(args[0]); ' + arm.removeprefix('case 36: ')),
         exact, 'Read the requested entry before returning creation time.'),
        ('reject-zero', replace_once(source, arm,
         "case 36: { const info = await stat(args[0], { bigint: true }); if (info.birthtimeNs === 0n) throw new Error('unavailable'); return Buffer.from(String(info.birthtimeNs)); }"),
         exact, 'Reject zero instead of preserving the host field.'),
        ('reject-status-fallback', replace_once(source, arm,
         "case 36: { const info = await stat(args[0], { bigint: true }); if (info.birthtimeNs === info.ctimeNs) throw new Error('unavailable'); return Buffer.from(String(info.birthtimeNs)); }"),
         exact, 'Reject equality with ctime instead of preserving the host field.'),
    ]
    assert not args.output.exists(), 'Use a fresh output directory'
    args.output.mkdir(parents=True)
    controls = []
    with tempfile.TemporaryDirectory(prefix='veil-created-controls-') as temporary:
        for name, mutated, pattern, description in variants:
            work = Path(temporary) / name
            (work / 'runtime').mkdir(parents=True)
            (work / 'dev').mkdir()
            (work / 'runtime/reactor.mjs').write_text(mutated)
            (work / 'dev/runtime-test.mjs').write_bytes(tests)
            command = [node, '--test', '--test-reporter=tap', '--test-name-pattern', pattern,
                       'dev/runtime-test.mjs']
            result = subprocess.run(command, cwd=work, capture_output=True, timeout=30)
            stdout, stderr = result.stdout.decode(), result.stderr.decode()
            counts = {key: int(value) for key, value in re.findall(
                r'^# (tests|pass|fail|skipped|cancelled) (\d+)$', stdout, re.MULTILINE)}
            assert result.returncode == 1 and counts.get('fail', 0) > 0, (name, result.returncode, counts)
            assert counts.get('skipped') == counts.get('cancelled') == 0, (name, counts)
            assert stderr == '', (name, stderr)
            record = {'name': name, 'description': description, 'argv': command,
                'cwd': str(work), 'exit_code': result.returncode, 'counts': counts,
                'runtime_sha256': digest(mutated.encode()), 'tests_sha256': digest(tests),
                'stdout': stdout, 'stderr': stderr}
            capture = args.output / (name + '.json')
            capture.write_text(json.dumps(record, indent=2, ensure_ascii=True) + '\n')
            controls.append({key: value for key, value in record.items() if key not in ['stdout', 'stderr', 'cwd', 'argv']}
                | {'capture': capture.name, 'capture_sha256': digest(capture.read_bytes())})
            print(f'{name}: rejected, {counts["fail"]}/{counts["tests"]} tests failed', flush=True)
    record = {'base': base, 'runtime_sha256': digest(source.encode()),
              'tests_sha256': digest(tests), 'controls': controls}
    (args.output / 'controls.json').write_text(json.dumps(record, indent=2) + '\n')


if __name__ == '__main__':
    main()
