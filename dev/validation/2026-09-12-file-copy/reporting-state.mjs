import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const [compiler, shared, fixture] = process.argv.slice(2);
const scratch = mkdtempSync(join(tmpdir(), 'veil-reporting-control-'));
try {
  const output = join(scratch, 'fixture.wasm');
  const names = ['emptyWords', 'emptyBytes', 'init', 'resume', 'exitCode'];
  const built = spawnSync(compiler, ['build', shared, fixture, '-o', output,
    ...names.flatMap(name => ['--export', name])], { encoding: 'utf8', timeout: 10000 });
  assert.equal(built.status, 0, built.error ?? built.stderr);
  const { instance: { exports: api } } = await WebAssembly.instantiate(readFileSync(output));
  for (const status of [0, 1]) {
    const reporting = api.resume(api.init(api.emptyWords()), status, api.emptyBytes());
    assert.equal(api.exitCode(reporting), status, 'reporting state must preserve the operation status');
  }
  console.log('reporting state: 2 checks passed');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
