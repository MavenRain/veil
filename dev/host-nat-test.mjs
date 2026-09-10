import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const compiler = resolve(process.argv[2] ?? join(root, '_build/default/bin/kanon.exe'));
const scratch = mkdtempSync(join(tmpdir(), 'veil-host-nat-'));
try {
  const cases = [
    ['zkLarge', 1], ['zkAdjacent', 0], ['zkFalse', 0],
    ['fhcI31', 1], ['fhcSafe', 1], ['fhcSquare', 1], ['fhcLevel', 1],
    ['mpcSum', 1], ['mpcProduct', 1], ['mpcSquare', 1], ['mpcSuccessor', 1], ['mpcZero', 1],
  ];
  const reactorExports = ['emptyBytes', 'consBytes', 'bytesEmpty', 'bytesHead', 'bytesTail',
    'emptyWords', 'consWords', 'wordsEmpty', 'wordsHead', 'wordsTail',
    'init', 'resume', 'requestCode', 'requestArgs', 'requestBody', 'exitCode'];
  const output = join(scratch, 'host-nat.wasm');
  const built = spawnSync(compiler, ['build', join(root, 'runtime/reactor.kan'),
    join(root, 'test/host/host-nat.kan'), join(root, 'test/host/nat-bytes.kan'), '-o', output,
    ...[...cases.map(([name]) => name), ...reactorExports].flatMap(name => ['--export', name])],
  { encoding: 'utf8', timeout: 20000 });
  assert.equal(built.status, 0, built.error?.message ?? built.stderr);
  const module = await WebAssembly.compile(readFileSync(output));
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const { exports: api } = await WebAssembly.instantiate(module);
  const exported = cases.filter(([name, expected]) => {
    assert.equal(api[name](), expected, name);
    return true;
  }).length;
  const byteCases = [
    ['0', '1'], ['1073741823', '1073741824'], ['9007199254740992', '9007199254740993'],
    ['123456789012345678901234567890123456789012345678901234567890',
      '123456789012345678901234567890123456789012345678901234567891'],
  ];
  const ranBytes = byteCases.filter(([input, expected]) => {
    const ran = spawnSync(process.execPath, [join(root, 'runtime/run.mjs'), output, input],
      { encoding: 'utf8', timeout: 20000 });
    assert.equal(ran.status, 0, ran.error?.message ?? ran.stderr);
    assert.equal(ran.stderr, '');
    assert.equal(ran.stdout, expected, `decimal successor of ${input}`);
    return true;
  }).length;
  // The verdict line prints the pass count against the case count, so an
  // added case keeps the line true. The minimum keeps a deleted case red.
  assert.ok(cases.length >= 12 && byteCases.length >= 4, 'missing host natural cases');
  console.log(`HOST-NAT ${exported + ranBytes}/${cases.length + byteCases.length}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
