// Run the allocation block and its existing helpers from the full suite.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const compiler = resolve(process.argv[2] ?? join(root, '_build/default/bin/kanon.exe'));
const source = readFileSync(join(root, 'dev/reactor-test.mjs'), 'utf8');
const uniqueIndex = marker => {
  const index = source.indexOf(marker);
  assert.ok(index >= 0 && source.indexOf(marker, index + marker.length) === -1,
    `expected one source marker: ${marker}`);
  return index;
};
const between = (start, end) => {
  const from = uniqueIndex(start);
  const to = uniqueIndex(end);
  assert.ok(to > from);
  return source.slice(from, to);
};
const rootLine = "const root = resolve(fileURLToPath(new URL('..', import.meta.url)));";
uniqueIndex(rootLine);
const prefix = source.slice(0, uniqueIndex('\ntry {')).replace(rootLine,
  `const root = ${JSON.stringify(root)};`);
const shared = "  const shared = join(root, 'runtime/reactor.kan');";
uniqueIndex(shared);
const body = [shared,
  between('  const decodeBytes =', '  const fullBuffer ='),
  between('  const reactorExports =', '  const directories ='),
  between('  const fileAllocation =', '  const fileOwner =')].join('\n');
const generated = `${prefix}\ntry {\n${body}\n` +
  "  console.log(`compiled allocation: ${checks} checks passed`);\n" +
  '} finally { rmSync(scratch, { recursive: true, force: true }); }\n';
const temporary = mkdtempSync(join(tmpdir(), 'veil-allocation-compiled-'));
try {
  const script = join(temporary, 'allocation.mjs');
  writeFileSync(script, generated);
  const result = spawnSync(process.execPath, [script, compiler], { stdio: 'inherit', timeout: 120000 });
  if (result.error) throw result.error;
  assert.equal(result.signal, null, 'compiled allocation process was signalled');
  process.exitCode = result.status;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
