import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runCliBatch } from './cli-batch.mjs';

test('CLI batch preserves order, output and ordinary nonzero exit codes', async () => {
  const cases = [0, 7, 1, 0, 3].map((code, index) => ['-e',
    `setTimeout(() => { process.stdout.write('out-${index}'); process.stderr.write('err-${index}'); process.exitCode = ${code}; }, ${30 - index * 5});`]);
  const results = await runCliBatch(process.execPath, cases);
  assert.equal(results.length, cases.length);
  for (const [index, args] of cases.entries()) {
    const expected = spawnSync(process.execPath, args, { encoding: 'utf8' });
    const actual = results[index];
    for (const key of ['status', 'signal', 'stdout', 'stderr', 'error']) {
      assert.deepEqual(actual[key], expected[key], `${index}: ${key}`);
    }
  }
});

test('CLI batch closes stdin and honors cwd', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'kanon-cli-cwd-'));
  try {
    const [result] = await runCliBatch(process.execPath, [['-e',
      "process.stdin.on('end', () => process.stdout.write(process.cwd())); process.stdin.resume();"]], { cwd });
    assert.equal(result.status, 0, result.error);
    assert.equal(result.stdout, realpathSync(cwd));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('CLI batch retains spawn, signal, timeout and output-limit failures', async () => {
  const [missing] = await runCliBatch('/kanon-missing-executable', [[]]);
  assert.equal(missing.status, null);
  assert.equal(missing.error.code, 'ENOENT');
  const [signal] = await runCliBatch(process.execPath, [['-e', "process.kill(process.pid, 'SIGTERM');"]]);
  assert.equal(signal.status, null);
  assert.equal(signal.signal, 'SIGTERM');
  assert.ok(signal.error);
  const [timeout] = await runCliBatch(process.execPath, [['-e', 'setInterval(() => {}, 1000);']], { timeout: 100 });
  assert.equal(timeout.status, null);
  assert.ok(timeout.error);
  const [handled] = await runCliBatch(process.execPath, [['-e',
    "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);"]], { timeout: 500 });
  assert.equal(handled.status, null);
  assert.ok(handled.error);
  const [overflow] = await runCliBatch(process.execPath, [['-e', "process.stdout.write('x'.repeat(1048577));"]]);
  assert.equal(overflow.status, null);
  assert.equal(overflow.error.code, 'ENOBUFS');
  // The cap must kill the child at once, so the case idles well past the limit.
  const idleAfterOverflow = ['-e',
    "process.stdout.write('x'.repeat(600000)); process.stderr.write('y'.repeat(600000)); setInterval(() => {}, 1000);"];
  const started = Date.now();
  const [early] = await runCliBatch(process.execPath, [idleAfterOverflow], { timeout: 3000 });
  const elapsed = Date.now() - started;
  assert.equal(early.status, null);
  assert.equal(early.error.code, 'ENOBUFS');
  assert.ok(elapsed < 2000, `early kill took ${elapsed} ms`);
  // Two-byte characters keep the counter honest: a character count stays under
  // the limit here, while the byte count of both streams exceeds it.
  // U+00E9 is precomposed, so it is one UTF-16 unit and two UTF-8 bytes.
  const bothStreams = ['-e',
    "const payload = '\\u00e9'.repeat(400000); process.stdout.write(payload); process.stderr.write(payload);"];
  const original = spawnSync(process.execPath, bothStreams, { encoding: 'utf8' });
  const [combined] = await runCliBatch(process.execPath, [bothStreams]);
  assert.equal(original.error.code, 'ENOBUFS');
  assert.equal(combined.status, original.status);
  assert.equal(combined.error.code, original.error.code);
  // The helper reports no signal on this path, unlike spawnSync.  See
  // dev/cli-batch.mjs for the recorded departures from the spawnSync shape.
  assert.equal(combined.signal, null);
});

test('CLI batch bounds live children and waits for them after invalid arguments', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'kanon-cli-batch-'));
  try {
    const source = "const fs = require('node:fs'); const file = 'active-' + process.pid; fs.writeFileSync(file, ''); const count = fs.readdirSync('.').filter(name => name.startsWith('active-')).length; setTimeout(() => { fs.unlinkSync(file); process.stdout.write(String(count)); }, 100);";
    const results = await runCliBatch(process.execPath, Array.from({ length: 9 }, () => ['-e', source]), { cwd });
    assert.equal(results.length, 9);
    for (const result of results) {
      assert.equal(result.status, 0, result.error);
      assert.ok(Number(result.stdout) >= 1 && Number(result.stdout) <= 4);
    }
    const delayed = ['-e', "setTimeout(() => require('node:fs').writeFileSync('finished', 'done'), 100);"];
    await assert.rejects(runCliBatch(process.execPath, [42, delayed], { cwd }), { code: 'ERR_INVALID_ARG_TYPE' });
    assert.equal(readFileSync(join(cwd, 'finished'), 'utf8'), 'done');
    assert.deepEqual(await runCliBatch(process.execPath, [], { cwd }), []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
