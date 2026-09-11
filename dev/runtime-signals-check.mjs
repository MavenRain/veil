// Reproduce the startup race and verify the signal tests reject runtime defects.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = '33317868b33ad474916b29b4e4fc4ba7e523de2f';
const selected = process.argv[2];
const all = 'timeout escalates|signal callback errors|escalation callback errors';
const replaceOnce = (text, before, after) => {
  assert.equal(text.split(before).length, 2, `expected exactly one mutation site: ${before}`);
  return text.replace(before, after);
};
const hash = text => createHash('sha256').update(text).digest('hex');
let runtime = readFileSync(join(root, 'runtime/reactor.mjs'), 'utf8');
let suite = readFileSync(join(root, 'dev/runtime-test.mjs'), 'utf8');
const sourceHashes = { runtime: hash(runtime), suite: hash(suite) };
let pattern = all;
let failures = 0;
let tests = 3;
switch (selected) {
  case 'slow-start-before': {
    const prior = spawnSync('git', ['show', `${base}:dev/runtime-test.mjs`], { cwd: root, encoding: 'utf8' });
    assert.equal(prior.status, 0, prior.stderr);
    suite = replaceOnce(prior.stdout, "process.execPath, '-e', source];",
      "process.execPath, '-e', 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);' + source];");
    failures = 3;
    break;
  }
  case 'slow-start-after':
    suite = replaceOnce(suite, "process.execPath, '-e', source];",
      "process.execPath, '-e', 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);' + source];");
    break;
  case 'deadline':
    runtime = replaceOnce(runtime, '}, timeoutMs) : null;', '}, timeoutMs + 1) : null;');
    pattern = 'timeout escalates';
    failures = 1;
    tests = 1;
    break;
  case 'escalation':
    runtime = replaceOnce(runtime, '        }, 250);', '        }, 251);');
    pattern = 'timeout escalates';
    failures = 1;
    tests = 1;
    break;
  case 'error-identity':
    runtime = replaceOnce(runtime, '      throw error;\n    } finally {',
      "      throw new Error('lost signal failure');\n    } finally {");
    pattern = 'signal callback errors|escalation callback errors';
    failures = 2;
    tests = 2;
    break;
  default:
    throw new Error('expected slow-start-before, slow-start-after, deadline, escalation, or error-identity');
}

const scratch = mkdtempSync(join(tmpdir(), 'veil-signal-check-'));
try {
  mkdirSync(join(scratch, 'runtime'));
  mkdirSync(join(scratch, 'dev'));
  writeFileSync(join(scratch, 'runtime/reactor.mjs'), runtime);
  writeFileSync(join(scratch, 'dev/runtime-test.mjs'), suite);
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap',
    '--test-name-pattern', pattern, 'dev/runtime-test.mjs'], {
    cwd: scratch, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024,
  });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  // A spawn error is not a surviving mutation. ETIMEDOUT means the run passed
  // the 15 s cap; ENOBUFS means it passed the 1 MiB output cap.
  assert.equal(result.error, undefined,
    `${selected}: the test run gave no usable output, spawn error ${result.error?.code}`);
  assert.equal(result.signal, null);
  assert.equal(result.status, failures ? 1 : 0);
  assert.match(result.stdout, new RegExp(`^# tests ${tests}$`, 'm'));
  assert.match(result.stdout, new RegExp(`^# pass ${tests - failures}$`, 'm'));
  assert.match(result.stdout, new RegExp(`^# fail ${failures}$`, 'm'));
  assert.match(result.stdout, /^# cancelled 0$/m);
  assert.match(result.stdout, /^# skipped 0$/m);
  if (selected === 'slow-start-before') assert.match(result.stdout, /ENOENT/);
  else if (failures) assert.match(result.stdout, /ERR_ASSERTION/);
  console.log(JSON.stringify({ case: selected, base, sourceHashes,
    executedHashes: { runtime: hash(runtime), suite: hash(suite) },
    testExit: result.status, expectedFailures: failures, verified: true }));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
