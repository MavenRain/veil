import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, realpathSync, rmSync, readdirSync, statSync, lstatSync, existsSync, renameSync, symlinkSync, readlinkSync, utimesSync, chmodSync, linkSync } from 'node:fs';
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
  const rename = join(scratch, 'file-rename.wasm');
  const renameBuild = run(['build', shared, fixture('file-rename'), '-o', rename,
    ...reactorExports.flatMap(name => ['--export', name])]);
  verify(() => assert.equal(renameBuild.status, 0, renameBuild.stderr));
  verify(() => assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(readFileSync(rename))).length, 0));
  const renameSource = join(scratch, 'rename-source');
  const renameDirectory = join(scratch, 'rename-directory');
  const renameTarget = join(renameDirectory, 'héllo world');
  const renameContent = Buffer.from([0, 255, 128, 10, 65]);
  mkdirSync(renameDirectory);
  writeFileSync(renameSource, renameContent);
  writeFileSync(renameTarget, 'original destination');
  const renameIdentity = statSync(renameSource);
  for (const args of [[], [renameSource], [renameSource, renameTarget, 'surplus']]) {
    const rejected = runModule([rename, ...args]);
    verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
    verify(() => assert.equal(rejected.stdout, `IO: OS request 21 expects 2 arguments, got ${args.length}`));
    verify(() => assert.equal(rejected.stderr, ''));
    verify(() => assert.deepEqual(readFileSync(renameSource), renameContent));
    verify(() => assert.equal(readFileSync(renameTarget, 'utf8'), 'original destination'));
  }
  for (const args of [['rename-source', 'rename-directory/héllo world'], [renameTarget, renameTarget]]) {
    const moved = runModule([rename, ...args]);
    verify(() => assert.equal(moved.status, 0, moved.error ?? moved.stderr));
    verify(() => assert.equal(moved.stdout, ''));
    verify(() => assert.equal(moved.stderr, ''));
    verify(() => assert.equal(existsSync(renameSource), false));
    verify(() => assert.deepEqual(readFileSync(renameTarget), renameContent));
    verify(() => assert.equal(statSync(renameTarget).ino, renameIdentity.ino));
    verify(() => assert.equal(statSync(renameTarget).mode, renameIdentity.mode));
  }
  const renameMissing = runModule([rename, renameSource, renameTarget]);
  verify(() => assert.equal(renameMissing.status, 1, renameMissing.error ?? renameMissing.stderr));
  verify(() => assert.match(renameMissing.stdout, /^ENOENT:/));
  verify(() => assert.equal(renameMissing.stderr, ''));
  verify(() => assert.deepEqual(readFileSync(renameTarget), renameContent));
  const renamedDirectory = join(scratch, 'renamed-directory');
  const directoryMove = runModule([rename, renameDirectory, renamedDirectory]);
  verify(() => assert.equal(directoryMove.status, 0, directoryMove.error ?? directoryMove.stderr));
  verify(() => assert.equal(directoryMove.stdout, ''));
  verify(() => assert.equal(directoryMove.stderr, ''));
  verify(() => assert.equal(existsSync(renameDirectory), false));
  verify(() => assert.deepEqual(readFileSync(join(renamedDirectory, 'héllo world')), renameContent));
  const entryKind = join(scratch, 'entry-kind.wasm');
  const entryKindBuild = run(['build', shared, fixture('entry-kind'), '-o', entryKind,
    ...reactorExports.flatMap(name => ['--export', name])]);
  verify(() => assert.equal(entryKindBuild.status, 0, entryKindBuild.stderr));
  verify(() => assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(readFileSync(entryKind))).length, 0));
  const entryDirectory = join(scratch, 'entry-directory');
  const entryFile = join(entryDirectory, 'héllo world\nfile');
  mkdirSync(entryDirectory);
  writeFileSync(entryFile, 'preserved');
  const entryCases = [[entryDirectory, 'directory'], [entryFile, 'file'],
    ['entry-directory/héllo world\nfile', 'file']];
  if (process.platform !== 'win32') {
    const fileLink = join(scratch, 'entry-file-link');
    const directoryLink = join(scratch, 'entry-directory-link');
    const danglingLink = join(scratch, 'entry-dangling-link');
    symlinkSync(entryFile, fileLink);
    symlinkSync(entryDirectory, directoryLink);
    symlinkSync(join(scratch, 'entry-missing'), danglingLink);
    entryCases.push([fileLink, 'symlink'], [directoryLink, 'symlink'], [danglingLink, 'symlink'],
      [join(directoryLink, 'héllo world\nfile'), 'file'], ['/dev/null', 'other']);
  }
  for (const [path, expected] of entryCases) {
    const inspected = runModule([entryKind, path]);
    verify(() => assert.equal(inspected.status, 0, inspected.error ?? inspected.stderr));
    verify(() => assert.equal(inspected.stdout, expected));
    verify(() => assert.equal(inspected.stderr, ''));
  }
  for (const args of [[], [entryFile, 'surplus']]) {
    const rejected = runModule([entryKind, ...args]);
    verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
    verify(() => assert.equal(rejected.stdout, `IO: OS request 23 expects 1 argument, got ${args.length}`));
    verify(() => assert.equal(rejected.stderr, ''));
  }
  for (const path of [join(scratch, 'entry-missing'), '']) {
    const missing = runModule([entryKind, path]);
    verify(() => assert.equal(missing.status, 1, missing.error ?? missing.stderr));
    verify(() => assert.match(missing.stdout, /^ENOENT:/));
    verify(() => assert.equal(missing.stderr, ''));
  }
  verify(() => assert.equal(readFileSync(entryFile, 'utf8'), 'preserved'));
  const symlinkTarget = join(scratch, 'symlink-target.wasm');
  const symlinkTargetBuild = run(['build', shared, fixture('symlink-target'), '-o', symlinkTarget,
    ...reactorExports.flatMap(name => ['--export', name])]);
  verify(() => assert.equal(symlinkTargetBuild.status, 0, symlinkTargetBuild.stderr));
  const symlinkTargetBytes = readFileSync(symlinkTarget);
  verify(() => assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(symlinkTargetBytes)).length, 0));
  const { instance: symlinkTargetInstance } = await WebAssembly.instantiate(symlinkTargetBytes);
  const linkApi = symlinkTargetInstance.exports;
  const linkPending = linkApi.init(linkApi.emptyWords());
  verify(() => assert.equal(linkApi.requestCode(linkPending), 24));
  for (const [status, answer] of [[0, Buffer.from([46, 47, 255, 128, 10, 195, 169])],
    [0, Buffer.alloc(65536, 255)], [1, Buffer.from('EIO: injected read failure')]]) {
    let bytes = linkApi.emptyBytes();
    for (let index = answer.length - 1; index >= 0; index--) bytes = linkApi.consBytes(answer[index], bytes);
    const reporting = linkApi.resume(linkPending, status, bytes);
    verify(() => assert.equal(linkApi.requestCode(reporting), 6));
    verify(() => assert.ok(Buffer.from(decodeBytes(linkApi, linkApi.requestBody(reporting), answer.length)).equals(answer),
      `symlink target fixture changed ${answer.length} response bytes`));
    for (const writeStatus of [0, 1]) {
      const finished = linkApi.resume(reporting, writeStatus, linkApi.emptyBytes());
      verify(() => assert.equal(linkApi.requestCode(finished), 0));
      verify(() => assert.equal(linkApi.exitCode(finished), status + writeStatus));
    }
  }
  if (process.platform !== 'win32') {
    const targets = ['./entry-directory/héllo world\nfile', entryFile, entryDirectory,
      'missing/../dangling', 'symlink-target-0', 'symlink-target-5'];
    for (const [index, target] of targets.entries()) {
      const path = join(scratch, `symlink-target-${index}`);
      symlinkSync(target, path);
      for (const argument of [path, basename(path)]) {
        const read = spawnSync(process.execPath, [join(root, 'runtime/run.mjs'), symlinkTarget, argument],
          { cwd: scratch, timeout: 20000 });
        verify(() => assert.equal(read.status, 0, read.error ?? String(read.stderr)));
        verify(() => assert.deepEqual(read.stdout, Buffer.from(target)));
        verify(() => assert.equal(read.stderr.length, 0));
      }
    }
    for (const path of [entryFile, entryDirectory]) {
      const rejected = runModule([symlinkTarget, path]);
      verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
      verify(() => assert.match(rejected.stdout, /^EINVAL:/));
      verify(() => assert.equal(rejected.stderr, ''));
    }
  }
  for (const args of [[], [entryFile, 'surplus']]) {
    const rejected = runModule([symlinkTarget, ...args]);
    verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
    verify(() => assert.equal(rejected.stdout, `IO: OS request 24 expects 1 argument, got ${args.length}`));
    verify(() => assert.equal(rejected.stderr, ''));
  }
  for (const path of [join(scratch, 'symlink-target-missing'), '']) {
    const missing = runModule([symlinkTarget, path]);
    verify(() => assert.equal(missing.status, 1, missing.error ?? missing.stderr));
    verify(() => assert.match(missing.stdout, /^ENOENT:/));
    verify(() => assert.equal(missing.stderr, ''));
  }
  const symlinkCreate = join(scratch, 'symlink-create.wasm');
  const symlinkCreateBuild = run(['build', shared, fixture('symlink-create'), '-o', symlinkCreate,
    ...reactorExports.flatMap(name => ['--export', name])]);
  verify(() => assert.equal(symlinkCreateBuild.status, 0, symlinkCreateBuild.stderr));
  const symlinkCreateBytes = readFileSync(symlinkCreate);
  verify(() => assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(symlinkCreateBytes)).length, 0));
  const { instance: symlinkCreateInstance } = await WebAssembly.instantiate(symlinkCreateBytes);
  const createApi = symlinkCreateInstance.exports;
  let createArgs = createApi.emptyWords();
  for (const argument of ['./destination', '../héllo//target']) {
    let bytes = createApi.emptyBytes();
    for (const byte of Buffer.from(argument).reverse()) bytes = createApi.consBytes(byte, bytes);
    createArgs = createApi.consWords(bytes, createArgs);
  }
  const createPending = createApi.init(createArgs);
  verify(() => assert.equal(createApi.requestCode(createPending), 25));
  const forwardedArgs = createApi.requestArgs(createPending);
  verify(() => assert.deepEqual(Buffer.from(decodeBytes(createApi, createApi.wordsHead(forwardedArgs), Buffer.byteLength('../héllo//target'))), Buffer.from('../héllo//target')));
  verify(() => assert.deepEqual(Buffer.from(decodeBytes(createApi, createApi.wordsHead(createApi.wordsTail(forwardedArgs)), Buffer.byteLength('./destination'))), Buffer.from('./destination')));
  verify(() => assert.equal(createApi.wordsEmpty(createApi.wordsTail(createApi.wordsTail(forwardedArgs))), 1));
  verify(() => assert.equal(createApi.bytesEmpty(createApi.requestBody(createPending)), 1));
  verify(() => assert.equal(createApi.exitCode(createPending), 1));
  for (const [status, answer] of [[0, Buffer.alloc(0)], [1, Buffer.from('EEXIST: injected conflict')]]) {
    let bytes = createApi.emptyBytes();
    for (const byte of Buffer.from(answer).reverse()) bytes = createApi.consBytes(byte, bytes);
    const reporting = createApi.resume(createPending, status, bytes);
    verify(() => assert.equal(createApi.requestCode(reporting), 6));
    verify(() => assert.equal(createApi.wordsEmpty(createApi.requestArgs(reporting)), 1));
    verify(() => assert.deepEqual(Buffer.from(decodeBytes(createApi, createApi.requestBody(reporting), answer.length)), answer));
    for (const writeStatus of [0, 1]) {
      const finished = createApi.resume(reporting, writeStatus, createApi.emptyBytes());
      verify(() => assert.equal(createApi.requestCode(finished), 0));
      verify(() => assert.equal(createApi.exitCode(finished), status + writeStatus));
    }
  }
  const createDestination = join(scratch, 'symlink-create-new');
  for (const args of [[], [entryFile], [entryFile, createDestination, 'surplus']]) {
    const rejected = runModule([symlinkCreate, ...args]);
    verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
    verify(() => assert.equal(rejected.stdout, `IO: OS request 25 expects 2 arguments, got ${args.length}`));
    verify(() => assert.equal(rejected.stderr, ''));
    verify(() => assert.throws(() => lstatSync(createDestination), { code: 'ENOENT' }));
  }
  if (process.platform !== 'win32') {
    const targets = [entryFile, entryDirectory, './entry-directory/héllo world\nfile',
      'missing/../dangling', 'symlink-create-0', 'symlink-create-5'];
    for (const [index, target] of targets.entries()) {
      const path = join(scratch, `symlink-create-${index}`);
      const created = runModule([symlinkCreate, target, index % 2 ? basename(path) : path]);
      verify(() => assert.equal(created.status, 0, created.error ?? created.stderr));
      verify(() => assert.equal(created.stdout, ''));
      verify(() => assert.equal(created.stderr, ''));
      verify(() => assert.ok(lstatSync(path).isSymbolicLink()));
      verify(() => assert.deepEqual(readlinkSync(path, { encoding: 'buffer' }), Buffer.from(target)));
      const duplicate = runModule([symlinkCreate, 'replacement', path]);
      verify(() => assert.equal(duplicate.status, 1, duplicate.error ?? duplicate.stderr));
      verify(() => assert.match(duplicate.stdout, /^EEXIST:/));
      verify(() => assert.equal(duplicate.stderr, ''));
      verify(() => assert.deepEqual(readlinkSync(path, { encoding: 'buffer' }), Buffer.from(target)));
    }
    for (const [target, destination, error] of [
      ['target', entryFile, /^EEXIST:/], ['target', entryDirectory, /^EEXIST:/],
      ['target', join(scratch, 'absent-parent', 'link'), /^ENOENT:/],
      ['target', join(entryFile, 'child'), /^ENOTDIR:/], ['target', '', /^ENOENT:/],
    ]) {
      const rejected = runModule([symlinkCreate, target, destination]);
      verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
      verify(() => assert.match(rejected.stdout, error));
      verify(() => assert.equal(rejected.stderr, ''));
    }
  }
  const hardLink = join(scratch, 'hard-link.wasm');
  const hardLinkBuild = run(['build', shared, fixture('hard-link'), '-o', hardLink,
    ...reactorExports.flatMap(name => ['--export', name])]);
  verify(() => assert.equal(hardLinkBuild.status, 0, hardLinkBuild.stderr));
  const hardLinkBytes = readFileSync(hardLink);
  verify(() => assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(hardLinkBytes)).length, 0));
  const { instance: hardLinkInstance } = await WebAssembly.instantiate(hardLinkBytes);
  const hardLinkApi = hardLinkInstance.exports;
  let hardLinkArgs = hardLinkApi.emptyWords();
  for (const argument of ['./destination', '../héllo//source']) {
    let bytes = hardLinkApi.emptyBytes();
    for (const byte of Buffer.from(argument).reverse()) bytes = hardLinkApi.consBytes(byte, bytes);
    hardLinkArgs = hardLinkApi.consWords(bytes, hardLinkArgs);
  }
  const hardLinkPending = hardLinkApi.init(hardLinkArgs);
  verify(() => assert.equal(hardLinkApi.requestCode(hardLinkPending), 26));
  let hardLinkForwarded = hardLinkApi.requestArgs(hardLinkPending);
  for (const expected of ['../héllo//source', './destination']) {
    verify(() => assert.deepEqual(Buffer.from(decodeBytes(hardLinkApi, hardLinkApi.wordsHead(hardLinkForwarded), Buffer.byteLength(expected))), Buffer.from(expected)));
    hardLinkForwarded = hardLinkApi.wordsTail(hardLinkForwarded);
  }
  verify(() => assert.equal(hardLinkApi.wordsEmpty(hardLinkForwarded), 1));
  verify(() => assert.equal(hardLinkApi.bytesEmpty(hardLinkApi.requestBody(hardLinkPending)), 1));
  verify(() => assert.equal(hardLinkApi.exitCode(hardLinkPending), 1));
  for (const [status, answer] of [[0, Buffer.alloc(0)], [1, Buffer.from('EXDEV: injected failure')]]) {
    let bytes = hardLinkApi.emptyBytes();
    for (const byte of Buffer.from(answer).reverse()) bytes = hardLinkApi.consBytes(byte, bytes);
    const reporting = hardLinkApi.resume(hardLinkPending, status, bytes);
    verify(() => assert.equal(hardLinkApi.exitCode(reporting), status));
    verify(() => assert.equal(hardLinkApi.requestCode(reporting), 6));
    verify(() => assert.equal(hardLinkApi.wordsEmpty(hardLinkApi.requestArgs(reporting)), 1));
    verify(() => assert.deepEqual(Buffer.from(decodeBytes(hardLinkApi, hardLinkApi.requestBody(reporting), answer.length)), answer));
    for (const writeStatus of [0, 1]) {
      const finished = hardLinkApi.resume(reporting, writeStatus, hardLinkApi.emptyBytes());
      verify(() => assert.equal(hardLinkApi.requestCode(finished), 0));
      verify(() => assert.equal(hardLinkApi.exitCode(finished), status + writeStatus));
    }
  }
  const hardLinkSource = join(scratch, 'hard-link-source');
  const hardLinkDestination = join(scratch, 'hard-link-destination');
  const hardLinkContent = Buffer.from([0, 255, 128, 10, 65]);
  writeFileSync(hardLinkSource, hardLinkContent);
  for (const args of [[], [hardLinkSource], [hardLinkSource, hardLinkDestination, 'surplus']]) {
    const rejected = runModule([hardLink, ...args]);
    verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
    verify(() => assert.equal(rejected.stdout, `IO: OS request 26 expects 2 arguments, got ${args.length}`));
    verify(() => assert.equal(rejected.stderr, ''));
    verify(() => assert.throws(() => lstatSync(hardLinkDestination), { code: 'ENOENT' }));
  }
  const hardLinked = runModule([hardLink, basename(hardLinkSource), basename(hardLinkDestination)]);
  verify(() => assert.equal(hardLinked.status, 0, hardLinked.error ?? hardLinked.stderr));
  verify(() => assert.equal(hardLinked.stdout, ''));
  verify(() => assert.equal(hardLinked.stderr, ''));
  const hardLinkInfo = lstatSync(hardLinkSource);
  const hardLinkedInfo = lstatSync(hardLinkDestination);
  verify(() => assert.ok(hardLinkedInfo.isFile()));
  verify(() => assert.deepEqual([hardLinkedInfo.dev, hardLinkedInfo.ino], [hardLinkInfo.dev, hardLinkInfo.ino]));
  verify(() => assert.equal(hardLinkedInfo.nlink, 2));
  verify(() => assert.deepEqual(readFileSync(hardLinkDestination), hardLinkContent));
  const hardLinkDuplicate = runModule([hardLink, hardLinkSource, hardLinkDestination]);
  verify(() => assert.equal(hardLinkDuplicate.status, 1, hardLinkDuplicate.error ?? hardLinkDuplicate.stderr));
  verify(() => assert.match(hardLinkDuplicate.stdout, /^EEXIST:/));
  verify(() => assert.equal(hardLinkDuplicate.stderr, ''));
  verify(() => assert.equal(lstatSync(hardLinkDestination).ino, hardLinkInfo.ino));
  writeFileSync(hardLinkDestination, 'shared update');
  verify(() => assert.equal(readFileSync(hardLinkSource, 'utf8'), 'shared update'));
  rmSync(hardLinkSource);
  verify(() => assert.equal(readFileSync(hardLinkDestination, 'utf8'), 'shared update'));
  verify(() => assert.equal(lstatSync(hardLinkDestination).nlink, 1));
  const hardLinkMissing = join(scratch, 'hard-link-missing');
  for (const [source, destination, error] of [
    [hardLinkSource, hardLinkMissing, /^ENOENT:/],
    [hardLinkDestination, join(scratch, 'hard-link-absent-parent', 'child'), /^ENOENT:/],
    [hardLinkDestination, '', /^ENOENT:/],
  ]) {
    const rejected = runModule([hardLink, source, destination]);
    verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
    verify(() => assert.match(rejected.stdout, error));
    verify(() => assert.equal(rejected.stderr, ''));
  }
  verify(() => assert.throws(() => lstatSync(hardLinkMissing), { code: 'ENOENT' }));
  verify(() => assert.throws(() => lstatSync(join(scratch, 'hard-link-absent-parent')), { code: 'ENOENT' }));

  const fileModified = join(scratch, 'file-modified.wasm');
  const fileModifiedBuild = run(['build', shared, fixture('file-modified'), '-o', fileModified,
    ...reactorExports.flatMap(name => ['--export', name])]);
  verify(() => assert.equal(fileModifiedBuild.status, 0, fileModifiedBuild.stderr));
  const fileModifiedBytes = readFileSync(fileModified);
  verify(() => assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(fileModifiedBytes)).length, 0));
  const { instance: fileModifiedInstance } = await WebAssembly.instantiate(fileModifiedBytes);
  const modifiedApi = fileModifiedInstance.exports;
  const modifiedPath = '../héllo//alias/../file';
  const modifiedBytes = bytes => {
    let result = modifiedApi.emptyBytes();
    for (const byte of Buffer.from(bytes).reverse()) result = modifiedApi.consBytes(byte, result);
    return result;
  };
  const modifiedPending = modifiedApi.init(modifiedApi.consWords(
    modifiedBytes(modifiedPath), modifiedApi.emptyWords()));
  verify(() => assert.equal(modifiedApi.requestCode(modifiedPending), 33));
  const modifiedArgs = modifiedApi.requestArgs(modifiedPending);
  verify(() => assert.deepEqual(Buffer.from(decodeBytes(modifiedApi,
    modifiedApi.wordsHead(modifiedArgs), Buffer.byteLength(modifiedPath))), Buffer.from(modifiedPath)));
  verify(() => assert.equal(modifiedApi.wordsEmpty(modifiedApi.wordsTail(modifiedArgs)), 1));
  verify(() => assert.deepEqual(Buffer.from(decodeBytes(modifiedApi,
    modifiedApi.requestBody(modifiedPending), 3)), Buffer.from([0, 255, 65])));
  verify(() => assert.equal(modifiedApi.exitCode(modifiedPending), 1));
  for (const [status, answer] of [[0, '0'], [0, '1700000000123456789'], [0, '-1'],
    [1, 'EACCES: injected failure']]) {
    const reporting = modifiedApi.resume(modifiedPending, status, modifiedBytes(answer));
    verify(() => assert.equal(modifiedApi.requestCode(reporting), 6));
    verify(() => assert.equal(modifiedApi.wordsEmpty(modifiedApi.requestArgs(reporting)), 1));
    verify(() => assert.deepEqual(Buffer.from(decodeBytes(modifiedApi,
      modifiedApi.requestBody(reporting), Buffer.byteLength(answer))), Buffer.from(answer)));
    verify(() => assert.equal(modifiedApi.exitCode(reporting), status));
    for (const outputStatus of [0, 1]) {
      const finished = modifiedApi.resume(reporting, outputStatus, modifiedApi.emptyBytes());
      verify(() => assert.equal(modifiedApi.requestCode(finished), 0));
      verify(() => assert.equal(modifiedApi.exitCode(finished), status + outputStatus));
      verify(() => assert.equal(modifiedApi.wordsEmpty(modifiedApi.requestArgs(finished)), 1));
      verify(() => assert.equal(modifiedApi.bytesEmpty(modifiedApi.requestBody(finished)), 1));
      const stillFinished = modifiedApi.resume(finished, 1, modifiedBytes('ignored'));
      verify(() => assert.equal(modifiedApi.requestCode(stillFinished), 0));
      verify(() => assert.equal(modifiedApi.exitCode(stillFinished), status + outputStatus));
    }
  }

  const modifiedFile = join(scratch, 'modified héllo');
  const modifiedLink = join(scratch, 'modified-link');
  const modifiedMissing = join(scratch, 'modified-missing');
  const modifiedDangling = join(scratch, 'modified-dangling');
  writeFileSync(modifiedFile, Buffer.from([0, 255, 65]));
  symlinkSync(basename(modifiedFile), modifiedLink);
  symlinkSync(basename(modifiedMissing), modifiedDangling);
  for (const path of [modifiedFile, modifiedLink, scratch + '/', basename(modifiedFile)]) {
    const expected = String(statSync(resolve(scratch, path), { bigint: true }).mtimeNs);
    const result = runModule([fileModified, path]);
    verify(() => assert.equal(result.status, 0, result.error ?? result.stderr));
    verify(() => assert.equal(result.stdout, expected));
    verify(() => assert.equal(result.stderr, ''));
  }
  for (const [args, message] of [
    [[], /^IO: OS request 33 expects 1 argument, got 0$/],
    [[modifiedFile, 'surplus'], /^IO: OS request 33 expects 1 argument, got 2$/],
    [[modifiedMissing], /^ENOENT:/], [[modifiedDangling], /^ENOENT:/],
    [[modifiedFile + '/'], /^ENOTDIR:/], [[''], /^ENOENT:/],
  ]) {
    const rejected = runModule([fileModified, ...args]);
    verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
    verify(() => assert.match(rejected.stdout, message));
    verify(() => assert.equal(rejected.stderr, ''));
  }
  verify(() => assert.deepEqual(readFileSync(modifiedFile), Buffer.from([0, 255, 65])));
  verify(() => assert.equal(readlinkSync(modifiedDangling), basename(modifiedMissing)));
  verify(() => assert.equal(existsSync(modifiedMissing), false));

  const fileAccessed = join(scratch, 'file-accessed.wasm');
  const fileAccessedBuild = run(['build', shared, fixture('file-accessed'), '-o', fileAccessed,
    ...reactorExports.flatMap(name => ['--export', name])]);
  verify(() => assert.equal(fileAccessedBuild.status, 0, fileAccessedBuild.stderr));
  const fileAccessedBytes = readFileSync(fileAccessed);
  verify(() => assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(fileAccessedBytes)).length, 0));
  const { instance: fileAccessedInstance } = await WebAssembly.instantiate(fileAccessedBytes);
  const accessedApi = fileAccessedInstance.exports;
  const accessedPath = '../héllo//alias/../file';
  const accessedBytes = bytes => {
    let result = accessedApi.emptyBytes();
    for (const byte of Buffer.from(bytes).reverse()) result = accessedApi.consBytes(byte, result);
    return result;
  };
  const accessedPending = accessedApi.init(accessedApi.consWords(
    accessedBytes(accessedPath), accessedApi.emptyWords()));
  verify(() => assert.equal(accessedApi.requestCode(accessedPending), 34));
  const accessedArgs = accessedApi.requestArgs(accessedPending);
  verify(() => assert.deepEqual(Buffer.from(decodeBytes(accessedApi,
    accessedApi.wordsHead(accessedArgs), Buffer.byteLength(accessedPath))), Buffer.from(accessedPath)));
  verify(() => assert.equal(accessedApi.wordsEmpty(accessedApi.wordsTail(accessedArgs)), 1));
  verify(() => assert.deepEqual(Buffer.from(decodeBytes(accessedApi,
    accessedApi.requestBody(accessedPending), 3)), Buffer.from([0, 255, 65])));
  verify(() => assert.equal(accessedApi.exitCode(accessedPending), 1));
  for (const [status, answer] of [[0, '0'], [0, '1700000000123456789'], [0, '-1'],
    [1, 'EACCES: injected failure']]) {
    const reporting = accessedApi.resume(accessedPending, status, accessedBytes(answer));
    verify(() => assert.equal(accessedApi.requestCode(reporting), 6));
    verify(() => assert.equal(accessedApi.wordsEmpty(accessedApi.requestArgs(reporting)), 1));
    verify(() => assert.deepEqual(Buffer.from(decodeBytes(accessedApi,
      accessedApi.requestBody(reporting), Buffer.byteLength(answer))), Buffer.from(answer)));
    verify(() => assert.equal(accessedApi.exitCode(reporting), status));
    for (const outputStatus of [0, 1]) {
      const finished = accessedApi.resume(reporting, outputStatus, accessedApi.emptyBytes());
      verify(() => assert.equal(accessedApi.requestCode(finished), 0));
      verify(() => assert.equal(accessedApi.exitCode(finished), status + outputStatus));
      verify(() => assert.equal(accessedApi.wordsEmpty(accessedApi.requestArgs(finished)), 1));
      verify(() => assert.equal(accessedApi.bytesEmpty(accessedApi.requestBody(finished)), 1));
      const stillFinished = accessedApi.resume(finished, 1, accessedBytes('ignored'));
      verify(() => assert.equal(accessedApi.requestCode(stillFinished), 0));
      verify(() => assert.equal(accessedApi.exitCode(stillFinished), status + outputStatus));
    }
  }

  const accessedFile = join(scratch, 'accessed héllo');
  const accessedLink = join(scratch, 'accessed-link');
  const accessedMissing = join(scratch, 'accessed-missing');
  const accessedDangling = join(scratch, 'accessed-dangling');
  writeFileSync(accessedFile, Buffer.from([0, 255, 65]));
  utimesSync(accessedFile, 1, 3);
  symlinkSync(basename(accessedFile), accessedLink);
  symlinkSync(basename(accessedMissing), accessedDangling);
  verify(() => assert.notEqual(lstatSync(accessedLink, { bigint: true }).atimeNs,
    statSync(accessedFile, { bigint: true }).atimeNs));
  for (const path of [accessedFile, accessedLink, scratch + '/', basename(accessedFile)]) {
    const expected = String(statSync(resolve(scratch, path), { bigint: true }).atimeNs);
    const result = runModule([fileAccessed, path]);
    verify(() => assert.equal(result.status, 0, result.error ?? result.stderr));
    verify(() => assert.equal(result.stdout, expected));
    verify(() => assert.equal(result.stderr, ''));
  }
  utimesSync(accessedFile, new Date(-1000), new Date(2000));
  const accessedBeforeEpoch = runModule([fileAccessed, accessedFile]);
  verify(() => assert.equal(accessedBeforeEpoch.status, 0, accessedBeforeEpoch.error ?? accessedBeforeEpoch.stderr));
  verify(() => assert.equal(accessedBeforeEpoch.stdout, '-1000000000'));
  verify(() => assert.equal(accessedBeforeEpoch.stderr, ''));
  for (const [args, message] of [
    [[], /^IO: OS request 34 expects 1 argument, got 0$/],
    [[accessedFile, 'surplus'], /^IO: OS request 34 expects 1 argument, got 2$/],
    [[accessedMissing], /^ENOENT:/], [[accessedDangling], /^ENOENT:/],
    [[accessedFile + '/'], /^ENOTDIR:/], [[''], /^ENOENT:/],
  ]) {
    const rejected = runModule([fileAccessed, ...args]);
    verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
    verify(() => assert.match(rejected.stdout, message));
    verify(() => assert.equal(rejected.stderr, ''));
  }
  verify(() => assert.deepEqual(readFileSync(accessedFile), Buffer.from([0, 255, 65])));
  verify(() => assert.equal(readlinkSync(accessedDangling), basename(accessedMissing)));
  verify(() => assert.equal(existsSync(accessedMissing), false));

  const fileChanged = join(scratch, 'file-changed.wasm');
  const fileChangedBuild = run(['build', shared, fixture('file-changed'), '-o', fileChanged,
    ...reactorExports.flatMap(name => ['--export', name])]);
  verify(() => assert.equal(fileChangedBuild.status, 0, fileChangedBuild.stderr));
  const fileChangedBytes = readFileSync(fileChanged);
  verify(() => assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(fileChangedBytes)).length, 0));
  const { instance: fileChangedInstance } = await WebAssembly.instantiate(fileChangedBytes);
  const changedApi = fileChangedInstance.exports;
  const changedPath = '../héllo//alias/../file';
  const changedBytes = bytes => {
    let result = changedApi.emptyBytes();
    for (const byte of Buffer.from(bytes).reverse()) result = changedApi.consBytes(byte, result);
    return result;
  };
  const changedPending = changedApi.init(changedApi.consWords(
    changedBytes(changedPath), changedApi.emptyWords()));
  verify(() => assert.equal(changedApi.requestCode(changedPending), 35));
  const changedArgs = changedApi.requestArgs(changedPending);
  verify(() => assert.deepEqual(Buffer.from(decodeBytes(changedApi,
    changedApi.wordsHead(changedArgs), Buffer.byteLength(changedPath))), Buffer.from(changedPath)));
  verify(() => assert.equal(changedApi.wordsEmpty(changedApi.wordsTail(changedArgs)), 1));
  verify(() => assert.deepEqual(Buffer.from(decodeBytes(changedApi,
    changedApi.requestBody(changedPending), 3)), Buffer.from([0, 255, 65])));
  verify(() => assert.equal(changedApi.exitCode(changedPending), 1));
  for (const [status, answer] of [[0, '0'], [0, '1700000000123456789'], [0, '-1'],
    [1, 'EACCES: injected failure']]) {
    const reporting = changedApi.resume(changedPending, status, changedBytes(answer));
    verify(() => assert.equal(changedApi.requestCode(reporting), 6));
    verify(() => assert.equal(changedApi.wordsEmpty(changedApi.requestArgs(reporting)), 1));
    verify(() => assert.deepEqual(Buffer.from(decodeBytes(changedApi,
      changedApi.requestBody(reporting), Buffer.byteLength(answer))), Buffer.from(answer)));
    verify(() => assert.equal(changedApi.exitCode(reporting), status));
    for (const outputStatus of [0, 1]) {
      const finished = changedApi.resume(reporting, outputStatus, changedApi.emptyBytes());
      verify(() => assert.equal(changedApi.requestCode(finished), 0));
      verify(() => assert.equal(changedApi.exitCode(finished), status + outputStatus));
      verify(() => assert.equal(changedApi.wordsEmpty(changedApi.requestArgs(finished)), 1));
      verify(() => assert.equal(changedApi.bytesEmpty(changedApi.requestBody(finished)), 1));
      const stillFinished = changedApi.resume(finished, 1, changedBytes('ignored'));
      verify(() => assert.equal(changedApi.requestCode(stillFinished), 0));
      verify(() => assert.equal(changedApi.exitCode(stillFinished), status + outputStatus));
    }
  }

  const changedFile = join(scratch, 'changed héllo');
  const changedLink = join(scratch, 'changed-link');
  const changedHard = join(scratch, 'changed-hard');
  const changedMissing = join(scratch, 'changed-missing');
  const changedDangling = join(scratch, 'changed-dangling');
  writeFileSync(changedFile, Buffer.from([0, 255, 65]), { mode: 0o600 });
  utimesSync(changedFile, 1, 3);
  symlinkSync(basename(changedFile), changedLink);
  linkSync(changedFile, changedHard);
  symlinkSync(basename(changedMissing), changedDangling);
  const changedBefore = statSync(changedFile, { bigint: true });
  verify(() => assert.notEqual(changedBefore.ctimeNs, changedBefore.mtimeNs));
  verify(() => assert.notEqual(changedBefore.ctimeNs, changedBefore.atimeNs));
  verify(() => assert.equal(statSync(changedHard, { bigint: true }).ctimeNs, changedBefore.ctimeNs));
  for (const path of [changedFile, changedLink, changedHard, scratch + '/', basename(changedFile)]) {
    const expected = String(statSync(resolve(scratch, path), { bigint: true }).ctimeNs);
    const result = runModule([fileChanged, path]);
    verify(() => assert.equal(result.status, 0, result.error ?? result.stderr));
    verify(() => assert.equal(result.stdout, expected));
    verify(() => assert.equal(result.stderr, ''));
  }
  const changedMetadata = info => [info.dev, info.ino, info.mode, info.nlink, info.size,
    info.atimeNs, info.mtimeNs, info.ctimeNs, info.birthtimeNs];
  verify(() => assert.deepEqual(changedMetadata(statSync(changedFile, { bigint: true })),
    changedMetadata(changedBefore)));
  chmodSync(changedFile, 0o644);
  const changedAfter = statSync(changedFile, { bigint: true });
  const changedAfterMode = runModule([fileChanged, changedFile]);
  verify(() => assert.equal(changedAfterMode.status, 0, changedAfterMode.error ?? changedAfterMode.stderr));
  verify(() => assert.equal(changedAfterMode.stdout, String(changedAfter.ctimeNs)));
  verify(() => assert.equal(changedAfterMode.stderr, ''));
  verify(() => assert.equal(changedAfter.mode & 0o777n, 0o644n));
  verify(() => assert.equal(changedAfter.mtimeNs, changedBefore.mtimeNs));
  for (const [args, message] of [
    [[], /^IO: OS request 35 expects 1 argument, got 0$/],
    [[changedFile, 'surplus'], /^IO: OS request 35 expects 1 argument, got 2$/],
    [[changedMissing], /^ENOENT:/], [[changedDangling], /^ENOENT:/],
    [[changedFile + '/'], /^ENOTDIR:/], [[''], /^ENOENT:/],
  ]) {
    const rejected = runModule([fileChanged, ...args]);
    verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
    verify(() => assert.match(rejected.stdout, message));
    verify(() => assert.equal(rejected.stderr, ''));
  }
  verify(() => assert.deepEqual(readFileSync(changedFile), Buffer.from([0, 255, 65])));
  verify(() => assert.equal(readlinkSync(changedDangling), basename(changedMissing)));
  verify(() => assert.equal(existsSync(changedMissing), false));

  const fileCreated = join(scratch, 'file-created.wasm');
  const fileCreatedBuild = run(['build', shared, fixture('file-created'), '-o', fileCreated,
    ...reactorExports.flatMap(name => ['--export', name])]);
  verify(() => assert.equal(fileCreatedBuild.status, 0, fileCreatedBuild.stderr));
  const fileCreatedBytes = readFileSync(fileCreated);
  verify(() => assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(fileCreatedBytes)).length, 0));
  const { instance: fileCreatedInstance } = await WebAssembly.instantiate(fileCreatedBytes);
  const createdApi = fileCreatedInstance.exports;
  const createdPath = '../héllo//alias/../file';
  const createdBytes = bytes => {
    let result = createdApi.emptyBytes();
    for (const byte of Buffer.from(bytes).reverse()) result = createdApi.consBytes(byte, result);
    return result;
  };
  const createdPending = createdApi.init(createdApi.consWords(
    createdBytes(createdPath), createdApi.emptyWords()));
  verify(() => assert.equal(createdApi.requestCode(createdPending), 36));
  const createdArgs = createdApi.requestArgs(createdPending);
  verify(() => assert.deepEqual(Buffer.from(decodeBytes(createdApi,
    createdApi.wordsHead(createdArgs), Buffer.byteLength(createdPath))), Buffer.from(createdPath)));
  verify(() => assert.equal(createdApi.wordsEmpty(createdApi.wordsTail(createdArgs)), 1));
  verify(() => assert.deepEqual(Buffer.from(decodeBytes(createdApi,
    createdApi.requestBody(createdPending), 3)), Buffer.from([0, 255, 65])));
  verify(() => assert.equal(createdApi.exitCode(createdPending), 1));
  for (const [status, answer] of [[0, '0'], [0, '9007199254740993'],
    [0, '1700000000123456789'], [0, '-1'], [0, '-9223372036854775808'],
    [0, '9223372036854775807'], [1, 'EACCES: injected failure']]) {
    const reporting = createdApi.resume(createdPending, status, createdBytes(answer));
    verify(() => assert.equal(createdApi.requestCode(reporting), 6));
    verify(() => assert.equal(createdApi.wordsEmpty(createdApi.requestArgs(reporting)), 1));
    verify(() => assert.deepEqual(Buffer.from(decodeBytes(createdApi,
      createdApi.requestBody(reporting), Buffer.byteLength(answer))), Buffer.from(answer)));
    verify(() => assert.equal(createdApi.exitCode(reporting), status));
    for (const outputStatus of [0, 1]) {
      const finished = createdApi.resume(reporting, outputStatus, createdApi.emptyBytes());
      verify(() => assert.equal(createdApi.requestCode(finished), 0));
      verify(() => assert.equal(createdApi.exitCode(finished), status + outputStatus));
      verify(() => assert.equal(createdApi.wordsEmpty(createdApi.requestArgs(finished)), 1));
      verify(() => assert.equal(createdApi.bytesEmpty(createdApi.requestBody(finished)), 1));
      const stillFinished = createdApi.resume(finished, 1, createdBytes('ignored'));
      verify(() => assert.equal(createdApi.requestCode(stillFinished), 0));
      verify(() => assert.equal(createdApi.exitCode(stillFinished), status + outputStatus));
    }
  }

  const createdFile = join(scratch, 'birthtime héllo');
  const createdLink = join(scratch, 'birthtime-link');
  const createdHard = join(scratch, 'birthtime-hard');
  const createdMissing = join(scratch, 'birthtime-missing');
  const createdDangling = join(scratch, 'birthtime-dangling');
  writeFileSync(createdFile, Buffer.from([0, 255, 65]), { mode: 0o600 });
  utimesSync(createdFile, 1, 3);
  symlinkSync(basename(createdFile), createdLink);
  linkSync(createdFile, createdHard);
  symlinkSync(basename(createdMissing), createdDangling);
  const createdBefore = statSync(createdFile, { bigint: true });
  verify(() => assert.equal(statSync(createdHard, { bigint: true }).birthtimeNs, createdBefore.birthtimeNs));
  for (const path of [createdFile, createdLink, createdHard, scratch + '/', basename(createdFile)]) {
    const expected = String(statSync(resolve(scratch, path), { bigint: true }).birthtimeNs);
    const result = runModule([fileCreated, path]);
    verify(() => assert.equal(result.status, 0, result.error ?? result.stderr));
    verify(() => assert.equal(result.stdout, expected));
    verify(() => assert.equal(result.stderr, ''));
  }
  const createdMetadata = info => [info.dev, info.ino, info.mode, info.nlink, info.size,
    info.atimeNs, info.mtimeNs, info.ctimeNs, info.birthtimeNs];
  verify(() => assert.deepEqual(createdMetadata(statSync(createdFile, { bigint: true })),
    createdMetadata(createdBefore)));
  chmodSync(createdFile, 0o644);
  const createdAfter = statSync(createdFile, { bigint: true });
  const createdAfterMode = runModule([fileCreated, createdFile]);
  verify(() => assert.equal(createdAfterMode.status, 0, createdAfterMode.error ?? createdAfterMode.stderr));
  verify(() => assert.equal(createdAfterMode.stdout, String(createdAfter.birthtimeNs)));
  verify(() => assert.equal(createdAfterMode.stderr, ''));
  verify(() => assert.equal(createdAfter.mode & 0o777n, 0o644n));
  verify(() => assert.equal(createdAfter.mtimeNs, createdBefore.mtimeNs));
  for (const [args, message] of [
    [[], /^IO: OS request 36 expects 1 argument, got 0$/],
    [[createdFile, 'surplus'], /^IO: OS request 36 expects 1 argument, got 2$/],
    [[createdMissing], /^ENOENT:/], [[createdDangling], /^ENOENT:/],
    [[createdFile + '/'], /^ENOTDIR:/], [[''], /^ENOENT:/],
  ]) {
    const rejected = runModule([fileCreated, ...args]);
    verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
    verify(() => assert.match(rejected.stdout, message));
    verify(() => assert.equal(rejected.stderr, ''));
  }
  verify(() => assert.deepEqual(readFileSync(createdFile), Buffer.from([0, 255, 65])));
  verify(() => assert.equal(readlinkSync(createdDangling), basename(createdMissing)));
  verify(() => assert.equal(existsSync(createdMissing), false));

  const fileIdentity = join(scratch, 'file-identity.wasm');
  const fileIdentityBuild = run(['build', shared, fixture('file-identity'), '-o', fileIdentity,
    ...reactorExports.flatMap(name => ['--export', name])]);
  verify(() => assert.equal(fileIdentityBuild.status, 0, fileIdentityBuild.stderr));
  const fileIdentityBytes = readFileSync(fileIdentity);
  verify(() => assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(fileIdentityBytes)).length, 0));
  const { instance: fileIdentityInstance } = await WebAssembly.instantiate(fileIdentityBytes);
  const identityApi = fileIdentityInstance.exports;
  const identityPath = '../héllo//alias/../file';
  const identityBytes = bytes => {
    let result = identityApi.emptyBytes();
    for (const byte of Buffer.from(bytes).reverse()) result = identityApi.consBytes(byte, result);
    return result;
  };
  const identityPending = identityApi.init(identityApi.consWords(
    identityBytes(identityPath), identityApi.emptyWords()));
  verify(() => assert.equal(identityApi.requestCode(identityPending), 37));
  const identityArgs = identityApi.requestArgs(identityPending);
  verify(() => assert.deepEqual(Buffer.from(decodeBytes(identityApi,
    identityApi.wordsHead(identityArgs), Buffer.byteLength(identityPath))), Buffer.from(identityPath)));
  verify(() => assert.equal(identityApi.wordsEmpty(identityApi.wordsTail(identityArgs)), 1));
  verify(() => assert.deepEqual(Buffer.from(decodeBytes(identityApi,
    identityApi.requestBody(identityPending), 3)), Buffer.from([0, 255, 65])));
  verify(() => assert.equal(identityApi.exitCode(identityPending), 1));
  for (const [status, answer] of [[0, '0:0'], [0, '1:2'], [0, '0:7'], [0, '7:0'],
    [0, '9007199254740993:9007199254740995'], [0, '18446744073709551615:9223372036854775808'],
    [1, 'EACCES: injected failure']]) {
    const reporting = identityApi.resume(identityPending, status, identityBytes(answer));
    verify(() => assert.equal(identityApi.requestCode(reporting), 6));
    verify(() => assert.equal(identityApi.wordsEmpty(identityApi.requestArgs(reporting)), 1));
    verify(() => assert.deepEqual(Buffer.from(decodeBytes(identityApi,
      identityApi.requestBody(reporting), Buffer.byteLength(answer))), Buffer.from(answer)));
    verify(() => assert.equal(identityApi.exitCode(reporting), status));
    for (const outputStatus of [0, 1]) {
      const finished = identityApi.resume(reporting, outputStatus, identityApi.emptyBytes());
      verify(() => assert.equal(identityApi.requestCode(finished), 0));
      verify(() => assert.equal(identityApi.exitCode(finished), status + outputStatus));
      verify(() => assert.equal(identityApi.wordsEmpty(identityApi.requestArgs(finished)), 1));
      verify(() => assert.equal(identityApi.bytesEmpty(identityApi.requestBody(finished)), 1));
      const stillFinished = identityApi.resume(finished, 1, identityBytes('ignored'));
      verify(() => assert.equal(identityApi.requestCode(stillFinished), 0));
      verify(() => assert.equal(identityApi.exitCode(stillFinished), status + outputStatus));
    }
  }

  const identityFile = join(scratch, 'identity héllo');
  const identityLink = join(scratch, 'identity-link');
  const identityHard = join(scratch, 'identity-hard');
  const identityReplacement = join(scratch, 'identity-replacement');
  const identityMissing = join(scratch, 'identity-missing');
  const identityDangling = join(scratch, 'identity-dangling');
  writeFileSync(identityFile, Buffer.from([0, 255, 65]), { mode: 0o600 });
  symlinkSync(basename(identityFile), identityLink);
  linkSync(identityFile, identityHard);
  symlinkSync(basename(identityMissing), identityDangling);
  const identityBefore = statSync(identityFile, { bigint: true });
  const identityOriginal = `${identityBefore.dev}:${identityBefore.ino}`;
  verify(() => assert.equal(statSync(identityHard, { bigint: true }).ino, identityBefore.ino));
  for (const path of [identityFile, identityLink, identityHard, scratch + '/', basename(identityFile)]) {
    const info = statSync(resolve(scratch, path), { bigint: true });
    const result = runModule([fileIdentity, path]);
    verify(() => assert.equal(result.status, 0, result.error ?? result.stderr));
    verify(() => assert.equal(result.stdout, `${info.dev}:${info.ino}`));
    verify(() => assert.equal(result.stderr, ''));
  }
  const identityMetadata = info => [info.dev, info.ino, info.mode, info.nlink, info.size,
    info.atimeNs, info.mtimeNs, info.ctimeNs, info.birthtimeNs];
  verify(() => assert.deepEqual(identityMetadata(statSync(identityFile, { bigint: true })),
    identityMetadata(identityBefore)));
  writeFileSync(identityReplacement, 'new identity');
  renameSync(identityReplacement, identityFile);
  const identityAfter = statSync(identityFile, { bigint: true });
  const identityUpdated = `${identityAfter.dev}:${identityAfter.ino}`;
  verify(() => assert.notEqual(identityUpdated, identityOriginal));
  for (const [path, expected] of [[identityFile, identityUpdated], [identityLink, identityUpdated],
    [identityHard, identityOriginal]]) {
    const result = runModule([fileIdentity, path]);
    verify(() => assert.equal(result.status, 0, result.error ?? result.stderr));
    verify(() => assert.equal(result.stdout, expected));
    verify(() => assert.equal(result.stderr, ''));
  }
  for (const [args, message] of [
    [[], /^IO: OS request 37 expects 1 argument, got 0$/],
    [[identityFile, 'surplus'], /^IO: OS request 37 expects 1 argument, got 2$/],
    [[identityMissing], /^ENOENT:/], [[identityDangling], /^ENOENT:/],
    [[identityFile + '/'], /^ENOTDIR:/], [[''], /^ENOENT:/],
  ]) {
    const rejected = runModule([fileIdentity, ...args]);
    verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
    verify(() => assert.match(rejected.stdout, message));
    verify(() => assert.equal(rejected.stderr, ''));
  }
  verify(() => assert.deepEqual(readFileSync(identityHard), Buffer.from([0, 255, 65])));
  verify(() => assert.equal(readFileSync(identityFile, 'utf8'), 'new identity'));
  verify(() => assert.equal(readlinkSync(identityDangling), basename(identityMissing)));
  verify(() => assert.equal(existsSync(identityMissing), false));

  const filePermissions = join(scratch, 'file-permissions.wasm');
  const filePermissionsBuild = run(['build', shared, fixture('file-permissions'), '-o', filePermissions,
    ...reactorExports.flatMap(name => ['--export', name])]);
  verify(() => assert.equal(filePermissionsBuild.status, 0, filePermissionsBuild.stderr));
  const filePermissionsBytes = readFileSync(filePermissions);
  verify(() => assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(filePermissionsBytes)).length, 0));
  const { instance: filePermissionsInstance } = await WebAssembly.instantiate(filePermissionsBytes);
  const permissionsApi = filePermissionsInstance.exports;
  const permissionsPath = '../héllo//alias/../file';
  const permissionsBytes = bytes => {
    let result = permissionsApi.emptyBytes();
    for (const byte of Buffer.from(bytes).reverse()) result = permissionsApi.consBytes(byte, result);
    return result;
  };
  const permissionsPending = permissionsApi.init(permissionsApi.consWords(
    permissionsBytes(permissionsPath), permissionsApi.emptyWords()));
  verify(() => assert.equal(permissionsApi.requestCode(permissionsPending), 32));
  const permissionsArgs = permissionsApi.requestArgs(permissionsPending);
  verify(() => assert.deepEqual(Buffer.from(decodeBytes(permissionsApi,
    permissionsApi.wordsHead(permissionsArgs), Buffer.byteLength(permissionsPath))), Buffer.from(permissionsPath)));
  verify(() => assert.equal(permissionsApi.wordsEmpty(permissionsApi.wordsTail(permissionsArgs)), 1));
  verify(() => assert.deepEqual(Buffer.from(decodeBytes(permissionsApi,
    permissionsApi.requestBody(permissionsPending), 3)), Buffer.from([0, 255, 65])));
  verify(() => assert.equal(permissionsApi.exitCode(permissionsPending), 1));
  for (const [status, answer] of [[0, '493'], [1, 'EACCES: injected failure']]) {
    const reporting = permissionsApi.resume(permissionsPending, status, permissionsBytes(answer));
    verify(() => assert.equal(permissionsApi.requestCode(reporting), 6));
    verify(() => assert.equal(permissionsApi.wordsEmpty(permissionsApi.requestArgs(reporting)), 1));
    verify(() => assert.deepEqual(Buffer.from(decodeBytes(permissionsApi,
      permissionsApi.requestBody(reporting), Buffer.byteLength(answer))), Buffer.from(answer)));
    verify(() => assert.equal(permissionsApi.exitCode(reporting), status));
    for (const outputStatus of [0, 1]) {
      const finished = permissionsApi.resume(reporting, outputStatus, permissionsApi.emptyBytes());
      verify(() => assert.equal(permissionsApi.requestCode(finished), 0));
      verify(() => assert.equal(permissionsApi.exitCode(finished), status + outputStatus));
      verify(() => assert.equal(permissionsApi.wordsEmpty(permissionsApi.requestArgs(finished)), 1));
      verify(() => assert.equal(permissionsApi.bytesEmpty(permissionsApi.requestBody(finished)), 1));
      const stillFinished = permissionsApi.resume(finished, 1, permissionsBytes('ignored'));
      verify(() => assert.equal(permissionsApi.requestCode(stillFinished), 0));
      verify(() => assert.equal(permissionsApi.exitCode(stillFinished), status + outputStatus));
    }
  }

  const fileMode = join(scratch, 'file-mode.wasm');
  const fileModeBuild = run(['build', shared, fixture('file-mode'), '-o', fileMode,
    ...reactorExports.flatMap(name => ['--export', name])]);
  verify(() => assert.equal(fileModeBuild.status, 0, fileModeBuild.stderr));
  const fileModeBytes = readFileSync(fileMode);
  verify(() => assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(fileModeBytes)).length, 0));
  const { instance: fileModeInstance } = await WebAssembly.instantiate(fileModeBytes);
  const fileModeApi = fileModeInstance.exports;
  const fileModeArguments = ['../héllo//alias/../file', '000493'];
  let fileModeWords = fileModeApi.emptyWords();
  for (const text of [...fileModeArguments].reverse()) {
    let word = fileModeApi.emptyBytes();
    for (const byte of Buffer.from(text).reverse()) word = fileModeApi.consBytes(byte, word);
    fileModeWords = fileModeApi.consWords(word, fileModeWords);
  }
  const fileModePending = fileModeApi.init(fileModeWords);
  verify(() => assert.equal(fileModeApi.requestCode(fileModePending), 31));
  let fileModeForwarded = fileModeApi.requestArgs(fileModePending);
  for (const text of fileModeArguments) {
    verify(() => assert.deepEqual(Buffer.from(decodeBytes(fileModeApi,
      fileModeApi.wordsHead(fileModeForwarded), Buffer.byteLength(text))), Buffer.from(text)));
    fileModeForwarded = fileModeApi.wordsTail(fileModeForwarded);
  }
  verify(() => assert.equal(fileModeApi.wordsEmpty(fileModeForwarded), 1));
  verify(() => assert.deepEqual(Buffer.from(decodeBytes(fileModeApi,
    fileModeApi.requestBody(fileModePending), 3)), Buffer.from([0, 255, 65])));
  verify(() => assert.equal(fileModeApi.exitCode(fileModePending), 1));
  for (const [status, answer] of [[0, Buffer.alloc(0)], [1, Buffer.from('EPERM: injected failure')]]) {
    let bytes = fileModeApi.emptyBytes();
    for (const byte of Buffer.from(answer).reverse()) bytes = fileModeApi.consBytes(byte, bytes);
    const reporting = fileModeApi.resume(fileModePending, status, bytes);
    verify(() => assert.equal(fileModeApi.requestCode(reporting), 6));
    verify(() => assert.equal(fileModeApi.wordsEmpty(fileModeApi.requestArgs(reporting)), 1));
    verify(() => assert.deepEqual(Buffer.from(decodeBytes(fileModeApi,
      fileModeApi.requestBody(reporting), answer.length)), answer));
    verify(() => assert.equal(fileModeApi.exitCode(reporting), status));
    for (const outputStatus of [0, 1]) {
      const finished = fileModeApi.resume(reporting, outputStatus, fileModeApi.emptyBytes());
      verify(() => assert.equal(fileModeApi.requestCode(finished), 0));
      verify(() => assert.equal(fileModeApi.exitCode(finished), status + outputStatus));
      verify(() => assert.equal(fileModeApi.wordsEmpty(fileModeApi.requestArgs(finished)), 1));
      verify(() => assert.equal(fileModeApi.bytesEmpty(fileModeApi.requestBody(finished)), 1));
      const stillFinished = fileModeApi.resume(finished, 1, bytes);
      verify(() => assert.equal(fileModeApi.requestCode(stillFinished), 0));
      verify(() => assert.equal(fileModeApi.exitCode(stillFinished), status + outputStatus));
    }
  }
  const fileModePath = join(scratch, 'mode héllo');
  const fileModeContent = Buffer.from([0, 255, 65, 254, 10]);
  writeFileSync(fileModePath, fileModeContent, { mode: 0o600 });
  const fileModeBefore = lstatSync(fileModePath);
  for (const args of [[], [fileModePath], [fileModePath, '493', 'surplus']]) {
    const rejected = runModule([fileMode, ...args]);
    verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
    verify(() => assert.equal(rejected.stdout, `IO: OS request 31 expects 2 arguments, got ${args.length}`));
    verify(() => assert.equal(rejected.stderr, ''));
    verify(() => assert.equal(lstatSync(fileModePath).mode, fileModeBefore.mode));
  }
  for (const [mode, error] of [['', 'invalid OS numeric argument'], ['1\n', 'invalid OS numeric argument'],
    ['0o755', 'invalid OS numeric argument'], ['9007199254740992', 'invalid OS numeric argument'],
    ['512', 'file mode exceeds permission bit range'], ['0755', 'file mode exceeds permission bit range']]) {
    const rejected = runModule([fileMode, fileModePath, mode]);
    verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
    verify(() => assert.equal(rejected.stdout, `IO: ${error}`));
    verify(() => assert.equal(rejected.stderr, ''));
    verify(() => assert.equal(lstatSync(fileModePath).mode, fileModeBefore.mode));
  }
  for (const mode of ['0', '000493', '511', '384']) {
    const changed = runModule([fileMode, basename(fileModePath), mode]);
    verify(() => assert.equal(changed.status, 0, changed.error ?? changed.stderr));
    verify(() => assert.equal(changed.stdout, ''));
    verify(() => assert.equal(changed.stderr, ''));
    const after = lstatSync(fileModePath);
    if (process.platform !== 'win32') verify(() => assert.equal(after.mode & 0o777, Number(mode)));
    verify(() => assert.deepEqual([after.dev, after.ino, after.size],
      [fileModeBefore.dev, fileModeBefore.ino, fileModeBefore.size]));
    const inspected = runModule([filePermissions, basename(fileModePath)]);
    verify(() => assert.equal(inspected.status, 0, inspected.error ?? inspected.stderr));
    verify(() => assert.equal(inspected.stdout, String(after.mode & 0o777)));
    verify(() => assert.equal(inspected.stderr, ''));
    verify(() => assert.equal(lstatSync(fileModePath).mode, after.mode));
  }
  verify(() => assert.deepEqual(readFileSync(fileModePath), fileModeContent));
  const permissionsDirectory = join(scratch, 'permissions-directory');
  mkdirSync(permissionsDirectory, { mode: 0o700 });
  const permissionsTargets = [permissionsDirectory + '/'];
  if (process.platform !== 'win32') {
    const permissionsLink = join(scratch, 'permissions-link');
    symlinkSync(basename(fileModePath), permissionsLink);
    permissionsTargets.push(permissionsLink);
  }
  for (const path of permissionsTargets) {
    const inspected = runModule([filePermissions, path]);
    verify(() => assert.equal(inspected.status, 0, inspected.error ?? inspected.stderr));
    verify(() => assert.equal(inspected.stdout, String(statSync(path).mode & 0o777)));
    verify(() => assert.equal(inspected.stderr, ''));
  }
  for (const args of [[], [fileModePath, 'surplus']]) {
    const rejected = runModule([filePermissions, ...args]);
    verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
    verify(() => assert.equal(rejected.stdout, `IO: OS request 32 expects 1 argument, got ${args.length}`));
    verify(() => assert.equal(rejected.stderr, ''));
  }
  const permissionsMissing = join(scratch, 'permissions-missing');
  const permissionsRejected = runModule([filePermissions, permissionsMissing]);
  verify(() => assert.equal(permissionsRejected.status, 1, permissionsRejected.error ?? permissionsRejected.stderr));
  verify(() => assert.match(permissionsRejected.stdout, /^ENOENT:/));
  verify(() => assert.equal(permissionsRejected.stderr, ''));
  verify(() => assert.equal(existsSync(permissionsMissing), false));
  const fileModeMissing = join(scratch, 'mode-missing');
  for (const path of [fileModeMissing, join(fileModeMissing, 'child'), '']) {
    const rejected = runModule([fileMode, path, '493']);
    verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
    verify(() => assert.match(rejected.stdout, /^ENOENT:/));
    verify(() => assert.equal(rejected.stderr, ''));
  }
  verify(() => assert.equal(existsSync(fileModeMissing), false));

  const fileTruncate = join(scratch, 'file-truncate.wasm');
  const fileTruncateBuild = run(['build', shared, fixture('file-truncate'), '-o', fileTruncate,
    ...reactorExports.flatMap(name => ['--export', name])]);
  verify(() => assert.equal(fileTruncateBuild.status, 0, fileTruncateBuild.stderr));
  const fileTruncateBytes = readFileSync(fileTruncate);
  verify(() => assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(fileTruncateBytes)).length, 0));
  const { instance: fileTruncateInstance } = await WebAssembly.instantiate(fileTruncateBytes);
  const fileTruncateApi = fileTruncateInstance.exports;
  const fileTruncateArguments = ['../héllo//alias/../file', '0003'];
  let fileTruncateWords = fileTruncateApi.emptyWords();
  for (const text of [...fileTruncateArguments].reverse()) {
    let word = fileTruncateApi.emptyBytes();
    for (const byte of Buffer.from(text).reverse()) word = fileTruncateApi.consBytes(byte, word);
    fileTruncateWords = fileTruncateApi.consWords(word, fileTruncateWords);
  }
  const fileTruncatePending = fileTruncateApi.init(fileTruncateWords);
  verify(() => assert.equal(fileTruncateApi.requestCode(fileTruncatePending), 30));
  let fileTruncateForwarded = fileTruncateApi.requestArgs(fileTruncatePending);
  for (const text of fileTruncateArguments) {
    verify(() => assert.deepEqual(Buffer.from(decodeBytes(fileTruncateApi,
      fileTruncateApi.wordsHead(fileTruncateForwarded), Buffer.byteLength(text))), Buffer.from(text)));
    fileTruncateForwarded = fileTruncateApi.wordsTail(fileTruncateForwarded);
  }
  verify(() => assert.equal(fileTruncateApi.wordsEmpty(fileTruncateForwarded), 1));
  verify(() => assert.deepEqual(Buffer.from(decodeBytes(fileTruncateApi,
    fileTruncateApi.requestBody(fileTruncatePending), 3)), Buffer.from([0, 255, 65])));
  verify(() => assert.equal(fileTruncateApi.exitCode(fileTruncatePending), 1));
  for (const [status, answer] of [[0, Buffer.alloc(0)], [1, Buffer.from('EFBIG: injected failure')]]) {
    let bytes = fileTruncateApi.emptyBytes();
    for (const byte of Buffer.from(answer).reverse()) bytes = fileTruncateApi.consBytes(byte, bytes);
    const reporting = fileTruncateApi.resume(fileTruncatePending, status, bytes);
    verify(() => assert.equal(fileTruncateApi.requestCode(reporting), 6));
    verify(() => assert.equal(fileTruncateApi.wordsEmpty(fileTruncateApi.requestArgs(reporting)), 1));
    verify(() => assert.deepEqual(Buffer.from(decodeBytes(fileTruncateApi,
      fileTruncateApi.requestBody(reporting), answer.length)), answer));
    verify(() => assert.equal(fileTruncateApi.exitCode(reporting), status));
    for (const outputStatus of [0, 1]) {
      const finished = fileTruncateApi.resume(reporting, outputStatus, fileTruncateApi.emptyBytes());
      verify(() => assert.equal(fileTruncateApi.requestCode(finished), 0));
      verify(() => assert.equal(fileTruncateApi.exitCode(finished), status + outputStatus));
      verify(() => assert.equal(fileTruncateApi.wordsEmpty(fileTruncateApi.requestArgs(finished)), 1));
      verify(() => assert.equal(fileTruncateApi.bytesEmpty(fileTruncateApi.requestBody(finished)), 1));
      const stillFinished = fileTruncateApi.resume(finished, 1, bytes);
      verify(() => assert.equal(fileTruncateApi.requestCode(stillFinished), 0));
      verify(() => assert.equal(fileTruncateApi.exitCode(stillFinished), status + outputStatus));
    }
  }
  const fileTruncatePath = join(scratch, 'truncate héllo');
  const fileTruncatePrefix = Buffer.from([0, 255, 65, 254, 10]);
  writeFileSync(fileTruncatePath, fileTruncatePrefix, { mode: 0o640 });
  const fileTruncateBefore = lstatSync(fileTruncatePath);
  for (const args of [[], [fileTruncatePath], [fileTruncatePath, '0', 'surplus']]) {
    const rejected = runModule([fileTruncate, ...args]);
    verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
    verify(() => assert.equal(rejected.stdout, `IO: OS request 30 expects 2 arguments, got ${args.length}`));
    verify(() => assert.equal(rejected.stderr, ''));
    verify(() => assert.deepEqual(readFileSync(fileTruncatePath), fileTruncatePrefix));
  }
  for (const length of ['', '-1', '1.5', '9007199254740992', '1\n']) {
    const rejected = runModule([fileTruncate, fileTruncatePath, length]);
    verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
    verify(() => assert.equal(rejected.stdout, 'IO: invalid OS numeric argument'));
    verify(() => assert.equal(rejected.stderr, ''));
    verify(() => assert.deepEqual(readFileSync(fileTruncatePath), fileTruncatePrefix));
  }
  for (const [length, expected] of [['0003', fileTruncatePrefix.subarray(0, 3)],
    ['3', fileTruncatePrefix.subarray(0, 3)],
    ['65537', Buffer.concat([fileTruncatePrefix.subarray(0, 3), Buffer.alloc(65534)])],
    ['0', Buffer.alloc(0)]]) {
    const resized = runModule([fileTruncate, basename(fileTruncatePath), length]);
    verify(() => assert.equal(resized.status, 0, resized.error ?? resized.stderr));
    verify(() => assert.equal(resized.stdout, ''));
    verify(() => assert.equal(resized.stderr, ''));
    verify(() => assert.deepEqual(readFileSync(fileTruncatePath), expected));
    const after = lstatSync(fileTruncatePath);
    verify(() => assert.deepEqual([after.dev, after.ino, after.mode],
      [fileTruncateBefore.dev, fileTruncateBefore.ino, fileTruncateBefore.mode]));
  }
  const fileTruncateMissing = join(scratch, 'truncate-missing');
  for (const [path, error] of [[fileTruncateMissing, /^ENOENT:/],
    [join(fileTruncateMissing, 'child'), /^ENOENT:/], [scratch, /^EISDIR:/], ['', /^ENOENT:/]]) {
    const rejected = runModule([fileTruncate, path, '0']);
    verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
    verify(() => assert.match(rejected.stdout, error));
    verify(() => assert.equal(rejected.stderr, ''));
  }
  verify(() => assert.equal(existsSync(fileTruncateMissing), false));
  verify(() => assert.deepEqual(readFileSync(fileTruncatePath), Buffer.alloc(0)));

  const fileAppend = join(scratch, 'file-append.wasm');
  const fileAppendBuild = run(['build', shared, fixture('file-append'), '-o', fileAppend,
    ...reactorExports.flatMap(name => ['--export', name])]);
  verify(() => assert.equal(fileAppendBuild.status, 0, fileAppendBuild.stderr));
  const fileAppendBytes = readFileSync(fileAppend);
  verify(() => assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(fileAppendBytes)).length, 0));
  const { instance: fileAppendInstance } = await WebAssembly.instantiate(fileAppendBytes);
  const fileAppendApi = fileAppendInstance.exports;
  const fileAppendArgument = '../héllo//alias/../file';
  const fileAppendBody = Buffer.from([0, 255, 65]);
  let fileAppendWord = fileAppendApi.emptyBytes();
  for (const byte of Buffer.from(fileAppendArgument).reverse()) {
    fileAppendWord = fileAppendApi.consBytes(byte, fileAppendWord);
  }
  const fileAppendPending = fileAppendApi.init(
    fileAppendApi.consWords(fileAppendWord, fileAppendApi.emptyWords()));
  verify(() => assert.equal(fileAppendApi.requestCode(fileAppendPending), 29));
  const fileAppendForwarded = fileAppendApi.requestArgs(fileAppendPending);
  verify(() => assert.deepEqual(Buffer.from(decodeBytes(fileAppendApi,
    fileAppendApi.wordsHead(fileAppendForwarded), Buffer.byteLength(fileAppendArgument))),
  Buffer.from(fileAppendArgument)));
  verify(() => assert.equal(fileAppendApi.wordsEmpty(fileAppendApi.wordsTail(fileAppendForwarded)), 1));
  verify(() => assert.deepEqual(Buffer.from(decodeBytes(fileAppendApi,
    fileAppendApi.requestBody(fileAppendPending), fileAppendBody.length)), fileAppendBody));
  verify(() => assert.equal(fileAppendApi.exitCode(fileAppendPending), 1));
  for (const [status, answer] of [[0, Buffer.alloc(0)], [1, Buffer.from('ENOSPC: injected failure')]]) {
    let bytes = fileAppendApi.emptyBytes();
    for (const byte of Buffer.from(answer).reverse()) bytes = fileAppendApi.consBytes(byte, bytes);
    const reporting = fileAppendApi.resume(fileAppendPending, status, bytes);
    verify(() => assert.equal(fileAppendApi.requestCode(reporting), 6));
    verify(() => assert.equal(fileAppendApi.wordsEmpty(fileAppendApi.requestArgs(reporting)), 1));
    verify(() => assert.deepEqual(Buffer.from(decodeBytes(fileAppendApi,
      fileAppendApi.requestBody(reporting), answer.length)), answer));
    verify(() => assert.equal(fileAppendApi.exitCode(reporting), status));
    for (const writeStatus of [0, 1]) {
      const finished = fileAppendApi.resume(reporting, writeStatus, fileAppendApi.emptyBytes());
      verify(() => assert.equal(fileAppendApi.requestCode(finished), 0));
      verify(() => assert.equal(fileAppendApi.exitCode(finished), status + writeStatus));
      verify(() => assert.equal(fileAppendApi.wordsEmpty(fileAppendApi.requestArgs(finished)), 1));
      verify(() => assert.equal(fileAppendApi.bytesEmpty(fileAppendApi.requestBody(finished)), 1));
      const stillFinished = fileAppendApi.resume(finished, 1, bytes);
      verify(() => assert.equal(fileAppendApi.requestCode(stillFinished), 0));
      verify(() => assert.equal(fileAppendApi.exitCode(stillFinished), status + writeStatus));
    }
  }
  const fileAppendPath = join(scratch, 'append héllo');
  for (const args of [[], [fileAppendPath, 'surplus']]) {
    const rejected = runModule([fileAppend, ...args]);
    verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
    verify(() => assert.equal(rejected.stdout, `IO: OS request 29 expects 1 argument, got ${args.length}`));
    verify(() => assert.equal(rejected.stderr, ''));
    verify(() => assert.throws(() => lstatSync(fileAppendPath), { code: 'ENOENT' }));
  }
  const fileAppendCreated = runModule([fileAppend, basename(fileAppendPath)]);
  verify(() => assert.equal(fileAppendCreated.status, 0, fileAppendCreated.error ?? fileAppendCreated.stderr));
  verify(() => assert.equal(fileAppendCreated.stdout, ''));
  verify(() => assert.equal(fileAppendCreated.stderr, ''));
  verify(() => assert.deepEqual(readFileSync(fileAppendPath), fileAppendBody));
  const fileAppendOriginal = lstatSync(fileAppendPath);
  if (process.platform !== 'win32') {
    verify(() => assert.equal(fileAppendOriginal.mode & 0o777, 0o600 & ~process.umask()));
  }
  const fileAppendRepeated = runModule([fileAppend, fileAppendPath]);
  verify(() => assert.equal(fileAppendRepeated.status, 0, fileAppendRepeated.error ?? fileAppendRepeated.stderr));
  verify(() => assert.equal(fileAppendRepeated.stdout, ''));
  verify(() => assert.equal(fileAppendRepeated.stderr, ''));
  verify(() => assert.deepEqual(readFileSync(fileAppendPath), Buffer.concat([fileAppendBody, fileAppendBody])));
  const fileAppendAfter = lstatSync(fileAppendPath);
  verify(() => assert.deepEqual([fileAppendAfter.dev, fileAppendAfter.ino, fileAppendAfter.mode],
    [fileAppendOriginal.dev, fileAppendOriginal.ino, fileAppendOriginal.mode]));
  const fileAppendMissing = join(scratch, 'append-missing-parent');
  for (const [path, error] of [[scratch, /^EISDIR:/], [join(fileAppendMissing, 'child'), /^ENOENT:/], ['', /^ENOENT:/]]) {
    const rejected = runModule([fileAppend, path]);
    verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
    verify(() => assert.match(rejected.stdout, error));
    verify(() => assert.equal(rejected.stderr, ''));
  }
  verify(() => assert.throws(() => lstatSync(fileAppendMissing), { code: 'ENOENT' }));
  verify(() => assert.deepEqual(readFileSync(fileAppendPath), Buffer.concat([fileAppendBody, fileAppendBody])));

  const directoryCreate = join(scratch, 'directory-create.wasm');
  const directoryCreateBuild = run(['build', shared, fixture('directory-create'), '-o', directoryCreate,
    ...reactorExports.flatMap(name => ['--export', name])]);
  verify(() => assert.equal(directoryCreateBuild.status, 0, directoryCreateBuild.stderr));
  const directoryCreateBytes = readFileSync(directoryCreate);
  verify(() => assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(directoryCreateBytes)).length, 0));
  const { instance: directoryCreateInstance } = await WebAssembly.instantiate(directoryCreateBytes);
  const directoryCreateApi = directoryCreateInstance.exports;
  const directoryCreateArgument = '../héllo//directory/';
  let directoryCreateWord = directoryCreateApi.emptyBytes();
  for (const byte of Buffer.from(directoryCreateArgument).reverse()) {
    directoryCreateWord = directoryCreateApi.consBytes(byte, directoryCreateWord);
  }
  const directoryCreatePending = directoryCreateApi.init(
    directoryCreateApi.consWords(directoryCreateWord, directoryCreateApi.emptyWords()));
  verify(() => assert.equal(directoryCreateApi.requestCode(directoryCreatePending), 28));
  const directoryCreateForwarded = directoryCreateApi.requestArgs(directoryCreatePending);
  verify(() => assert.deepEqual(Buffer.from(decodeBytes(directoryCreateApi,
    directoryCreateApi.wordsHead(directoryCreateForwarded), Buffer.byteLength(directoryCreateArgument))),
  Buffer.from(directoryCreateArgument)));
  verify(() => assert.equal(directoryCreateApi.wordsEmpty(directoryCreateApi.wordsTail(directoryCreateForwarded)), 1));
  verify(() => assert.equal(directoryCreateApi.bytesEmpty(directoryCreateApi.requestBody(directoryCreatePending)), 1));
  verify(() => assert.equal(directoryCreateApi.exitCode(directoryCreatePending), 1));
  for (const [status, answer] of [[0, Buffer.alloc(0)], [1, Buffer.from('EACCES: injected failure')]]) {
    let bytes = directoryCreateApi.emptyBytes();
    for (const byte of Buffer.from(answer).reverse()) bytes = directoryCreateApi.consBytes(byte, bytes);
    const reporting = directoryCreateApi.resume(directoryCreatePending, status, bytes);
    verify(() => assert.equal(directoryCreateApi.requestCode(reporting), 6));
    verify(() => assert.equal(directoryCreateApi.wordsEmpty(directoryCreateApi.requestArgs(reporting)), 1));
    verify(() => assert.deepEqual(Buffer.from(decodeBytes(directoryCreateApi,
      directoryCreateApi.requestBody(reporting), answer.length)), answer));
    verify(() => assert.equal(directoryCreateApi.exitCode(reporting), status));
    for (const writeStatus of [0, 1]) {
      const finished = directoryCreateApi.resume(reporting, writeStatus, directoryCreateApi.emptyBytes());
      verify(() => assert.equal(directoryCreateApi.requestCode(finished), 0));
      verify(() => assert.equal(directoryCreateApi.exitCode(finished), status + writeStatus));
      verify(() => assert.equal(directoryCreateApi.wordsEmpty(directoryCreateApi.requestArgs(finished)), 1));
      verify(() => assert.equal(directoryCreateApi.bytesEmpty(directoryCreateApi.requestBody(finished)), 1));
      const stillFinished = directoryCreateApi.resume(finished, 1, bytes);
      verify(() => assert.equal(directoryCreateApi.requestCode(stillFinished), 0));
      verify(() => assert.equal(directoryCreateApi.exitCode(stillFinished), status + writeStatus));
    }
  }
  const directoryCreatePath = join(scratch, 'created héllo');
  for (const args of [[], [directoryCreatePath, 'surplus']]) {
    const rejected = runModule([directoryCreate, ...args]);
    verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
    verify(() => assert.equal(rejected.stdout, `IO: OS request 28 expects 1 argument, got ${args.length}`));
    verify(() => assert.equal(rejected.stderr, ''));
    verify(() => assert.throws(() => lstatSync(directoryCreatePath), { code: 'ENOENT' }));
  }
  const directoryCreated = runModule([directoryCreate, basename(directoryCreatePath)]);
  verify(() => assert.equal(directoryCreated.status, 0, directoryCreated.error ?? directoryCreated.stderr));
  verify(() => assert.equal(directoryCreated.stdout, ''));
  verify(() => assert.equal(directoryCreated.stderr, ''));
  verify(() => assert.ok(lstatSync(directoryCreatePath).isDirectory()));
  verify(() => assert.deepEqual(readdirSync(directoryCreatePath), []));
  if (process.platform !== 'win32') {
    verify(() => assert.equal(lstatSync(directoryCreatePath).mode & 0o777, 0o700 & ~process.umask()));
  }
  const directoryCreateExisting = lstatSync(directoryCreatePath);
  const directoryCreateFile = join(scratch, 'create-existing-file');
  const directoryCreateMissing = join(scratch, 'create-missing-parent');
  writeFileSync(directoryCreateFile, 'kept');
  for (const [path, error] of [[directoryCreatePath, /^EEXIST:/], [directoryCreateFile, /^EEXIST:/],
    [join(directoryCreateMissing, 'child'), /^ENOENT:/], ['', /^ENOENT:/]]) {
    const rejected = runModule([directoryCreate, path]);
    verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
    verify(() => assert.match(rejected.stdout, error));
    verify(() => assert.equal(rejected.stderr, ''));
  }
  verify(() => assert.equal(lstatSync(directoryCreatePath).ino, directoryCreateExisting.ino));
  verify(() => assert.equal(lstatSync(directoryCreatePath).mode, directoryCreateExisting.mode));
  verify(() => assert.equal(readFileSync(directoryCreateFile, 'utf8'), 'kept'));
  verify(() => assert.throws(() => lstatSync(directoryCreateMissing), { code: 'ENOENT' }));
  if (process.platform !== 'win32') {
    const dangling = join(scratch, 'create-dangling');
    symlinkSync('create-missing-parent', dangling);
    const rejected = runModule([directoryCreate, dangling]);
    verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
    verify(() => assert.match(rejected.stdout, /^EEXIST:/));
    verify(() => assert.equal(rejected.stderr, ''));
    verify(() => assert.equal(readlinkSync(dangling), 'create-missing-parent'));
    verify(() => assert.throws(() => lstatSync(directoryCreateMissing), { code: 'ENOENT' }));
  }

  const fileCopy = join(scratch, 'file-copy.wasm');
  const fileCopyBuild = run(['build', shared, fixture('file-copy'), '-o', fileCopy,
    ...reactorExports.flatMap(name => ['--export', name])]);
  verify(() => assert.equal(fileCopyBuild.status, 0, fileCopyBuild.stderr));
  const fileCopyBytes = readFileSync(fileCopy);
  verify(() => assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(fileCopyBytes)).length, 0));
  const { instance: fileCopyInstance } = await WebAssembly.instantiate(fileCopyBytes);
  const fileCopyApi = fileCopyInstance.exports;
  let fileCopyArgs = fileCopyApi.emptyWords();
  for (const argument of ['./destination', '../héllo//source']) {
    let bytes = fileCopyApi.emptyBytes();
    for (const byte of Buffer.from(argument).reverse()) bytes = fileCopyApi.consBytes(byte, bytes);
    fileCopyArgs = fileCopyApi.consWords(bytes, fileCopyArgs);
  }
  const fileCopyPending = fileCopyApi.init(fileCopyArgs);
  verify(() => assert.equal(fileCopyApi.requestCode(fileCopyPending), 27));
  let fileCopyForwarded = fileCopyApi.requestArgs(fileCopyPending);
  for (const expected of ['../héllo//source', './destination']) {
    verify(() => assert.deepEqual(Buffer.from(decodeBytes(fileCopyApi, fileCopyApi.wordsHead(fileCopyForwarded), Buffer.byteLength(expected))), Buffer.from(expected)));
    fileCopyForwarded = fileCopyApi.wordsTail(fileCopyForwarded);
  }
  verify(() => assert.equal(fileCopyApi.wordsEmpty(fileCopyForwarded), 1));
  verify(() => assert.equal(fileCopyApi.bytesEmpty(fileCopyApi.requestBody(fileCopyPending)), 1));
  verify(() => assert.equal(fileCopyApi.exitCode(fileCopyPending), 1));
  for (const [status, answer] of [[0, Buffer.alloc(0)], [1, Buffer.from('ENOSPC: injected failure')]]) {
    let bytes = fileCopyApi.emptyBytes();
    for (const byte of Buffer.from(answer).reverse()) bytes = fileCopyApi.consBytes(byte, bytes);
    const reporting = fileCopyApi.resume(fileCopyPending, status, bytes);
    verify(() => assert.equal(fileCopyApi.requestCode(reporting), 6));
    verify(() => assert.equal(fileCopyApi.wordsEmpty(fileCopyApi.requestArgs(reporting)), 1));
    verify(() => assert.deepEqual(Buffer.from(decodeBytes(fileCopyApi, fileCopyApi.requestBody(reporting), answer.length)), answer));
    verify(() => assert.equal(fileCopyApi.exitCode(reporting), status));
    for (const writeStatus of [0, 1]) {
      const finished = fileCopyApi.resume(reporting, writeStatus, fileCopyApi.emptyBytes());
      verify(() => assert.equal(fileCopyApi.requestCode(finished), 0));
      verify(() => assert.equal(fileCopyApi.exitCode(finished), status + writeStatus));
      verify(() => assert.equal(fileCopyApi.wordsEmpty(fileCopyApi.requestArgs(finished)), 1));
      verify(() => assert.equal(fileCopyApi.bytesEmpty(fileCopyApi.requestBody(finished)), 1));
      const stillFinished = fileCopyApi.resume(finished, 1, bytes);
      verify(() => assert.equal(fileCopyApi.requestCode(stillFinished), 0));
      verify(() => assert.equal(fileCopyApi.exitCode(stillFinished), status + writeStatus));
    }
  }
  const fileCopySource = join(scratch, 'copy-source');
  const fileCopyDestination = join(scratch, 'copy-destination');
  const fileCopyContent = Buffer.from(Array.from({ length: 65537 }, (_, index) => index % 256));
  writeFileSync(fileCopySource, fileCopyContent);
  for (const args of [[], [fileCopySource], [fileCopySource, fileCopyDestination, 'surplus']]) {
    const rejected = runModule([fileCopy, ...args]);
    verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
    verify(() => assert.equal(rejected.stdout, `IO: OS request 27 expects 2 arguments, got ${args.length}`));
    verify(() => assert.equal(rejected.stderr, ''));
    verify(() => assert.throws(() => lstatSync(fileCopyDestination), { code: 'ENOENT' }));
  }
  const copied = runModule([fileCopy, basename(fileCopySource), basename(fileCopyDestination)]);
  verify(() => assert.equal(copied.status, 0, copied.error ?? copied.stderr));
  verify(() => assert.equal(copied.stdout, ''));
  verify(() => assert.equal(copied.stderr, ''));
  verify(() => assert.ok(lstatSync(fileCopyDestination).isFile()));
  verify(() => assert.notEqual(lstatSync(fileCopyDestination).ino, lstatSync(fileCopySource).ino));
  verify(() => assert.deepEqual(readFileSync(fileCopyDestination), fileCopyContent));
  writeFileSync(fileCopySource, 'source update');
  verify(() => assert.deepEqual(readFileSync(fileCopyDestination), fileCopyContent));
  writeFileSync(fileCopyDestination, 'copy update');
  verify(() => assert.equal(readFileSync(fileCopySource, 'utf8'), 'source update'));
  const fileCopyDuplicate = runModule([fileCopy, fileCopySource, fileCopyDestination]);
  verify(() => assert.equal(fileCopyDuplicate.status, 1, fileCopyDuplicate.error ?? fileCopyDuplicate.stderr));
  verify(() => assert.match(fileCopyDuplicate.stdout, /^EEXIST:/));
  verify(() => assert.equal(fileCopyDuplicate.stderr, ''));
  verify(() => assert.equal(readFileSync(fileCopyDestination, 'utf8'), 'copy update'));
  if (process.platform !== 'win32') {
    const sourceLink = join(scratch, 'copy-source-link');
    const linkCopy = join(scratch, 'copy-from-link');
    symlinkSync('copy-source', sourceLink);
    const copiedLink = runModule([fileCopy, sourceLink, linkCopy]);
    verify(() => assert.equal(copiedLink.status, 0, copiedLink.error ?? copiedLink.stderr));
    verify(() => assert.equal(copiedLink.stdout, ''));
    verify(() => assert.equal(copiedLink.stderr, ''));
    verify(() => assert.ok(lstatSync(linkCopy).isFile()));
    verify(() => assert.equal(readFileSync(linkCopy, 'utf8'), 'source update'));
    const refusedLink = runModule([fileCopy, fileCopyDestination, sourceLink]);
    verify(() => assert.equal(refusedLink.status, 1, refusedLink.error ?? refusedLink.stderr));
    verify(() => assert.match(refusedLink.stdout, /^EEXIST:/));
    verify(() => assert.equal(refusedLink.stderr, ''));
    verify(() => assert.equal(readlinkSync(sourceLink), 'copy-source'));
    verify(() => assert.equal(readFileSync(fileCopySource, 'utf8'), 'source update'));
  }
  rmSync(fileCopySource);
  verify(() => assert.equal(readFileSync(fileCopyDestination, 'utf8'), 'copy update'));
  const fileCopyMissing = join(scratch, 'copy-missing');
  const fileCopyMissingParent = join(scratch, 'copy-absent-parent');
  for (const [source, destination, error] of [
    [fileCopySource, fileCopyMissing, /^ENOENT:/],
    [fileCopyDestination, join(fileCopyMissingParent, 'child'), /^ENOENT:/],
    [fileCopyDestination, '', /^ENOENT:/],
  ]) {
    const rejected = runModule([fileCopy, source, destination]);
    verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
    verify(() => assert.match(rejected.stdout, error));
    verify(() => assert.equal(rejected.stderr, ''));
  }
  verify(() => assert.throws(() => lstatSync(fileCopyMissing), { code: 'ENOENT' }));
  verify(() => assert.throws(() => lstatSync(fileCopyMissingParent), { code: 'ENOENT' }));

  const listing = join(scratch, 'directory-listing.wasm');
  const listingBuild = run(['build', shared, fixture('directory-listing'), '-o', listing,
    ...reactorExports.flatMap(name => ['--export', name])]);
  verify(() => assert.equal(listingBuild.status, 0, listingBuild.stderr));
  verify(() => assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(readFileSync(listing))).length, 0));
  const listingDirectory = join(scratch, 'listing');
  mkdirSync(listingDirectory);
  const listingEmpty = runModule([listing, listingDirectory]);
  verify(() => assert.equal(listingEmpty.status, 0, listingEmpty.error ?? listingEmpty.stderr));
  verify(() => assert.equal(listingEmpty.stdout, ''));
  verify(() => assert.equal(listingEmpty.stderr, ''));
  mkdirSync(join(listingDirectory, 'child'));
  writeFileSync(join(listingDirectory, 'child', 'nested'), 'nested');
  for (const name of ['zeta', 'A space', '.hidden', 'line\nbreak', '\uE000', '\u{10000}']) writeFileSync(join(listingDirectory, name), '');
  for (const path of [listingDirectory, 'listing']) {
    const listed = runModule([listing, path]);
    verify(() => assert.equal(listed.status, 0, listed.error ?? listed.stderr));
    verify(() => assert.equal(listed.stdout, '.hidden\0A space\0child\0line\nbreak\0zeta\0\uE000\0\u{10000}\0'));
    verify(() => assert.equal(listed.stderr, ''));
  }
  for (const args of [[], [listingDirectory, 'surplus']]) {
    const rejected = runModule([listing, ...args]);
    verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
    verify(() => assert.equal(rejected.stdout, `IO: OS request 22 expects 1 argument, got ${args.length}`));
    verify(() => assert.equal(rejected.stderr, ''));
  }
  for (const [path, message] of [[join(scratch, 'listing-missing'), /^ENOENT:/], [join(listingDirectory, '.hidden'), /^ENOTDIR:/]]) {
    const rejected = runModule([listing, path]);
    verify(() => assert.equal(rejected.status, 1, rejected.error ?? rejected.stderr));
    verify(() => assert.match(rejected.stdout, message));
    verify(() => assert.equal(rejected.stderr, ''));
  }
  const listingBounded = join(scratch, 'listing-bounded');
  mkdirSync(listingBounded);
  const listingNames = Array.from({ length: 255 }, (_, index) => `${String(index).padStart(3, '0')}-${'x'.repeat(251)}`);
  const listingBoundary = '\uE000'.repeat(84) + 'y';
  for (const name of [...listingNames, 'z', listingBoundary]) writeFileSync(join(listingBounded, name), '');
  const listingExpected = Buffer.from([...listingNames, 'z', listingBoundary, ''].join('\0'));
  verify(() => assert.equal(listingExpected.length, 65536));
  const listingFull = spawnSync(process.execPath, [join(root, 'runtime/run.mjs'), listing, listingBounded], { cwd: scratch, timeout: 20000 });
  verify(() => assert.equal(listingFull.status, 0, listingFull.error ?? String(listingFull.stderr)));
  verify(() => assert.deepEqual(listingFull.stdout, listingExpected));
  verify(() => assert.equal(listingFull.stderr.length, 0));
  renameSync(join(listingBounded, listingBoundary), join(listingBounded, listingBoundary + 'y'));
  const listingOverflow = runModule([listing, listingBounded]);
  verify(() => assert.equal(listingOverflow.status, 1, listingOverflow.error ?? listingOverflow.stderr));
  verify(() => assert.equal(listingOverflow.stdout, 'IO: directory listing exceeds maximum OS chunk size'));
  verify(() => assert.equal(listingOverflow.stderr, ''));
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
