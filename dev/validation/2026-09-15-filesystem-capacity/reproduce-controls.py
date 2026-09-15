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
    parser = argparse.ArgumentParser(description='Reproduce filesystem capacity defect controls.')
    parser.add_argument('--output', required=True, type=Path, help='New directory for captures')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    source = (root / 'runtime/reactor.mjs').read_text()
    tests = (root / 'dev/runtime-test.mjs').read_bytes()
    start = source.index('    case 41: {\n')
    end = source.index('    default:', start)
    arm = source[start:end]
    call = 'const info = await statfs(args[0], { bigint: true });'
    assert arm.count(call) == 1
    arity = next(line for line in source.splitlines() if line.startswith('const requestArities ='))
    assert arity.endswith(', 1];')
    changes = {
        'missing-operation': (arm, ''),
        'swap-free-available': (arm, arm.replace('${info.bfree}:${info.bavail}', '${info.bavail}:${info.bfree}')),
        'wrong-block-size': (arm, arm.replace('${info.bsize}', '${info.frsize}')),
        'wrong-total-blocks': (arm, arm.replace('${info.blocks}', '${info.files}')),
        'wrong-free-blocks': (arm, arm.replace('${info.bfree}', '${info.ffree}')),
        'wrong-available-blocks': (arm, arm.replace('${info.bavail}', '${info.bfree}')),
        **{f'round-{field}': (arm, arm.replace('${info.' + field + '}', '${Number(info.' + field + ')}'))
           for field in ['bsize', 'blocks', 'bfree', 'bavail']},
        'missing-bigint': (arm, arm.replace('statfs(args[0], { bigint: true })', 'statfs(args[0])')),
        'normalize-path': (arm, arm.replace('statfs(args[0],', 'statfs(resolve(args[0]),')),
        'duplicate-statfs': (arm, arm.replace(call, call + '\n      await statfs(args[0], { bigint: true });')),
        'missing-arity': (arity, arity[:-5] + '];'),
        'read-contents': (arm, arm.replace(call, 'await readFile(args[0]);\n      ' + call)),
        'reject-zero': (arm, arm.replace(call, call + '\n      if (!info.bavail) throw new Error("zero capacity");')),
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
    with tempfile.TemporaryDirectory(prefix='veil-capacity-controls-') as temporary:
        work = Path(temporary)
        (work / 'runtime').mkdir()
        (work / 'dev').mkdir()
        (work / 'dev/runtime-test.mjs').write_bytes(tests)
        for name, runtime in variants.items():
            (work / 'runtime/reactor.mjs').write_text(runtime)
            command = [node, '--test', '--test-reporter=tap', '--test-name-pattern',
                       '^filesystem capacity', 'dev/runtime-test.mjs']
            run = subprocess.run(command, cwd=work, text=True, capture_output=True, timeout=20)
            counts = {key: int(value) for key, value in re.findall(
                r'^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$', run.stdout, re.MULTILINE)}
            record = {'variant': name, 'argv': command, 'cwd': str(work), 'exit_code': run.returncode,
                      'timeout_seconds': 20, 'timed_out': False, 'counts': counts,
                      'runtime_sha256': digest(runtime.encode()), 'test_sha256': digest(tests),
                      'stdout': run.stdout, 'stderr': run.stderr,
                      'stdout_sha256': digest(run.stdout.encode()), 'stderr_sha256': digest(run.stderr.encode())}
            capture = output / f'{name}.json'
            capture.write_text(json.dumps(record, indent=2) + '\n')
            assert counts.get('tests') == 7, (name, record)
            assert all(counts.get(key) == 0 for key in ['cancelled', 'skipped', 'todo']), (name, counts)
            if name == 'positive':
                assert run.returncode == 0 and counts['pass'] == 7 and counts['fail'] == 0, record
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
