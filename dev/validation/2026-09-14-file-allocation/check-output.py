import hashlib
from pathlib import Path
import subprocess
import sys
import tempfile


root = Path(__file__).resolve().parents[3]
record = 'dev/validation/2026-09-14-file-allocation'
reproducer = root / record / 'reproduce-controls.py'
assert reproducer.is_file(), f'reproducer not found: {reproducer}'
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
with tempfile.TemporaryDirectory(prefix='veil-allocation-output-') as temporary:
    work = Path(temporary)
    output = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else work / 'controls'
    if not output.is_dir():
        output.mkdir(parents=True)
        (output / 'kept.json').write_text('{}')
    before = {path.name: digest(path) for path in output.iterdir()}
    assert before, f'output guard needs a directory with at least one file: {output}'
    file = work / 'file'
    file.write_text('keep')
    link = work / 'link'
    link.symlink_to(work / 'missing')
    for target in [output, file, link]:
        result = subprocess.run(['python3', '-I', str(reproducer), '--output', str(target)],
                                capture_output=True, timeout=20, check=False)
        assert result.returncode == 2
        assert result.stdout == b''
        assert b'output must be a new directory' in result.stderr
    assert file.read_text() == 'keep'
    assert link.is_symlink() and not (work / 'missing').exists()
    assert {path.name: digest(path) for path in output.iterdir()} == before
print('Output guard passed: existing directory, file and dangling symlink preserved.')
