import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, realpathSync, rmSync, readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const compiler = resolve(process.argv[2] ?? join(root, '_build/default/bin/kanon.exe'));
const scratch = mkdtempSync(join(tmpdir(), 'kanon-reactor-'));
const fixture = name => join(root, 'test/fixtures/reactor', `${name}.kan`);
const run = args => spawnSync(compiler, args, { encoding: 'utf8' });
const runModule = (args, cwd = scratch) => spawnSync(process.execPath,
  [join(root, 'runtime/run.mjs'), ...args],
  { encoding: 'utf8', cwd, timeout: 20000 });
const exports = ['empty', 'prepend', 'byteHead', 'byteTail',
  'byteLength', 'initialState', 'stateCount', 'stateBytes', 'updateState',
  'increment', 'literalBytes', 'literalEmpty'];
let checks = 0;
const verify = fn => { fn(); checks += 1; };

try {
  const output = join(scratch, 'reactor.wasm');
  const built = run(['build', fixture('reactor-types'), fixture('reactor-functions'),
    fixture('byte-literal-valid'), '-o', output, ...exports.flatMap(name => ['--export', name])]);
  assert.equal(built.status, 0, built.stderr);
  const bytes = readFileSync(output);
  const { instance } = await WebAssembly.instantiate(bytes);
  const e = instance.exports;
  verify(() => assert.deepEqual(Object.keys(e), exports));
  verify(() => assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(bytes)).length, 0));
  verify(() => assert.equal(typeof e.empty(), 'object'));
  verify(() => assert.equal(e.byteLength(e.empty()), 0));
  const list = e.prepend(65, e.prepend(255, e.empty()));
  verify(() => assert.equal(e.byteLength(list), 2));
  verify(() => assert.equal(e.byteHead(list), 65));
  verify(() => assert.equal(e.byteHead(e.byteTail(list)), 255));
  const original = e.initialState();
  const updated = e.updateState(original, 7, list);
  verify(() => assert.equal(e.stateCount(original), 0));
  verify(() => assert.equal(e.stateCount(updated), 7));
  verify(() => assert.equal(e.byteLength(e.stateBytes(updated)), 2));
  verify(() => assert.equal(e.increment(1073741822), 1073741823));
  for (const invalid of [-1, 1073741824, 2147483647, -2147483648]) {
    verify(() => assert.throws(() => e.prepend(invalid, list), WebAssembly.RuntimeError));
  }
  verify(() => assert.throws(() => e.increment(1073741823), WebAssembly.RuntimeError));
  for (const invalid of [null, undefined, {}, [], 0, 'bytes', original]) {
    verify(() => assert.throws(() => e.byteLength(invalid), TypeError));
  }
  verify(() => assert.throws(() => e.stateCount(list), TypeError));
  let literal = e.literalBytes();
  const observed = [];
  while (e.byteLength(literal) !== 0) {
    observed.push(e.byteHead(literal));
    literal = e.byteTail(literal);
  }
  verify(() => assert.deepEqual(observed, [65, 10, 13, 9, 0, 92, 34, 255, 195, 169]));
  verify(() => assert.equal(e.byteLength(e.literalEmpty()), 0));
  for (const name of ['byte-literal-bad-escape', 'byte-literal-bad-hex', 'byte-literal-unterminated']) {
    const failed = run(['check', fixture(name)]);
    verify(() => assert.equal(failed.status, 1, name));
    verify(() => assert.match(failed.stderr, /byte (?:escape|literal)/));
  }
  const duplicate = run(['build', fixture('reactor-types'), '-o', output,
    '--export', 'bytesNil', '--export', 'bytesNil']);
  verify(() => assert.equal(duplicate.status, 2));
  const missing = run(['build', fixture('reactor-types'), '-o', output, '--export', 'missing']);
  verify(() => assert.equal(missing.status, 2));
  const noExport = run(['build', fixture('reactor-types'), '-o', output]);
  verify(() => assert.equal(noExport.status, 64));
  const legacy = run(['emit', join(root, 'test/fixtures/mu-mutual-emit.kan'), '-o', output, '--export', 'main']);
  verify(() => assert.equal(legacy.status, 0, legacy.stderr));
  verify(() => assert.deepEqual(readFileSync(output), readFileSync(join(root, 'test/mu-mutual-emit.wasm'))));
  const { instance: old } = await WebAssembly.instantiate(readFileSync(output));
  verify(() => assert.equal(old.exports.main(), 4));

  // Append must preserve byte order at the host's full read-buffer size.
  // Construct inputs through the ABI so the compiler never evaluates a
  // large literal in place of exercising the emitted recursion.
  const shared = join(root, 'runtime/reactor.kan');
  const helpers = join(scratch, 'bytes.wasm');
  const helperExports = ['emptyBytes', 'consBytes', 'bytesEmpty', 'bytesHead', 'bytesTail', 'bytesAppend'];
  const helperBuild = run(['build', shared, '-o', helpers,
    ...helperExports.flatMap(name => ['--export', name])]);
  verify(() => assert.equal(helperBuild.status, 0, helperBuild.stderr));
  const { instance: helperInstance } = await WebAssembly.instantiate(readFileSync(helpers));
  const bytesApi = helperInstance.exports;
  const encodeBytes = (api, bytes) => bytes.reduceRight((tail, byte) => api.consBytes(byte, tail), api.emptyBytes());
  const decodeBytes = (api, list, length) => {
    const result = [];
    while (!api.bytesEmpty(list)) {
      assert.ok(result.length < length, 'byte list exceeds expected length');
      result.push(api.bytesHead(list));
      list = api.bytesTail(list);
    }
    return result;
  };
  const fullBuffer = Array.from({ length: 65536 }, (_, i) => (i * 73 + 19) % 256);
  const suffix = [255, 0, 10, 195, 169];
  // The chain operand appends onto a result of the emitted recursion, so the
  // left operand of the second append is a list the module itself built.
  const chain = [7, 200];
  const chainList = encodeBytes(bytesApi, chain);
  for (const [left, right] of [[[], []], [[], suffix], [suffix, []],
    [[65, 0, 255], suffix], [fullBuffer, []], [fullBuffer, suffix], [suffix, fullBuffer],
    [fullBuffer, fullBuffer]]) {
    const leftList = encodeBytes(bytesApi, left);
    const rightList = encodeBytes(bytesApi, right);
    const appended = bytesApi.bytesAppend(leftList, rightList);
    verify(() => assert.deepEqual(decodeBytes(bytesApi, appended, left.length + right.length), [...left, ...right]));
    verify(() => assert.deepEqual(decodeBytes(bytesApi, leftList, left.length), left));
    const chained = bytesApi.bytesAppend(appended, chainList);
    verify(() => assert.deepEqual(decodeBytes(bytesApi, chained, left.length + right.length + chain.length),
      [...left, ...right, ...chain]));
  }

  // Exercise a real compiled state machine through the same CLI a user runs.
  const reactorExports = ['emptyBytes', 'consBytes', 'bytesEmpty', 'bytesHead', 'bytesTail',
    'emptyWords', 'consWords', 'wordsEmpty', 'wordsHead', 'wordsTail',
    'init', 'resume', 'requestCode', 'requestArgs', 'requestBody', 'exitCode'];
  const directories = join(scratch, 'temp-directory.wasm');
  const directoryBuild = run(['build', shared, fixture('temp-directory'), '-o', directories,
    ...reactorExports.flatMap(name => ['--export', name])]);
  verify(() => assert.equal(directoryBuild.status, 0, directoryBuild.stderr));
  verify(() => assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(readFileSync(directories))).length, 0));
  const directoryRoot = join(realpathSync(scratch), 'directories');
  for (const prefix of ['../escape-', 'nested/', '..\\escape-', 'nested\\child']) {
    const rejected = runModule([directories, 'directories', prefix]);
    verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
    verify(() => assert.equal(rejected.stdout, 'IO: temporary directory prefix must not contain path separators'));
    verify(() => assert.equal(rejected.stderr, ''));
    verify(() => assert.equal(existsSync(directoryRoot), false));
    verify(() => assert.equal(readdirSync(scratch).some(name => name.startsWith('escape-')), false));
  }
  for (const prefix of ['', '.', '..', 'request-', 'héllo ']) {
    const created = runModule([directories, 'directories/unused/..', prefix]);
    verify(() => assert.equal(created.status, 0, created.error ?? created.stderr));
    verify(() => assert.equal(created.stderr, ''));
    verify(() => assert.equal(dirname(created.stdout), directoryRoot));
    verify(() => assert.ok(basename(created.stdout).startsWith(prefix)));
    verify(() => assert.ok(basename(created.stdout).length > prefix.length));
    const info = statSync(created.stdout);
    verify(() => assert.ok(info.isDirectory()));
    if (process.platform !== 'win32') verify(() => assert.equal(info.mode & 0o777, 0o700));
  }
  verify(() => assert.equal(readdirSync(directoryRoot).length, 5));
  const cleanup = join(scratch, 'file-cleanup.wasm');
  const cleanupBuild = run(['build', shared, fixture('file-cleanup'), '-o', cleanup,
    ...reactorExports.flatMap(name => ['--export', name])]);
  verify(() => assert.equal(cleanupBuild.status, 0, cleanupBuild.stderr));
  verify(() => assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(readFileSync(cleanup))).length, 0));
  const cleanupDirectory = join(scratch, 'cleanup');
  const cleanupFile = join(cleanupDirectory, 'héllo world');
  const emptyDirectory = join(scratch, 'cleanup-empty');
  mkdirSync(cleanupDirectory);
  mkdirSync(emptyDirectory);
  writeFileSync(cleanupFile, 'keep until unlinked');
  for (const [code, target] of [[19, cleanupFile], [20, emptyDirectory]]) {
    for (const args of [[], [target, 'surplus']]) {
      const rejected = runModule([cleanup, String.fromCharCode(code), ...args]);
      verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
      verify(() => assert.equal(rejected.stdout, `IO: OS request ${code} expects 1 argument, got ${args.length}`));
      verify(() => assert.equal(rejected.stderr, ''));
      verify(() => assert.ok(existsSync(target)));
    }
  }
  for (const [code, target, error] of [[19, emptyDirectory, /^(EISDIR|EPERM|EACCES):/],
    [20, cleanupFile, /^ENOTDIR:/], [20, cleanupDirectory, /^(ENOTEMPTY|EEXIST):/]]) {
    const rejected = runModule([cleanup, String.fromCharCode(code), target]);
    verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
    verify(() => assert.match(rejected.stdout, error));
    verify(() => assert.equal(rejected.stderr, ''));
    verify(() => assert.equal(readFileSync(cleanupFile, 'utf8'), 'keep until unlinked'));
    verify(() => assert.deepEqual(readdirSync(emptyDirectory), []));
  }
  for (const [code, target] of [[19, 'cleanup/héllo world'], [20, 'cleanup'], [20, 'cleanup-empty']]) {
    const removed = runModule([cleanup, String.fromCharCode(code), target]);
    verify(() => assert.equal(removed.status, 0, removed.error ?? removed.stderr));
    verify(() => assert.equal(removed.stdout, ''));
    verify(() => assert.equal(removed.stderr, ''));
    verify(() => assert.equal(existsSync(join(scratch, target)), false));
    const missing = runModule([cleanup, String.fromCharCode(code), target]);
    verify(() => assert.equal(missing.status, 1, missing.error ?? missing.stderr));
    verify(() => assert.match(missing.stdout, /^ENOENT:/));
    verify(() => assert.equal(missing.stderr, ''));
  }
  const predicates = join(scratch, 'list-predicates.wasm');
  const predicateBuild = run(['build', fixture('list-predicates'), '-o', predicates,
    ...reactorExports.flatMap(name => ['--export', name])]);
  verify(() => assert.equal(predicateBuild.status, 0, predicateBuild.stderr));
  verify(() => assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(readFileSync(predicates))).length, 0));
  for (const [mode, predicate] of [['words', 'wordsEmpty'], ['argument', 'bytesEmpty'], ['body', 'bytesEmpty']]) {
    const rejected = runModule([predicates, mode]);
    verify(() => assert.equal(rejected.status, 2, rejected.stderr));
    verify(() => assert.equal(rejected.stdout, ''));
    verify(() => assert.equal(rejected.stderr, `kanon reactor: invalid ABI predicate ${predicate}: expected 0 or 1\n`));
  }
  const validPredicates = spawnSync(process.execPath, [join(root, 'runtime/run.mjs'), predicates, 'valid'],
    { cwd: scratch, timeout: 20000 });
  verify(() => assert.equal(validPredicates.status, 0, String(validPredicates.stderr)));
  verify(() => assert.deepEqual(validPredicates.stdout, Buffer.from([65, 0, 255])));
  verify(() => assert.equal(validPredicates.stderr.length, 0));
  const cycles = join(scratch, 'list-cycles.wasm');
  const cycleBuild = run(['build', fixture('list-cycles'), '-o', cycles,
    ...reactorExports.flatMap(name => ['--export', name])]);
  verify(() => assert.equal(cycleBuild.status, 0, cycleBuild.stderr));
  verify(() => assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(readFileSync(cycles))).length, 0));
  for (const mode of ['words', 'argument', 'body']) {
    const rejected = runModule([cycles, mode]);
    verify(() => assert.equal(rejected.status, 2, `${mode}: ${rejected.error ?? rejected.stderr}`));
    verify(() => assert.equal(rejected.stdout, ''));
    verify(() => assert.equal(rejected.stderr, 'kanon reactor: reactor request exceeds 1048576 list nodes\n'));
  }
  const validCycles = spawnSync(process.execPath, [join(root, 'runtime/run.mjs'), cycles, 'valid'],
    { cwd: scratch, timeout: 20000 });
  verify(() => assert.equal(validCycles.status, 0, String(validCycles.stderr)));
  verify(() => assert.deepEqual(validCycles.stdout, Buffer.from([65, 0, 255])));
  verify(() => assert.equal(validCycles.stderr.length, 0));
  const release = join(scratch, 'blob-release.wasm');
  const releaseBuild = run(['build', shared, fixture('blob-release'), '-o', release,
    ...reactorExports.flatMap(name => ['--export', name])]);
  verify(() => assert.equal(releaseBuild.status, 0, releaseBuild.stderr));
  verify(() => assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(readFileSync(release))).length, 0));
  for (const [code, args] of [[11, ['1', '9', '2']], [13, ['1', '0', '1']], [14, ['1']],
    [16, ['2', '0', '2', '1']], [17, ['1']], [18, ['1']]]) {
    const retired = runModule([release, String.fromCharCode(code), ...args]);
    verify(() => assert.equal(retired.status, 1, `operation ${code}: ${retired.error ?? retired.stderr}`));
    verify(() => assert.equal(retired.stdout, 'IO: unknown blob slot 1'));
    verify(() => assert.equal(retired.stderr, ''));
  }
  for (const [args, answer] of [[[], 'IO: OS request 18 expects 1 argument, got 0'],
    [['2', '2'], 'IO: OS request 18 expects 1 argument, got 2'],
    [['2\n'], 'IO: invalid OS numeric argument']]) {
    const invalid = runModule([release, String.fromCharCode(18), ...args]);
    verify(() => assert.equal(invalid.status, 1, invalid.stderr));
    verify(() => assert.equal(invalid.stdout, answer));
    verify(() => assert.equal(invalid.stderr, ''));
  }
  for (const [code, args, answer] of [[17, ['2'], '7'], [11, ['2', '7', '0'], '0'],
    [18, ['0002'], '']]) {
    const live = runModule([release, String.fromCharCode(code), ...args]);
    verify(() => assert.equal(live.status, 0, live.stderr));
    verify(() => assert.equal(live.stdout, answer));
    verify(() => assert.equal(live.stderr, ''));
  }
  const application = join(scratch, 'realpath.wasm');
  const applicationBuild = run(['build', shared,
    join(root, 'examples/reactor-realpath.kan'), '-o', application,
    ...reactorExports.flatMap(name => ['--export', name])]);
  verify(() => assert.equal(applicationBuild.status, 0, applicationBuild.stderr));
  const { instance: applicationInstance } = await WebAssembly.instantiate(readFileSync(application));
  const app = applicationInstance.exports;
  const toBytes = bytes => bytes.reduceRight((tail, byte) => app.consBytes(byte, tail), app.emptyBytes());
  const fromBytes = list => {
    const result = [];
    while (!app.bytesEmpty(list)) {
      result.push(app.bytesHead(list));
      list = app.bytesTail(list);
    }
    return result;
  };
  const pending = app.init(app.consWords(toBytes([65]), app.emptyWords()));
  verify(() => assert.equal(app.requestCode(pending), 8));
  const rawAnswer = [65, 0, 255, 195, 169];
  const reporting = app.resume(pending, 0, toBytes(rawAnswer));
  verify(() => assert.equal(app.requestCode(reporting), 6));
  verify(() => assert.deepEqual(fromBytes(app.requestBody(reporting)), [...rawAnswer, 10]));
  const writeFailure = app.resume(reporting, 1, app.emptyBytes());
  verify(() => assert.equal(app.requestCode(writeFailure), 0));
  verify(() => assert.equal(app.exitCode(writeFailure), 1));
  for (const status of [0, 1]) {
    const longAnswer = app.resume(pending, status, toBytes(fullBuffer));
    verify(() => assert.equal(app.requestCode(longAnswer), status === 0 ? 6 : 7));
    verify(() => assert.deepEqual(decodeBytes(app, app.requestBody(longAnswer), fullBuffer.length + 1), [...fullBuffer, 10]));
    const completed = app.resume(longAnswer, 0, app.emptyBytes());
    verify(() => assert.equal(app.requestCode(completed), 0));
    verify(() => assert.equal(app.exitCode(completed), status));
  }
  const directory = join(scratch, 'caf\u00e9 path');
  mkdirSync(directory);
  const success = runModule([application, 'caf\u00e9 path']);
  verify(() => assert.equal(success.status, 0, success.stderr));
  verify(() => assert.equal(success.stdout, `${realpathSync(directory)}\n`));
  verify(() => assert.equal(success.stderr, ''));

  mkdirSync(join(scratch, '--help'));
  const flagPath = runModule([application, '--help']);
  verify(() => assert.equal(flagPath.status, 0, flagPath.stderr));
  verify(() => assert.equal(flagPath.stdout, `${realpathSync(join(scratch, '--help'))}\n`));
  const missingPath = runModule([application, 'missing-path']);
  verify(() => assert.equal(missingPath.status, 1, missingPath.stderr));
  verify(() => assert.equal(missingPath.stdout, ''));
  verify(() => assert.match(missingPath.stderr, /^ENOENT:.*missing-path.*\n$/));
  for (const args of [[], ['one', 'two']]) {
    const invalid = runModule([application, ...args]);
    verify(() => assert.equal(invalid.status, 64, invalid.stderr));
    verify(() => assert.equal(invalid.stdout, ''));
    verify(() => assert.equal(invalid.stderr, 'usage: reactor-realpath PATH\n'));
  }

  const noModule = runModule([]);
  verify(() => assert.equal(noModule.status, 64));
  verify(() => assert.equal(noModule.stdout, ''));
  verify(() => assert.match(noModule.stderr, /^Usage:/));
  const help = runModule(['--help']);
  verify(() => assert.equal(help.status, 0));
  verify(() => assert.match(help.stdout, /^Usage:/));
  verify(() => assert.equal(help.stderr, ''));
  const absentModule = runModule([join(scratch, 'absent.wasm')]);
  verify(() => assert.equal(absentModule.status, 2));
  verify(() => assert.equal(absentModule.stdout, ''));
  verify(() => assert.match(absentModule.stderr, /^kanon reactor:.*ENOENT.*\n$/));
  const invalidModule = runModule([output]);
  verify(() => assert.equal(invalidModule.status, 2));
  verify(() => assert.equal(invalidModule.stdout, ''));
  verify(() => assert.match(invalidModule.stderr, /^kanon reactor: missing reactor export emptyBytes\n$/));
  process.stdout.write(`reactor: ${checks} checks passed\n`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
