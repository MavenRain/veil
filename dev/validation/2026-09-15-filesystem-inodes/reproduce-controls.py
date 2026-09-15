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


def text_of(data):
    return '' if data is None else data.decode('utf-8', 'replace') if isinstance(data, bytes) else str(data)


def observe(command, work):
    try:
        run = subprocess.run(command, cwd=work, text=True, capture_output=True, timeout=20)
        return {'exit_code': run.returncode, 'timed_out': False, 'stdout': run.stdout, 'stderr': run.stderr}
    except subprocess.TimeoutExpired as expired:
        return {'exit_code': None, 'timed_out': True,
                'stdout': text_of(expired.stdout), 'stderr': text_of(expired.stderr)}


def main():
    parser = argparse.ArgumentParser(description='Reproduce filesystem inode defect controls.')
    parser.add_argument('--output', required=True, type=Path, help='New directory for captures')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    source = (root / 'runtime/reactor.mjs').read_text()
    tests = (root / 'dev/runtime-test.mjs').read_bytes()
    start = source.index('    case 42: {\n')
    end = source.index('    }\n', start) + len('    }\n')
    arm = source[start:end]
    call = 'const info = await statfs(args[0], { bigint: true });'
    assert arm.count(call) == 1
    arity = next(line for line in source.splitlines() if line.startswith('const requestArities ='))
    values = json.loads(arity.split(' = ', 1)[1].removesuffix(';'))
    assert len(values) == 43 and values[42] == 1
    changes = {
        'missing-operation': (arm, ''),
        'swap-fields': (arm, arm.replace('${info.files}:${info.ffree}', '${info.ffree}:${info.files}')),
        'wrong-total': (arm, arm.replace('${info.files}', '${info.blocks}')),
        'wrong-free': (arm, arm.replace('${info.ffree}', '${info.bfree}')),
        **{f'round-{field}': (arm, arm.replace('${info.' + field + '}', '${Number(info.' + field + ')}'))
           for field in ['files', 'ffree']},
        'missing-bigint': (arm, arm.replace('statfs(args[0], { bigint: true })', 'statfs(args[0])')),
        'normalize-path': (arm, arm.replace('statfs(args[0],', 'statfs(resolve(args[0]),')),
        'duplicate-statfs': (arm, arm.replace(call, call + '\n      await statfs(args[0], { bigint: true });')),
        'missing-arity': (arity, arity[:-5] + '];'),
        'read-contents': (arm, arm.replace(call, 'await readFile(args[0]);\n      ' + call)),
        'stat-instead': (arm, arm.replace('await statfs(', 'await stat(')),
        **{f'reject-zero-{field}': (arm, arm.replace(call, call +
           f'\n      if (!info.{field}) throw new Error("zero inode count");')) for field in ['files', 'ffree']},
        **{f'clamp-negative-{field}': (arm, arm.replace('${info.' + field + '}',
           '${info.' + field + ' < 0n ? 0n : info.' + field + '}')) for field in ['files', 'ffree']},
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
    with tempfile.TemporaryDirectory(prefix='veil-inodes-controls-') as temporary:
        work = Path(temporary)
        (work / 'runtime').mkdir()
        (work / 'dev').mkdir()
        (work / 'dev/runtime-test.mjs').write_bytes(tests)
        for name, runtime in variants.items():
            (work / 'runtime/reactor.mjs').write_text(runtime)
            command = [node, '--test', '--test-reporter=tap', '--test-name-pattern',
                       '^filesystem inodes', 'dev/runtime-test.mjs']
            run = observe(command, work)
            counts = {key: int(value) for key, value in re.findall(
                r'^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$', run['stdout'], re.MULTILINE)}
            record = {'variant': name, 'argv': command, 'cwd': str(work), 'exit_code': run['exit_code'],
                      'timeout_seconds': 20, 'timed_out': run['timed_out'], 'counts': counts,
                      'runtime_sha256': digest(runtime.encode()), 'test_sha256': digest(tests),
                      'stdout': run['stdout'], 'stderr': run['stderr'],
                      'stdout_sha256': digest(run['stdout'].encode()),
                      'stderr_sha256': digest(run['stderr'].encode())}
            capture = output / f'{name}.json'
            capture.write_text(json.dumps(record, indent=2) + '\n')
            assert not run['timed_out'], (name, 'variant exceeded the 20-second bound', capture)
            assert counts.get('tests') == 7, (name, record)
            assert all(counts.get(key) == 0 for key in ['cancelled', 'skipped', 'todo']), (name, counts)
            if name == 'positive':
                assert run['exit_code'] == 0 and counts['pass'] == 7 and counts['fail'] == 0, record
            else:
                assert run['exit_code'] == 1 and counts['fail'] > 0, record
                assert 'ERR_ASSERTION' in run['stdout'], record
            results[name] = {'exit_code': run['exit_code'], 'counts': counts,
                             'capture': capture.name, 'capture_sha256': digest(capture.read_bytes())}
            print(f'{name}: exit={run["exit_code"]} pass={counts["pass"]} fail={counts["fail"]}', flush=True)
    summary = {'source_sha256': digest(source.encode()), 'test_sha256': digest(tests),
               'mutations': {name: {'old': old, 'new': new} for name, (old, new) in changes.items()},
               'results': results}
    (output / 'controls.json').write_text(json.dumps(summary, indent=2) + '\n')


if __name__ == '__main__':
    main()
