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


def main():
    parser = argparse.ArgumentParser(description='Reproduce file timestamp defect controls.')
    parser.add_argument('--output', required=True, type=Path, help='New directory for captures')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    source = (root / 'runtime/reactor.mjs').read_text()
    tests = (root / 'dev/runtime-test.mjs').read_bytes()
    start = source.index('    case 44: {\n')
    end = source.index('    }\n', start) + len('    }\n')
    arm = source[start:end]
    call = 'await utimes(args[0], atime, mtime);'
    assert arm.count(call) == 1
    arity = next(line for line in source.splitlines() if line.startswith('const requestArities ='))
    values = json.loads(arity.split(' = ', 1)[1].removesuffix(';'))
    assert len(values) == 45 and values[44] == 3
    changes = {
        'missing-operation': (arm, ''),
        'missing-arity': (arity, 'const requestArities = ' + json.dumps(values[:-1]) + ';'),
        'swap-times': (arm, arm.replace(call, 'await utimes(args[0], mtime, atime);')),
        'numeric-seconds': ('return new Date(milliseconds);', 'return milliseconds / 1000;'),
        'scale-seconds': ('return new Date(milliseconds);', 'return new Date(milliseconds * 1000);'),
        'round-seconds': ('return new Date(milliseconds);', 'return new Date(Math.trunc(milliseconds / 1000) * 1000);'),
        'allow-noncanonical': ('String(milliseconds) !== value', 'false'),
        'missing-date-bound': ('Math.abs(milliseconds) > 8640000000000000', 'false'),
        'reject-zero': ('!Number.isSafeInteger(milliseconds)', '!milliseconds || !Number.isSafeInteger(milliseconds)'),
        'clamp-negative': ('return new Date(milliseconds);', 'return new Date(Math.max(0, milliseconds));'),
        'normalize-path': (arm, arm.replace(call, 'await utimes(resolve(args[0]), atime, mtime);')),
        'duplicate-update': (arm, arm.replace(call, call + '\n      ' + call)),
        'read-contents': (arm, arm.replace(call, 'await readFile(args[0]);\n      ' + call)),
        'update-before-validation': (arm, arm.replace('const mtime = timestamp(args[2]);',
            'await utimes(args[0], atime, atime);\n      const mtime = timestamp(args[2]);')),
    }
    for name, (old, new) in changes.items():
        assert old != new and source.count(old) == 1, name
    variants = {'positive': source, **{name: source.replace(old, new) for name, (old, new) in changes.items()}}
    node = shutil.which('node')
    assert node, 'Node is required'
    output = args.output.absolute()
    try:
        output.mkdir()
    except FileExistsError:
        parser.error(f'output already exists: {output}')
    results = {}
    with tempfile.TemporaryDirectory(prefix='veil-times-controls-') as temporary:
        work = Path(temporary)
        (work / 'runtime').mkdir()
        (work / 'dev').mkdir()
        (work / 'dev/runtime-test.mjs').write_bytes(tests)
        for name, runtime in variants.items():
            (work / 'runtime/reactor.mjs').write_text(runtime)
            command = [node, '--test', '--test-reporter=tap', '--test-name-pattern',
                       '^file times', 'dev/runtime-test.mjs']
            try:
                run = subprocess.run(command, cwd=work, text=True, capture_output=True, timeout=20)
            except subprocess.TimeoutExpired as expired:
                (output / f'{name}-timeout.txt').write_text(str(expired))
                raise RuntimeError(f'{name}: exceeded the 20-second watchdog') from expired
            counts = {key: int(value) for key, value in re.findall(
                r'^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$', run.stdout, re.MULTILINE)}
            record = {'variant': name, 'argv': command, 'cwd': str(work), 'exit_code': run.returncode,
                      'timeout_seconds': 20, 'timed_out': False, 'counts': counts,
                      'runtime_sha256': digest(runtime.encode()), 'test_sha256': digest(tests),
                      'stdout': run.stdout, 'stderr': run.stderr,
                      'stdout_sha256': digest(run.stdout.encode()),
                      'stderr_sha256': digest(run.stderr.encode())}
            capture = output / f'{name}.json'
            capture.write_text(json.dumps(record, indent=2) + '\n')
            assert counts.get('tests') == 9, (name, record)
            assert all(counts.get(key) == 0 for key in ['cancelled', 'skipped', 'todo']), (name, counts)
            if name == 'positive':
                assert run.returncode == 0 and counts['pass'] == 9 and counts['fail'] == 0, record
            else:
                assert run.returncode == 1 and counts['fail'] > 0, record
                assert 'ERR_ASSERTION' in run.stdout, record
            results[name] = {'exit_code': run.returncode, 'counts': counts,
                             'capture': capture.name, 'capture_sha256': digest(capture.read_bytes())}
            print(f'{name}: exit={run.returncode} pass={counts["pass"]} fail={counts["fail"]}', flush=True)
    summary = {'source_sha256': digest(source.encode()), 'test_sha256': digest(tests),
               'mutations': {name: {'old': old, 'new': new} for name, (old, new) in changes.items()},
               'results': results}
    (output / 'controls.json').write_text(json.dumps(summary, indent=2) + '\n')


if __name__ == '__main__':
    main()
