"""Run file-identity defect controls in separate scratch directories."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess


BASE = '88d6bfe6de844eb8852489ee88f419aebdfb82b8'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def replace_once(source, old, new):
    assert source.count(old) == 1, f'Expected one occurrence: {old!r}'
    return source.replace(old, new, 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    options = parser.parse_args()
    output = options.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    root = Path(__file__).resolve().parents[3]
    runtime = (root / 'runtime/reactor.mjs').read_text()
    tests = (root / 'dev/runtime-test.mjs').read_bytes()
    case = '''    case 37: {
      const info = await stat(args[0], { bigint: true });
      return Buffer.from(`${info.dev}:${info.ino}`);
    }
'''
    assert runtime.count(case) == 1
    arity = next(line for line in runtime.splitlines() if line.startswith('const requestArities = '))
    assert arity.endswith(', 1];')
    base_runtime = subprocess.check_output(['git', '-C', str(root), 'show', f'{BASE}:runtime/reactor.mjs']).decode()
    exact = '^file identity preserves exact integer pairs'
    cases = {
        'positive': (runtime, '^file identity', 8),
        'base-runtime': (base_runtime, '^file identity', 8),
        'swapped-fields': (replace_once(runtime, case, case.replace('${info.dev}:${info.ino}', '${info.ino}:${info.dev}')), '^file identity', 8),
        'wrong-device': (replace_once(runtime, case, case.replace('info.dev', 'info.rdev')), '^file identity', 8),
        'rounded-device': (replace_once(runtime, case, case.replace('${info.dev}', '${Number(info.dev)}')), '^file identity', 8),
        'rounded-inode': (replace_once(runtime, case, case.replace('${info.ino}', '${Number(info.ino)}')), '^file identity', 8),
        'omit-bigint': (replace_once(runtime, case, case.replace(', { bigint: true }', '')), '^file identity', 8),
        'inspect-symlink': (replace_once(runtime, case, case.replace('await stat(', 'await lstat(')), '^file identity', 8),
        'omit-arity': (replace_once(runtime, arity, arity[:-5] + '];'), '^file identity', 8),
        'normalize-path': (replace_once(runtime, case, case.replace('stat(args[0],', 'stat(resolve(args[0]),')), '^file identity', 8),
        'split-stat': (replace_once(runtime, case, case.replace('${info.ino}', '${(await stat(args[0], { bigint: true })).ino}')), '^file identity', 8),
        'omit-separator': (replace_once(runtime, case, case.replace('${info.dev}:${info.ino}', '${info.dev}${info.ino}')), '^file identity', 8),
        'open-contents': (replace_once(runtime, case, case.replace('      const info', '      const handle = await open(args[0]); await handle.close();\n      const info')), exact, 1),
        'read-contents': (replace_once(runtime, case, case.replace('      const info', '      await readFile(args[0]);\n      const info')), exact, 1),
        'reject-zero': (replace_once(runtime, case, case.replace('      return Buffer', "      if (info.dev === 0n || info.ino === 0n) throw new Error('zero identity');\n      return Buffer")), '^file identity', 8),
    }
    results = []
    for name, (candidate, pattern, expected_tests) in cases.items():
        directory = output / name
        (directory / 'runtime').mkdir(parents=True)
        (directory / 'dev').mkdir()
        (directory / 'runtime/reactor.mjs').write_text(candidate)
        (directory / 'dev/runtime-test.mjs').write_bytes(tests)
        syntax = subprocess.run(['node', '--check', 'runtime/reactor.mjs'], cwd=directory,
                                capture_output=True, text=True, timeout=15)
        assert syntax.returncode == 0, (name, syntax.stderr)
        argv = ['node', '--test', '--test-reporter=tap', '--test-name-pattern', pattern, 'dev/runtime-test.mjs']
        run = subprocess.run(argv, cwd=directory, capture_output=True, text=True, timeout=15)
        counts = {key: int(value) for key, value in re.findall(
            r'^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$', run.stdout, re.MULTILINE)}
        assert counts.get('tests') == expected_tests, (name, counts, run.stderr)
        assert all(counts.get(key) == 0 for key in ['cancelled', 'skipped', 'todo']), (name, counts)
        if name == 'positive':
            assert run.returncode == 0 and counts['pass'] == expected_tests and counts['fail'] == 0
        else:
            assert run.returncode == 1 and counts['fail'] > 0, (name, run.returncode, counts)
        capture = {
            'argv': argv, 'cwd': str(directory), 'exit_code': run.returncode,
            'watchdog_ms': 15000, 'counts': counts, 'stdout': run.stdout, 'stderr': run.stderr,
            'stdout_sha256': digest(run.stdout.encode()), 'stderr_sha256': digest(run.stderr.encode()),
            'runtime_sha256': digest(candidate.encode()), 'tests_sha256': digest(tests),
        }
        (output / f'{name}.json').write_text(json.dumps(capture, indent=2) + '\n')
        results.append({'name': name, 'exit_code': run.returncode, 'counts': counts,
                        'runtime_sha256': capture['runtime_sha256'], 'capture': f'{name}.json'})
        print(f'{name}: exit={run.returncode} pass={counts["pass"]} fail={counts["fail"]}', flush=True)
    record = {'base': BASE, 'runtime_sha256': digest(runtime.encode()), 'tests_sha256': digest(tests),
              'reproducer_sha256': digest(Path(__file__).read_bytes()),
              'node': subprocess.check_output(['node', '--version']).decode().strip(), 'controls': results}
    (output / 'controls.json').write_text(json.dumps(record, indent=2) + '\n')
    print('CONTROL OK: positive 8/8; all 14 defect variants rejected')


if __name__ == '__main__':
    main()
