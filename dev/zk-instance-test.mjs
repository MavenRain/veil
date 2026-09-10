import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const compiler = resolve(process.argv[2] ?? join(root, '_build/default/bin/kanon.exe'));
const scratch = mkdtempSync(join(tmpdir(), 'veil-zk-instance-'));
try {
  const output = join(scratch, 'zk-instance.wasm');
  const names = ['squareCheck', 'anyCheck', 'storedInstance'];
  const built = spawnSync(compiler, ['build', join(root, 'runtime/reactor.kan'),
    join(root, 'test/host/zk-instance.kan'), '-o', output,
    ...names.flatMap(name => ['--export', name])], { encoding: 'utf8', timeout: 20000 });
  assert.equal(built.status, 0, built.error?.message ?? built.stderr);
  const module = await WebAssembly.compile(readFileSync(output));
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const { exports: api } = await WebAssembly.instantiate(module);
  const cases = [
    ['squareCheck', [9, 9, 3], 1],
    ['squareCheck', [9, 10, 3], 0],
    ['squareCheck', [10, 9, 3], 0],
    ['squareCheck', [9, 9, 4], 0],
    ['squareCheck', [0, 0, 0], 1],
    ['anyCheck', [9, 9, 3], 1],
    ['anyCheck', [9, 10, 3], 0],
    ['anyCheck', [0, 1, 0], 0],
    ['storedInstance', [9, 3], 9],
    ['storedInstance', [0, 3], 0],
  ];
  // The verdict line prints the pass count against the case count, so an
  // added case keeps the line true. The minimum keeps a deleted case red.
  assert.ok(cases.length >= 10, `expected at least 10 cases, found ${cases.length}`);
  const passed = cases.filter(([name, args, expected]) => {
    assert.equal(api[name](...args), expected, `${name}(${args.join(', ')})`);
    return true;
  }).length;
  console.log(`ZK-INSTANCE ${passed}/${cases.length}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
