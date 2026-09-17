"""Run file-creation defect controls on disposable copies of the final sources."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[3])
parser.add_argument('--output', type=Path)
args = parser.parse_args()
root = args.root.resolve()
output = (args.output or root / '.gatework/create-controls').resolve()
output.mkdir(parents=True, exist_ok=True)
digest = lambda data: hashlib.sha256(data).hexdigest()
write_json = lambda path, value: path.write_text(json.dumps(value, indent=2) + '\n')
source_names = ['runtime/reactor.mjs', 'dev/runtime-test.mjs']
sources = {name: (root / name).read_bytes() for name in source_names}
runtime = sources['runtime/reactor.mjs'].decode()
arm = """    case 49: {
      if (body.length > MAX_IO) throw new RangeError('create exceeds maximum OS chunk size');
      await writeFile(args[0], body, { flag: 'wx', mode: 0o600 });
      return Buffer.alloc(0);
    }
"""
assert runtime.count(arm) == 1
arity = next(line for line in runtime.splitlines() if line.startswith('const requestArities ='))
assert arity.endswith(', 2, 1];')
write_call = "await writeFile(args[0], body, { flag: 'wx', mode: 0o600 });"
variants = [
    ('positive', '', '', 'Unchanged final source.'),
    ('missing-operation', arm, '', 'Remove operation 49.'),
    ('missing-arity', arity, arity[:-5] + '];', 'Remove the final argument-count entry.'),
    ('overwrite-existing', arm, arm.replace("flag: 'wx'", "flag: 'w'"),
     'Open with truncating, nonexclusive flags.'),
    ('public-mode', arm, arm.replace('mode: 0o600', 'mode: 0o666'),
     'Request group and other access when creating files.'),
    ('text-body', arm, arm.replace('args[0], body,', 'args[0], body.toString(),'),
     'Decode the binary payload as UTF-8 before writing it.'),
    ('missing-bound', arm, arm.replace(arm.splitlines(keepends=True)[1], ''),
     'Permit payloads above the maximum OS chunk size.'),
    ('normalize-path', arm, arm.replace('writeFile(args[0],', 'writeFile(resolve(args[0]),'),
     'Resolve paths lexically before the filesystem sees parent symlinks.'),
    ('omit-write', arm, arm.replace(write_call, ''), 'Return success without a host write.'),
    ('missing-await', arm, arm.replace('await writeFile(', 'writeFile('),
     'Resume before the host write settles.'),
]
records = []
for name, before, after, defect in variants:
    if before:
        assert runtime.count(before) == 1, name
        changed = runtime.replace(before, after, 1)
    else:
        changed = runtime
    with tempfile.TemporaryDirectory(prefix='veil-create-control-') as temporary:
        work = Path(temporary)
        for source in source_names:
            target = work / source
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(sources[source])
        (work / 'runtime/reactor.mjs').write_text(changed)
        command = ['gtimeout', '30', 'node', '--test', '--test-reporter=tap',
                   '--test-name-pattern=^file create ', 'dev/runtime-test.mjs']
        result = subprocess.run(command, cwd=work, capture_output=True, text=True, timeout=35)
        counts = {key: int(re.search(r'^# ' + key + r' (\d+)$', result.stdout, re.M)[1])
                  for key in ['tests', 'pass', 'fail', 'cancelled', 'skipped']}
        record = {
            'name': name, 'defect': defect, 'replacement': {'before': before, 'after': after},
            'runtime_sha256': digest(changed.encode()), 'argv': command, 'cwd': str(work),
            'temporary_copy_retained': False, 'watchdog_ms': 30000,
            'exit_code': result.returncode, **counts,
            'stdout': result.stdout, 'stderr': result.stderr,
            'stdout_sha256': digest(result.stdout.encode()),
            'stderr_sha256': digest(result.stderr.encode()),
        }
        write_json(output / f'{name}.json', record)
        if name == 'positive':
            assert result.returncode == 0 and counts == {
                'tests': 10, 'pass': 10, 'fail': 0, 'cancelled': 0, 'skipped': 0,
            }, record
        else:
            assert result.returncode == 1 and counts['fail'] > 0, record
            assert 'ERR_ASSERTION' in result.stdout, record
        records.append({key: value for key, value in record.items() if key not in ['stdout', 'stderr']})
        print(f"{name}: exit={result.returncode}, pass={counts['pass']}, fail={counts['fail']}", flush=True)
assert all((root / name).read_bytes() == value for name, value in sources.items())
write_json(output / 'controls.json', {
    'source_sha256': {name: digest(value) for name, value in sources.items()},
    'reproducer_sha256': digest(Path(__file__).read_bytes()),
    'pattern': '^file create ', 'controls': records,
})
print('Positive control passed; all nine defects failed assertions; source files unchanged.')
