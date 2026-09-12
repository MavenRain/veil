import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, realpathSync, rmSync, readdirSync, statSync, existsSync, renameSync, symlinkSync } from 'node:fs';
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
