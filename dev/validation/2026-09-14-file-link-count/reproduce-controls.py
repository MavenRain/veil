"""Run file-link-count defect controls in separate scratch directories."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess


BASE = 'be5e76e9f9d960d018d04571ccdc3c409127defe'


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
    case = '    case 38: return Buffer.from(String((await stat(args[0], { bigint: true })).nlink));\n'
    assert runtime.count(case) == 1
    arity = next(line for line in runtime.splitlines() if line.startswith('const requestArities = '))
    assert arity.endswith(', 1];')
    base_runtime = subprocess.check_output(['git', '-C', str(root), 'show', f'{BASE}:runtime/reactor.mjs']).decode()
    exact = '^file link count preserves exact integers'
    variants = {
        'wrong-field': case.replace('.nlink', '.ino'),
        'rounded-count': case.replace('String((', 'String(Number((').replace('.nlink));', '.nlink)));'),
        'omit-bigint': case.replace(', { bigint: true }', ''),
        'inspect-symlink': case.replace('await stat(', 'await lstat('),
        'normalize-path': case.replace('stat(args[0],', 'stat(resolve(args[0]),'),
        'constant-count': "    case 38: return Buffer.from('1');\n",
        'extra-stat': case.replace('case 38: ', 'case 38: await stat(args[0], { bigint: true }); '),
        'replace-zero': case.replace('.nlink)', '.nlink || 1n)'),
    }
    cases = {'positive': (runtime, '^file link count', 8),
             'base-runtime': (base_runtime, '^file link count', 8)}
    cases.update({name: (replace_once(runtime, case, candidate), '^file link count', 8)
                  for name, candidate in variants.items()})
    cases['omit-arity'] = (replace_once(runtime, arity, arity[:-5] + '];'), '^file link count', 8)
    for name, operation in [('open-contents', 'const handle = await open(args[0]); await handle.close();'),
                            ('read-contents', 'await readFile(args[0]);')]:
        candidate = case.replace('case 38: ', f'case 38: {operation} ')
        cases[name] = (replace_once(runtime, case, candidate), exact, 1)
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


if __name__ == '__main__':
    main()
