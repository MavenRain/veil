import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Dir, existsSync, constants as fsConstants } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, readdir, realpath, rm, access, stat, lstat, symlink, readlink, rename } from 'node:fs/promises';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { join, dirname, basename, relative, resolve } from 'node:path';
import { tmpdir, constants } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { executeProcess, osString, runReactor, spawns } from '../runtime/reactor.mjs';

const sandbox = async t => {
  const path = await mkdtemp(join(tmpdir(), 'kanon-runtime-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return { path, out: join(path, 'stdout'), err: join(path, 'stderr'), marker: join(path, 'marker') };
};
const command = (s, deadline, source) => [s.out, s.err, s.path, deadline, process.execPath, '-e', source];
const fields = response => response.toString().split('\0');
const absent = async path => assert.rejects(access(path), { code: 'ENOENT' });
const privateFifo = path => {
  const created = spawnSync('mkfifo', [path], { encoding: 'utf8' });
  assert.equal(created.status, 0, created.error ?? created.stderr);
  return path;
};
const nativeTimeout = globalThis.setTimeout;
// Control the parent's deadline only. The real child deliberately takes longer
// than 150 ms to become ready, then publishes its complete PID atomically.
const readyProcess = async (t, s, ignoreTerm = false) => {
  const originalKill = process.kill;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const running = executeProcess(command(s, '150', `
    setTimeout(() => {
      ${ignoreTerm ? "process.on('SIGTERM', () => {});" : ''}
      const fs = require('node:fs');
      fs.writeFileSync(${JSON.stringify(`${s.marker}.pending`)}, String(process.pid));
      fs.renameSync(${JSON.stringify(`${s.marker}.pending`)}, ${JSON.stringify(s.marker)});
      setInterval(() => {}, 1000);
    }, 200);
  `), { signal: null });
  // Observe rejection immediately, including failures before readiness.
  const outcome = running.then(response => ({ response }), error => ({ error }));
  let pid;
  let settled = false;
  outcome.then(() => { settled = true; });
  t.after(async () => {
    // Reap the fixture even if an assertion or a runtime mutation fails. The
    // marker gives the group id when readiness itself failed.
    const group = pid ?? (existsSync(s.marker) ? Number(await readFile(s.marker, 'utf8')) : 0);
    try {
      if (Number.isInteger(group) && group > 0) {
        try { originalKill.call(process, -group, 'SIGKILL'); }
        catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    } finally {
      // Drive the mocked clock until the run settles. A tick that fires the
      // deadline timer schedules the escalation timer, and the test runner
      // runs that new timer only on a later tick, so one tick is not enough.
      const stop = Date.now() + 5000;
      while (!settled && Date.now() < stop) {
        t.mock.timers.tick(400);
        await Promise.race([
          outcome,
          new Promise(resolvePause => nativeTimeout(() => resolvePause(null), 20)),
        ]);
      }
      t.mock.timers.reset();
      await Promise.race([
        outcome,
        new Promise(resolvePause => nativeTimeout(() => resolvePause(null), 1000)),
      ]);
    }
  });
  const until = Date.now() + 5000;
  while (!existsSync(s.marker)) {
    assert.ok(Date.now() < until, 'child did not publish readiness within 5 seconds');
    const ended = await Promise.race([
      outcome,
      new Promise(resolvePause => nativeTimeout(() => resolvePause(null), 20)),
    ]);
    if (ended) throw ended.error ?? new Error('child exited before publishing readiness');
  }
  pid = Number(await readFile(s.marker, 'utf8'));
  assert.ok(Number.isInteger(pid) && pid > 0);
  return { running, pid };
};
const sideEffect = s => `require('node:fs').writeFileSync(${JSON.stringify(s.marker)}, 'ran')`;

test('rejects invalid process inputs before opening files or spawning', async t => {
  for (const deadline of ['bad', '-1', '2147483648', '9007199254740992']) {
    const s = await sandbox(t);
    await assert.rejects(executeProcess(command(s, deadline, sideEffect(s)), { signal: null }), RangeError);
    await absent(s.out);
    await absent(s.err);
    await absent(s.marker);
  }
  const s = await sandbox(t);
  await assert.rejects(executeProcess([s.out, s.err, s.path, '0', ''], { signal: null }), /executable/);
  await assert.rejects(executeProcess([s.out, s.err, s.path, '0', 'bad\0argv'], { signal: null }), /NUL-free/);
  await absent(s.out);
});

test('prior interruption creates empty captures and never starts a command', async t => {
  const s = await sandbox(t);
  const response = await executeProcess(command(s, '0', sideEffect(s)), { signal: 'SIGINT' });
  assert.deepEqual(fields(response), ['130', String(constants.signals.SIGINT), '0', '1', '']);
  assert.equal((await readFile(s.out)).length, 0);
  assert.equal((await readFile(s.err)).length, 0);
  await absent(s.marker);
});

test('interruption delivered while captures open prevents spawning', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const interrupted = { signal: null };
  const started = spawns.started;
  // The counter answers the property in the title on its own: only the
  // synchronous guard can keep it at its old value. The shell payload
  // writes its marker within a few milliseconds of exec, so a spawned
  // command leaves the marker behind long before the 25 ms poll.
  const running = executeProcess([s.out, s.err, s.path, '0', '/bin/sh', '-c',
    `printf ran > ${JSON.stringify(s.marker)}`], interrupted);
  queueMicrotask(() => { interrupted.signal = 'SIGTERM'; });
  assert.deepEqual(fields(await running), ['143', String(constants.signals.SIGTERM), '0', '1', '']);
  assert.equal(spawns.started, started);
  await delay(200);
  assert.equal((await readFile(s.out)).length, 0);
  assert.equal((await readFile(s.err)).length, 0);
  await absent(s.marker);
});

test('captures binary stdout and stderr with exact exit status', async t => {
  const s = await sandbox(t);
  const response = await executeProcess(command(s, '1000', `
    const fs = require('node:fs');
    fs.writeSync(1, Buffer.from([0, 255, 65]));
    fs.writeSync(2, Buffer.from([10, 0, 66]));
    process.exitCode = 7;
  `), { signal: null });
  assert.deepEqual(fields(response), ['7', '0', '0', '0', '']);
  assert.deepEqual(await readFile(s.out), Buffer.from([0, 255, 65]));
  assert.deepEqual(await readFile(s.err), Buffer.from([10, 0, 66]));
});

test('reports spawn errors through the response and closes captures', async t => {
  const s = await sandbox(t);
  const response = fields(await executeProcess([s.out, s.err, s.path, '1000', join(s.path, 'missing-command')], { signal: null }));
  assert.deepEqual(response.slice(0, 4), ['127', '0', '0', '0']);
  assert.match(response[4], /^ENOENT:/);
  assert.equal((await readFile(s.out)).length, 0);
  assert.equal((await readFile(s.err)).length, 0);
});

test('timeout escalates for a child that ignores SIGTERM', { skip: process.platform === 'win32', timeout: 20000 }, async t => {
  const s = await sandbox(t);
  const { running, pid } = await readyProcess(t, s, true);
  const originalKill = process.kill;
  const signals = [];
  t.mock.method(process, 'kill', (target, signal) => {
    if (target === -pid && signal !== 0) signals.push(signal);
    return originalKill.call(process, target, signal);
  });
  t.mock.timers.tick(149);
  assert.deepEqual(signals, []);
  t.mock.timers.tick(1);
  assert.deepEqual(signals, ['SIGTERM']);
  assert.equal(originalKill.call(process, pid, 0), true);
  t.mock.timers.tick(249);
  assert.deepEqual(signals, ['SIGTERM']);
  t.mock.timers.tick(1);
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  const response = fields(await running);
  assert.deepEqual(response.slice(0, 4), ['124', String(constants.signals.SIGKILL), '1', '0']);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('signal callback errors reject normally after killing and reaping the child', { skip: process.platform === 'win32', timeout: 20000 }, async t => {
  const s = await sandbox(t);
  const { running, pid } = await readyProcess(t, s);
  const originalKill = process.kill;
  const injected = Object.assign(new Error('injected signal failure'), { code: 'EIO' });
  process.kill = (pid, signal) => {
    if (signal === 'SIGTERM') throw injected;
    return originalKill.call(process, pid, signal);
  };
  try {
    const rejected = assert.rejects(running, error => error === injected);
    t.mock.timers.tick(150);
    await rejected;
    assert.throws(() => originalKill.call(process, pid, 0), { code: 'ESRCH' });
  } finally {
    process.kill = originalKill;
  }
});

test('active interruption returns signal status and reaps the process', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const started = spawns.started;
  // Publish the complete PID before the runtime's poll can interrupt the
  // child. Readiness depends on child progress, not Node startup timing.
  const interrupted = { get signal() { return existsSync(s.marker) ? 'SIGINT' : null; } };
  const response = fields(await executeProcess(command(s, '1000', `
    const fs = require('node:fs');
    fs.writeFileSync(${JSON.stringify(`${s.marker}.pending`)}, String(process.pid));
    fs.renameSync(${JSON.stringify(`${s.marker}.pending`)}, ${JSON.stringify(s.marker)});
    setInterval(() => {}, 1000);
  `), interrupted));
  assert.equal(spawns.started, started + 1);
  assert.deepEqual(response.slice(0, 4), ['130', String(constants.signals.SIGINT), '0', '1']);
  const pid = Number(await readFile(s.marker, 'utf8'));
  assert.ok(Number.isInteger(pid) && pid > 0);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('escalation callback errors are caught and cleanup retries the kill', { skip: process.platform === 'win32', timeout: 20000 }, async t => {
  const s = await sandbox(t);
  const { running, pid } = await readyProcess(t, s, true);
  const originalKill = process.kill;
  const injected = Object.assign(new Error('injected escalation failure'), { code: 'EIO' });
  let failedOnce = false;
  process.kill = (pid, signal) => {
    if (signal === 'SIGKILL' && !failedOnce) {
      failedOnce = true;
      throw injected;
    }
    return originalKill.call(process, pid, signal);
  };
  try {
    const rejected = assert.rejects(running, error => error === injected);
    t.mock.timers.tick(150);
    t.mock.timers.tick(250);
    await rejected;
    assert.equal(failedOnce, true);
    assert.throws(() => originalKill.call(process, pid, 0), { code: 'ESRCH' });
  } finally {
    process.kill = originalKill;
  }
});

test('unexpected descendant wait errors kill the remaining process group', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const originalKill = process.kill;
  const injected = Object.assign(new Error('injected group probe failure'), { code: 'EIO' });
  process.kill = (pid, signal) => {
    if (signal === 0 && pid < 0) throw injected;
    return originalKill.call(process, pid, signal);
  };
  const descendant = `setTimeout(() => { ${sideEffect(s)}; }, 500);`;
  try {
    await assert.rejects(executeProcess(command(s, '0', `
      const child = require('node:child_process').spawn(process.execPath,
        ['-e', ${JSON.stringify(descendant)}], { stdio: 'inherit' });
      child.unref();
    `), { signal: null }), error => error === injected);
    await delay(650);
    await absent(s.marker);
  } finally {
    process.kill = originalKill;
  }
});

test('a lingering group member cannot hold a deadline of zero open', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const start = Date.now();
  const response = fields(await executeProcess([s.out, s.err, s.path, '0', '/bin/sh', '-c',
    `sleep 30 & printf ran > ${JSON.stringify(s.marker)}`], { signal: null }));
  const elapsed = Date.now() - start;
  assert.deepEqual(response, ['0', '0', '0', '0', '']);
  assert.ok(elapsed < 3000, `group drain took ${elapsed} ms`);
  assert.equal(await readFile(s.marker, 'utf8'), 'ran');
});

test('a leader that exits before its deadline keeps its own status', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  // The deadline falls between the end of the group drain and the end of
  // the escalation, so a timer left armed would fire after the leader has
  // already closed with status 0.
  const response = fields(await executeProcess([s.out, s.err, s.path, '400', '/bin/sh', '-c',
    'sleep 5 & echo hi'], { signal: null }));
  assert.deepEqual(response, ['0', '0', '0', '0', '']);
  assert.equal(await readFile(s.out, 'utf8'), 'hi\n');
});

test('an OS string argument keeps its bytes or is rejected', () => {
  assert.throws(() => osString(Buffer.from([0xe9, 0x41])), /non-UTF-8/);
  assert.throws(() => osString(Buffer.from([0x41, 0x00])), /NUL/);
  assert.equal(osString(Buffer.from([0xc3, 0xa9, 0x41])), 'éA');
});

// A list is a plain array here, so a fake module can drive the loop
// without a WebAssembly build. Empty predicates answer 1 or 0.
const lists = {
  emptyBytes: () => [], consBytes: (b, l) => [b, ...l],
  bytesEmpty: l => Number(l.length === 0), bytesHead: l => l[0], bytesTail: l => l.slice(1),
  emptyWords: () => [], consWords: (w, l) => [w, ...l],
  wordsEmpty: l => Number(l.length === 0), wordsHead: l => l[0], wordsTail: l => l.slice(1),
};

for (const [predicate, region] of [['wordsEmpty', 'arguments'], ['bytesEmpty', 'arguments'], ['bytesEmpty', 'body']]) {
  test(`list ABI rejects invalid ${predicate} flags in request ${region}`, async t => {
    const s = await sandbox(t);
    const engine = globalThis.WebAssembly;
    t.after(() => { globalThis.WebAssembly = engine; });
    const signals = ['SIGINT', 'SIGTERM'];
    const listeners = signals.map(signal => process.listeners(signal));
    const word = [...Buffer.from(s.out)];
    const payload = [65, 0, 255];
    // A list of length N answers its predicate N + 1 times, so index N is the
    // end-of-list call. Cover that call as well as the first two.
    const traversed = { 'wordsEmpty:arguments': [word], 'bytesEmpty:arguments': word, 'bytesEmpty:body': payload };
    const positions = [...new Set([0, 1, traversed[`${predicate}:${region}`].length])];
    // Include truthy and falsy values, plus values with a non-number type.
    const invalidFlags = [2, -1, 1073741823, 0.5, NaN, Infinity, '0', '1', false, true, null, undefined, 0n, 1n, {}];
    for (const flag of invalidFlags) {
      for (const position of positions) {
        await writeFile(s.out, 'original');
        let activeRegion = null;
        let calls = 0;
        let resumes = 0;
        const api = {
          ...lists,
          [predicate]: list => activeRegion === region && calls++ === position ? flag : lists[predicate](list),
          init: () => 0,
          requestCode: state => state === 0 ? 3 : 0,
          requestArgs: () => { activeRegion = 'arguments'; return [word]; },
          requestBody: () => { activeRegion = 'body'; return payload; },
          resume: () => { resumes += 1; return 1; },
          exitCode: () => 0,
        };
        globalThis.WebAssembly = { instantiate: async () => ({ instance: { exports: api } }) };
        await assert.rejects(runReactor(new URL('../runtime/reactor.mjs', import.meta.url), []), {
          name: 'RangeError', message: `invalid ABI predicate ${predicate}: expected 0 or 1`,
        }, `${region}, ${predicate}, flag ${String(flag)}, position ${position}`);
        assert.equal(resumes, 0, 'malformed lists must not reach resume');
        assert.equal(await readFile(s.out, 'utf8'), 'original', 'malformed lists must not reach atomicWrite');
        assert.deepEqual(signals.map(signal => process.listeners(signal)), listeners);
      }
    }
  });
}

const maxRequestNodes = 1048576;
const requestLimitError = { name: 'RangeError', message: `reactor request exceeds ${maxRequestNodes} list nodes` };

for (const region of ['words', 'argument', 'body']) {
  test(`request traversal bounds cycles in ${region}`, async t => {
    const s = await sandbox(t);
    const engine = globalThis.WebAssembly;
    t.after(() => { globalThis.WebAssembly = engine; });
    const signals = ['SIGINT', 'SIGTERM'];
    const listeners = signals.map(signal => process.listeners(signal));
    const word = [...Buffer.from(s.out)];
    // An empty word holds no byte node, so only the word-list budget stops a
    // cycle of empty words.
    const heads = region === 'words' ? [word, []] : [65];
    const shapes = [[0], [1, 1], [1, 0], [1, 2, 1]];
    const cases = shapes.flatMap(links => heads.map(head => ({ links, head })));
    for (const { links, head } of cases) {
      await writeFile(s.out, 'original');
      const nodes = links.map(() => ({}));
      const nodeSet = new Set(nodes);
      const prefix = region === 'words' ? 'words' : 'bytes';
      let visits = 0;
      let resumes = 0;
      const api = {
        ...lists,
        [`${prefix}Empty`]: list => {
          if (!nodeSet.has(list)) return lists[`${prefix}Empty`](list);
          // Bound the baseline regression without a timeout or an infinite loop.
          if (++visits > maxRequestNodes + 1) throw new Error('cycle traversal exceeded the test guard');
          return 0;
        },
        [`${prefix}Head`]: list => nodeSet.has(list) ? head : lists[`${prefix}Head`](list),
        [`${prefix}Tail`]: list => nodeSet.has(list)
          ? nodes[links[nodes.indexOf(list)]] : lists[`${prefix}Tail`](list),
        init: () => 0,
        requestCode: () => 3,
        requestArgs: () => region === 'words' ? nodes[0] : [region === 'argument' ? nodes[0] : word],
        requestBody: () => region === 'body' ? nodes[0] : [65, 0, 255],
        resume: () => { resumes += 1; assert.fail('a cyclic request must not resume'); },
        exitCode: () => 0,
      };
      globalThis.WebAssembly = { instantiate: async () => ({ instance: { exports: api } }) };
      await assert.rejects(runReactor(new URL('../runtime/reactor.mjs', import.meta.url), []),
        requestLimitError,
        `${region}: ${JSON.stringify(links)}, head size ${Array.isArray(head) ? head.length : 1}`);
      assert.equal(resumes, 0);
      assert.equal(await readFile(s.out, 'utf8'), 'original');
      assert.deepEqual(signals.map(signal => process.listeners(signal)), listeners);
    }
  });
}

test('request traversal permits shared byte lists across arguments, bodies and requests', async t => {
  const s = await sandbox(t);
  const engine = globalThis.WebAssembly;
  t.after(() => { globalThis.WebAssembly = engine; });
  const word = [...Buffer.from(s.path)];
  const words = [word, word];
  let resumes = 0;
  const api = {
    ...lists,
    init: () => 0,
    requestCode: state => state < 2 ? 9 : 0,
    requestArgs: () => words,
    requestBody: () => word,
    resume: (state, status, answer) => {
      assert.equal(status, 0);
      assert.equal(Buffer.from(answer).toString(), s.path);
      resumes += 1;
      return state + 1;
    },
    exitCode: () => 0,
  };
  globalThis.WebAssembly = { instantiate: async () => ({ instance: { exports: api } }) };
  assert.equal(await runReactor(new URL('../runtime/reactor.mjs', import.meta.url), []), 0);
  assert.equal(resumes, 2);
});

test('request traversal accepts the exact limit and renews it for each request', async t => {
  const s = await sandbox(t);
  const engine = globalThis.WebAssembly;
  t.after(() => { globalThis.WebAssembly = engine; });
  const word = [...Buffer.from(s.out)];
  const bodyLength = maxRequestNodes - 1 - word.length;
  let resumes = 0;
  const api = {
    ...lists,
    bytesEmpty: list => Array.isArray(list) ? lists.bytesEmpty(list) : Number(list.left === 0),
    bytesHead: list => Array.isArray(list) ? lists.bytesHead(list) : 65,
    bytesTail: list => Array.isArray(list) ? lists.bytesTail(list) : { left: list.left - 1 },
    init: () => 0,
    requestCode: state => state < 2 ? 3 : 0,
    requestArgs: () => [word],
    requestBody: () => ({ left: bodyLength }),
    resume: (state, status, answer) => {
      assert.equal(status, 0, Buffer.from(answer).toString());
      resumes += 1;
      return state + 1;
    },
    exitCode: () => 0,
  };
  globalThis.WebAssembly = { instantiate: async () => ({ instance: { exports: api } }) };
  assert.equal(await runReactor(new URL('../runtime/reactor.mjs', import.meta.url), []), 0);
  assert.equal(resumes, 2);
  assert.deepEqual(await readFile(s.out), Buffer.alloc(bodyLength, 65));
  // One surplus node must fail before it overwrites an existing file.
  await writeFile(s.out, 'original');
  api.requestBody = () => ({ left: bodyLength + 1 });
  resumes = 0;
  await assert.rejects(runReactor(new URL('../runtime/reactor.mjs', import.meta.url), []), requestLimitError);
  assert.equal(resumes, 0);
  assert.equal(await readFile(s.out, 'utf8'), 'original');
});

test('request traversal shares the limit across arguments and bounds fresh nodes', async t => {
  const engine = globalThis.WebAssembly;
  t.after(() => { globalThis.WebAssembly = engine; });
  for (const fresh of [false, true]) {
    let heads = 0;
    const api = {
      ...lists,
      bytesEmpty: list => Number(list.left === 0),
      bytesHead: () => {
        if (++heads > maxRequestNodes) throw new Error('fresh traversal exceeded the test guard');
        return 65;
      },
      bytesTail: list => ({ left: fresh ? list.left : list.left - 1 }),
      init: () => 0,
      requestCode: () => 9,
      requestArgs: () => [{ left: maxRequestNodes / 2 }, { left: maxRequestNodes / 2 }],
      requestBody: () => assert.fail('overlong arguments must be rejected before the body'),
      resume: () => assert.fail('an overlong request must not resume'),
      exitCode: () => 0,
    };
    globalThis.WebAssembly = { instantiate: async () => ({ instance: { exports: api } }) };
    await assert.rejects(runReactor(new URL('../runtime/reactor.mjs', import.meta.url), []), requestLimitError);
    assert.equal(heads, maxRequestNodes - (fresh ? 1 : 2));
  }
});

test('list ABI preserves valid flags, empty lists and binary request bodies', async t => {
  const s = await sandbox(t);
  const engine = globalThis.WebAssembly;
  t.after(() => { globalThis.WebAssembly = engine; });
  for (const body of [[], [0, 255, 65, 0]]) {
    const seen = { bytesEmpty: new Set(), wordsEmpty: new Set() };
    const { api, answers } = slotScriptApi([{ code: 3, args: [s.out], body: Buffer.from(body), answer: '' }]);
    for (const name of Object.keys(seen)) {
      api[name] = list => { const flag = lists[name](list); seen[name].add(flag); return flag; };
    }
    globalThis.WebAssembly = { instantiate: async () => ({ instance: { exports: api } }) };
    assert.equal(await runReactor(new URL('../runtime/reactor.mjs', import.meta.url), []), 0);
    assert.deepEqual(answers, ['']);
    assert.deepEqual(await readFile(s.out), Buffer.from(body));
    for (const flags of Object.values(seen)) assert.deepEqual([...flags].sort(), [0, 1]);
  }
});

for (const exitCode of [0, 7]) {
  test(`a terminal request preserves application exit code ${exitCode} without interruption`, async t => {
    const engine = globalThis.WebAssembly;
    t.after(() => { globalThis.WebAssembly = engine; });
    const api = {
      ...lists,
      init: () => 0,
      requestCode: () => 0,
      requestArgs: () => assert.fail('a terminal request must not read arguments'),
      requestBody: () => assert.fail('a terminal request must not read its body'),
      resume: () => assert.fail('a terminal request must not resume'),
      exitCode: () => exitCode,
    };
    globalThis.WebAssembly = { instantiate: async () => ({ instance: { exports: api } }) };
    assert.equal(await runReactor(new URL('../runtime/reactor.mjs', import.meta.url), []), exitCode);
  });
}

test('the argument list reaches init in order and unchanged', async t => {
  const engine = globalThis.WebAssembly;
  t.after(() => { globalThis.WebAssembly = engine; });
  let seen = null;
  const api = {
    ...lists,
    // The words arrive as byte lists, so the record decodes each one.
    init: words => { seen = words.map(word => Buffer.from(word).toString()); return 0; },
    requestCode: () => 0,
    requestArgs: () => [],
    requestBody: () => [],
    resume: () => assert.fail('a terminal request must not resume'),
    exitCode: () => 0,
  };
  globalThis.WebAssembly = { instantiate: async () => ({ instance: { exports: api } }) };
  const argv = ['first', 'second', 'café'];
  assert.equal(await runReactor(new URL('../runtime/reactor.mjs', import.meta.url), argv), 0);
  assert.deepEqual(seen, argv);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`a terminal request after operation 4 preserves ${signal} status`, async t => {
    const s = await sandbox(t);
    const engine = globalThis.WebAssembly;
    t.after(() => { globalThis.WebAssembly = engine; });
    const word = text => [...Buffer.from(text)];
    const responses = [];
    const started = spawns.started;
    const api = {
      ...lists,
      init: () => 0,
      requestCode: state => state === 0 ? 4 : 0,
      requestArgs: () => command(s, '0', sideEffect(s)).map(word),
      requestBody: () => {
        // Deliver the signal when opening the captures yields. Operation 4
        // then reports interruption without any timer or process startup race.
        queueMicrotask(() => process.emit(signal));
        return [];
      },
      resume: (state, status, answer) => {
        responses.push({ status, answer: fields(Buffer.from(answer)) });
        return state + 1;
      },
      exitCode: () => 0,
    };
    globalThis.WebAssembly = { instantiate: async () => ({ instance: { exports: api } }) };
    const status = await runReactor(new URL('../runtime/reactor.mjs', import.meta.url), []);
    const interruptedCode = 128 + constants.signals[signal];
    assert.deepEqual(responses, [{ status: 0, answer: [String(interruptedCode),
      String(constants.signals[signal]), '0', '1', ''] }]);
    assert.equal(spawns.started, started);
    assert.equal(status, interruptedCode);
    await absent(s.marker);
  });
}

test('a signal between requests ends the loop with 128 plus the signal number', { skip: process.platform === 'win32' }, async t => {
  const guard = () => {};
  const engine = globalThis.WebAssembly;
  process.on('SIGINT', guard);
  t.after(() => { process.removeListener('SIGINT', guard); globalThis.WebAssembly = engine; });
  const word = text => [...Buffer.from(text)];
  let resumes = 0;
  const api = {
    ...lists,
    init: () => 100,
    requestCode: state => state > 0 ? 2 : 0,
    requestArgs: () => [word(process.execPath), word('0'), word('4')],
    requestBody: () => [],
    resume: state => {
      resumes += 1;
      // The third read has returned, so the loop is running and the
      // handler is installed. Operation 2 is not operation 4.
      if (resumes === 3) process.kill(process.pid, 'SIGINT');
      return state - 1;
    },
    exitCode: () => 0,
  };
  globalThis.WebAssembly = { instantiate: async () => ({ instance: { exports: api } }) };
  // The fake module ignores the bytes, so any small existing file serves.
  const status = await runReactor(new URL('../runtime/reactor.mjs', import.meta.url), []);
  assert.equal(status, 128 + constants.signals.SIGINT);
  assert.ok(resumes < 100, `loop ran ${resumes} requests after the signal`);
});

test('an interruption reported by operation 4 earns one shutdown request', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const guard = () => {};
  const engine = globalThis.WebAssembly;
  process.on('SIGINT', guard);
  t.after(() => { process.removeListener('SIGINT', guard); globalThis.WebAssembly = engine; });
  const word = text => [...Buffer.from(text)];
  const performed = [];
  const api = {
    ...lists,
    init: () => 0,
    requestCode: state => state === 0 ? 4 : state === 1 ? 3 : 0,
    // State 0 runs a command long enough to be interrupted. State 1 is the
    // shutdown request: operation 3 leaves a file the assertions can read.
    requestArgs: state => state === 0
      ? [word(s.out), word(s.err), word(s.path), word('0'), word('/bin/sh'), word('-c'), word('sleep 5')]
      : [word(s.marker)],
    requestBody: state => state === 1 ? word('summary') : [],
    resume: (state, status) => { performed.push(`${state}:${status}`); return state + 1; },
    exitCode: () => 0,
  };
  globalThis.WebAssembly = { instantiate: async () => ({ instance: { exports: api } }) };
  // The handler is installed by the time the command is running, and the
  // command outlives this delay by seconds.
  setTimeout(() => process.kill(process.pid, 'SIGINT'), 150).unref();
  const status = await runReactor(new URL('../runtime/reactor.mjs', import.meta.url), []);
  assert.equal(status, 128 + constants.signals.SIGINT);
  assert.deepEqual(performed, ['0:0', '1:0']);
  assert.equal(await readFile(s.marker, 'utf8'), 'summary');
});

// The reactor level zk verdict. No surface program reaches operation 11 in
// version one, because "verify" is a proposition there.
test('operation 11 answers the zk verdict of a proof slot', async t => {
  const engine = globalThis.WebAssembly;
  t.after(() => { globalThis.WebAssembly = engine; });
  const word = text => [...Buffer.from(text)];
  const answers = [];
  // State 0 proves the witness 3 at the instance 9, so the slot holds the
  // instance in its flag and the witness in its plaintext (R-W4-8).
  // The identity relation holds at 3 for the same witness, so that row
  // isolates instance binding from the relation check at operation 11.
  const script = [
    { code: 10, args: () => ['9', '3'] },
    { code: 11, args: slots => [slots.at(0), '9', '2'] },
    { code: 11, args: slots => [slots.at(0), '10', '2'] },
    { code: 11, args: slots => [slots.at(0), '3', '0'] },
    { code: 11, args: slots => [slots.at(0), '9', '0'] },
    { code: 10, args: () => ['0', '0'] },
    { code: 11, args: slots => [slots.at(5), '0', '2'] },
    { code: 11, args: slots => [slots.at(5), '1', '3'] },
  ];
  const api = {
    ...lists,
    init: () => 0,
    requestCode: state => state < script.length ? script.at(state).code : 0,
    requestArgs: state => script.at(state).args(answers).map(word),
    requestBody: () => [],
    resume: (state, status, answer) => {
      assert.equal(status, 0);
      answers.push(Buffer.from(answer).toString());
      return state + 1;
    },
    exitCode: () => 0,
  };
  globalThis.WebAssembly = { instantiate: async () => ({ instance: { exports: api } }) };
  assert.equal(await runReactor(new URL('../runtime/reactor.mjs', import.meta.url), []), 0);
  assert.deepEqual(answers, ['1', '1', '0', '0', '0', '2', '1', '0']);
});

test('the fhc and mpc operations keep one slot layout', async t => {
  const engine = globalThis.WebAssembly;
  t.after(() => { globalThis.WebAssembly = engine; });
  const word = text => [...Buffer.from(text)];
  const answers = [];
  // Seal 5 at level 0, evaluate the successor at level 3, and read the
  // plaintext back. Then take two shares, add them jointly over a subset of
  // two parties, and open the result.
  const script = [
    { code: 12, args: () => ['0', '5'] },
    { code: 13, args: slots => ['3', '3', slots.at(0)] },
    { code: 14, args: slots => [slots.at(1)] },
    { code: 15, args: () => ['7'] },
    { code: 15, args: () => ['8'] },
    { code: 16, args: slots => ['2', '0', slots.at(3), slots.at(4)] },
    { code: 17, args: slots => [slots.at(5)] },
  ];
  const api = {
    ...lists,
    init: () => 0,
    requestCode: state => state < script.length ? script.at(state).code : 0,
    requestArgs: state => script.at(state).args(answers).map(word),
    requestBody: () => [],
    resume: (state, status, answer) => {
      assert.equal(status, 0);
      answers.push(Buffer.from(answer).toString());
      return state + 1;
    },
    exitCode: () => 0,
  };
  globalThis.WebAssembly = { instantiate: async () => ({ instance: { exports: api } }) };
  assert.equal(await runReactor(new URL('../runtime/reactor.mjs', import.meta.url), []), 0);
  assert.deepEqual(answers, ['1', '2', '6', '3', '4', '5', '15']);
});

// Drive the actual request loop with a scripted byte-list ABI. Each response
// is checked before another request can use it as a slot index.
const slotScriptApi = script => {
  const answers = [];
  const api = {
    ...lists,
    init: () => 0,
    requestCode: state => state < script.length ? script.at(state).code : 0,
    requestArgs: state => script.at(state).args.map(text => [...Buffer.from(text)]),
    requestBody: state => [...Buffer.from(script.at(state).body ?? '')],
    resume: (state, status, bytes) => {
      const step = script.at(state);
      const answer = Buffer.from(bytes).toString();
      assert.equal(status, step.status ?? 0, `step ${state}, operation ${step.code}: ${answer.slice(0, 160)}`);
      if (Buffer.isBuffer(step.answer)) assert.ok(Buffer.from(bytes).equals(step.answer),
        `step ${state}, operation ${step.code}: response bytes differ (got ${bytes.length}, expected ${step.answer.length})`);
      else if (step.answer instanceof RegExp) assert.match(answer, step.answer);
      else assert.equal(answer, step.answer, `step ${state}, operation ${step.code}`);
      answers.push(answer);
      return state + 1;
    },
    exitCode: () => 0,
  };
  return { api, answers };
};
const slotScript = async script => {
  const engine = globalThis.WebAssembly;
  const { api, answers } = slotScriptApi(script);
  // Buffer tails are views, keeping full-size request decoding linear too.
  api.requestBody = state => Buffer.from(script.at(state).body ?? '');
  // Requests use the array ABI above. Build responses by constant-time cons
  // so the full 64 KiB answer does not trigger quadratic array copying.
  api.emptyBytes = () => null;
  api.consBytes = (head, tail) => ({ head, tail });
  const resume = api.resume;
  api.resume = (state, status, list) => {
    const bytes = [];
    for (let cursor = list; cursor !== null; cursor = cursor.tail) bytes.push(cursor.head);
    return resume(state, status, bytes);
  };
  globalThis.WebAssembly = { instantiate: async () => ({ instance: { exports: api } }) };
  try {
    assert.equal(await runReactor(new URL('../runtime/reactor.mjs', import.meta.url), []), 0);
    assert.equal(answers.length, script.length);
    return answers;
  } finally {
    globalThis.WebAssembly = engine;
  }
};

test('request arities reject missing and surplus arguments before host effects', async t => {
  const s = await sandbox(t);
  const root = join(s.path, 'new-root');
  const emptyDirectory = join(s.path, 'empty');
  await mkdir(emptyDirectory);
  await writeFile(s.out, 'original');
  const started = spawns.started;
  const requests = [
    ['temporary directory', 1, [root, 'request-']],
    ['file read', 2, [s.out, '0', '8']],
    ['atomic write', 3, [s.out]],
    ['process', 4, [s.marker, s.err, s.path, '0', process.execPath]],
    ['file size', 5, [s.out]],
    ['stdout', 6, []], ['stderr', 7, []],
    ['realpath', 8, [s.out]], ['resolve', 9, [s.path, 'stdout']],
    ['prove', 10, ['9', '3']], ['verify', 11, ['1', '9', '2']],
    ['encrypt', 12, ['0', '3']], ['evaluate', 13, ['1', '3', '1']],
    ['decrypt', 14, ['1']], ['input', 15, ['3']],
    ['joint computation', 16, ['1', '0', '1']], ['open', 17, ['1']], ['release', 18, ['1']],
    ['unlink', 19, [s.out]], ['remove directory', 20, [emptyDirectory]],
    ['rename', 21, [s.out, s.marker]],
    ['directory listing', 22, [emptyDirectory]],
    ['entry kind', 23, [s.out]],
    ['symlink target', 24, [s.out]],
    ['symlink creation', 25, [s.out, s.marker]],
    ['hard-link creation', 26, [s.out, s.marker]],
    ['file copy', 27, [s.out, s.marker]],
    ['directory creation', 28, [s.marker]],
    ['file append', 29, [s.out]],
    ['file truncate', 30, [s.out, '0']],
    ['file mode', 31, [s.out, '384']],
    ['file permissions', 32, [s.out]],
    ['file modified', 33, [s.out]],
    ['file accessed', 34, [s.out]],
    ['file changed', 35, [s.out]],
    ['file created', 36, [s.out]],
    ['file identity', 37, [s.out]],
    ['file link count', 38, [s.out]],
    ['file owner', 39, [s.out]],
    ['file allocation', 40, [s.out]],
    ['filesystem capacity', 41, [s.out]],
    ['filesystem inodes', 42, [s.out]],
    ['filesystem type', 43, [s.out]],
    ['file times', 44, [s.out, '1000', '2000']],
    ['file chown', 45, [s.out, '1000', '2000']],
    ['file lchown', 46, [s.out, '1000', '2000']],
    ['file lutimes', 47, [s.out, '1000', '2000']],
    ['file access', 48, [s.out, '0']],
  ];
  for (const [name, code, args] of requests) {
    await t.test(name, async () => {
      const variadic = code === 4 || code === 16;
      const malformed = variadic ? [] : [[...args, 'surplus']];
      for (let length = 0; length < args.length; length += 1) malformed.push(args.slice(0, length));
      await slotScript([
        { code: 10, args: ['9', '3'], answer: '1' },
        ...malformed.map(invalid => ({ code, args: invalid, status: 1,
          answer: `IO: OS request ${code} expects ${variadic ? 'at least ' : ''}${args.length} argument${args.length === 1 ? '' : 's'}, got ${invalid.length}` })),
        { code: 17, args: ['1'], answer: '3' },
        { code: 15, args: ['7'], answer: '2' },
        { code: 17, args: ['2'], answer: '7' },
      ]);
      await absent(root);
      await absent(s.marker);
      await absent(s.err);
      assert.equal(await readFile(s.out, 'utf8'), 'original');
      assert.deepEqual(await readdir(emptyDirectory), []);
      assert.equal(spawns.started, started);
    });
  }
});

test('temporary directories preserve literal prefixes and stay under the resolved root', async t => {
  const s = await sandbox(t);
  const root = join(s.path, 'directories');
  const rootArgument = relative(process.cwd(), root) + '/unused/..';
  const prefixes = ['', '.', '..', 'request-', 'héllo ', ' spaced-'];
  const answers = await slotScript(prefixes.flatMap(prefix => [
    { code: 1, args: [rootArgument, prefix], answer: /.+/ },
    { code: 1, args: [rootArgument, prefix], answer: /.+/ },
  ]));
  t.after(() => Promise.all(answers.map(path => rm(path, { recursive: true, force: true }))));
  assert.equal(new Set(answers).size, answers.length, 'every request creates a fresh directory');
  for (const [index, path] of answers.entries()) {
    assert.equal(dirname(path), resolve(root));
    assert.ok(basename(path).startsWith(prefixes[Math.floor(index / 2)]));
    assert.ok(basename(path).length > prefixes[Math.floor(index / 2)].length);
    const info = await stat(path);
    assert.ok(info.isDirectory());
    if (process.platform !== 'win32') assert.equal(info.mode & 0o777, 0o700);
  }
  assert.deepEqual((await readdir(root)).sort(), answers.map(path => basename(path)).sort());
  assert.deepEqual(await readdir(s.path), ['directories']);
});

test('temporary directories reject path separators before creating the root', async t => {
  const s = await sandbox(t);
  const root = join(s.path, 'directories');
  for (const prefix of ['../escape-', '../', 'a/b', 'a/', '/absolute-', '..\\escape-', '\\absolute-', 'a\\b']) {
    await slotScript([{ code: 1, args: [root, prefix], status: 1,
      answer: 'IO: temporary directory prefix must not contain path separators' }]);
    await absent(root);
    assert.deepEqual(await readdir(s.path), []);
  }
});

test('filesystem cleanup removes a reactor file and its temporary directory', async t => {
  const s = await sandbox(t);
  const [directory] = await slotScript([{ code: 1, args: [s.path, 'cleanup-'], answer: /.+/ }]);
  const file = join(directory, 'héllo world');
  const fileArgument = relative(process.cwd(), file);
  const directoryArgument = relative(process.cwd(), directory);
  await writeFile(s.marker, 'keep');
  await slotScript([
    { code: 3, args: [fileArgument], body: 'private\0content', answer: '' },
    { code: 2, args: [fileArgument, '0', '65536'], answer: 'private\0content' },
    { code: 20, args: [directoryArgument], status: 1, answer: /^(ENOTEMPTY|EEXIST):/ },
    { code: 2, args: [fileArgument, '0', '65536'], answer: 'private\0content' },
    { code: 19, args: [fileArgument], answer: '' },
    { code: 19, args: [fileArgument], status: 1, answer: /^ENOENT:/ },
    { code: 20, args: [directoryArgument], answer: '' },
    { code: 20, args: [directoryArgument], status: 1, answer: /^ENOENT:/ },
  ]);
  await absent(directory);
  assert.deepEqual(await readdir(s.path), ['marker']);
  assert.equal(await readFile(s.marker, 'utf8'), 'keep');
});

test('filesystem cleanup refuses wrong kinds and preserves directory contents', async t => {
  const s = await sandbox(t);
  const emptyDirectory = join(s.path, 'empty');
  await mkdir(emptyDirectory);
  await writeFile(s.out, 'original');
  await slotScript([
    { code: 19, args: [emptyDirectory], status: 1, answer: /^(EISDIR|EPERM|EACCES):/ },
    { code: 19, args: [s.path], status: 1, answer: /^(EISDIR|EPERM|EACCES):/ },
    { code: 20, args: [s.out], status: 1, answer: /^ENOTDIR:/ },
    { code: 20, args: [s.path], status: 1, answer: /^(ENOTEMPTY|EEXIST):/ },
  ]);
  assert.deepEqual(await readdir(emptyDirectory), []);
  assert.equal(await readFile(s.out, 'utf8'), 'original');
  assert.deepEqual((await readdir(s.path)).sort(), ['empty', 'stdout']);
});

test('filesystem cleanup unlinks symlinks without removing their targets', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const directory = join(s.path, 'target-directory');
  const directoryLink = join(s.path, 'directory-link');
  const fileLink = join(s.path, 'file-link');
  const danglingLink = join(s.path, 'dangling-link');
  await mkdir(directory);
  await writeFile(s.out, 'target');
  await symlink(directory, directoryLink);
  await symlink(s.out, fileLink);
  await symlink(s.marker, danglingLink);
  await slotScript([{ code: 20, args: [directoryLink], status: 1, answer: /^ENOTDIR:/ }]);
  assert.ok((await lstat(directoryLink)).isSymbolicLink());
  assert.deepEqual(await readdir(directory), []);
  await slotScript([directoryLink, fileLink, danglingLink].map(path => ({ code: 19, args: [path], answer: '' })));
  for (const path of [directoryLink, fileLink, danglingLink]) await assert.rejects(lstat(path), { code: 'ENOENT' });
  assert.deepEqual(await readdir(directory), []);
  assert.equal(await readFile(s.out, 'utf8'), 'target');
  await absent(s.marker);
});

test('filesystem rename moves and replaces files without changing their contents or identity', async t => {
  const s = await sandbox(t);
  const directory = join(s.path, 'destination');
  const target = join(directory, 'héllo world');
  const content = Buffer.from([0, 255, 128, 10, 65]);
  await mkdir(directory);
  await slotScript([
    { code: 3, args: [s.out], body: content, answer: '' },
    { code: 3, args: [target], body: 'old destination', answer: '' },
  ]);
  const original = await stat(s.out);
  const sourceArgument = relative(process.cwd(), s.out);
  const targetArgument = relative(process.cwd(), target);
  await slotScript([
    { code: 21, args: [sourceArgument, targetArgument], body: 'ignored', answer: '' },
    { code: 21, args: [targetArgument, targetArgument], answer: '' },
    { code: 5, args: [targetArgument], answer: String(content.length) },
    { code: 21, args: [sourceArgument, targetArgument], status: 1, answer: /^ENOENT:/ },
    { code: 21, args: [targetArgument, s.marker], answer: '' },
  ]);
  await absent(s.out);
  await absent(target);
  assert.deepEqual(await readFile(s.marker), content);
  const moved = await stat(s.marker);
  assert.equal(moved.dev, original.dev);
  assert.equal(moved.ino, original.ino);
  assert.equal(moved.mode, original.mode);
  assert.deepEqual(await readdir(directory), []);
});

test('filesystem rename moves nonempty directories and replaces empty directories', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const source = join(s.path, 'source');
  const moved = join(s.path, 'moved');
  const target = join(s.path, 'target');
  await mkdir(join(source, 'nested'), { recursive: true });
  await mkdir(target);
  await writeFile(join(source, 'nested', 'content'), 'keep');
  const original = await stat(source);
  await slotScript([
    { code: 21, args: [source, moved], answer: '' },
    { code: 2, args: [join(moved, 'nested', 'content'), '0', '65536'], answer: 'keep' },
    { code: 21, args: [moved, target], answer: '' },
  ]);
  await absent(source);
  await absent(moved);
  assert.equal(await readFile(join(target, 'nested', 'content'), 'utf8'), 'keep');
  assert.equal((await stat(target)).ino, original.ino);
  assert.deepEqual(await readdir(s.path), ['target']);
});

test('filesystem rename reports filesystem errors while preserving both paths', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const sourceDirectory = join(s.path, 'source');
  const targetDirectory = join(s.path, 'target');
  await mkdir(sourceDirectory);
  await mkdir(targetDirectory);
  await writeFile(s.out, 'source file');
  await writeFile(s.err, 'destination file');
  await writeFile(join(sourceDirectory, 'content'), 'source directory');
  await writeFile(join(targetDirectory, 'content'), 'destination directory');
  for (const [source, target, error] of [
    [s.marker, s.err, /^ENOENT:/],
    [s.out, join(s.marker, 'missing-parent'), /^ENOENT:/],
    [s.out, targetDirectory, /^(EISDIR|ENOTDIR):/],
    [sourceDirectory, s.err, /^ENOTDIR:/],
    [sourceDirectory, targetDirectory, /^(ENOTEMPTY|EEXIST):/],
    [sourceDirectory, join(sourceDirectory, 'child'), /^EINVAL:/],
  ]) {
    await slotScript([{ code: 21, args: [source, target], status: 1, answer: error }]);
    assert.equal(await readFile(s.out, 'utf8'), 'source file');
    assert.equal(await readFile(s.err, 'utf8'), 'destination file');
    assert.equal(await readFile(join(sourceDirectory, 'content'), 'utf8'), 'source directory');
    assert.equal(await readFile(join(targetDirectory, 'content'), 'utf8'), 'destination directory');
    assert.deepEqual(await readdir(sourceDirectory), ['content']);
    assert.deepEqual(await readdir(targetDirectory), ['content']);
    await absent(s.marker);
  }
});

test('filesystem rename preserves symlink targets at both endpoints', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const directory = join(s.path, 'directory');
  await mkdir(directory);
  await writeFile(s.out, 'target file');
  await writeFile(join(directory, 'content'), 'target directory');
  for (const target of [s.out, directory, s.marker]) {
    const sourceLink = join(s.path, 'source-link');
    const movedLink = join(s.path, 'moved-link');
    await symlink(target, sourceLink);
    await writeFile(movedLink, 'replaced');
    await slotScript([{ code: 21, args: [sourceLink, movedLink], answer: '' }]);
    await assert.rejects(lstat(sourceLink), { code: 'ENOENT' });
    assert.ok((await lstat(movedLink)).isSymbolicLink());
    assert.equal(await readlink(movedLink), target);
    await slotScript([
      { code: 3, args: [s.err], body: 'replacement', answer: '' },
      { code: 21, args: [s.err, movedLink], answer: '' },
    ]);
    await absent(s.err);
    assert.ok((await lstat(movedLink)).isFile());
    assert.equal(await readFile(movedLink, 'utf8'), 'replacement');
    assert.equal(await readFile(s.out, 'utf8'), 'target file');
    assert.equal(await readFile(join(directory, 'content'), 'utf8'), 'target directory');
    await absent(s.marker);
  }
});

test('filesystem rename rejects undecodable paths before changing either endpoint', async t => {
  const s = await sandbox(t);
  await writeFile(s.out, 'source');
  await writeFile(s.err, 'destination');
  for (const [invalid, message] of [[Buffer.from('bad\0path'), 'NUL in OS string argument'],
    [Buffer.from([255]), 'non-UTF-8 bytes in OS string argument']]) {
    for (const args of [[invalid, s.err], [s.out, invalid]]) {
      await assert.rejects(slotScript([{ code: 21, args, answer: '' }]), { message });
      assert.equal(await readFile(s.out, 'utf8'), 'source');
      assert.equal(await readFile(s.err, 'utf8'), 'destination');
      assert.deepEqual((await readdir(s.path)).sort(), ['stderr', 'stdout']);
    }
  }
});

test('entry kind classifies files and directories with literal and relative paths', async t => {
  const s = await sandbox(t);
  const file = join(s.path, 'héllo world\nfile');
  await writeFile(file, Buffer.from([0, 255, 10]));
  await slotScript([
    { code: 23, args: [file], body: 'unused payload', answer: 'file' },
    { code: 23, args: [relative(process.cwd(), file)], answer: 'file' },
    { code: 23, args: [s.path], answer: 'directory' },
    { code: 23, args: [relative(process.cwd(), s.path)], answer: 'directory' },
  ]);
  assert.deepEqual(await readFile(file), Buffer.from([0, 255, 10]));
  assert.deepEqual(await readdir(s.path), ['héllo world\nfile']);
});

test('entry kind inspects final symlinks and preserves OS resolution of parent components', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const directory = join(s.path, 'directory');
  const fileLink = join(s.path, 'file-link');
  const directoryLink = join(s.path, 'directory-link');
  const dangling = join(s.path, 'dangling');
  const loop = join(s.path, 'loop');
  const parentLink = join(s.path, 'parent-link');
  await mkdir(directory);
  await writeFile(s.out, 'target');
  await symlink(s.out, fileLink);
  await symlink(directory, directoryLink);
  await symlink(s.marker, dangling);
  await symlink(loop, loop);
  await symlink(s.path, parentLink);
  await slotScript([
    ...[fileLink, directoryLink, dangling, loop].map(path => ({ code: 23, args: [path], answer: 'symlink' })),
    { code: 23, args: [join(parentLink, 'stdout')], answer: 'file' },
    { code: 23, args: [join(parentLink, 'directory')], answer: 'directory' },
    { code: 23, args: [join(parentLink, 'dangling')], answer: 'symlink' },
    { code: 23, args: [directoryLink + '/'], answer: 'directory' },
  ]);
  assert.equal(await readlink(fileLink), s.out);
  assert.equal(await readlink(directoryLink), directory);
  assert.equal(await readlink(dangling), s.marker);
  assert.equal(await readlink(loop), loop);
  assert.equal(await readFile(s.out, 'utf8'), 'target');
  assert.deepEqual(await readdir(directory), []);
  await absent(s.marker);
});

test('entry kind reports special files without opening them', { skip: process.platform === 'win32' }, async () => {
  assert.equal((await lstat('/dev/null')).isCharacterDevice(), true);
  await slotScript([{ code: 23, args: ['/dev/null'], answer: 'other' }]);
});

test('entry kind reports filesystem errors and continues with subsequent requests', async t => {
  const s = await sandbox(t);
  await writeFile(s.out, 'file');
  await slotScript([
    { code: 23, args: [s.marker], status: 1, answer: /^ENOENT:/ },
    { code: 23, args: [''], status: 1, answer: /^ENOENT:/ },
    ...(process.platform === 'win32' ? [] : [
      { code: 23, args: [join(s.out, 'child')], status: 1, answer: /^ENOTDIR:/ },
    ]),
    { code: 23, args: [s.out], answer: 'file' },
    { code: 23, args: [s.path], answer: 'directory' },
  ]);
});

test('entry kind rejects undecodable paths before responding', async t => {
  const s = await sandbox(t);
  await writeFile(s.out, 'unchanged');
  for (const [invalid, message] of [[Buffer.from(s.out + '\0suffix'), 'NUL in OS string argument'],
    [Buffer.from([255]), 'non-UTF-8 bytes in OS string argument']]) {
    await assert.rejects(slotScript([{ code: 23, args: [invalid], answer: '' }]), { message });
  }
  assert.equal(await readFile(s.out, 'utf8'), 'unchanged');
});

test('file modified returns filesystem nanoseconds without changing file contents or metadata', async t => {
  const s = await sandbox(t);
  const content = Buffer.from([0, 255, 65, 254, 10]);
  await writeFile(s.out, content);
  const metadata = info => [info.dev, info.ino, info.mode, info.nlink, info.size,
    info.atimeNs, info.mtimeNs, info.ctimeNs];
  for (const seconds of [0, 1.234567, 1700000000.123456]) {
    await fsPromises.utimes(s.out, 2, seconds);
    const before = await stat(s.out, { bigint: true });
    await slotScript([
      { code: 33, args: [s.out], answer: String(before.mtimeNs) },
      { code: 33, args: [s.out], body: Buffer.from([255, 0]), answer: String(before.mtimeNs) },
    ]);
    assert.deepEqual(metadata(await stat(s.out, { bigint: true })), metadata(before));
  }
  assert.deepEqual(await readFile(s.out), content);
});

test('file modified observes updates through append and truncate requests', async t => {
  const s = await sandbox(t);
  await writeFile(s.out, 'kept');
  for (const change of [{ code: 29, args: [s.out], body: ' appended', answer: '' },
    { code: 30, args: [s.out, '2'], answer: '' }]) {
    await fsPromises.utimes(s.out, 1, 1);
    const before = await stat(s.out, { bigint: true });
    const answers = await slotScript([
      { code: 33, args: [s.out], answer: String(before.mtimeNs) },
      change,
      { code: 33, args: [s.out], answer: /^-?(0|[1-9][0-9]*)$/ },
    ]);
    const after = await stat(s.out, { bigint: true });
    assert.equal(answers[2], String(after.mtimeNs));
    assert.notEqual(after.mtimeNs, before.mtimeNs);
    assert.equal(after.ino, before.ino);
  }
  assert.equal(await readFile(s.out, 'utf8'), 'ke');
});

test('file modified supports directories and special files and follows final symlinks and hard links', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const hard = join(s.path, 'hard');
  const live = join(s.path, 'live');
  const directoryLink = join(s.path, 'directory-link');
  await writeFile(s.out, 'kept');
  await fsPromises.utimes(s.out, 1, 3);
  await fsPromises.link(s.out, hard);
  await symlink('stdout', live);
  await symlink('.', directoryLink);
  const linkBefore = await lstat(live, { bigint: true });
  assert.notEqual(linkBefore.mtimeNs, (await stat(s.out, { bigint: true })).mtimeNs);
  const special = privateFifo(join(s.path, 'fifo'));
  assert.ok((await stat(special)).isFIFO());
  const expected = (await stat(s.out, { bigint: true })).mtimeNs;
  assert.equal((await stat(hard, { bigint: true })).mtimeNs, expected);
  const paths = [s.out, hard, live, s.path + '/', directoryLink, special];
  const requests = [];
  for (const path of paths) requests.push({ code: 33, args: [path],
    answer: String((await stat(path, { bigint: true })).mtimeNs) });
  await slotScript(requests);
  assert.equal((await lstat(live, { bigint: true })).mtimeNs, linkBefore.mtimeNs);
  assert.equal(await readlink(live), 'stdout');
  assert.equal(await readFile(hard, 'utf8'), 'kept');
});

test('file modified preserves relative Unicode paths and native parent symlink resolution', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const real = join(s.path, 'real');
  const alias = join(s.path, 'alias');
  await mkdir(join(real, 'nested'), { recursive: true });
  await symlink(join(real, 'nested'), alias);
  const actual = join(real, 'data');
  const decoy = join(s.path, 'data');
  const unicode = join(s.path, 'héllo space');
  for (const [path, seconds] of [[actual, 1], [decoy, 2], [unicode, 3]]) {
    await writeFile(path, 'kept');
    await fsPromises.utimes(path, seconds, seconds);
  }
  await slotScript([
    { code: 33, args: [relative(process.cwd(), unicode)], answer: '3000000000' },
    { code: 33, args: [alias + '//../data'], answer: '1000000000' },
    { code: 33, args: [decoy], answer: '2000000000' },
  ]);
});

test('file modified reports native path errors and continues without creating entries', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const missing = join(s.path, 'missing');
  const dangling = join(s.path, 'dangling');
  const loop = join(s.path, 'loop');
  await writeFile(s.out, 'kept');
  await symlink('missing', dangling);
  await symlink('loop', loop);
  const requests = [[missing, /^ENOENT:/], [join(missing, 'child'), /^ENOENT:/],
    [dangling, /^ENOENT:/], [join(s.out, 'child'), /^ENOTDIR:/],
    [s.out + '/', /^ENOTDIR:/], [loop, /^ELOOP:/], ['', /^ENOENT:/]];
  await slotScript([
    ...requests.map(([path, answer]) => ({ code: 33, args: [path], status: 1, answer })),
    { code: 33, args: [s.out], answer: String((await stat(s.out, { bigint: true })).mtimeNs) },
  ]);
  await absent(missing);
  assert.equal(await readlink(dangling), 'missing');
  assert.equal(await readlink(loop), 'loop');
});

test('file modified rejects argument counts and undecodable paths before stat', async t => {
  const inspect = t.mock.method(fsPromises, 'stat', async () => ({ mtimeNs: 0n }));
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([[], ['path', 'surplus']].map(args => ({ code: 33, args,
    status: 1, answer: `IO: OS request 33 expects 1 argument, got ${args.length}` })));
  for (const [bytes, message] of [[Buffer.from('x\0y'), 'NUL in OS string argument'],
    [Buffer.from([255]), 'non-UTF-8 bytes in OS string argument']]) {
    await assert.rejects(slotScript([{ code: 33, args: [bytes], answer: '' }]), { message });
  }
  assert.equal(inspect.mock.callCount(), 0);
});

test('file modified preserves exact signed nanoseconds and forwards literal paths while ignoring the body', async t => {
  const values = [0n, 1n, 999999n, 1000001n, 9007199254740993n, 1700000000123456789n,
    -1n, -1700000000123456789n, -(2n ** 63n), 2n ** 63n - 1n];
  const pending = [...values];
  const inspect = t.mock.method(fsPromises, 'stat', async () => {
    const mtimeNs = pending.shift();
    return { mtimeNs, mtimeMs: Number(mtimeNs) / 1000000,
      atimeNs: 11n, ctimeNs: 22n, birthtimeNs: 33n };
  });
  const originalRead = fsPromises.readFile;
  const read = t.mock.method(fsPromises, 'readFile', async (path, ...args) => {
    assert.equal(path.href, new URL('../runtime/reactor.mjs', import.meta.url).href);
    return originalRead(path, ...args);
  });
  const opened = t.mock.method(fsPromises, 'open', () => assert.fail('timestamp inspection opened contents'));
  syncBuiltinESMExports();
  t.after(() => {
    for (const mock of [inspect, read, opened]) mock.mock.restore();
    syncBuiltinESMExports();
  });
  const path = '../héllo//alias/../file';
  await slotScript(values.map(value => ({ code: 33, args: [path],
    body: Buffer.alloc(65537, 255), answer: String(value) })));
  assert.equal(inspect.mock.callCount(), values.length);
  assert.equal(read.mock.callCount(), 1);
  assert.equal(opened.mock.callCount(), 0);
  for (const call of inspect.mock.calls) assert.deepEqual(call.arguments, [path, { bigint: true }]);
});

test('file modified forwards host errors and resumes subsequent requests', async t => {
  const failures = ['EACCES', 'EIO', 'EOVERFLOW'].map(code => Object.assign(new Error('injected failure'), { code }));
  failures.push(new Error('injected failure'));
  const requests = failures.map(error => ({ code: 33, args: ['path'], status: 1,
    answer: `${error.code ?? 'IO'}: injected failure` }));
  const inspect = t.mock.method(fsPromises, 'stat', async () => {
    if (failures.length) throw failures.shift();
    return { mtimeNs: -1n };
  });
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([...requests, { code: 33, args: ['path'], answer: '-1' }]);
  assert.equal(inspect.mock.callCount(), 5);
});

test('file accessed returns native nanoseconds and observes explicit updates without changing contents or metadata', async t => {
  const s = await sandbox(t);
  const content = Buffer.from([0, 255, 65, 254, 10]);
  await writeFile(s.out, content);
  const metadata = info => [info.dev, info.ino, info.mode, info.nlink, info.size,
    info.atimeNs, info.mtimeNs, info.ctimeNs];
  const observed = [];
  for (const seconds of [0, 1.234567, 1700000000.123456]) {
    await fsPromises.utimes(s.out, seconds, 2);
    const before = await stat(s.out, { bigint: true });
    assert.notEqual(before.atimeNs, before.mtimeNs);
    const answers = await slotScript([
      { code: 34, args: [s.out], answer: String(before.atimeNs) },
      { code: 34, args: [s.out], body: Buffer.from([255, 0]), answer: String(before.atimeNs) },
    ]);
    observed.push(answers[0]);
    assert.deepEqual(metadata(await stat(s.out, { bigint: true })), metadata(before));
  }
  assert.equal(new Set(observed).size, 3);
  assert.deepEqual(await readFile(s.out), content);
});

test('file accessed reports a native pre-epoch timestamp', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  await writeFile(s.out, 'kept');
  // A negative numeric argument to Node utimes means now; a Date preserves it.
  await fsPromises.utimes(s.out, new Date(-1000), new Date(2000));
  const expected = (await stat(s.out, { bigint: true })).atimeNs;
  assert.equal(expected, -1000000000n);
  await slotScript([{ code: 34, args: [s.out], answer: String(expected) }]);
});

test('file accessed supports private special files and directories and follows final symlinks and hard links', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const hard = join(s.path, 'hard');
  const live = join(s.path, 'live');
  const directoryLink = join(s.path, 'directory-link');
  await writeFile(s.out, 'kept');
  await fsPromises.utimes(s.out, 1, 3);
  await fsPromises.link(s.out, hard);
  await symlink('stdout', live);
  await symlink('.', directoryLink);
  const special = privateFifo(join(s.path, 'fifo'));
  assert.ok((await stat(special)).isFIFO());
  const expected = (await stat(s.out, { bigint: true })).atimeNs;
  assert.notEqual((await lstat(live, { bigint: true })).atimeNs, expected);
  assert.equal((await stat(hard, { bigint: true })).atimeNs, expected);
  const requests = [{ code: 34, args: [s.out], answer: String(expected) },
    { code: 34, args: [hard], answer: String(expected) },
    { code: 34, args: [live], answer: String(expected) }];
  for (const path of [s.path + '/', directoryLink, special]) requests.push({ code: 34, args: [path],
    answer: String((await stat(path, { bigint: true })).atimeNs) });
  await slotScript(requests);
  assert.equal(await readlink(live), 'stdout');
  assert.equal(await readFile(hard, 'utf8'), 'kept');
});

test('file accessed preserves relative Unicode paths and native parent symlink resolution', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const real = join(s.path, 'real');
  const alias = join(s.path, 'alias');
  await mkdir(join(real, 'nested'), { recursive: true });
  await symlink(join(real, 'nested'), alias);
  const actual = join(real, 'data');
  const decoy = join(s.path, 'data');
  const unicode = join(s.path, 'héllo space');
  for (const [path, seconds] of [[actual, 1], [decoy, 2], [unicode, 3]]) {
    await writeFile(path, 'kept');
    await fsPromises.utimes(path, seconds, 4);
  }
  await slotScript([
    { code: 34, args: [relative(process.cwd(), unicode)], answer: '3000000000' },
    { code: 34, args: [alias + '//../data'], answer: '1000000000' },
    { code: 34, args: [decoy], answer: '2000000000' },
  ]);
});

test('file accessed reports native path errors and continues without creating entries', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const missing = join(s.path, 'missing');
  const dangling = join(s.path, 'dangling');
  const loop = join(s.path, 'loop');
  await writeFile(s.out, 'kept');
  await symlink('missing', dangling);
  await symlink('loop', loop);
  const requests = [[missing, /^ENOENT:/], [join(missing, 'child'), /^ENOENT:/],
    [dangling, /^ENOENT:/], [join(s.out, 'child'), /^ENOTDIR:/],
    [s.out + '/', /^ENOTDIR:/], [loop, /^ELOOP:/], ['', /^ENOENT:/]];
  await slotScript([
    ...requests.map(([path, answer]) => ({ code: 34, args: [path], status: 1, answer })),
    { code: 34, args: [s.out], answer: String((await stat(s.out, { bigint: true })).atimeNs) },
  ]);
  await absent(missing);
  assert.equal(await readlink(dangling), 'missing');
  assert.equal(await readlink(loop), 'loop');
});

test('file accessed rejects argument counts and undecodable paths before stat', async t => {
  const inspect = t.mock.method(fsPromises, 'stat', async () => ({ atimeNs: 0n }));
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([[], ['path', 'surplus']].map(args => ({ code: 34, args,
    status: 1, answer: `IO: OS request 34 expects 1 argument, got ${args.length}` })));
  for (const [bytes, message] of [[Buffer.from('x\0y'), 'NUL in OS string argument'],
    [Buffer.from([255]), 'non-UTF-8 bytes in OS string argument']]) {
    await assert.rejects(slotScript([{ code: 34, args: [bytes], answer: '' }]), { message });
  }
  assert.equal(inspect.mock.callCount(), 0);
});

test('file accessed preserves exact signed nanoseconds and literal paths without opening contents', async t => {
  const values = [0n, 1n, 999999n, 1000001n, 9007199254740993n, 1700000000123456789n,
    -1n, -1700000000123456789n, -(2n ** 63n), 2n ** 63n - 1n];
  const pending = [...values];
  const inspect = t.mock.method(fsPromises, 'stat', async () => {
    const atimeNs = pending.shift();
    return { atimeNs, atimeMs: Number(atimeNs) / 1000000,
      mtimeNs: 11n, ctimeNs: 22n, birthtimeNs: 33n };
  });
  const originalRead = fsPromises.readFile;
  const read = t.mock.method(fsPromises, 'readFile', async (path, ...args) => {
    assert.equal(path.href, new URL('../runtime/reactor.mjs', import.meta.url).href);
    return originalRead(path, ...args);
  });
  const opened = t.mock.method(fsPromises, 'open', () => assert.fail('timestamp inspection opened contents'));
  syncBuiltinESMExports();
  t.after(() => {
    for (const mock of [inspect, read, opened]) mock.mock.restore();
    syncBuiltinESMExports();
  });
  const path = '../héllo//alias/../file';
  await slotScript(values.map(value => ({ code: 34, args: [path],
    body: Buffer.alloc(65537, 255), answer: String(value) })));
  assert.equal(inspect.mock.callCount(), values.length);
  for (const call of inspect.mock.calls) assert.deepEqual(call.arguments, [path, { bigint: true }]);
  assert.equal(read.mock.callCount(), 1);
  assert.equal(opened.mock.callCount(), 0);
});

test('file accessed forwards host errors and resumes subsequent requests', async t => {
  const failures = ['EACCES', 'EIO', 'EOVERFLOW'].map(code => Object.assign(new Error('injected failure'), { code }));
  failures.push(new Error('injected failure'));
  const requests = failures.map(error => ({ code: 34, args: ['path'], status: 1,
    answer: `${error.code ?? 'IO'}: injected failure` }));
  const inspect = t.mock.method(fsPromises, 'stat', async () => {
    if (failures.length) throw failures.shift();
    return { atimeNs: -1n };
  });
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([...requests, { code: 34, args: ['path'], answer: '-1' }]);
  assert.equal(inspect.mock.callCount(), 5);
});

test('file changed returns native status nanoseconds without changing contents or metadata', async t => {
  const s = await sandbox(t);
  const content = Buffer.from([0, 255, 65, 254, 10]);
  await writeFile(s.out, content);
  await fsPromises.utimes(s.out, 1, 2);
  const metadata = info => [info.dev, info.ino, info.mode, info.nlink, info.size,
    info.atimeNs, info.mtimeNs, info.ctimeNs, info.birthtimeNs];
  const before = await stat(s.out, { bigint: true });
  assert.notEqual(before.ctimeNs, before.atimeNs);
  assert.notEqual(before.ctimeNs, before.mtimeNs);
  await slotScript([
    { code: 35, args: [s.out], answer: String(before.ctimeNs) },
    { code: 35, args: [s.out], body: Buffer.from([255, 0]), answer: String(before.ctimeNs) },
  ]);
  assert.deepEqual(metadata(await stat(s.out, { bigint: true })), metadata(before));
  assert.deepEqual(await readFile(s.out), content);
});

test('file changed observes a native permission change through operation 31', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  await writeFile(s.out, 'kept', { mode: 0o600 });
  await fsPromises.utimes(s.out, 1, 2);
  const before = await stat(s.out, { bigint: true });
  await slotScript([{ code: 35, args: [s.out], answer: String(before.ctimeNs) }]);
  let after = before;
  let mode = 0o644;
  const until = performance.now() + 2500;
  while (after.ctimeNs === before.ctimeNs) {
    assert.ok(performance.now() < until, 'chmod did not change the native status timestamp');
    await slotScript([{ code: 31, args: [s.out, String(mode)], answer: '' }]);
    after = await stat(s.out, { bigint: true });
    assert.equal(after.mode & 0o777n, BigInt(mode));
    mode = mode === 0o644 ? 0o600 : 0o644;
    if (after.ctimeNs === before.ctimeNs) await delay(20);
  }
  await slotScript([{ code: 35, args: [s.out], answer: String(after.ctimeNs) }]);
  assert.deepEqual([after.atimeNs, after.mtimeNs, after.ino, after.size],
    [before.atimeNs, before.mtimeNs, before.ino, before.size]);
  assert.equal(await readFile(s.out, 'utf8'), 'kept');
});

test('file changed supports private special files and directories and follows final symlinks and hard links', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const hard = join(s.path, 'hard');
  const live = join(s.path, 'live');
  const directoryLink = join(s.path, 'directory-link');
  await writeFile(s.out, 'kept');
  await fsPromises.link(s.out, hard);
  await symlink('stdout', live);
  await symlink('.', directoryLink);
  const special = privateFifo(join(s.path, 'fifo'));
  assert.ok((await stat(special)).isFIFO());
  const expected = (await stat(s.out, { bigint: true })).ctimeNs;
  assert.equal((await stat(hard, { bigint: true })).ctimeNs, expected);
  const requests = [s.out, hard, live].map(path => ({ code: 35, args: [path], answer: String(expected) }));
  for (const path of [s.path + '/', directoryLink, special]) requests.push({ code: 35, args: [path],
    answer: String((await stat(path, { bigint: true })).ctimeNs) });
  await slotScript(requests);
  assert.equal(await readlink(live), 'stdout');
  assert.equal(await readFile(hard, 'utf8'), 'kept');
});

test('file changed preserves relative Unicode paths and native parent symlink resolution', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const real = join(s.path, 'real');
  const alias = join(s.path, 'alias');
  await mkdir(join(real, 'nested'), { recursive: true });
  await symlink(join(real, 'nested'), alias);
  const actual = join(real, 'data');
  const decoy = join(s.path, 'data');
  const unicode = join(s.path, 'héllo space');
  for (const path of [actual, decoy, unicode]) await writeFile(path, 'kept');
  await slotScript([
    { code: 35, args: [relative(process.cwd(), unicode)],
      answer: String((await stat(unicode, { bigint: true })).ctimeNs) },
    { code: 35, args: [alias + '//../data'],
      answer: String((await stat(actual, { bigint: true })).ctimeNs) },
    { code: 35, args: [decoy], answer: String((await stat(decoy, { bigint: true })).ctimeNs) },
  ]);
});

test('file changed reports native path errors and continues without creating entries', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const missing = join(s.path, 'missing');
  const dangling = join(s.path, 'dangling');
  const loop = join(s.path, 'loop');
  await writeFile(s.out, 'kept');
  await symlink('missing', dangling);
  await symlink('loop', loop);
  const requests = [[missing, /^ENOENT:/], [join(missing, 'child'), /^ENOENT:/],
    [dangling, /^ENOENT:/], [join(s.out, 'child'), /^ENOTDIR:/],
    [s.out + '/', /^ENOTDIR:/], [loop, /^ELOOP:/], ['', /^ENOENT:/]];
  await slotScript([
    ...requests.map(([path, answer]) => ({ code: 35, args: [path], status: 1, answer })),
    { code: 35, args: [s.out], answer: String((await stat(s.out, { bigint: true })).ctimeNs) },
  ]);
  await absent(missing);
  assert.equal(await readlink(dangling), 'missing');
  assert.equal(await readlink(loop), 'loop');
});

test('file changed rejects argument counts and undecodable paths before stat', async t => {
  const inspect = t.mock.method(fsPromises, 'stat', async () => ({ ctimeNs: 0n }));
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([[], ['path', 'surplus']].map(args => ({ code: 35, args,
    status: 1, answer: `IO: OS request 35 expects 1 argument, got ${args.length}` })));
  for (const [bytes, message] of [[Buffer.from('x\0y'), 'NUL in OS string argument'],
    [Buffer.from([255]), 'non-UTF-8 bytes in OS string argument']]) {
    await assert.rejects(slotScript([{ code: 35, args: [bytes], answer: '' }]), { message });
  }
  assert.equal(inspect.mock.callCount(), 0);
});

test('file changed preserves exact signed nanoseconds and literal paths without opening contents', async t => {
  const values = [0n, 1n, 999999n, 1000001n, 9007199254740993n, 1700000000123456789n,
    -1n, -1700000000123456789n, -(2n ** 63n), 2n ** 63n - 1n];
  const pending = [...values];
  const inspect = t.mock.method(fsPromises, 'stat', async () => {
    const ctimeNs = pending.shift();
    return { ctimeNs, ctimeMs: Number(ctimeNs) / 1000000,
      atimeNs: 11n, mtimeNs: 22n, birthtimeNs: 33n };
  });
  const originalRead = fsPromises.readFile;
  const read = t.mock.method(fsPromises, 'readFile', async (path, ...args) => {
    assert.equal(path.href, new URL('../runtime/reactor.mjs', import.meta.url).href);
    return originalRead(path, ...args);
  });
  const opened = t.mock.method(fsPromises, 'open', () => assert.fail('timestamp inspection opened contents'));
  syncBuiltinESMExports();
  t.after(() => {
    for (const mock of [inspect, read, opened]) mock.mock.restore();
    syncBuiltinESMExports();
  });
  const path = '../héllo//alias/../file';
  await slotScript(values.map(value => ({ code: 35, args: [path],
    body: Buffer.alloc(65537, 255), answer: String(value) })));
  assert.equal(inspect.mock.callCount(), values.length);
  for (const call of inspect.mock.calls) assert.deepEqual(call.arguments, [path, { bigint: true }]);
  assert.equal(read.mock.callCount(), 1);
  assert.equal(opened.mock.callCount(), 0);
});

test('file changed forwards host errors and resumes subsequent requests', async t => {
  const failures = ['EACCES', 'EIO', 'EOVERFLOW'].map(code => Object.assign(new Error('injected failure'), { code }));
  failures.push(new Error('injected failure'));
  const requests = failures.map(error => ({ code: 35, args: ['path'], status: 1,
    answer: `${error.code ?? 'IO'}: injected failure` }));
  const inspect = t.mock.method(fsPromises, 'stat', async () => {
    if (failures.length) throw failures.shift();
    return { ctimeNs: -1n };
  });
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([...requests, { code: 35, args: ['path'], answer: '-1' }]);
  assert.equal(inspect.mock.callCount(), 5);
});

test('file created returns native birth nanoseconds without changing contents or metadata', async t => {
  const s = await sandbox(t);
  const content = Buffer.from([0, 255, 65, 254, 10]);
  await writeFile(s.out, content);
  await fsPromises.utimes(s.out, 1, 2);
  const metadata = info => [info.dev, info.ino, info.mode, info.nlink, info.size,
    info.atimeNs, info.mtimeNs, info.ctimeNs, info.birthtimeNs];
  const before = await stat(s.out, { bigint: true });
  await slotScript([
    { code: 36, args: [s.out], answer: String(before.birthtimeNs) },
    { code: 36, args: [s.out], body: Buffer.from([255, 0]), answer: String(before.birthtimeNs) },
  ]);
  assert.deepEqual(metadata(await stat(s.out, { bigint: true })), metadata(before));
  assert.deepEqual(await readFile(s.out), content);
});

test('file created reads current host metadata after append and permission changes', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  await writeFile(s.out, 'kept', { mode: 0o600 });
  const before = await stat(s.out, { bigint: true });
  await slotScript([
    { code: 36, args: [s.out], answer: String(before.birthtimeNs) },
    { code: 29, args: [s.out], body: Buffer.from(' appended'), answer: '' },
    { code: 31, args: [s.out, '420'], answer: '' },
  ]);
  // Some hosts substitute ctime or revise birthtime. Compare with fresh metadata.
  const after = await stat(s.out, { bigint: true });
  await slotScript([{ code: 36, args: [s.out], answer: String(after.birthtimeNs) }]);
  assert.equal(after.ino, before.ino);
  assert.equal(after.mode & 0o777n, 0o644n);
  assert.equal(await readFile(s.out, 'utf8'), 'kept appended');
});

test('file created supports private special files and directories and follows final symlinks and hard links', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const hard = join(s.path, 'hard');
  const live = join(s.path, 'live');
  const directoryLink = join(s.path, 'directory-link');
  await writeFile(s.out, 'kept');
  await fsPromises.link(s.out, hard);
  await symlink('stdout', live);
  await symlink('.', directoryLink);
  const special = privateFifo(join(s.path, 'fifo'));
  assert.ok((await stat(special)).isFIFO());
  const expected = (await stat(s.out, { bigint: true })).birthtimeNs;
  assert.equal((await stat(hard, { bigint: true })).birthtimeNs, expected);
  const requests = [s.out, hard, live].map(path => ({ code: 36, args: [path], answer: String(expected) }));
  for (const path of [s.path + '/', directoryLink, special]) requests.push({ code: 36, args: [path],
    answer: String((await stat(path, { bigint: true })).birthtimeNs) });
  await slotScript(requests);
  assert.equal(await readlink(live), 'stdout');
  assert.equal(await readFile(hard, 'utf8'), 'kept');
});

test('file created preserves relative Unicode paths and native parent symlink resolution', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const real = join(s.path, 'real');
  const alias = join(s.path, 'alias');
  await mkdir(join(real, 'nested'), { recursive: true });
  await symlink(join(real, 'nested'), alias);
  const actual = join(real, 'data');
  const decoy = join(s.path, 'data');
  const unicode = join(s.path, 'héllo space');
  for (const path of [actual, decoy, unicode]) await writeFile(path, 'kept');
  await slotScript([
    { code: 36, args: [relative(process.cwd(), unicode)],
      answer: String((await stat(unicode, { bigint: true })).birthtimeNs) },
    { code: 36, args: [alias + '//../data'],
      answer: String((await stat(actual, { bigint: true })).birthtimeNs) },
    { code: 36, args: [decoy], answer: String((await stat(decoy, { bigint: true })).birthtimeNs) },
  ]);
});

test('file created reports native path errors and continues without creating entries', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const missing = join(s.path, 'missing');
  const dangling = join(s.path, 'dangling');
  const loop = join(s.path, 'loop');
  await writeFile(s.out, 'kept');
  await symlink('missing', dangling);
  await symlink('loop', loop);
  const requests = [[missing, /^ENOENT:/], [join(missing, 'child'), /^ENOENT:/],
    [dangling, /^ENOENT:/], [join(s.out, 'child'), /^ENOTDIR:/],
    [s.out + '/', /^ENOTDIR:/], [loop, /^ELOOP:/], ['', /^ENOENT:/]];
  await slotScript([
    ...requests.map(([path, answer]) => ({ code: 36, args: [path], status: 1, answer })),
    { code: 36, args: [s.out], answer: String((await stat(s.out, { bigint: true })).birthtimeNs) },
  ]);
  await absent(missing);
  assert.equal(await readlink(dangling), 'missing');
  assert.equal(await readlink(loop), 'loop');
});

test('file created rejects argument counts and undecodable paths before stat', async t => {
  const inspect = t.mock.method(fsPromises, 'stat', async () => ({ birthtimeNs: 0n }));
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([[], ['path', 'surplus']].map(args => ({ code: 36, args,
    status: 1, answer: `IO: OS request 36 expects 1 argument, got ${args.length}` })));
  for (const [bytes, message] of [[Buffer.from('x\0y'), 'NUL in OS string argument'],
    [Buffer.from([255]), 'non-UTF-8 bytes in OS string argument']]) {
    await assert.rejects(slotScript([{ code: 36, args: [bytes], answer: '' }]), { message });
  }
  assert.equal(inspect.mock.callCount(), 0);
});

test('file created preserves exact signed nanoseconds and literal paths without opening contents', async t => {
  const values = [0n, 1n, 999999n, 1000001n, 9007199254740993n, 1700000000123456789n,
    -1n, -1700000000123456789n, -(2n ** 63n), 2n ** 63n - 1n, 33n, 0n];
  const pending = [...values];
  const inspect = t.mock.method(fsPromises, 'stat', async () => {
    const birthtimeNs = pending.shift();
    return { birthtimeNs, birthtimeMs: Number(birthtimeNs) / 1000000,
      atimeNs: 11n, mtimeNs: 22n, ctimeNs: 33n };
  });
  const originalRead = fsPromises.readFile;
  const read = t.mock.method(fsPromises, 'readFile', async (path, ...args) => {
    assert.equal(path.href, new URL('../runtime/reactor.mjs', import.meta.url).href);
    return originalRead(path, ...args);
  });
  const opened = t.mock.method(fsPromises, 'open', () => assert.fail('timestamp inspection opened contents'));
  syncBuiltinESMExports();
  t.after(() => {
    for (const mock of [inspect, read, opened]) mock.mock.restore();
    syncBuiltinESMExports();
  });
  const path = '../héllo//alias/../file';
  await slotScript(values.map(value => ({ code: 36, args: [path],
    body: Buffer.alloc(65537, 255), answer: String(value) })));
  assert.equal(inspect.mock.callCount(), values.length);
  for (const call of inspect.mock.calls) assert.deepEqual(call.arguments, [path, { bigint: true }]);
  assert.equal(read.mock.callCount(), 1);
  assert.equal(opened.mock.callCount(), 0);
});

test('file created forwards host errors and resumes subsequent requests', async t => {
  const failures = ['EACCES', 'EIO', 'EOVERFLOW'].map(code => Object.assign(new Error('injected failure'), { code }));
  failures.push(new Error('injected failure'));
  const requests = failures.map(error => ({ code: 36, args: ['path'], status: 1,
    answer: `${error.code ?? 'IO'}: injected failure` }));
  const inspect = t.mock.method(fsPromises, 'stat', async () => {
    if (failures.length) throw failures.shift();
    return { birthtimeNs: -1n };
  });
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([...requests, { code: 36, args: ['path'], answer: '-1' }]);
  assert.equal(inspect.mock.callCount(), 5);
});

test('file identity returns the native device and inode without changing contents or metadata', async t => {
  const s = await sandbox(t);
  const content = Buffer.from([0, 255, 65, 254, 10]);
  await writeFile(s.out, content);
  await fsPromises.utimes(s.out, 1, 2);
  const metadata = info => [info.dev, info.ino, info.mode, info.nlink, info.size,
    info.atimeNs, info.mtimeNs, info.ctimeNs, info.birthtimeNs];
  const before = await stat(s.out, { bigint: true });
  await slotScript([
    { code: 37, args: [s.out], answer: `${before.dev}:${before.ino}` },
    { code: 37, args: [s.out], body: Buffer.from([255, 0]), answer: `${before.dev}:${before.ino}` },
  ]);
  assert.deepEqual(metadata(await stat(s.out, { bigint: true })), metadata(before));
  assert.deepEqual(await readFile(s.out), content);
});

test('file identity recognizes hard links through append, rename, replacement and unlink', async t => {
  const s = await sandbox(t);
  const hard = join(s.path, 'hard');
  const moved = join(s.path, 'moved');
  await writeFile(s.out, 'original');
  const before = await stat(s.out, { bigint: true });
  const identity = `${before.dev}:${before.ino}`;
  await slotScript([
    { code: 26, args: [s.out, hard], answer: '' },
    { code: 37, args: [hard], answer: identity },
    { code: 29, args: [s.out], body: Buffer.from(' appended'), answer: '' },
    { code: 37, args: [s.out], answer: identity },
    { code: 21, args: [s.out, moved], answer: '' },
    { code: 37, args: [moved], answer: identity },
    { code: 3, args: [moved], body: Buffer.from('replacement'), answer: '' },
    { code: 37, args: [hard], answer: identity },
  ]);
  const after = await stat(moved, { bigint: true });
  const replacement = `${after.dev}:${after.ino}`;
  // The hard link keeps the original inode alive throughout replacement.
  assert.notEqual(replacement, identity);
  await slotScript([
    { code: 37, args: [moved], answer: replacement },
    { code: 19, args: [hard], answer: '' },
    { code: 37, args: [hard], status: 1, answer: /^ENOENT:/ },
    { code: 37, args: [moved], answer: replacement },
  ]);
  assert.equal(await readFile(moved, 'utf8'), 'replacement');
  await absent(s.out);
});

test('file identity accepts directories and special files and follows final symlinks', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const live = join(s.path, 'live');
  const directoryLink = join(s.path, 'directory-link');
  await writeFile(s.out, 'kept');
  await symlink('stdout', live);
  await symlink('.', directoryLink);
  const special = privateFifo(join(s.path, 'fifo'));
  assert.ok((await stat(special)).isFIFO());
  const before = await stat(s.out, { bigint: true });
  const requests = [s.out, live].map(path => ({ code: 37, args: [path], answer: `${before.dev}:${before.ino}` }));
  for (const path of [s.path + '/', directoryLink, special]) {
    const info = await stat(path, { bigint: true });
    requests.push({ code: 37, args: [path], answer: `${info.dev}:${info.ino}` });
  }
  await slotScript(requests);
  assert.equal(await readlink(live), 'stdout');
  assert.equal(await readFile(s.out, 'utf8'), 'kept');
});

test('file identity preserves relative Unicode paths and native parent symlink resolution', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const real = join(s.path, 'real');
  const alias = join(s.path, 'alias');
  await mkdir(join(real, 'nested'), { recursive: true });
  await symlink(join(real, 'nested'), alias);
  const actual = join(real, 'data');
  const decoy = join(s.path, 'data');
  const unicode = join(s.path, 'héllo space');
  for (const path of [actual, decoy, unicode]) await writeFile(path, 'kept');
  const requests = [];
  for (const [path, native] of [[relative(process.cwd(), unicode), unicode],
    [alias + '//../data', actual], [decoy, decoy]]) {
    const info = await stat(native, { bigint: true });
    requests.push({ code: 37, args: [path], answer: `${info.dev}:${info.ino}` });
  }
  assert.notEqual(requests[1].answer, requests[2].answer);
  await slotScript(requests);
});

test('file identity reports native path errors and continues without creating entries', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const missing = join(s.path, 'missing');
  const dangling = join(s.path, 'dangling');
  const loop = join(s.path, 'loop');
  await writeFile(s.out, 'kept');
  await symlink('missing', dangling);
  await symlink('loop', loop);
  const info = await stat(s.out, { bigint: true });
  const requests = [[missing, /^ENOENT:/], [join(missing, 'child'), /^ENOENT:/],
    [dangling, /^ENOENT:/], [join(s.out, 'child'), /^ENOTDIR:/],
    [s.out + '/', /^ENOTDIR:/], [loop, /^ELOOP:/], ['', /^ENOENT:/]];
  await slotScript([
    ...requests.map(([path, answer]) => ({ code: 37, args: [path], status: 1, answer })),
    { code: 37, args: [s.out], answer: `${info.dev}:${info.ino}` },
  ]);
  await absent(missing);
  assert.equal(await readlink(dangling), 'missing');
  assert.equal(await readlink(loop), 'loop');
});

test('file identity rejects argument counts and undecodable paths before stat', async t => {
  const inspect = t.mock.method(fsPromises, 'stat', async () => ({ dev: 0n, ino: 0n }));
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([[], ['path', 'surplus']].map(args => ({ code: 37, args,
    status: 1, answer: `IO: OS request 37 expects 1 argument, got ${args.length}` })));
  for (const [bytes, message] of [[Buffer.from('x\0y'), 'NUL in OS string argument'],
    [Buffer.from([255]), 'non-UTF-8 bytes in OS string argument']]) {
    await assert.rejects(slotScript([{ code: 37, args: [bytes], answer: '' }]), { message });
  }
  assert.equal(inspect.mock.callCount(), 0);
});

test('file identity preserves exact integer pairs from one fresh stat without opening contents', async t => {
  const values = [
    [0n, 0n, '0:0'], [1n, 2n, '1:2'], [12n, 3n, '12:3'], [1n, 23n, '1:23'],
    [9007199254740993n, 9007199254740995n, '9007199254740993:9007199254740995'],
    [2n ** 64n - 1n, 2n ** 63n, '18446744073709551615:9223372036854775808'],
    [0n, 7n, '0:7'], [7n, 0n, '7:0'], [0n, 0n, '0:0'],
  ];
  const pending = [...values];
  const inspect = t.mock.method(fsPromises, 'stat', async () => {
    assert.ok(pending.length, 'identity performed extra stat calls');
    const [dev, ino] = pending.shift();
    return { dev, ino, rdev: 91n, nlink: 92n, size: 93n, mode: 94n };
  });
  const originalRead = fsPromises.readFile;
  const read = t.mock.method(fsPromises, 'readFile', async (path, ...args) => {
    assert.equal(path.href, new URL('../runtime/reactor.mjs', import.meta.url).href);
    return originalRead(path, ...args);
  });
  const opened = t.mock.method(fsPromises, 'open', () => assert.fail('identity inspection opened contents'));
  syncBuiltinESMExports();
  t.after(() => {
    for (const mock of [inspect, read, opened]) mock.mock.restore();
    syncBuiltinESMExports();
  });
  const path = '../héllo//alias/../file';
  await slotScript(values.map(([, , answer]) => ({ code: 37, args: [path],
    body: Buffer.alloc(65537, 255), answer })));
  assert.equal(pending.length, 0);
  assert.equal(inspect.mock.callCount(), values.length);
  for (const call of inspect.mock.calls) assert.deepEqual(call.arguments, [path, { bigint: true }]);
  assert.equal(read.mock.callCount(), 1);
  assert.equal(opened.mock.callCount(), 0);
});

test('file identity forwards host errors and resumes subsequent requests', async t => {
  const failures = ['EACCES', 'EIO', 'EOVERFLOW'].map(code => Object.assign(new Error('injected failure'), { code }));
  failures.push(new Error('injected failure'));
  const requests = failures.map(error => ({ code: 37, args: ['path'], status: 1,
    answer: `${error.code ?? 'IO'}: injected failure` }));
  const inspect = t.mock.method(fsPromises, 'stat', async () => {
    if (failures.length) throw failures.shift();
    return { dev: 0n, ino: 7n };
  });
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([...requests, { code: 37, args: ['path'], answer: '0:7' }]);
  assert.equal(inspect.mock.callCount(), 5);
});

const filesystemTypePattern = /^(?:0|-?[1-9]\d*)$/;
const traceFilesystemType = t => {
  const native = fsPromises.statfs;
  const snapshots = [];
  const inspect = t.mock.method(fsPromises, 'statfs', async (...args) => {
    const info = await native(...args);
    snapshots.push(info.type);
    return info;
  });
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
  return { inspect, snapshots };
};

test('filesystem type returns the native identifier without changing contents or metadata', async t => {
  const s = await sandbox(t);
  const content = Buffer.from([0, 255, 65, 254, 10]);
  await writeFile(s.out, content);
  await fsPromises.utimes(s.out, 1, 2);
  const before = await stat(s.out, { bigint: true });
  const { inspect, snapshots } = traceFilesystemType(t);
  const answers = await slotScript([
    { code: 43, args: [s.out], answer: filesystemTypePattern },
    { code: 43, args: [s.out], body: Buffer.alloc(65537, 255), answer: filesystemTypePattern },
  ]);
  assert.deepEqual(answers.map(BigInt), snapshots);
  assert.equal(inspect.mock.callCount(), 2);
  for (const call of inspect.mock.calls) assert.deepEqual(call.arguments, [s.out, { bigint: true }]);
  assert.deepEqual(await stat(s.out, { bigint: true }), before);
  assert.deepEqual(await readFile(s.out), content);
});

test('filesystem type accepts directories, links and special files without opening contents',
  { skip: process.platform === 'win32', timeout: 5000 }, async t => {
  const s = await sandbox(t);
  const live = join(s.path, 'live');
  const hard = join(s.path, 'hard');
  const directoryLink = join(s.path, 'directory-link');
  await writeFile(s.out, 'kept');
  await symlink('stdout', live);
  await fsPromises.link(s.out, hard);
  await symlink('.', directoryLink);
  const special = privateFifo(join(s.path, 'fifo'));
  const { snapshots } = traceFilesystemType(t);
  const guards = ['open', 'stat', 'lstat'].map(name =>
    t.mock.method(fsPromises, name, () => assert.fail(`filesystem type inspection called ${name}`)));
  const nativeRead = fsPromises.readFile;
  const read = t.mock.method(fsPromises, 'readFile', async (path, ...args) => {
    assert.equal(path.href, new URL('../runtime/reactor.mjs', import.meta.url).href);
    return nativeRead(path, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    for (const mock of [...guards, read]) mock.mock.restore();
    syncBuiltinESMExports();
  });
  const paths = [s.out, live, hard, s.path + '/', directoryLink, special];
  const answers = await slotScript(paths.map(path => ({ code: 43, args: [path], answer: filesystemTypePattern })));
  assert.equal(snapshots.length, paths.length);
  assert.deepEqual(answers.map(BigInt), snapshots);
  for (const guard of guards) assert.equal(guard.mock.callCount(), 0);
  assert.equal(read.mock.callCount(), 1);
  assert.equal(await readlink(live), 'stdout');
});

test('filesystem type preserves relative Unicode paths and native parent symlink resolution',
  { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const real = join(s.path, 'real');
  const alias = join(s.path, 'alias');
  await mkdir(join(real, 'nested'), { recursive: true });
  await symlink(join(real, 'nested'), alias);
  const unicode = join(s.path, 'héllo space');
  await writeFile(join(real, 'data'), 'kept');
  await writeFile(unicode, 'kept');
  await absent(join(s.path, 'data'));
  const { inspect, snapshots } = traceFilesystemType(t);
  const paths = [relative(process.cwd(), unicode), alias + '//../data'];
  const answers = await slotScript(paths.map(path => ({ code: 43, args: [path], answer: filesystemTypePattern })));
  assert.deepEqual(answers.map(BigInt), snapshots);
  assert.deepEqual(inspect.mock.calls.map(call => call.arguments), paths.map(path => [path, { bigint: true }]));
  await absent(join(s.path, 'data'));
});

test('filesystem type reports native path errors and recovers without creating entries',
  { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const missing = join(s.path, 'missing');
  const dangling = join(s.path, 'dangling');
  const loop = join(s.path, 'loop');
  await writeFile(s.out, 'kept');
  await symlink('missing', dangling);
  await symlink('loop', loop);
  const { snapshots } = traceFilesystemType(t);
  const failures = [[missing, /^ENOENT:/], [join(missing, 'child'), /^ENOENT:/],
    [dangling, /^ENOENT:/], [join(s.out, 'child'), /^ENOTDIR:/],
    [s.out + '/', /^ENOTDIR:/], [loop, /^ELOOP:/], ['', /^ENOENT:/]];
  const answers = await slotScript(failures.flatMap(([path, answer]) => [
    { code: 43, args: [path], status: 1, answer },
    { code: 43, args: [s.out], answer: filesystemTypePattern },
  ]));
  assert.deepEqual(answers.filter((_, index) => index % 2 === 1).map(BigInt), snapshots);
  await absent(missing);
  assert.equal(await readlink(dangling), 'missing');
  assert.equal(await readlink(loop), 'loop');
  assert.equal(await readFile(s.out, 'utf8'), 'kept');
});

test('filesystem type rejects argument counts and undecodable paths before statfs', async t => {
  const inspect = t.mock.method(fsPromises, 'statfs', async () => ({ type: 0n }));
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([[], ['path', 'surplus']].map(args => ({ code: 43, args,
    status: 1, answer: `IO: OS request 43 expects 1 argument, got ${args.length}` })));
  for (const [bytes, message] of [[Buffer.from('x\0y'), 'NUL in OS string argument'],
    [Buffer.from([255]), 'non-UTF-8 bytes in OS string argument']]) {
    await assert.rejects(slotScript([{ code: 43, args: [bytes], answer: '' }]), { message });
  }
  assert.equal(inspect.mock.callCount(), 0);
});

test('filesystem type preserves exact identifiers from one fresh bigint statfs per request', async t => {
  const values = [[0n, '0'], [16914836n, '16914836'],
    [9007199254740993n, '9007199254740993'], [2n ** 64n - 1n, '18446744073709551615'],
    [-(2n ** 63n), '-9223372036854775808'], [-9007199254740993n, '-9007199254740993'],
    [-1n, '-1'], [0n, '0']];
  const pending = [...values];
  const inspect = t.mock.method(fsPromises, 'statfs', async () => {
    assert.ok(pending.length, 'filesystem type inspection performed extra statfs calls');
    const [type] = pending.shift();
    return { type, bsize: 81n, blocks: 82n, bfree: 83n, bavail: 84n, files: 85n, ffree: 86n };
  });
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
  const path = '../héllo//alias/../file';
  await slotScript(values.map(([, answer]) => ({ code: 43, args: [path],
    body: Buffer.from([255, 0]), answer })));
  assert.equal(pending.length, 0);
  assert.equal(inspect.mock.callCount(), values.length);
  for (const call of inspect.mock.calls) assert.deepEqual(call.arguments, [path, { bigint: true }]);
});

test('filesystem type forwards unsupported and other host errors and resumes requests', async t => {
  const failures = ['EACCES', 'EIO', 'EOVERFLOW', 'ENOSYS', 'ENOTSUP']
    .map(code => Object.assign(new Error('injected failure'), { code }));
  failures.push(new Error('injected failure'));
  const requests = failures.map(error => ({ code: 43, args: ['path'], status: 1,
    answer: `${error.code ?? 'IO'}: injected failure` }));
  const inspect = t.mock.method(fsPromises, 'statfs', async () => {
    if (failures.length) throw failures.shift();
    return { type: 16914836n };
  });
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([...requests, { code: 43, args: ['path'], answer: '16914836' }]);
  assert.equal(inspect.mock.callCount(), 7);
});

const inodePattern = /^(?:0|-?[1-9]\d*):(?:0|-?[1-9]\d*)$/;
// Observe the request's own native snapshot, since inode counts can change.
const traceInodes = t => {
  const native = fsPromises.statfs;
  const snapshots = [];
  const inspect = t.mock.method(fsPromises, 'statfs', async (...args) => {
    const info = await native(...args);
    snapshots.push([info.files, info.ffree]);
    return info;
  });
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
  return { inspect, snapshots };
};

test('filesystem inodes returns native snapshots without changing contents or metadata', async t => {
  const s = await sandbox(t);
  const content = Buffer.from([0, 255, 65, 254, 10]);
  await writeFile(s.out, content);
  await fsPromises.utimes(s.out, 1, 2);
  const before = await stat(s.out, { bigint: true });
  const { inspect, snapshots } = traceInodes(t);
  const answers = await slotScript([
    { code: 42, args: [s.out], answer: inodePattern },
    { code: 42, args: [s.out], body: Buffer.alloc(65537, 255), answer: inodePattern },
  ]);
  assert.deepEqual(answers.map(answer => answer.split(':').map(BigInt)), snapshots);
  assert.equal(inspect.mock.callCount(), 2);
  for (const call of inspect.mock.calls) assert.deepEqual(call.arguments, [s.out, { bigint: true }]);
  assert.deepEqual(await stat(s.out, { bigint: true }), before);
  assert.deepEqual(await readFile(s.out), content);
});

test('filesystem inodes accepts directories, links and special files without opening contents',
  { skip: process.platform === 'win32', timeout: 5000 }, async t => {
  const s = await sandbox(t);
  const live = join(s.path, 'live');
  const hard = join(s.path, 'hard');
  const directoryLink = join(s.path, 'directory-link');
  await writeFile(s.out, 'kept');
  await symlink('stdout', live);
  await fsPromises.link(s.out, hard);
  await symlink('.', directoryLink);
  const special = privateFifo(join(s.path, 'fifo'));
  const { snapshots } = traceInodes(t);
  const guards = ['open', 'stat', 'lstat'].map(name =>
    t.mock.method(fsPromises, name, () => assert.fail(`inode inspection called ${name}`)));
  const nativeRead = fsPromises.readFile;
  const read = t.mock.method(fsPromises, 'readFile', async (path, ...args) => {
    assert.equal(path.href, new URL('../runtime/reactor.mjs', import.meta.url).href);
    return nativeRead(path, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    for (const mock of [...guards, read]) mock.mock.restore();
    syncBuiltinESMExports();
  });
  const paths = [s.out, live, hard, s.path + '/', directoryLink, special];
  const answers = await slotScript(paths.map(path => ({ code: 42, args: [path], answer: inodePattern })));
  assert.equal(snapshots.length, paths.length);
  assert.deepEqual(answers.map(answer => answer.split(':').map(BigInt)), snapshots);
  for (const guard of guards) assert.equal(guard.mock.callCount(), 0);
  assert.equal(read.mock.callCount(), 1);
  assert.equal(await readlink(live), 'stdout');
});

test('filesystem inodes preserves relative Unicode paths and native parent symlink resolution',
  { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const real = join(s.path, 'real');
  const alias = join(s.path, 'alias');
  await mkdir(join(real, 'nested'), { recursive: true });
  await symlink(join(real, 'nested'), alias);
  const unicode = join(s.path, 'héllo space');
  await writeFile(join(real, 'data'), 'kept');
  await writeFile(unicode, 'kept');
  await absent(join(s.path, 'data'));
  const { inspect, snapshots } = traceInodes(t);
  const paths = [relative(process.cwd(), unicode), alias + '//../data'];
  const answers = await slotScript(paths.map(path => ({ code: 42, args: [path], answer: inodePattern })));
  assert.deepEqual(answers.map(answer => answer.split(':').map(BigInt)), snapshots);
  assert.deepEqual(inspect.mock.calls.map(call => call.arguments), paths.map(path => [path, { bigint: true }]));
  await absent(join(s.path, 'data'));
});

test('filesystem inodes reports native path errors and recovers without creating entries',
  { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const missing = join(s.path, 'missing');
  const dangling = join(s.path, 'dangling');
  const loop = join(s.path, 'loop');
  await writeFile(s.out, 'kept');
  await symlink('missing', dangling);
  await symlink('loop', loop);
  const { snapshots } = traceInodes(t);
  const failures = [[missing, /^ENOENT:/], [join(missing, 'child'), /^ENOENT:/],
    [dangling, /^ENOENT:/], [join(s.out, 'child'), /^ENOTDIR:/],
    [s.out + '/', /^ENOTDIR:/], [loop, /^ELOOP:/], ['', /^ENOENT:/]];
  const answers = await slotScript(failures.flatMap(([path, answer]) => [
    { code: 42, args: [path], status: 1, answer },
    { code: 42, args: [s.out], answer: inodePattern },
  ]));
  assert.deepEqual(answers.filter((_, index) => index % 2 === 1)
    .map(answer => answer.split(':').map(BigInt)), snapshots);
  await absent(missing);
  assert.equal(await readlink(dangling), 'missing');
  assert.equal(await readlink(loop), 'loop');
  assert.equal(await readFile(s.out, 'utf8'), 'kept');
});

test('filesystem inodes rejects argument counts and undecodable paths before statfs', async t => {
  const inspect = t.mock.method(fsPromises, 'statfs', async () => ({ files: 0n, ffree: 0n }));
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([[], ['path', 'surplus']].map(args => ({ code: 42, args,
    status: 1, answer: `IO: OS request 42 expects 1 argument, got ${args.length}` })));
  for (const [bytes, message] of [[Buffer.from('x\0y'), 'NUL in OS string argument'],
    [Buffer.from([255]), 'non-UTF-8 bytes in OS string argument']]) {
    await assert.rejects(slotScript([{ code: 42, args: [bytes], answer: '' }]), { message });
  }
  assert.equal(inspect.mock.callCount(), 0);
});

test('filesystem inodes preserves exact fields from one fresh bigint statfs per request', async t => {
  const values = [
    [0n, 0n, '0:0'], [11n, 7n, '11:7'], [11n, 0n, '11:0'], [0n, 7n, '0:7'],
    [9007199254740993n, 9007199254740995n, '9007199254740993:9007199254740995'],
    [2n ** 64n - 1n, 2n ** 63n, '18446744073709551615:9223372036854775808'],
    [-1n, -9007199254740993n, '-1:-9007199254740993'], [0n, 0n, '0:0'],
  ];
  const pending = [...values];
  const inspect = t.mock.method(fsPromises, 'statfs', async () => {
    assert.ok(pending.length, 'inode inspection performed extra statfs calls');
    const [files, ffree] = pending.shift();
    return { files, ffree, type: 81n, bsize: 82n, blocks: 83n, bfree: 84n, bavail: 85n };
  });
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
  const path = '../héllo//alias/../file';
  await slotScript(values.map(([, , answer]) => ({ code: 42, args: [path],
    body: Buffer.from([255, 0]), answer })));
  assert.equal(pending.length, 0);
  assert.equal(inspect.mock.callCount(), values.length);
  for (const call of inspect.mock.calls) assert.deepEqual(call.arguments, [path, { bigint: true }]);
});

test('filesystem inodes forwards unsupported and other host errors and resumes requests', async t => {
  const failures = ['EACCES', 'EIO', 'EOVERFLOW', 'ENOSYS', 'ENOTSUP']
    .map(code => Object.assign(new Error('injected failure'), { code }));
  failures.push(new Error('injected failure'));
  const requests = failures.map(error => ({ code: 42, args: ['path'], status: 1,
    answer: `${error.code ?? 'IO'}: injected failure` }));
  const inspect = t.mock.method(fsPromises, 'statfs', async () => {
    if (failures.length) throw failures.shift();
    return { files: 11n, ffree: 7n };
  });
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([...requests, { code: 42, args: ['path'], answer: '11:7' }]);
  assert.equal(inspect.mock.callCount(), 7);
});

const capacityPattern = /^(?:0|-?[1-9]\d*)(?::(?:0|-?[1-9]\d*)){3}$/;
// Observe the actual host call, since free space can change between snapshots.
const traceCapacity = t => {
  const native = fsPromises.statfs;
  const snapshots = [];
  const inspect = t.mock.method(fsPromises, 'statfs', async (...args) => {
    const info = await native(...args);
    snapshots.push([info.bsize, info.blocks, info.bfree, info.bavail]);
    return info;
  });
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
  return { inspect, snapshots };
};

test('filesystem capacity returns native snapshots without changing contents or metadata', async t => {
  const s = await sandbox(t);
  const content = Buffer.from([0, 255, 65, 254, 10]);
  await writeFile(s.out, content);
  await fsPromises.utimes(s.out, 1, 2);
  const before = await stat(s.out, { bigint: true });
  const { inspect, snapshots } = traceCapacity(t);
  const answers = await slotScript([
    { code: 41, args: [s.out], answer: capacityPattern },
    { code: 41, args: [s.out], body: Buffer.alloc(65537, 255), answer: capacityPattern },
  ]);
  assert.deepEqual(answers.map(answer => answer.split(':').map(BigInt)), snapshots);
  assert.equal(inspect.mock.callCount(), 2);
  for (const call of inspect.mock.calls) assert.deepEqual(call.arguments, [s.out, { bigint: true }]);
  assert.deepEqual(await stat(s.out, { bigint: true }), before);
  assert.deepEqual(await readFile(s.out), content);
});

test('filesystem capacity accepts directories, links and special files without opening contents',
  { skip: process.platform === 'win32', timeout: 5000 }, async t => {
  const s = await sandbox(t);
  const live = join(s.path, 'live');
  const hard = join(s.path, 'hard');
  const directoryLink = join(s.path, 'directory-link');
  await writeFile(s.out, 'kept');
  await symlink('stdout', live);
  await fsPromises.link(s.out, hard);
  await symlink('.', directoryLink);
  const special = privateFifo(join(s.path, 'fifo'));
  const { snapshots } = traceCapacity(t);
  const guards = ['open', 'stat', 'lstat'].map(name =>
    t.mock.method(fsPromises, name, () => assert.fail(`capacity inspection called ${name}`)));
  const nativeRead = fsPromises.readFile;
  const read = t.mock.method(fsPromises, 'readFile', async (path, ...args) => {
    assert.equal(path.href, new URL('../runtime/reactor.mjs', import.meta.url).href);
    return nativeRead(path, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    for (const mock of [...guards, read]) mock.mock.restore();
    syncBuiltinESMExports();
  });
  const paths = [s.out, live, hard, s.path + '/', directoryLink, special];
  const answers = await slotScript(paths.map(path => ({ code: 41, args: [path], answer: capacityPattern })));
  assert.equal(snapshots.length, paths.length);
  assert.deepEqual(answers.map(answer => answer.split(':').map(BigInt)), snapshots);
  for (const guard of guards) assert.equal(guard.mock.callCount(), 0);
  assert.equal(read.mock.callCount(), 1);
  assert.equal(await readlink(live), 'stdout');
});

test('filesystem capacity preserves relative Unicode paths and native parent symlink resolution',
  { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const real = join(s.path, 'real');
  const alias = join(s.path, 'alias');
  await mkdir(join(real, 'nested'), { recursive: true });
  await symlink(join(real, 'nested'), alias);
  const unicode = join(s.path, 'héllo space');
  await writeFile(join(real, 'data'), 'kept');
  await writeFile(unicode, 'kept');
  await absent(join(s.path, 'data'));
  const { inspect, snapshots } = traceCapacity(t);
  const paths = [relative(process.cwd(), unicode), alias + '//../data'];
  const answers = await slotScript(paths.map(path => ({ code: 41, args: [path], answer: capacityPattern })));
  assert.deepEqual(answers.map(answer => answer.split(':').map(BigInt)), snapshots);
  assert.deepEqual(inspect.mock.calls.map(call => call.arguments), paths.map(path => [path, { bigint: true }]));
  await absent(join(s.path, 'data'));
});

test('filesystem capacity reports native path errors and recovers without creating entries',
  { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const missing = join(s.path, 'missing');
  const dangling = join(s.path, 'dangling');
  const loop = join(s.path, 'loop');
  await writeFile(s.out, 'kept');
  await symlink('missing', dangling);
  await symlink('loop', loop);
  const { snapshots } = traceCapacity(t);
  const failures = [[missing, /^ENOENT:/], [join(missing, 'child'), /^ENOENT:/],
    [dangling, /^ENOENT:/], [join(s.out, 'child'), /^ENOTDIR:/],
    [s.out + '/', /^ENOTDIR:/], [loop, /^ELOOP:/], ['', /^ENOENT:/]];
  const answers = await slotScript(failures.flatMap(([path, answer]) => [
    { code: 41, args: [path], status: 1, answer },
    { code: 41, args: [s.out], answer: capacityPattern },
  ]));
  assert.deepEqual(answers.filter((_, index) => index % 2 === 1)
    .map(answer => answer.split(':').map(BigInt)), snapshots);
  await absent(missing);
  assert.equal(await readlink(dangling), 'missing');
  assert.equal(await readlink(loop), 'loop');
  assert.equal(await readFile(s.out, 'utf8'), 'kept');
});

test('filesystem capacity rejects argument counts and undecodable paths before statfs', async t => {
  const inspect = t.mock.method(fsPromises, 'statfs', async () => ({ bsize: 0n, blocks: 0n, bfree: 0n, bavail: 0n }));
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([[], ['path', 'surplus']].map(args => ({ code: 41, args,
    status: 1, answer: `IO: OS request 41 expects 1 argument, got ${args.length}` })));
  for (const [bytes, message] of [[Buffer.from('x\0y'), 'NUL in OS string argument'],
    [Buffer.from([255]), 'non-UTF-8 bytes in OS string argument']]) {
    await assert.rejects(slotScript([{ code: 41, args: [bytes], answer: '' }]), { message });
  }
  assert.equal(inspect.mock.callCount(), 0);
});

test('filesystem capacity preserves exact fields from one fresh bigint statfs per request', async t => {
  const values = [
    [0n, 0n, 0n, 0n, '0:0:0:0'], [1n, 2n, 3n, 4n, '1:2:3:4'],
    [4096n, 100n, 0n, 0n, '4096:100:0:0'], [4096n, 100n, 7n, 0n, '4096:100:7:0'],
    [9007199254740993n, 9007199254740995n, 9007199254740997n, 9007199254740999n,
      '9007199254740993:9007199254740995:9007199254740997:9007199254740999'],
    [2n ** 64n - 1n, 2n ** 63n, 2n ** 63n - 1n, 2n ** 64n - 3n,
      '18446744073709551615:9223372036854775808:9223372036854775807:18446744073709551613'],
    [4096n, 100n, -1n, -9007199254740993n, '4096:100:-1:-9007199254740993'],
    [0n, 0n, 0n, 0n, '0:0:0:0'],
  ];
  const pending = [...values];
  const inspect = t.mock.method(fsPromises, 'statfs', async () => {
    assert.ok(pending.length, 'capacity inspection performed extra statfs calls');
    const [bsize, blocks, bfree, bavail] = pending.shift();
    return { bsize, blocks, bfree, bavail, type: 81n, files: 82n, ffree: 83n, frsize: 84n };
  });
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
  const path = '../héllo//alias/../file';
  await slotScript(values.map(([, , , , answer]) => ({ code: 41, args: [path],
    body: Buffer.from([255, 0]), answer })));
  assert.equal(pending.length, 0);
  assert.equal(inspect.mock.callCount(), values.length);
  for (const call of inspect.mock.calls) assert.deepEqual(call.arguments, [path, { bigint: true }]);
});

test('filesystem capacity forwards unsupported and other host errors and resumes requests', async t => {
  const failures = ['EACCES', 'EIO', 'EOVERFLOW', 'ENOSYS', 'ENOTSUP']
    .map(code => Object.assign(new Error('injected failure'), { code }));
  failures.push(new Error('injected failure'));
  const requests = failures.map(error => ({ code: 41, args: ['path'], status: 1,
    answer: `${error.code ?? 'IO'}: injected failure` }));
  const inspect = t.mock.method(fsPromises, 'statfs', async () => {
    if (failures.length) throw failures.shift();
    return { bsize: 4096n, blocks: 100n, bfree: 7n, bavail: 3n };
  });
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([...requests, { code: 41, args: ['path'], answer: '4096:100:7:3' }]);
  assert.equal(inspect.mock.callCount(), 7);
});

test('file allocation returns native block fields without changing contents or metadata', async t => {
  const s = await sandbox(t);
  const content = Buffer.from([0, 255, 65, 254, 10]);
  await writeFile(s.out, content);
  await fsPromises.utimes(s.out, 1, 2);
  const metadata = info => [info.blocks, info.blksize, info.uid, info.gid, info.dev, info.ino,
    info.mode, info.nlink, info.size, info.atimeNs, info.mtimeNs, info.ctimeNs, info.birthtimeNs];
  const before = await stat(s.out, { bigint: true });
  await slotScript([
    { code: 40, args: [s.out], answer: `${before.blocks}:${before.blksize}` },
    { code: 40, args: [s.out], body: Buffer.from([255, 0]), answer: `${before.blocks}:${before.blksize}` },
  ]);
  assert.deepEqual(metadata(await stat(s.out, { bigint: true })), metadata(before));
  assert.deepEqual(await readFile(s.out), content);
});

test('file allocation follows native snapshots through writes, truncation and hard-link changes', async t => {
  const s = await sandbox(t);
  const hard = join(s.path, 'hard');
  const moved = join(s.path, 'moved');
  await writeFile(s.out, '');
  await fsPromises.link(s.out, hard);
  const checkPaths = async paths => {
    const info = await stat(paths[0], { bigint: true });
    const answer = `${info.blocks}:${info.blksize}`;
    await slotScript(paths.map(path => ({ code: 40, args: [path], answer })));
  };
  await checkPaths([s.out, hard]);
  await slotScript([{ code: 29, args: [s.out], body: Buffer.alloc(65536, 65), answer: '' }]);
  await checkPaths([s.out, hard]);
  // Allocation policy belongs to the host, including sparse extensions.
  await slotScript([{ code: 30, args: [hard, '1048576'], answer: '' }]);
  await checkPaths([s.out, hard]);
  await slotScript([{ code: 30, args: [s.out, '0'], answer: '' }]);
  await checkPaths([s.out, hard]);
  await slotScript([{ code: 21, args: [s.out, moved], answer: '' }]);
  await checkPaths([moved, hard]);
  await slotScript([{ code: 19, args: [hard], answer: '' }]);
  await checkPaths([moved]);
  await slotScript([{ code: 40, args: [hard], status: 1, answer: /^ENOENT:/ }]);
  assert.equal((await readFile(moved)).length, 0);
  await absent(s.out);
});

test('file allocation accepts directories and special files and follows final symlinks',
  { skip: process.platform === 'win32', timeout: 5000 }, async t => {
  const s = await sandbox(t);
  const live = join(s.path, 'live');
  const directoryLink = join(s.path, 'directory-link');
  await writeFile(s.out, 'kept');
  await symlink('stdout', live);
  await symlink('.', directoryLink);
  const special = privateFifo(join(s.path, 'fifo'));
  assert.ok((await stat(special)).isFIFO());
  const requests = [];
  for (const path of [s.out, live, s.path + '/', directoryLink, special]) {
    const info = await stat(path, { bigint: true });
    requests.push({ code: 40, args: [path], answer: `${info.blocks}:${info.blksize}` });
  }
  const opened = t.mock.method(fsPromises, 'open', () => assert.fail('allocation inspection opened contents'));
  const inspectedLink = t.mock.method(fsPromises, 'lstat', () => assert.fail('allocation inspection used lstat'));
  const originalRead = fsPromises.readFile;
  const read = t.mock.method(fsPromises, 'readFile', async (path, ...args) => {
    assert.equal(path.href, new URL('../runtime/reactor.mjs', import.meta.url).href);
    return originalRead(path, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    for (const mock of [opened, inspectedLink, read]) mock.mock.restore();
    syncBuiltinESMExports();
  });
  await slotScript(requests);
  assert.equal(opened.mock.callCount(), 0);
  assert.equal(inspectedLink.mock.callCount(), 0);
  assert.equal(read.mock.callCount(), 1);
  assert.equal(await readlink(live), 'stdout');
});

test('file allocation preserves relative Unicode paths and native parent symlink resolution',
  { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const real = join(s.path, 'real');
  const alias = join(s.path, 'alias');
  await mkdir(join(real, 'nested'), { recursive: true });
  await symlink(join(real, 'nested'), alias);
  const actual = join(real, 'data');
  const unicode = join(s.path, 'héllo space');
  for (const path of [actual, unicode]) await writeFile(path, 'kept');
  // Lexically normalizing alias/../data would reach this absent path.
  await absent(join(s.path, 'data'));
  const requests = [];
  for (const [path, native] of [[relative(process.cwd(), unicode), unicode],
    [alias + '//../data', actual]]) {
    const info = await stat(native, { bigint: true });
    requests.push({ code: 40, args: [path], answer: `${info.blocks}:${info.blksize}` });
  }
  await slotScript(requests);
  await absent(join(s.path, 'data'));
});

test('file allocation reports native path errors and continues without creating entries',
  { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const missing = join(s.path, 'missing');
  const dangling = join(s.path, 'dangling');
  const loop = join(s.path, 'loop');
  await writeFile(s.out, 'kept');
  await symlink('missing', dangling);
  await symlink('loop', loop);
  const info = await stat(s.out, { bigint: true });
  const requests = [[missing, /^ENOENT:/], [join(missing, 'child'), /^ENOENT:/],
    [dangling, /^ENOENT:/], [join(s.out, 'child'), /^ENOTDIR:/],
    [s.out + '/', /^ENOTDIR:/], [loop, /^ELOOP:/], ['', /^ENOENT:/]];
  await slotScript([
    ...requests.map(([path, answer]) => ({ code: 40, args: [path], status: 1, answer })),
    { code: 40, args: [s.out], answer: `${info.blocks}:${info.blksize}` },
  ]);
  await absent(missing);
  assert.equal(await readlink(dangling), 'missing');
  assert.equal(await readlink(loop), 'loop');
});

test('file allocation rejects argument counts and undecodable paths before stat', async t => {
  const inspect = t.mock.method(fsPromises, 'stat', async () => ({ blocks: 0n, blksize: 0n }));
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([[], ['path', 'surplus']].map(args => ({ code: 40, args,
    status: 1, answer: `IO: OS request 40 expects 1 argument, got ${args.length}` })));
  for (const [bytes, message] of [[Buffer.from('x\0y'), 'NUL in OS string argument'],
    [Buffer.from([255]), 'non-UTF-8 bytes in OS string argument']]) {
    await assert.rejects(slotScript([{ code: 40, args: [bytes], answer: '' }]), { message });
  }
  assert.equal(inspect.mock.callCount(), 0);
});

test('file allocation preserves exact integer pairs from one fresh stat without opening contents', async t => {
  const values = [
    [0n, 0n, '0:0'], [1n, 2n, '1:2'], [12n, 3n, '12:3'], [1n, 23n, '1:23'],
    [9007199254740993n, 9007199254740995n, '9007199254740993:9007199254740995'],
    [2n ** 64n - 1n, 2n ** 63n, '18446744073709551615:9223372036854775808'],
    [0n, 7n, '0:7'], [7n, 0n, '7:0'], [0n, 0n, '0:0'],
  ];
  const pending = [...values];
  const inspect = t.mock.method(fsPromises, 'stat', async () => {
    assert.ok(pending.length, 'allocation inspection performed extra stat calls');
    const [blocks, blksize] = pending.shift();
    return { blocks, blksize, dev: 81n, ino: 82n, rdev: 91n, nlink: 92n,
      size: 93n, mode: 94n, uid: 95n, gid: 96n };
  });
  const originalRead = fsPromises.readFile;
  const read = t.mock.method(fsPromises, 'readFile', async (path, ...args) => {
    assert.equal(path.href, new URL('../runtime/reactor.mjs', import.meta.url).href);
    return originalRead(path, ...args);
  });
  const opened = t.mock.method(fsPromises, 'open', () => assert.fail('allocation inspection opened contents'));
  syncBuiltinESMExports();
  t.after(() => {
    for (const mock of [inspect, read, opened]) mock.mock.restore();
    syncBuiltinESMExports();
  });
  const path = '../héllo//alias/../file';
  await slotScript(values.map(([, , answer]) => ({ code: 40, args: [path],
    body: Buffer.alloc(65537, 255), answer })));
  assert.equal(pending.length, 0);
  assert.equal(inspect.mock.callCount(), values.length);
  for (const call of inspect.mock.calls) assert.deepEqual(call.arguments, [path, { bigint: true }]);
  assert.equal(read.mock.callCount(), 1);
  assert.equal(opened.mock.callCount(), 0);
});

test('file allocation forwards host errors and resumes subsequent requests', async t => {
  const failures = ['EACCES', 'EIO', 'EOVERFLOW'].map(code => Object.assign(new Error('injected failure'), { code }));
  failures.push(new Error('injected failure'));
  const requests = failures.map(error => ({ code: 40, args: ['path'], status: 1,
    answer: `${error.code ?? 'IO'}: injected failure` }));
  const inspect = t.mock.method(fsPromises, 'stat', async () => {
    if (failures.length) throw failures.shift();
    return { blocks: 0n, blksize: 7n };
  });
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([...requests, { code: 40, args: ['path'], answer: '0:7' }]);
  assert.equal(inspect.mock.callCount(), 5);
});

test('file owner returns native user and group IDs without changing contents or metadata', async t => {
  const s = await sandbox(t);
  const content = Buffer.from([0, 255, 65, 254, 10]);
  await writeFile(s.out, content);
  await fsPromises.utimes(s.out, 1, 2);
  const metadata = info => [info.uid, info.gid, info.dev, info.ino, info.mode, info.nlink, info.size,
    info.atimeNs, info.mtimeNs, info.ctimeNs, info.birthtimeNs];
  const before = await stat(s.out, { bigint: true });
  await slotScript([
    { code: 39, args: [s.out], answer: `${before.uid}:${before.gid}` },
    { code: 39, args: [s.out], body: Buffer.from([255, 0]), answer: `${before.uid}:${before.gid}` },
  ]);
  assert.deepEqual(metadata(await stat(s.out, { bigint: true })), metadata(before));
  assert.deepEqual(await readFile(s.out), content);
});

test('file owner agrees across hard links through append, permission changes, rename and unlink', async t => {
  const s = await sandbox(t);
  const hard = join(s.path, 'hard');
  const moved = join(s.path, 'moved');
  await writeFile(s.out, 'original');
  const before = await stat(s.out, { bigint: true });
  const owner = `${before.uid}:${before.gid}`;
  await slotScript([
    { code: 26, args: [s.out, hard], answer: '' },
    { code: 39, args: [hard], answer: owner },
    { code: 29, args: [s.out], body: Buffer.from(' appended'), answer: '' },
    { code: 39, args: [s.out], answer: owner },
    { code: 31, args: [hard, '384'], answer: '' },
    { code: 39, args: [hard], answer: owner },
    { code: 21, args: [s.out, moved], answer: '' },
    { code: 39, args: [moved], answer: owner },
    { code: 19, args: [hard], answer: '' },
    { code: 39, args: [hard], status: 1, answer: /^ENOENT:/ },
    { code: 39, args: [moved], answer: owner },
  ]);
  assert.equal(await readFile(moved, 'utf8'), 'original appended');
  await absent(s.out);
});

test('file owner accepts directories and special files and follows final symlinks',
  { skip: process.platform === 'win32', timeout: 5000 }, async t => {
  const s = await sandbox(t);
  const live = join(s.path, 'live');
  const directoryLink = join(s.path, 'directory-link');
  await writeFile(s.out, 'kept');
  await symlink('stdout', live);
  await symlink('.', directoryLink);
  const special = privateFifo(join(s.path, 'fifo'));
  assert.ok((await stat(special)).isFIFO());
  const requests = [];
  for (const path of [s.out, live, s.path + '/', directoryLink, special]) {
    const info = await stat(path, { bigint: true });
    requests.push({ code: 39, args: [path], answer: `${info.uid}:${info.gid}` });
  }
  const opened = t.mock.method(fsPromises, 'open', () => assert.fail('owner inspection opened contents'));
  const inspectedLink = t.mock.method(fsPromises, 'lstat', () => assert.fail('owner inspection used lstat'));
  const originalRead = fsPromises.readFile;
  const read = t.mock.method(fsPromises, 'readFile', async (path, ...args) => {
    assert.equal(path.href, new URL('../runtime/reactor.mjs', import.meta.url).href);
    return originalRead(path, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    for (const mock of [opened, inspectedLink, read]) mock.mock.restore();
    syncBuiltinESMExports();
  });
  await slotScript(requests);
  assert.equal(opened.mock.callCount(), 0);
  assert.equal(inspectedLink.mock.callCount(), 0);
  assert.equal(read.mock.callCount(), 1);
  assert.equal(await readlink(live), 'stdout');
});

test('file owner preserves relative Unicode paths and native parent symlink resolution',
  { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const real = join(s.path, 'real');
  const alias = join(s.path, 'alias');
  await mkdir(join(real, 'nested'), { recursive: true });
  await symlink(join(real, 'nested'), alias);
  const actual = join(real, 'data');
  const unicode = join(s.path, 'héllo space');
  for (const path of [actual, unicode]) await writeFile(path, 'kept');
  // Lexically normalizing alias/../data would reach this absent path.
  await absent(join(s.path, 'data'));
  const requests = [];
  for (const [path, native] of [[relative(process.cwd(), unicode), unicode],
    [alias + '//../data', actual]]) {
    const info = await stat(native, { bigint: true });
    requests.push({ code: 39, args: [path], answer: `${info.uid}:${info.gid}` });
  }
  await slotScript(requests);
  await absent(join(s.path, 'data'));
});

test('file owner reports native path errors and continues without creating entries',
  { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const missing = join(s.path, 'missing');
  const dangling = join(s.path, 'dangling');
  const loop = join(s.path, 'loop');
  await writeFile(s.out, 'kept');
  await symlink('missing', dangling);
  await symlink('loop', loop);
  const info = await stat(s.out, { bigint: true });
  const requests = [[missing, /^ENOENT:/], [join(missing, 'child'), /^ENOENT:/],
    [dangling, /^ENOENT:/], [join(s.out, 'child'), /^ENOTDIR:/],
    [s.out + '/', /^ENOTDIR:/], [loop, /^ELOOP:/], ['', /^ENOENT:/]];
  await slotScript([
    ...requests.map(([path, answer]) => ({ code: 39, args: [path], status: 1, answer })),
    { code: 39, args: [s.out], answer: `${info.uid}:${info.gid}` },
  ]);
  await absent(missing);
  assert.equal(await readlink(dangling), 'missing');
  assert.equal(await readlink(loop), 'loop');
});

test('file owner rejects argument counts and undecodable paths before stat', async t => {
  const inspect = t.mock.method(fsPromises, 'stat', async () => ({ uid: 0n, gid: 0n }));
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([[], ['path', 'surplus']].map(args => ({ code: 39, args,
    status: 1, answer: `IO: OS request 39 expects 1 argument, got ${args.length}` })));
  for (const [bytes, message] of [[Buffer.from('x\0y'), 'NUL in OS string argument'],
    [Buffer.from([255]), 'non-UTF-8 bytes in OS string argument']]) {
    await assert.rejects(slotScript([{ code: 39, args: [bytes], answer: '' }]), { message });
  }
  assert.equal(inspect.mock.callCount(), 0);
});

test('file owner preserves exact integer pairs from one fresh stat without opening contents', async t => {
  const values = [
    [0n, 0n, '0:0'], [1n, 2n, '1:2'], [12n, 3n, '12:3'], [1n, 23n, '1:23'],
    [9007199254740993n, 9007199254740995n, '9007199254740993:9007199254740995'],
    [2n ** 64n - 1n, 2n ** 63n, '18446744073709551615:9223372036854775808'],
    [0n, 7n, '0:7'], [7n, 0n, '7:0'], [0n, 0n, '0:0'],
  ];
  const pending = [...values];
  const inspect = t.mock.method(fsPromises, 'stat', async () => {
    assert.ok(pending.length, 'owner inspection performed extra stat calls');
    const [uid, gid] = pending.shift();
    return { uid, gid, dev: 81n, ino: 82n, rdev: 91n, nlink: 92n, size: 93n, mode: 94n };
  });
  const originalRead = fsPromises.readFile;
  const read = t.mock.method(fsPromises, 'readFile', async (path, ...args) => {
    assert.equal(path.href, new URL('../runtime/reactor.mjs', import.meta.url).href);
    return originalRead(path, ...args);
  });
  const opened = t.mock.method(fsPromises, 'open', () => assert.fail('owner inspection opened contents'));
  syncBuiltinESMExports();
  t.after(() => {
    for (const mock of [inspect, read, opened]) mock.mock.restore();
    syncBuiltinESMExports();
  });
  const path = '../héllo//alias/../file';
  await slotScript(values.map(([, , answer]) => ({ code: 39, args: [path],
    body: Buffer.alloc(65537, 255), answer })));
  assert.equal(pending.length, 0);
  assert.equal(inspect.mock.callCount(), values.length);
  for (const call of inspect.mock.calls) assert.deepEqual(call.arguments, [path, { bigint: true }]);
  assert.equal(read.mock.callCount(), 1);
  assert.equal(opened.mock.callCount(), 0);
});

test('file owner forwards host errors and resumes subsequent requests', async t => {
  const failures = ['EACCES', 'EIO', 'EOVERFLOW'].map(code => Object.assign(new Error('injected failure'), { code }));
  failures.push(new Error('injected failure'));
  const requests = failures.map(error => ({ code: 39, args: ['path'], status: 1,
    answer: `${error.code ?? 'IO'}: injected failure` }));
  const inspect = t.mock.method(fsPromises, 'stat', async () => {
    if (failures.length) throw failures.shift();
    return { uid: 0n, gid: 7n };
  });
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([...requests, { code: 39, args: ['path'], answer: '0:7' }]);
  assert.equal(inspect.mock.callCount(), 5);
});

test('file link count returns native metadata without changing contents or timestamps', async t => {
  const s = await sandbox(t);
  const content = Buffer.from([0, 255, 65, 254, 10]);
  await writeFile(s.out, content);
  await fsPromises.utimes(s.out, 1, 2);
  const metadata = info => [info.dev, info.ino, info.mode, info.nlink, info.size,
    info.atimeNs, info.mtimeNs, info.ctimeNs, info.birthtimeNs];
  const before = await stat(s.out, { bigint: true });
  await slotScript([
    { code: 38, args: [s.out], answer: String(before.nlink) },
    { code: 38, args: [s.out], body: Buffer.from([255, 0]), answer: String(before.nlink) },
  ]);
  assert.deepEqual(metadata(await stat(s.out, { bigint: true })), metadata(before));
  assert.deepEqual(await readFile(s.out), content);
});

test('file link count tracks creation, rename, unlink, replacement and independent copies', async t => {
  const s = await sandbox(t);
  const hard = join(s.path, 'hard');
  const extra = join(s.path, 'extra');
  const moved = join(s.path, 'moved');
  const copied = join(s.path, 'copied');
  await writeFile(s.out, 'original');
  await slotScript([
    { code: 38, args: [s.out], answer: '1' },
    { code: 26, args: [s.out, hard], answer: '' },
    { code: 38, args: [s.out], answer: '2' },
    { code: 38, args: [hard], answer: '2' },
    { code: 26, args: [hard, extra], answer: '' },
    { code: 38, args: [s.out], answer: '3' },
    { code: 29, args: [s.out], body: Buffer.from(' appended'), answer: '' },
    { code: 21, args: [extra, moved], answer: '' },
    { code: 38, args: [moved], answer: '3' },
    { code: 30, args: [hard, '2'], answer: '' },
    { code: 38, args: [s.out], answer: '3' },
    { code: 19, args: [moved], answer: '' },
    { code: 38, args: [hard], answer: '2' },
    { code: 3, args: [s.out], body: Buffer.from('replacement'), answer: '' },
    { code: 38, args: [s.out], answer: '1' },
    { code: 38, args: [hard], answer: '1' },
    { code: 19, args: [s.out], answer: '' },
    { code: 38, args: [s.out], status: 1, answer: /^ENOENT:/ },
    { code: 38, args: [hard], answer: '1' },
    { code: 27, args: [hard, copied], answer: '' },
    { code: 38, args: [copied], answer: '1' },
    { code: 38, args: [hard], answer: '1' },
  ]);
  assert.equal(await readFile(hard, 'utf8'), 'or');
  assert.equal(await readFile(copied, 'utf8'), 'or');
  for (const path of [s.out, extra, moved]) await absent(path);
});

test('file link count accepts directories and special files and follows final symlinks', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const live = join(s.path, 'live');
  const directoryLink = join(s.path, 'directory-link');
  await writeFile(s.out, 'kept');
  await fsPromises.link(s.out, join(s.path, 'hard'));
  await symlink('stdout', live);
  await symlink('.', directoryLink);
  const special = privateFifo(join(s.path, 'fifo'));
  assert.ok((await stat(special)).isFIFO());
  assert.equal((await stat(live, { bigint: true })).nlink, 2n);
  assert.equal((await lstat(live, { bigint: true })).nlink, 1n);
  const requests = [];
  for (const path of [s.out, live, s.path + '/', directoryLink, special]) {
    requests.push({ code: 38, args: [path], answer: String((await stat(path, { bigint: true })).nlink) });
  }
  await slotScript(requests);
  assert.equal(await readlink(live), 'stdout');
  assert.equal(await readFile(s.out, 'utf8'), 'kept');
});

test('file link count preserves relative Unicode paths and native parent symlink resolution', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const real = join(s.path, 'real');
  const alias = join(s.path, 'alias');
  await mkdir(join(real, 'nested'), { recursive: true });
  await symlink(join(real, 'nested'), alias);
  const actual = join(real, 'data');
  const decoy = join(s.path, 'data');
  const unicode = join(s.path, 'héllo space');
  for (const path of [actual, decoy, unicode]) await writeFile(path, 'kept');
  await fsPromises.link(actual, join(real, 'hard'));
  await slotScript([
    { code: 38, args: [relative(process.cwd(), unicode)], answer: '1' },
    { code: 38, args: [alias + '//../data'], answer: '2' },
    { code: 38, args: [decoy], answer: '1' },
  ]);
});

test('file link count reports native path errors and continues without creating entries', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const missing = join(s.path, 'missing');
  const dangling = join(s.path, 'dangling');
  const loop = join(s.path, 'loop');
  await writeFile(s.out, 'kept');
  await symlink('missing', dangling);
  await symlink('loop', loop);
  const requests = [[missing, /^ENOENT:/], [join(missing, 'child'), /^ENOENT:/],
    [dangling, /^ENOENT:/], [join(s.out, 'child'), /^ENOTDIR:/],
    [s.out + '/', /^ENOTDIR:/], [loop, /^ELOOP:/], ['', /^ENOENT:/]];
  await slotScript([
    ...requests.map(([path, answer]) => ({ code: 38, args: [path], status: 1, answer })),
    { code: 38, args: [s.out], answer: '1' },
  ]);
  await absent(missing);
  assert.equal(await readlink(dangling), 'missing');
  assert.equal(await readlink(loop), 'loop');
});

test('file link count rejects argument counts and undecodable paths before stat', async t => {
  const inspect = t.mock.method(fsPromises, 'stat', async () => ({ nlink: 0n }));
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([[], ['path', 'surplus']].map(args => ({ code: 38, args,
    status: 1, answer: `IO: OS request 38 expects 1 argument, got ${args.length}` })));
  for (const [bytes, message] of [[Buffer.from('x\0y'), 'NUL in OS string argument'],
    [Buffer.from([255]), 'non-UTF-8 bytes in OS string argument']]) {
    await assert.rejects(slotScript([{ code: 38, args: [bytes], answer: '' }]), { message });
  }
  assert.equal(inspect.mock.callCount(), 0);
});

test('file link count preserves exact integers from one fresh stat without opening contents', async t => {
  const values = [[0n, '0'], [1n, '1'], [2n, '2'],
    [9007199254740993n, '9007199254740993'], [2n ** 64n - 1n, '18446744073709551615'], [0n, '0']];
  const pending = [...values];
  const inspect = t.mock.method(fsPromises, 'stat', async () => {
    assert.ok(pending.length, 'link count performed extra stat calls');
    const [nlink] = pending.shift();
    return { nlink, dev: 91n, ino: 92n, size: 93n, mode: 94n };
  });
  const originalRead = fsPromises.readFile;
  const read = t.mock.method(fsPromises, 'readFile', async (path, ...args) => {
    assert.equal(path.href, new URL('../runtime/reactor.mjs', import.meta.url).href);
    return originalRead(path, ...args);
  });
  const opened = t.mock.method(fsPromises, 'open', () => assert.fail('link count inspection opened contents'));
  syncBuiltinESMExports();
  t.after(() => {
    for (const mock of [inspect, read, opened]) mock.mock.restore();
    syncBuiltinESMExports();
  });
  const path = '../héllo//alias/../file';
  await slotScript(values.map(([, answer]) => ({ code: 38, args: [path],
    body: Buffer.alloc(65537, 255), answer })));
  assert.equal(pending.length, 0);
  assert.equal(inspect.mock.callCount(), values.length);
  for (const call of inspect.mock.calls) assert.deepEqual(call.arguments, [path, { bigint: true }]);
  assert.equal(read.mock.callCount(), 1);
  assert.equal(opened.mock.callCount(), 0);
});

test('file link count forwards host errors and resumes subsequent requests', async t => {
  const failures = ['EACCES', 'EIO', 'EOVERFLOW'].map(code => Object.assign(new Error('injected failure'), { code }));
  failures.push(new Error('injected failure'));
  const requests = failures.map(error => ({ code: 38, args: ['path'], status: 1,
    answer: `${error.code ?? 'IO'}: injected failure` }));
  const inspect = t.mock.method(fsPromises, 'stat', async () => {
    if (failures.length) throw failures.shift();
    return { nlink: 0n };
  });
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([...requests, { code: 38, args: ['path'], answer: '0' }]);
  assert.equal(inspect.mock.callCount(), 5);
});

test('file permissions reads decimal bits including zero without changing the entry', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const content = Buffer.from([0, 255, 65, 254, 10]);
  await writeFile(s.out, content);
  try {
    for (const mode of [0, 1, 0o111, 0o600, 0o644, 0o755, 0o777]) {
      await fsPromises.chmod(s.out, mode);
      const before = await stat(s.out);
      await slotScript([{ code: 32, args: [s.out], body: Buffer.from([255, 0]), answer: String(mode) }]);
      const after = await stat(s.out);
      assert.deepEqual([after.mode, after.dev, after.ino, after.size, after.nlink, after.mtimeMs, after.ctimeMs],
        [before.mode, before.dev, before.ino, before.size, before.nlink, before.mtimeMs, before.ctimeMs]);
    }
  } finally { await fsPromises.chmod(s.out, 0o600); }
  assert.deepEqual(await readFile(s.out), content);
});

test('file permissions reads directories and special files while preserving special bits', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const directory = join(s.path, 'sticky');
  await mkdir(directory);
  await fsPromises.chmod(directory, 0o1750);
  const before = await stat(directory);
  assert.equal(before.mode & 0o7777, 0o1750);
  const device = await stat('/dev/null');
  assert.ok(device.isCharacterDevice());
  await slotScript([
    { code: 32, args: [directory + '/'], answer: '488' },
    { code: 32, args: ['/dev/null'], answer: String(device.mode & 0o777) },
  ]);
  const after = await stat(directory);
  assert.deepEqual([after.mode, after.ino, after.ctimeMs], [before.mode, before.ino, before.ctimeMs]);
  assert.deepEqual(await readdir(directory), []);
});

test('file permissions follows symlinks and supports saving and restoring shared permissions', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const hard = join(s.path, 'hard');
  const live = join(s.path, 'live');
  await writeFile(s.out, 'kept');
  await fsPromises.chmod(s.out, 0o640);
  await fsPromises.link(s.out, hard);
  await symlink('stdout', live);
  const before = await lstat(live);
  const [saved] = await slotScript([{ code: 32, args: [live], answer: '416' }]);
  await slotScript([
    { code: 31, args: [hard, '493'], answer: '' },
    { code: 32, args: [live], answer: '493' },
    { code: 31, args: [live, saved], answer: '' },
    { code: 32, args: [hard], answer: saved },
    { code: 32, args: [s.out], answer: saved },
  ]);
  const after = await lstat(live);
  assert.deepEqual([after.mode, after.ino, after.ctimeMs], [before.mode, before.ino, before.ctimeMs]);
  assert.equal(await readlink(live), 'stdout');
  assert.equal(await readFile(s.out, 'utf8'), 'kept');
});

test('file permissions preserves relative Unicode paths and native parent symlink resolution', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const real = join(s.path, 'real');
  const alias = join(s.path, 'alias');
  await mkdir(join(real, 'nested'), { recursive: true });
  await symlink(join(real, 'nested'), alias);
  const actual = join(real, 'data');
  const decoy = join(s.path, 'data');
  const unicode = join(s.path, 'héllo space');
  for (const [path, mode] of [[actual, 0o755], [decoy, 0o600], [unicode, 0o640]]) {
    await writeFile(path, 'kept');
    await fsPromises.chmod(path, mode);
  }
  await slotScript([
    { code: 32, args: [relative(process.cwd(), unicode)], answer: '416' },
    { code: 32, args: [alias + '//../data'], answer: '493' },
    { code: 32, args: [decoy], answer: '384' },
  ]);
});

test('file permissions reports native path errors and continues without creating entries', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const missing = join(s.path, 'missing');
  const dangling = join(s.path, 'dangling');
  const loop = join(s.path, 'loop');
  await writeFile(s.out, 'kept');
  await fsPromises.chmod(s.out, 0o600);
  await symlink('missing', dangling);
  await symlink('loop', loop);
  const requests = [[missing, /^ENOENT:/], [join(missing, 'child'), /^ENOENT:/],
    [dangling, /^ENOENT:/], [join(s.out, 'child'), /^ENOTDIR:/],
    [s.out + '/', /^ENOTDIR:/], [loop, /^ELOOP:/], ['', /^ENOENT:/]];
  await slotScript([
    ...requests.map(([path, answer]) => ({ code: 32, args: [path], status: 1, answer })),
    { code: 32, args: [s.out], answer: '384' },
  ]);
  await absent(missing);
  assert.equal(await readlink(dangling), 'missing');
  assert.equal(await readlink(loop), 'loop');
});

test('file permissions rejects argument counts and undecodable paths before stat', async t => {
  const inspect = t.mock.method(fsPromises, 'stat', async () => ({ mode: 0o100600 }));
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([[], ['path', 'surplus']].map(args => ({ code: 32, args,
    status: 1, answer: `IO: OS request 32 expects 1 argument, got ${args.length}` })));
  for (const [bytes, message] of [[Buffer.from('x\0y'), 'NUL in OS string argument'],
    [Buffer.from([255]), 'non-UTF-8 bytes in OS string argument']]) {
    await assert.rejects(slotScript([{ code: 32, args: [bytes], answer: '' }]), { message });
  }
  assert.equal(inspect.mock.callCount(), 0);
});

test('file permissions excludes file type and special bits and forwards the literal path', async t => {
  const modes = [0o107755, 0o047700, 0o020000, 0o147777];
  const inspect = t.mock.method(fsPromises, 'stat', async () => ({ mode: modes.shift() }));
  const opened = t.mock.method(fsPromises, 'open');
  const read = t.mock.method(fsPromises, 'readFile');
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); opened.mock.restore(); read.mock.restore(); syncBuiltinESMExports(); });
  const path = '../héllo//alias/../file';
  await slotScript(['493', '448', '0', '511'].map(answer => ({ code: 32, args: [path],
    body: Buffer.alloc(65537, 255), answer })));
  assert.deepEqual(inspect.mock.calls.map(call => call.arguments), Array.from({ length: 4 }, () => [path]));
  const contentCalls = [opened, read].flatMap(spy => spy.mock.calls)
    .filter(call => call.arguments.at(0) === path);
  assert.deepEqual(contentCalls, []);
});

test('file permissions forwards host errors and resumes subsequent requests', async t => {
  const failures = ['EACCES', 'EPERM', 'EIO', undefined];
  const inspect = t.mock.method(fsPromises, 'stat', async () => {
    if (failures.length) throw Object.assign(new Error('injected stat failure'), { code: failures.shift() });
    return { mode: 0o100640 };
  });
  syncBuiltinESMExports();
  t.after(() => { inspect.mock.restore(); syncBuiltinESMExports(); });
  const script = failures.map(code => ({ code: 32, args: ['path'],
    status: 1, answer: `${code ?? 'IO'}: injected stat failure` }));
  await slotScript([...script, { code: 32, args: ['path'], answer: '416' }]);
  assert.equal(inspect.mock.callCount(), 5);
});

test('file times updates both timestamps and composes with timestamp inspection', async t => {
  const s = await sandbox(t);
  const content = Buffer.from([0, 255, 65, 254, 10]);
  await writeFile(s.out, content);
  const before = await stat(s.out, { bigint: true });
  for (const [atime, mtime] of [[1000, 3000], [0, 2000], [1234, 5678],
    [1700000001234, 1700000005678], [1000, 3000]]) {
    await slotScript([{ code: 44, args: [s.out, String(atime), String(mtime)],
      body: Buffer.alloc(65537, 255), answer: '' }]);
    const after = await stat(s.out, { bigint: true });
    for (const [actual, milliseconds] of [[after.atimeNs, atime], [after.mtimeNs, mtime]]) {
      const delta = actual - BigInt(milliseconds) * 1000000n;
      assert.ok(delta >= -1000n && delta <= 1000n, `timestamp differs by ${delta} ns`);
    }
    for (const key of ['dev', 'ino', 'size', 'mode', 'uid', 'gid', 'nlink']) {
      assert.equal(after[key], before[key], key);
    }
    await slotScript([
      { code: 33, args: [s.out], answer: String(after.mtimeNs) },
      { code: 34, args: [s.out], answer: String(after.atimeNs) },
    ]);
  }
  assert.deepEqual(await readFile(s.out), content);
});

test('file times preserves pre-epoch values instead of replacing them with the current time',
  { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  await writeFile(s.out, 'kept');
  for (const [atime, mtime] of [[-2000, -1000], [-1000, 2000], [3000, -4000]]) {
    await slotScript([{ code: 44, args: [s.out, String(atime), String(mtime)], answer: '' }]);
    const after = await stat(s.out, { bigint: true });
    assert.equal(after.atimeNs, BigInt(atime) * 1000000n);
    assert.equal(after.mtimeNs, BigInt(mtime) * 1000000n);
  }
});

test('file times supports directories and special files and follows symlinks and hard links',
  { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  await writeFile(s.out, 'kept');
  const hard = join(s.path, 'hard');
  const live = join(s.path, 'live');
  const directory = join(s.path, 'directory');
  await fsPromises.link(s.out, hard);
  await symlink('stdout', live);
  await mkdir(directory);
  const fifo = privateFifo(join(s.path, 'fifo'));
  const linkBefore = await lstat(live, { bigint: true });
  const guards = ['open', 'writeFile', 'truncate', 'lutimes'].map(name =>
    t.mock.method(fsPromises, name, () => assert.fail(`file times called ${name}`)));
  const originalRead = fsPromises.readFile;
  const modulePath = new URL('../runtime/reactor.mjs', import.meta.url);
  guards.push(t.mock.method(fsPromises, 'readFile', (path, ...args) => {
    assert.ok(path instanceof URL && path.href === modulePath.href, 'file times read file contents');
    return originalRead(path, ...args);
  }));
  syncBuiltinESMExports();
  t.after(() => { guards.forEach(guard => guard.mock.restore()); syncBuiltinESMExports(); });
  for (const [index, path] of [directory + '/', fifo, hard, live].entries()) {
    const atime = (index + 1) * 1000;
    const mtime = (index + 5) * 1000;
    await slotScript([{ code: 44, args: [path, String(atime), String(mtime)], answer: '' }]);
    const after = await stat(path, { bigint: true });
    assert.equal(after.atimeNs, BigInt(atime) * 1000000n);
    assert.equal(after.mtimeNs, BigInt(mtime) * 1000000n);
  }
  const target = await stat(s.out, { bigint: true });
  assert.equal(target.atimeNs, 4000000000n);
  assert.equal(target.mtimeNs, 8000000000n);
  assert.equal((await stat(hard, { bigint: true })).mtimeNs, target.mtimeNs);
  const linkAfter = await lstat(live, { bigint: true });
  for (const key of ['ino', 'mode', 'size', 'mtimeNs', 'ctimeNs']) {
    assert.equal(linkAfter[key], linkBefore[key], key);
  }
  assert.equal(await readlink(live), 'stdout');
});

test('file times preserves relative Unicode paths and native parent symlink resolution',
  { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const real = join(s.path, 'real');
  const alias = join(s.path, 'alias');
  await mkdir(join(real, 'nested'), { recursive: true });
  await symlink(join(real, 'nested'), alias);
  const actual = join(real, 'data');
  const decoy = join(s.path, 'data');
  const unicode = join(s.path, 'héllo space');
  for (const path of [actual, decoy, unicode]) {
    await writeFile(path, 'kept');
    await fsPromises.utimes(path, new Date(9000), new Date(10000));
  }
  await slotScript([
    { code: 44, args: [relative(process.cwd(), unicode), '1000', '2000'], answer: '' },
    { code: 44, args: [alias + '//../data', '3000', '4000'], answer: '' },
  ]);
  for (const [path, atime, mtime] of [[unicode, 1000, 2000], [actual, 3000, 4000], [decoy, 9000, 10000]]) {
    const after = await stat(path, { bigint: true });
    assert.equal(after.atimeNs, BigInt(atime) * 1000000n);
    assert.equal(after.mtimeNs, BigInt(mtime) * 1000000n);
  }
});

test('file times reports native path errors and recovers without creating entries',
  { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const missing = join(s.path, 'missing');
  const dangling = join(s.path, 'dangling');
  const loop = join(s.path, 'loop');
  await writeFile(s.out, 'kept');
  await symlink('missing', dangling);
  await symlink('loop', loop);
  const requests = [[missing, /^ENOENT:/], [join(missing, 'child'), /^ENOENT:/],
    [dangling, /^ENOENT:/], [join(s.out, 'child'), /^ENOTDIR:/],
    [s.out + '/', /^ENOTDIR:/], [loop, /^ELOOP:/], ['', /^ENOENT:/]];
  for (const [path, answer] of requests) {
    await slotScript([
      { code: 44, args: [path, '1000', '2000'], status: 1, answer },
      { code: 44, args: [s.out, '3000', '4000'], answer: '' },
    ]);
    const after = await stat(s.out, { bigint: true });
    assert.equal(after.atimeNs, 3000000000n);
    assert.equal(after.mtimeNs, 4000000000n);
  }
  await absent(missing);
  assert.equal(await readlink(dangling), 'missing');
  assert.equal(await readlink(loop), 'loop');
  assert.deepEqual(await readFile(s.out), Buffer.from('kept'));
});

test('file times rejects malformed timestamps and argument counts before any host update', async t => {
  const change = t.mock.method(fsPromises, 'utimes', async () => {});
  syncBuiltinESMExports();
  t.after(() => { change.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([[], ['path'], ['path', '1000'], ['path', '1000', '2000', 'surplus']]
    .map(args => ({ code: 44, args, status: 1,
      answer: `IO: OS request 44 expects 3 arguments, got ${args.length}` })));
  const invalid = ['', ' ', ' 1', '1 ', '1\n', '1\r', '1\r\n', '1\t', '1\u2028', '1\u2029',
    '-0', '+1', '01', '-01', '00', '1.5', '-0.5', '1e2', '0x10', 'NaN', 'Infinity', '-Infinity', '１',
    '8640000000000001', '-8640000000000001', '9007199254740991', '-9007199254740991',
    '9007199254740993', '8640000000000000.1', '9'.repeat(400)];
  for (const value of invalid) {
    for (const args of [['path', value, '2000'], ['path', '1000', value]]) {
      await slotScript([{ code: 44, args, status: 1, answer: 'IO: invalid OS timestamp argument' }]);
    }
  }
  assert.equal(change.mock.callCount(), 0);
  await slotScript([{ code: 44, args: ['path', '1000', '2000'], answer: '' }]);
  assert.equal(change.mock.callCount(), 1);
});

test('file times rejects undecodable bytes in each argument before utimes', async t => {
  const change = t.mock.method(fsPromises, 'utimes', async () => {});
  syncBuiltinESMExports();
  t.after(() => { change.mock.restore(); syncBuiltinESMExports(); });
  for (const [bytes, message] of [[Buffer.from('x\0y'), 'NUL in OS string argument'],
    [Buffer.from([255]), 'non-UTF-8 bytes in OS string argument']]) {
    for (let index = 0; index < 3; index += 1) {
      const args = ['path', '1000', '2000'];
      args[index] = bytes;
      await assert.rejects(slotScript([{ code: 44, args, answer: '' }]), { message });
    }
  }
  assert.equal(change.mock.callCount(), 0);
});

test('file times forwards ordered Date values and range endpoints in one call and ignores the body', async t => {
  const change = t.mock.method(fsPromises, 'utimes', async () => {});
  syncBuiltinESMExports();
  t.after(() => { change.mock.restore(); syncBuiltinESMExports(); });
  const path = '../héllo//alias/../file';
  const pairs = [[0, 1], [-1, 0], [1234, -5678], [1700000001234, 1700000005678],
    [-8640000000000000, 8640000000000000], [8640000000000000, -8640000000000000]];
  await slotScript(pairs.map(([atime, mtime]) => ({ code: 44,
    args: [path, String(atime), String(mtime)], body: Buffer.alloc(65537, 255), answer: '' })));
  assert.equal(change.mock.callCount(), pairs.length);
  for (const [index, call] of change.mock.calls.entries()) {
    assert.equal(call.arguments.length, 3);
    const [actualPath, atime, mtime] = call.arguments;
    assert.equal(actualPath, path);
    assert.ok(atime instanceof Date);
    assert.ok(mtime instanceof Date);
    assert.deepEqual([atime.getTime(), mtime.getTime()], pairs[index]);
  }
});

test('file times forwards host errors and resumes a subsequent successful update', async t => {
  const failures = ['EACCES', 'EPERM', 'EROFS', 'EIO', 'ENOSYS', 'EINVAL', 'EOVERFLOW']
    .map(code => Object.assign(new Error('injected utimes failure'), { code }));
  failures.push(new Error('generic failure'));
  const script = failures.map(error => ({ code: 44, args: ['path', '1000', '2000'],
    status: 1, answer: `${error.code ?? 'IO'}: ${error.message}` }));
  const change = t.mock.method(fsPromises, 'utimes', async () => {
    const error = failures.shift();
    if (error) throw error;
  });
  syncBuiltinESMExports();
  t.after(() => { change.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([...script, { code: 44, args: ['path', '1000', '2000'], answer: '' }]);
  assert.equal(change.mock.callCount(), script.length + 1);
});

test('file access checks every mode against native permissions without changing metadata', async t => {
  const s = await sandbox(t);
  const content = Buffer.from([0, 255, 65, 254, 10]);
  await writeFile(s.out, content, { mode: 0o600 });
  const before = await stat(s.out, { bigint: true });
  const masks = [fsConstants.F_OK, fsConstants.X_OK, fsConstants.W_OK,
    fsConstants.W_OK | fsConstants.X_OK, fsConstants.R_OK, fsConstants.R_OK | fsConstants.X_OK,
    fsConstants.R_OK | fsConstants.W_OK, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK];
  const script = [];
  for (const path of [s.out, s.path]) {
    for (const [mode, flags] of masks.entries()) {
      const request = { code: 48, args: [path, String(mode)], answer: '' };
      try { await access(path, flags); }
      catch (error) { request.status = 1; request.answer = `${error.code}: ${error.message}`; }
      script.push(request);
    }
  }
  await slotScript(script);
  const after = await stat(s.out, { bigint: true });
  for (const key of ['dev', 'ino', 'mode', 'nlink', 'uid', 'gid', 'size', 'mtimeNs', 'ctimeNs']) {
    assert.equal(after[key], before[key], key);
  }
  assert.deepEqual(await readFile(s.out), content);
});

test('file access preserves literal paths and native parent symlink resolution',
  { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const parent = join(s.path, 'parent é');
  await mkdir(join(parent, 'deep'), { recursive: true });
  const target = join(parent, 'target ?# é');
  await writeFile(target, 'kept');
  const alias = join(s.path, 'alias');
  await symlink(join(parent, 'deep'), alias);
  const literal = `${alias}/../target ?# é`;
  await slotScript([
    ...[literal, `${relative(process.cwd(), alias)}/../target ?# é`, `${parent}//target ?# é`, `${parent}/`]
      .map(path => ({ code: 48, args: [path, '0'], answer: '' })),
    { code: 48, args: [resolve(literal), '0'], status: 1, answer: /^ENOENT:/ },
    { code: 48, args: [target, '4'], answer: '' },
  ]);
  assert.equal(await readFile(target, 'utf8'), 'kept');
});

test('file access follows final symlinks and supports hard links and special files without opening them',
  { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  await writeFile(s.out, 'kept', { mode: 0o600 });
  const live = join(s.path, 'live');
  const hard = join(s.path, 'hard');
  const dangling = join(s.path, 'dangling');
  const cyclic = join(s.path, 'cyclic');
  await symlink(basename(s.out), live);
  await fsPromises.link(s.out, hard);
  await symlink('missing', dangling);
  await symlink('cyclic', cyclic);
  const fifo = privateFifo(join(s.path, 'fifo'));
  const forbidden = ['open', 'writeFile', 'appendFile', 'chmod', 'stat', 'lstat', 'realpath']
    .map(name => t.mock.method(fsPromises, name, () => assert.fail(`file access called ${name}`)));
  const originalRead = fsPromises.readFile;
  const modulePath = new URL('../runtime/reactor.mjs', import.meta.url);
  forbidden.push(t.mock.method(fsPromises, 'readFile', (path, ...args) => {
    assert.ok(path instanceof URL && path.href === modulePath.href, 'file access read contents');
    return originalRead(path, ...args);
  }));
  syncBuiltinESMExports();
  t.after(() => { forbidden.forEach(mock => mock.mock.restore()); syncBuiltinESMExports(); });
  await slotScript([
    ...[live, hard, fifo, s.path].map(path => ({ code: 48, args: [path, '0'], answer: '' })),
    { code: 48, args: [dangling, '0'], status: 1, answer: /^ENOENT:/ },
    { code: 48, args: [cyclic, '0'], status: 1, answer: /^ELOOP:/ },
    { code: 48, args: [live, '6'], answer: '' },
  ]);
});

test('file access returns native path failures and recovers without creating entries',
  { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  await writeFile(s.out, 'kept');
  const missing = join(s.path, 'missing');
  await slotScript([
    ...[['', /^ENOENT:/], [missing, /^ENOENT:/], [s.out + '/', /^ENOTDIR:/],
      [join(s.out, 'child'), /^ENOTDIR:/], [`${missing}/../stdout`, /^ENOENT:/]]
      .map(([path, answer]) => ({ code: 48, args: [path, '0'], status: 1, answer })),
    { code: 48, args: [s.out, '0'], answer: '' },
    { code: 31, args: [s.out, '448'], answer: '' },
    { code: 48, args: [s.out, '7'], answer: '' },
  ]);
  await absent(missing);
  assert.equal(await readFile(s.out, 'utf8'), 'kept');
});

test('file access validates canonical modes and exact arity before the host call', async t => {
  const check = t.mock.method(fsPromises, 'access', async () => {});
  syncBuiltinESMExports();
  t.after(() => { check.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([[], ['path'], ['path', '0', 'surplus']]
    .map(args => ({ code: 48, args, status: 1,
      answer: `IO: OS request 48 expects 2 arguments, got ${args.length}` })));
  const invalid = ['', ' ', ' 1', '1 ', '1\n', '1\r', '1\r\n', '1\t', '1\u2028', '1\u2029',
    '-0', '-1', '+1', '01', '00', '1.0', '0.5', '1e0', '0x1', 'NaN', 'Infinity', '-Infinity',
    '１', '8', '511', '4294967296', '9007199254740993', '7.0000000000000001', '9'.repeat(400)];
  await slotScript(invalid.map(mode => ({ code: 48, args: ['path', mode], status: 1,
    answer: 'IO: invalid OS access mode argument' })));
  assert.equal(check.mock.callCount(), 0);
  await slotScript([{ code: 48, args: ['path', '0'], answer: '' }]);
  assert.equal(check.mock.callCount(), 1);
});

test('file access rejects undecodable bytes in either argument before the host call', async t => {
  const check = t.mock.method(fsPromises, 'access', async () => {});
  syncBuiltinESMExports();
  t.after(() => { check.mock.restore(); syncBuiltinESMExports(); });
  for (const [bytes, message] of [[Buffer.from('x\0y'), 'NUL in OS string argument'],
    [Buffer.from([255]), 'non-UTF-8 bytes in OS string argument']]) {
    for (let index = 0; index < 2; index += 1) {
      const args = ['path', '0'];
      args[index] = bytes;
      await assert.rejects(slotScript([{ code: 48, args, answer: '' }]), { message });
    }
  }
  assert.equal(check.mock.callCount(), 0);
});

test('file access forwards every flag combination once and ignores the request body', async t => {
  const check = t.mock.method(fsPromises, 'access', async () => {});
  syncBuiltinESMExports();
  t.after(() => { check.mock.restore(); syncBuiltinESMExports(); });
  const path = '../héllo//alias/../file';
  const masks = [fsConstants.F_OK, fsConstants.X_OK, fsConstants.W_OK,
    fsConstants.W_OK | fsConstants.X_OK, fsConstants.R_OK, fsConstants.R_OK | fsConstants.X_OK,
    fsConstants.R_OK | fsConstants.W_OK, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK];
  await slotScript(masks.map((_, mode) => ({ code: 48, args: [path, String(mode)],
    body: Buffer.alloc(65537, 255), answer: '' })));
  assert.equal(check.mock.callCount(), masks.length);
  for (const [index, call] of check.mock.calls.entries()) {
    assert.deepEqual(call.arguments, [path, masks[index]]);
  }
});

test('file access forwards host errors and awaits completion before resuming', async t => {
  const failures = ['EACCES', 'EPERM', 'EROFS', 'EIO', 'ENOSYS', 'ENOTSUP', 'EINVAL']
    .map(code => Object.assign(new Error('injected access failure'), { code }));
  failures.push(new Error('generic failure'));
  const script = failures.map(error => ({ code: 48, args: ['path', '4'], status: 1,
    answer: `${error.code ?? 'IO'}: ${error.message}` }));
  let finished = 0;
  const check = t.mock.method(fsPromises, 'access', async () => {
    await new Promise(resolveCheck => setImmediate(resolveCheck));
    finished += 1;
    const error = failures.shift();
    if (error) throw error;
  });
  syncBuiltinESMExports();
  t.after(() => { check.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([...script, { code: 48, args: ['path', '4'], answer: '' }]);
  assert.equal(check.mock.callCount(), script.length + 1);
  assert.equal(finished, script.length + 1);
});

test('file lutimes updates live, dangling and cyclic links without touching their targets',
  { skip: process.platform === 'win32', timeout: 10000 }, async t => {
  const s = await sandbox(t);
  const content = Buffer.from([0, 255, 65, 254, 10]);
  await writeFile(s.out, content);
  const targetBefore = await stat(s.out, { bigint: true });
  const follow = t.mock.method(fsPromises, 'utimes', () => assert.fail('followed a final symlink'));
  syncBuiltinESMExports();
  t.after(() => { follow.mock.restore(); syncBuiltinESMExports(); });
  for (const [name, target] of [['live', 'stdout'], ['dangling', 'missing'], ['loop', 'loop']]) {
    const path = join(s.path, name);
    await slotScript([{ code: 25, args: [target, path], answer: '' }]);
    const before = await lstat(path, { bigint: true });
    for (const [atime, mtime] of [[1000, 3000], [0, 2000], [1234, 5678],
      [1700000001234, 1700000005678], [-2000, -1000], [-1000, 2000], [3000, -4000]]) {
      await slotScript([{ code: 47, args: [path, String(atime), String(mtime)],
        body: Buffer.alloc(65537, 255), answer: '' }]);
      // Inspect before readlink, which can update the link's access time.
      const after = await lstat(path, { bigint: true });
      for (const [actual, milliseconds] of [[after.atimeNs, atime], [after.mtimeNs, mtime]]) {
        const delta = actual - BigInt(milliseconds) * 1000000n;
        assert.ok(delta >= -1000n && delta <= 1000n, `timestamp differs by ${delta} ns`);
      }
      for (const key of ['dev', 'ino', 'size', 'mode', 'uid', 'gid', 'nlink']) {
        assert.equal(after[key], before[key], key);
      }
    }
    await slotScript([
      { code: 23, args: [path], answer: 'symlink' },
      { code: 24, args: [path], answer: target },
      { code: 19, args: [path], answer: '' },
    ]);
    await assert.rejects(lstat(path), { code: 'ENOENT' });
  }
  const targetAfter = await stat(s.out, { bigint: true });
  for (const key of ['dev', 'ino', 'size', 'mode', 'uid', 'gid', 'nlink', 'atimeNs', 'mtimeNs', 'ctimeNs']) {
    assert.equal(targetAfter[key], targetBefore[key], key);
  }
  assert.deepEqual(await readFile(s.out), content);
  await absent(join(s.path, 'missing'));
  assert.equal(follow.mock.callCount(), 0);
});

test('file lutimes preserves literal relative paths and native parent symlink resolution',
  { skip: process.platform === 'win32', timeout: 10000 }, async t => {
  const s = await sandbox(t);
  const real = join(s.path, 'real');
  const alias = join(s.path, 'alias');
  await mkdir(join(real, 'nested'), { recursive: true });
  await symlink(join(real, 'nested'), alias);
  const actual = join(real, 'data');
  const decoy = join(s.path, 'data');
  const unicode = join(s.path, 'héllo space');
  for (const path of [actual, decoy, unicode]) await symlink('missing', path);
  const decoyBefore = await lstat(decoy, { bigint: true });
  const original = fsPromises.lutimes;
  const change = t.mock.method(fsPromises, 'lutimes', (...args) => original(...args));
  syncBuiltinESMExports();
  t.after(() => { change.mock.restore(); syncBuiltinESMExports(); });
  for (const [index, path] of [relative(process.cwd(), unicode), alias + '//../data'].entries()) {
    await slotScript([{ code: 47, args: [path, '1000', '2000'], answer: '' }]);
    assert.deepEqual(change.mock.calls[index].arguments, [path, new Date(1000), new Date(2000)]);
    const after = await lstat([unicode, actual][index], { bigint: true });
    assert.equal(after.atimeNs, 1000000000n);
    assert.equal(after.mtimeNs, 2000000000n);
  }
  assert.equal(change.mock.callCount(), 2);
  const decoyAfter = await lstat(decoy, { bigint: true });
  for (const key of ['ino', 'atimeNs', 'mtimeNs', 'ctimeNs']) assert.equal(decoyAfter[key], decoyBefore[key]);
});

test('file lutimes supports regular files, hard links, directories and special files without opening contents',
  { skip: process.platform === 'win32', timeout: 10000 }, async t => {
  const s = await sandbox(t);
  await writeFile(s.out, 'kept');
  const hard = join(s.path, 'hard');
  const directory = join(s.path, 'directory');
  await fsPromises.link(s.out, hard);
  await mkdir(directory);
  const fifo = privateFifo(join(s.path, 'fifo'));
  const guards = ['open', 'writeFile', 'truncate', 'utimes', 'realpath'].map(name =>
    t.mock.method(fsPromises, name, () => assert.fail(`file lutimes called ${name}`)));
  const originalRead = fsPromises.readFile;
  const modulePath = new URL('../runtime/reactor.mjs', import.meta.url);
  guards.push(t.mock.method(fsPromises, 'readFile', (path, ...args) => {
    assert.ok(path instanceof URL && path.href === modulePath.href, 'file lutimes read contents');
    return originalRead(path, ...args);
  }));
  syncBuiltinESMExports();
  t.after(() => { guards.forEach(guard => guard.mock.restore()); syncBuiltinESMExports(); });
  for (const [index, path] of [s.out, hard, directory + '/', fifo].entries()) {
    const before = await lstat(path, { bigint: true });
    const atime = (index + 1) * 1000;
    const mtime = (index + 5) * 1000;
    await slotScript([{ code: 47, args: [path, String(atime), String(mtime)], answer: '' }]);
    const after = await lstat(path, { bigint: true });
    assert.equal(after.atimeNs, BigInt(atime) * 1000000n);
    assert.equal(after.mtimeNs, BigInt(mtime) * 1000000n);
    for (const key of ['dev', 'ino', 'size', 'mode', 'uid', 'gid', 'nlink']) {
      assert.equal(after[key], before[key], key);
    }
  }
  await slotScript([
    { code: 33, args: [s.out], answer: '6000000000' },
    { code: 34, args: [hard], answer: '2000000000' },
  ]);
  assert.equal(await originalRead(s.out, 'utf8'), 'kept');
});

test('file lutimes returns native path failures and continues without creating entries',
  { skip: process.platform === 'win32', timeout: 10000 }, async t => {
  const s = await sandbox(t);
  const missing = join(s.path, 'missing');
  const loop = join(s.path, 'loop');
  await writeFile(s.out, 'kept');
  await symlink('loop', loop);
  for (const [path, answer] of [[missing, /^ENOENT:/], [join(missing, 'child'), /^ENOENT:/],
    [s.out + '/', /^ENOTDIR:/], [join(s.out, 'child'), /^ENOTDIR:/],
    [join(loop, 'child'), /^ELOOP:/], ['', /^ENOENT:/]]) {
    await slotScript([
      { code: 47, args: [path, '1000', '2000'], status: 1, answer },
      { code: 47, args: [loop, '3000', '4000'], answer: '' },
    ]);
    const after = await lstat(loop, { bigint: true });
    assert.equal(after.atimeNs, 3000000000n);
    assert.equal(after.mtimeNs, 4000000000n);
  }
  await absent(missing);
  assert.equal(await readlink(loop), 'loop');
  assert.equal(await readFile(s.out, 'utf8'), 'kept');
});

test('file lutimes validates both timestamps and exact arity before any host update', async t => {
  const change = t.mock.method(fsPromises, 'lutimes', async () => {});
  syncBuiltinESMExports();
  t.after(() => { change.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([[], ['path'], ['path', '1000'], ['path', '1000', '2000', 'surplus']]
    .map(args => ({ code: 47, args, status: 1,
      answer: `IO: OS request 47 expects 3 arguments, got ${args.length}` })));
  const invalid = ['', ' ', ' 1', '1 ', '1\n', '1\r', '1\r\n', '1\t', '1\u2028', '1\u2029',
    '-0', '+1', '01', '-01', '00', '1.5', '-0.5', '1e2', '0x10', 'NaN', 'Infinity', '-Infinity', '１',
    '8640000000000001', '-8640000000000001', '9007199254740991', '-9007199254740991',
    '9007199254740993', '8640000000000000.1', '9'.repeat(400)];
  for (const value of invalid) {
    for (const args of [['path', value, '2000'], ['path', '1000', value]]) {
      await slotScript([{ code: 47, args, status: 1, answer: 'IO: invalid OS timestamp argument' }]);
    }
  }
  assert.equal(change.mock.callCount(), 0);
  await slotScript([{ code: 47, args: ['path', '1000', '2000'], answer: '' }]);
  assert.equal(change.mock.callCount(), 1);
});

test('file lutimes rejects undecodable bytes in each argument before the host call', async t => {
  const change = t.mock.method(fsPromises, 'lutimes', async () => {});
  syncBuiltinESMExports();
  t.after(() => { change.mock.restore(); syncBuiltinESMExports(); });
  for (const [bytes, message] of [[Buffer.from('x\0y'), 'NUL in OS string argument'],
    [Buffer.from([255]), 'non-UTF-8 bytes in OS string argument']]) {
    for (let index = 0; index < 3; index += 1) {
      const args = ['path', '1000', '2000'];
      args[index] = bytes;
      await assert.rejects(slotScript([{ code: 47, args, answer: '' }]), { message });
    }
  }
  assert.equal(change.mock.callCount(), 0);
});

test('file lutimes forwards ordered Date values and range endpoints once and ignores the body', async t => {
  const change = t.mock.method(fsPromises, 'lutimes', async () => {});
  syncBuiltinESMExports();
  t.after(() => { change.mock.restore(); syncBuiltinESMExports(); });
  const path = '../héllo//alias/../file';
  const pairs = [[0, 1], [-1, 0], [1234, -5678], [1700000001234, 1700000005678],
    [-8640000000000000, 8640000000000000], [8640000000000000, -8640000000000000]];
  await slotScript(pairs.map(([atime, mtime]) => ({ code: 47,
    args: [path, String(atime), String(mtime)], body: Buffer.alloc(65537, 255), answer: '' })));
  assert.equal(change.mock.callCount(), pairs.length);
  for (const [index, call] of change.mock.calls.entries()) {
    assert.equal(call.arguments.length, 3);
    const [actualPath, atime, mtime] = call.arguments;
    assert.equal(actualPath, path);
    assert.ok(atime instanceof Date);
    assert.ok(mtime instanceof Date);
    assert.deepEqual([atime.getTime(), mtime.getTime()], pairs[index]);
  }
});

test('file lutimes forwards host errors and resumes the next request', async t => {
  const failures = ['EACCES', 'EPERM', 'EROFS', 'EIO', 'ENOSYS', 'ENOTSUP', 'EINVAL', 'EOVERFLOW']
    .map(code => Object.assign(new Error('injected lutimes failure'), { code }));
  failures.push(new Error('generic failure'));
  const script = failures.map(error => ({ code: 47, args: ['path', '1000', '2000'],
    status: 1, answer: `${error.code ?? 'IO'}: ${error.message}` }));
  const change = t.mock.method(fsPromises, 'lutimes', async () => {
    const error = failures.shift();
    if (error) throw error;
  });
  syncBuiltinESMExports();
  t.after(() => { change.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([...script, { code: 47, args: ['path', '1000', '2000'], answer: '' }]);
  assert.equal(change.mock.callCount(), script.length + 1);
});

test('file chown preserves file identity and contents and composes with owner inspection',
  { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const content = Buffer.from([0, 255, 65, 254, 10]);
  await writeFile(s.out, content);
  const before = await stat(s.out, { bigint: true });
  const ids = [String(before.uid), String(before.gid)];
  await slotScript([
    { code: 45, args: [s.out, ...ids], body: Buffer.alloc(65537, 255), answer: '' },
    { code: 39, args: [s.out], answer: ids.join(':') },
    { code: 45, args: [s.out, ...ids], answer: '' },
  ]);
  const after = await stat(s.out, { bigint: true });
  for (const key of ['dev', 'ino', 'size', 'uid', 'gid', 'nlink', 'atimeNs', 'mtimeNs']) {
    assert.equal(after[key], before[key], key);
  }
  assert.deepEqual(await readFile(s.out), content);
});

test('file chown changes the group to a supplementary group and back',
  { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  await writeFile(s.out, 'kept');
  const before = await stat(s.out);
  const memberships = process.getgroups().filter(gid => gid < 4294967295);
  const restore = memberships.includes(before.gid) ? before.gid : process.getgid();
  const group = memberships.find(gid => gid !== restore);
  if (group === undefined) { t.skip('requires a distinct supplementary group'); return; }
  for (const gid of [group, restore]) {
    await slotScript([
      { code: 45, args: [s.out, String(before.uid), String(gid)], answer: '' },
      { code: 39, args: [s.out], answer: `${before.uid}:${gid}` },
    ]);
    const after = await stat(s.out);
    assert.equal(after.uid, before.uid);
    assert.equal(after.gid, gid);
    assert.equal(after.ino, before.ino);
  }
  assert.equal(await readFile(s.out, 'utf8'), 'kept');
});

test('file chown supports directories and special files and follows links without opening contents',
  { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  await writeFile(s.out, 'kept');
  const hard = join(s.path, 'hard');
  const live = join(s.path, 'live');
  const directory = join(s.path, 'directory');
  await fsPromises.link(s.out, hard);
  await symlink('stdout', live);
  await mkdir(directory);
  const fifo = privateFifo(join(s.path, 'fifo'));
  const linkBefore = await lstat(live, { bigint: true });
  const guards = ['open', 'writeFile', 'truncate', 'lchown'].map(name =>
    t.mock.method(fsPromises, name, () => assert.fail(`file chown called ${name}`)));
  const originalRead = fsPromises.readFile;
  const modulePath = new URL('../runtime/reactor.mjs', import.meta.url);
  guards.push(t.mock.method(fsPromises, 'readFile', (path, ...args) => {
    assert.ok(path instanceof URL && path.href === modulePath.href, 'file chown read file contents');
    return originalRead(path, ...args);
  }));
  syncBuiltinESMExports();
  t.after(() => { guards.forEach(guard => guard.mock.restore()); syncBuiltinESMExports(); });
  for (const path of [directory + '/', fifo, hard, live]) {
    const before = await stat(path, { bigint: true });
    await slotScript([{ code: 45, args: [path, String(before.uid), String(before.gid)], answer: '' }]);
    const after = await stat(path, { bigint: true });
    for (const key of ['dev', 'ino', 'size', 'uid', 'gid', 'nlink', 'atimeNs', 'mtimeNs']) {
      assert.equal(after[key], before[key], key);
    }
  }
  assert.equal((await stat(hard)).ino, (await stat(s.out)).ino);
  const linkAfter = await lstat(live, { bigint: true });
  for (const key of ['ino', 'uid', 'gid', 'size', 'mtimeNs', 'ctimeNs']) {
    assert.equal(linkAfter[key], linkBefore[key], key);
  }
  assert.equal(await readlink(live), 'stdout');
});

test('file chown preserves relative Unicode paths and native parent symlink resolution',
  { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const real = join(s.path, 'real');
  const alias = join(s.path, 'alias');
  await mkdir(join(real, 'nested'), { recursive: true });
  await symlink(join(real, 'nested'), alias);
  const actual = join(real, 'data');
  const unicode = join(s.path, 'héllo space');
  for (const path of [actual, unicode]) await writeFile(path, 'kept');
  const original = fsPromises.chown;
  const change = t.mock.method(fsPromises, 'chown', (...args) => original(...args));
  syncBuiltinESMExports();
  t.after(() => { change.mock.restore(); syncBuiltinESMExports(); });
  const paths = [relative(process.cwd(), unicode), alias + '//../data'];
  for (const [index, path] of paths.entries()) {
    const before = await stat([unicode, actual][index]);
    await slotScript([{ code: 45, args: [path, String(before.uid), String(before.gid)], answer: '' }]);
    assert.deepEqual(change.mock.calls[index].arguments, [path, before.uid, before.gid]);
  }
  assert.equal(change.mock.callCount(), paths.length);
  await absent(join(s.path, 'data'));
});

test('file chown reports native path errors and continues without creating missing entries',
  { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const missing = join(s.path, 'missing');
  const dangling = join(s.path, 'dangling');
  const loop = join(s.path, 'loop');
  await writeFile(s.out, 'kept');
  await symlink('missing', dangling);
  await symlink('loop', loop);
  const before = await stat(s.out);
  const ids = [String(before.uid), String(before.gid)];
  // Exercise the host binding's unsigned range without changing any ownership.
  for (const pair of [['0', '4294967294'], ['4294967294', '0'], ['2147483648', '2147483647']]) {
    await slotScript([{ code: 45, args: [missing, ...pair], status: 1, answer: /^ENOENT:/ }]);
  }
  for (const [path, answer] of [[missing, /^ENOENT:/], [join(missing, 'child'), /^ENOENT:/],
    [dangling, /^ENOENT:/], [join(s.out, 'child'), /^ENOTDIR:/],
    [s.out + '/', /^ENOTDIR:/], [loop, /^ELOOP:/], ['', /^ENOENT:/]]) {
    await slotScript([
      { code: 45, args: [path, ...ids], status: 1, answer },
      { code: 45, args: [s.out, ...ids], answer: '' },
    ]);
  }
  await absent(missing);
  assert.equal(await readlink(dangling), 'missing');
  assert.equal(await readlink(loop), 'loop');
  assert.equal(await readFile(s.out, 'utf8'), 'kept');
});

test('file chown rejects malformed IDs and argument counts before any host update', async t => {
  const change = t.mock.method(fsPromises, 'chown', async () => {});
  syncBuiltinESMExports();
  t.after(() => { change.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([[], ['path'], ['path', '1000'], ['path', '1000', '2000', 'surplus']]
    .map(args => ({ code: 45, args, status: 1,
      answer: `IO: OS request 45 expects 3 arguments, got ${args.length}` })));
  const invalid = ['', ' ', ' 1', '1 ', '1\n', '1\r', '1\r\n', '1\t', '1\u2028', '1\u2029',
    '-1', '-0', '+1', '01', '00', '1.0', '1.5', '-0.5', '1e2', '0x10', '0b10',
    'NaN', 'Infinity', '-Infinity', '１', '4294967295', '4294967296', '9007199254740991',
    '9007199254740993', '4294967294.1', '9'.repeat(400)];
  for (const value of invalid) {
    for (const args of [['path', value, '2000'], ['path', '1000', value]]) {
      await slotScript([{ code: 45, args, status: 1, answer: 'IO: invalid OS owner ID argument' }]);
    }
  }
  assert.equal(change.mock.callCount(), 0);
  await slotScript([{ code: 45, args: ['path', '1000', '2000'], answer: '' }]);
  assert.equal(change.mock.callCount(), 1);
});

test('file chown rejects undecodable bytes in each argument before chown', async t => {
  const change = t.mock.method(fsPromises, 'chown', async () => {});
  syncBuiltinESMExports();
  t.after(() => { change.mock.restore(); syncBuiltinESMExports(); });
  for (const [bytes, message] of [[Buffer.from('x\0y'), 'NUL in OS string argument'],
    [Buffer.from([255]), 'non-UTF-8 bytes in OS string argument']]) {
    for (let index = 0; index < 3; index += 1) {
      const args = ['path', '1000', '2000'];
      args[index] = bytes;
      await assert.rejects(slotScript([{ code: 45, args, answer: '' }]), { message });
    }
  }
  assert.equal(change.mock.callCount(), 0);
});

test('file chown forwards ordered numeric IDs and range endpoints in one call and ignores the body', async t => {
  const change = t.mock.method(fsPromises, 'chown', async () => {});
  syncBuiltinESMExports();
  t.after(() => { change.mock.restore(); syncBuiltinESMExports(); });
  const path = '../héllo//alias/../file';
  const pairs = [[0, 1], [1, 0], [1000, 2000], [2147483647, 2147483648],
    [4294967294, 0], [0, 4294967294]];
  await slotScript(pairs.map(([uid, gid]) => ({ code: 45,
    args: [path, String(uid), String(gid)], body: Buffer.alloc(65537, 255), answer: '' })));
  assert.equal(change.mock.callCount(), pairs.length);
  for (const [index, call] of change.mock.calls.entries()) {
    assert.deepEqual(call.arguments, [path, ...pairs[index]]);
  }
});

test('file chown forwards host errors and resumes a subsequent successful update', async t => {
  const failures = ['EACCES', 'EPERM', 'EROFS', 'EIO', 'ENOSYS', 'EINVAL', 'EOVERFLOW']
    .map(code => Object.assign(new Error('injected chown failure'), { code }));
  failures.push(new Error('generic failure'));
  const script = failures.map(error => ({ code: 45, args: ['path', '1000', '2000'],
    status: 1, answer: `${error.code ?? 'IO'}: ${error.message}` }));
  const change = t.mock.method(fsPromises, 'chown', async () => {
    const error = failures.shift();
    if (error) throw error;
  });
  syncBuiltinESMExports();
  t.after(() => { change.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([...script, { code: 45, args: ['path', '1000', '2000'], answer: '' }]);
  assert.equal(change.mock.callCount(), script.length + 1);
});

test('file lchown updates live, dangling and cyclic links without touching their targets',
  { skip: process.platform === 'win32', timeout: 10000 }, async t => {
  const s = await sandbox(t);
  const content = Buffer.from([0, 255, 65, 254, 10]);
  await writeFile(s.out, content);
  const targetBefore = await stat(s.out, { bigint: true });
  const follow = t.mock.method(fsPromises, 'chown', () => assert.fail('followed a final symlink'));
  syncBuiltinESMExports();
  t.after(() => { follow.mock.restore(); syncBuiltinESMExports(); });
  for (const [name, target] of [['live', 'stdout'], ['dangling', 'missing'], ['loop', 'loop']]) {
    const path = join(s.path, name);
    await slotScript([{ code: 25, args: [target, path], answer: '' }]);
    const before = await lstat(path, { bigint: true });
    await slotScript([
      { code: 46, args: [path, String(before.uid), String(process.getgid())],
        body: Buffer.alloc(65537, 255), answer: '' },
      { code: 23, args: [path], answer: 'symlink' },
      { code: 24, args: [path], answer: target },
    ]);
    const after = await lstat(path, { bigint: true });
    assert.equal(after.uid, before.uid);
    assert.equal(after.gid, BigInt(process.getgid()));
    for (const key of ['dev', 'ino', 'size', 'nlink', 'mtimeNs']) {
      assert.equal(after[key], before[key], key);
    }
    await slotScript([{ code: 19, args: [path], answer: '' }]);
    await assert.rejects(lstat(path), { code: 'ENOENT' });
  }
  const targetAfter = await stat(s.out, { bigint: true });
  for (const key of ['dev', 'ino', 'size', 'mode', 'uid', 'gid', 'nlink', 'atimeNs', 'mtimeNs', 'ctimeNs']) {
    assert.equal(targetAfter[key], targetBefore[key], key);
  }
  assert.deepEqual(await readFile(s.out), content);
  await absent(join(s.path, 'missing'));
  assert.equal(follow.mock.callCount(), 0);
});

test('file lchown changes a symlink group and restores a membership group',
  { skip: process.platform === 'win32', timeout: 10000 }, async t => {
  const s = await sandbox(t);
  const path = join(s.path, 'link');
  await writeFile(s.out, 'kept');
  await symlink('stdout', path);
  const before = await lstat(path);
  const targetBefore = await stat(s.out, { bigint: true });
  const memberships = [...new Set([process.getgid(), ...process.getgroups()])]
    .filter(gid => gid < 4294967295);
  const restore = memberships.includes(before.gid) ? before.gid : process.getgid();
  const group = memberships.find(gid => gid !== before.gid && gid !== restore);
  if (group === undefined) { t.skip('requires a distinct supplementary group'); return; }
  try {
    await slotScript([{ code: 46, args: [path, String(before.uid), String(group)], answer: '' }]);
    const after = await lstat(path);
    assert.equal(after.uid, before.uid);
    assert.equal(after.gid, group);
    assert.equal(after.ino, before.ino);
    const targetAfter = await stat(s.out, { bigint: true });
    for (const key of ['uid', 'gid', 'mode', 'ctimeNs', 'mtimeNs']) {
      assert.equal(targetAfter[key], targetBefore[key], key);
    }
  } finally {
    await slotScript([{ code: 46, args: [path, String(before.uid), String(restore)], answer: '' }]);
  }
  assert.equal((await lstat(path)).gid, restore);
  assert.equal(await readlink(path), 'stdout');
});

test('file lchown preserves literal relative paths and native parent symlink resolution',
  { skip: process.platform === 'win32', timeout: 10000 }, async t => {
  const s = await sandbox(t);
  const real = join(s.path, 'real');
  const alias = join(s.path, 'alias');
  await mkdir(join(real, 'nested'), { recursive: true });
  await symlink(join(real, 'nested'), alias);
  const actual = join(real, 'data');
  const unicode = join(s.path, 'héllo space');
  for (const path of [actual, unicode]) await symlink('missing', path);
  const original = fsPromises.lchown;
  const change = t.mock.method(fsPromises, 'lchown', (...args) => original(...args));
  syncBuiltinESMExports();
  t.after(() => { change.mock.restore(); syncBuiltinESMExports(); });
  for (const [index, path] of [relative(process.cwd(), unicode), alias + '//../data'].entries()) {
    const before = await lstat([unicode, actual][index]);
    await slotScript([{ code: 46, args: [path, String(before.uid), String(process.getgid())], answer: '' }]);
    assert.deepEqual(change.mock.calls[index].arguments, [path, before.uid, process.getgid()]);
    assert.equal((await lstat([unicode, actual][index])).gid, process.getgid());
  }
  assert.equal(change.mock.callCount(), 2);
  await assert.rejects(lstat(join(s.path, 'data')), { code: 'ENOENT' });
});

test('file lchown supports regular files, hard links and directories without opening contents',
  { skip: process.platform === 'win32', timeout: 10000 }, async t => {
  const s = await sandbox(t);
  await writeFile(s.out, 'kept');
  const hard = join(s.path, 'hard');
  const directory = join(s.path, 'directory');
  await fsPromises.link(s.out, hard);
  await mkdir(directory);
  const guards = ['open', 'writeFile', 'truncate', 'chown', 'realpath'].map(name =>
    t.mock.method(fsPromises, name, () => assert.fail(`file lchown called ${name}`)));
  const originalRead = fsPromises.readFile;
  const modulePath = new URL('../runtime/reactor.mjs', import.meta.url);
  guards.push(t.mock.method(fsPromises, 'readFile', (path, ...args) => {
    assert.ok(path instanceof URL && path.href === modulePath.href, 'file lchown read contents');
    return originalRead(path, ...args);
  }));
  syncBuiltinESMExports();
  t.after(() => { guards.forEach(guard => guard.mock.restore()); syncBuiltinESMExports(); });
  for (const path of [s.out, hard, directory + '/']) {
    const before = await lstat(path, { bigint: true });
    await slotScript([{ code: 46, args: [path, String(before.uid), String(process.getgid())], answer: '' }]);
    const after = await lstat(path, { bigint: true });
    assert.equal(after.gid, BigInt(process.getgid()));
    for (const key of ['dev', 'ino', 'size', 'uid', 'nlink', 'atimeNs', 'mtimeNs']) {
      assert.equal(after[key], before[key], key);
    }
  }
  assert.equal((await lstat(hard)).ino, (await lstat(s.out)).ino);
  assert.equal(await originalRead(s.out, 'utf8'), 'kept');
});

test('file lchown returns native path failures and continues without creating entries',
  { skip: process.platform === 'win32', timeout: 10000 }, async t => {
  const s = await sandbox(t);
  const missing = join(s.path, 'missing');
  const loop = join(s.path, 'loop');
  await writeFile(s.out, 'kept');
  await symlink('loop', loop);
  const ids = [String(process.getuid()), String(process.getgid())];
  for (const pair of [['0', '4294967294'], ['4294967294', '0'], ['2147483648', '2147483647']]) {
    await slotScript([{ code: 46, args: [missing, ...pair], status: 1, answer: /^ENOENT:/ }]);
  }
  for (const [path, answer] of [[missing, /^ENOENT:/], [join(missing, 'child'), /^ENOENT:/],
    [join(s.out, 'child'), /^ENOTDIR:/], [s.out + '/', /^ENOTDIR:/],
    [join(loop, 'child'), /^ELOOP:/], ['', /^ENOENT:/]]) {
    await slotScript([
      { code: 46, args: [path, ...ids], status: 1, answer },
      { code: 46, args: [loop, ...ids], answer: '' },
    ]);
  }
  await absent(missing);
  assert.equal(await readlink(loop), 'loop');
  assert.equal(await readFile(s.out, 'utf8'), 'kept');
});

test('file lchown validates both IDs and exact arity before any host update', async t => {
  const change = t.mock.method(fsPromises, 'lchown', async () => {});
  syncBuiltinESMExports();
  t.after(() => { change.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([[], ['path'], ['path', '1000'], ['path', '1000', '2000', 'surplus']]
    .map(args => ({ code: 46, args, status: 1,
      answer: `IO: OS request 46 expects 3 arguments, got ${args.length}` })));
  const invalid = ['', ' ', ' 1', '1 ', '1\n', '1\r', '1\r\n', '1\t', '1\u2028', '1\u2029',
    '-1', '-0', '+1', '01', '00', '1.0', '1.5', '-0.5', '1e2', '0x10', '0b10',
    'NaN', 'Infinity', '-Infinity', '１', '4294967295', '4294967296', '9007199254740991',
    '9007199254740993', '4294967294.1', '9'.repeat(400)];
  for (const value of invalid) {
    for (const args of [['path', value, '2000'], ['path', '1000', value]]) {
      await slotScript([{ code: 46, args, status: 1, answer: 'IO: invalid OS owner ID argument' }]);
    }
  }
  assert.equal(change.mock.callCount(), 0);
  await slotScript([{ code: 46, args: ['path', '1000', '2000'], answer: '' }]);
  assert.equal(change.mock.callCount(), 1);
});

test('file lchown rejects NUL and non-UTF-8 bytes before the host call', async t => {
  const change = t.mock.method(fsPromises, 'lchown', async () => {});
  syncBuiltinESMExports();
  t.after(() => { change.mock.restore(); syncBuiltinESMExports(); });
  for (const [bytes, message] of [[Buffer.from('x\0y'), 'NUL in OS string argument'],
    [Buffer.from([255]), 'non-UTF-8 bytes in OS string argument']]) {
    for (let index = 0; index < 3; index += 1) {
      const args = ['path', '1000', '2000'];
      args[index] = bytes;
      await assert.rejects(slotScript([{ code: 46, args, answer: '' }]), { message });
    }
  }
  assert.equal(change.mock.callCount(), 0);
});

test('file lchown forwards ordered unsigned IDs once and ignores the body', async t => {
  const change = t.mock.method(fsPromises, 'lchown', async () => {});
  syncBuiltinESMExports();
  t.after(() => { change.mock.restore(); syncBuiltinESMExports(); });
  const path = '../héllo//alias/../file';
  const pairs = [[0, 1], [1, 0], [1000, 2000], [2147483647, 2147483648],
    [4294967294, 0], [0, 4294967294]];
  await slotScript(pairs.map(([uid, gid]) => ({ code: 46,
    args: [path, String(uid), String(gid)], body: Buffer.alloc(65537, 255), answer: '' })));
  assert.equal(change.mock.callCount(), pairs.length);
  for (const [index, call] of change.mock.calls.entries()) {
    assert.deepEqual(call.arguments, [path, ...pairs[index]]);
  }
});

test('file lchown forwards host errors and resumes the next request', async t => {
  const failures = ['EACCES', 'EPERM', 'EROFS', 'EIO', 'ENOSYS', 'EINVAL', 'EOVERFLOW']
    .map(code => Object.assign(new Error('injected lchown failure'), { code }));
  failures.push(new Error('generic failure'));
  const script = failures.map(error => ({ code: 46, args: ['path', '1000', '2000'],
    status: 1, answer: `${error.code ?? 'IO'}: ${error.message}` }));
  const change = t.mock.method(fsPromises, 'lchown', async () => {
    const error = failures.shift();
    if (error) throw error;
  });
  syncBuiltinESMExports();
  t.after(() => { change.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([...script, { code: 46, args: ['path', '1000', '2000'], answer: '' }]);
  assert.equal(change.mock.callCount(), script.length + 1);
});

test('file mode changes permission bits without replacing the file or changing its bytes', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const content = Buffer.from([0, 255, 65, 254, 10]);
  await writeFile(s.out, content);
  const before = await lstat(s.out);
  try {
    for (const mode of ['0', '1', '7', '64', '00073', '384', '420', '493', '511', '416', '416']) {
      await slotScript([{ code: 31, args: [s.out, mode], body: Buffer.from([255, 0]), answer: '' }]);
      const after = await lstat(s.out);
      assert.equal(after.mode & 0o777, Number(mode));
      assert.deepEqual([after.dev, after.ino, after.size, after.nlink],
        [before.dev, before.ino, before.size, before.nlink]);
    }
  } finally { await fsPromises.chmod(s.out, 0o600); }
  assert.deepEqual(await readFile(s.out), content);
});

test('file mode changes directory permissions and composes with directory creation', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const directory = join(s.path, 'directory');
  const child = join(directory, 'child');
  await slotScript([{ code: 28, args: [directory], answer: '' }]);
  const before = await lstat(directory);
  try {
    for (const mode of ['0', '511', '448']) {
      await slotScript([{ code: 31, args: [directory + '/', mode], answer: '' }]);
      const after = await lstat(directory);
      assert.equal(after.mode & 0o777, Number(mode));
      assert.ok(after.isDirectory());
      assert.deepEqual([after.dev, after.ino], [before.dev, before.ino]);
    }
    await slotScript([{ code: 28, args: [child], answer: '' }]);
    assert.deepEqual(await readdir(directory), ['child']);
  } finally { await fsPromises.chmod(directory, 0o700); }
});

test('file mode makes a generated program executable through the process operation', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const program = join(s.path, 'program');
  await slotScript([
    { code: 3, args: [program], body: '#!/bin/sh\nexit 7\n', answer: '' },
    { code: 31, args: [program, '448'], answer: '' },
    { code: 4, args: [s.out, s.err, s.path, '5000', program], answer: /^7\x000\x000\x000\x00$/ },
  ]);
  assert.equal((await lstat(program)).mode & 0o777, 0o700);
  assert.deepEqual(await readFile(s.out), Buffer.alloc(0));
  assert.deepEqual(await readFile(s.err), Buffer.alloc(0));
});

test('file mode follows final symlinks and updates permissions shared by hard links', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const hard = join(s.path, 'hard');
  const live = join(s.path, 'live');
  await writeFile(s.out, 'kept');
  await fsPromises.link(s.out, hard);
  await symlink('stdout', live);
  const before = await lstat(s.out);
  const linkBefore = await lstat(live);
  for (const [path, mode] of [[hard, 0o640], [live, 0o750]]) {
    await slotScript([{ code: 31, args: [path, String(mode)], answer: '' }]);
    for (const name of [s.out, hard]) {
      const after = await lstat(name);
      assert.equal(after.mode & 0o777, mode);
      assert.deepEqual([after.dev, after.ino, after.nlink], [before.dev, before.ino, before.nlink]);
      assert.equal(await readFile(name, 'utf8'), 'kept');
    }
  }
  const linkAfter = await lstat(live);
  assert.ok(linkAfter.isSymbolicLink());
  assert.deepEqual([linkAfter.dev, linkAfter.ino, linkAfter.mode],
    [linkBefore.dev, linkBefore.ino, linkBefore.mode]);
  assert.equal(await readlink(live), 'stdout');
});

test('file mode preserves relative paths, parent symlinks and dot segments', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const real = join(s.path, 'real');
  const alias = join(s.path, 'alias');
  await mkdir(join(real, 'nested'), { recursive: true });
  await symlink(join(real, 'nested'), alias);
  const actual = join(real, 'data');
  const decoy = join(s.path, 'data');
  const unicode = join(s.path, 'héllo space');
  for (const path of [actual, decoy, unicode]) {
    await writeFile(path, 'kept');
    await fsPromises.chmod(path, 0o600);
  }
  await slotScript([
    { code: 31, args: [relative(process.cwd(), unicode), '416'], answer: '' },
    { code: 31, args: [alias + '//../data', '493'], answer: '' },
  ]);
  assert.equal((await lstat(unicode)).mode & 0o777, 0o640);
  assert.equal((await lstat(actual)).mode & 0o777, 0o755);
  assert.equal((await lstat(decoy)).mode & 0o777, 0o600);
  assert.equal(await readlink(alias), join(real, 'nested'));
});

test('file mode reports path failures without creating entries and continues', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const missing = join(s.path, 'missing');
  const dangling = join(s.path, 'dangling');
  const loop = join(s.path, 'loop');
  await writeFile(s.out, 'kept');
  await fsPromises.chmod(s.out, 0o600);
  await symlink('missing', dangling);
  await symlink('loop', loop);
  const requests = [[missing, /^ENOENT:/], [join(missing, 'child'), /^ENOENT:/],
    [dangling, /^ENOENT:/], [join(s.out, 'child'), /^ENOTDIR:/],
    [s.out + '/', /^ENOTDIR:/], [loop, /^ELOOP:/], ['', /^ENOENT:/]];
  await slotScript(requests.map(([path, answer]) => ({ code: 31, args: [path, '493'], status: 1, answer })));
  assert.equal((await lstat(s.out)).mode & 0o777, 0o600);
  await slotScript([
    { code: 31, args: [s.out, '416'], answer: '' },
    { code: 2, args: [s.out, '0', '8'], answer: 'kept' },
  ]);
  assert.equal((await lstat(s.out)).mode & 0o777, 0o640);
  await absent(missing);
  assert.equal(await readlink(dangling), 'missing');
  assert.equal(await readlink(loop), 'loop');
});

test('file mode rejects malformed modes, argument counts and OS strings before chmod', async t => {
  const change = t.mock.method(fsPromises, 'chmod', async () => {});
  syncBuiltinESMExports();
  t.after(() => { change.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([[], ['path'], ['path', '384', 'surplus']].map(args => ({ code: 31, args,
    status: 1, answer: `IO: OS request 31 expects 2 arguments, got ${args.length}` })));
  const invalid = ['', ' ', ' 1', '1 ', '1\n', '1\r', '1\r\n', '1\t', '1\u2028', '1\u2029',
    '-1', '-0', '+1', '1.5', '1e2', '0x10', '0o755', 'u+x', 'NaN', 'Infinity', '１',
    '9007199254740992', '9'.repeat(400)];
  await slotScript(invalid.map(mode => ({ code: 31, args: ['path', mode],
    status: 1, answer: 'IO: invalid OS numeric argument' })));
  await slotScript(['512', '644', '0755', '1024', '2048', '4095', '4294967296', '9007199254740991']
    .map(mode => ({ code: 31, args: ['path', mode], status: 1,
      answer: 'IO: file mode exceeds permission bit range' })));
  for (const [bytes, message] of [[Buffer.from('x\0y'), 'NUL in OS string argument'],
    [Buffer.from([255]), 'non-UTF-8 bytes in OS string argument']]) {
    for (const args of [[bytes, '384'], ['path', bytes]]) {
      await assert.rejects(slotScript([{ code: 31, args, answer: '' }]), { message });
    }
  }
  assert.equal(change.mock.callCount(), 0);
});

test('file mode forwards every ordinary mode as a decimal number and ignores its payload', async t => {
  const change = t.mock.method(fsPromises, 'chmod', async () => {});
  syncBuiltinESMExports();
  t.after(() => { change.mock.restore(); syncBuiltinESMExports(); });
  const path = '../héllo//alias/../file';
  const modes = Array.from({ length: 512 }, (_, mode) => [String(mode), mode]);
  modes.push(['000493', 493]);
  await slotScript(modes.map(([mode]) => ({ code: 31, args: [path, mode], answer: '' })));
  await slotScript([{ code: 31, args: [path, '384'], body: Buffer.alloc(65537, 255), answer: '' }]);
  assert.deepEqual(change.mock.calls.map(call => call.arguments),
    [...modes.map(([, mode]) => [path, mode]), [path, 384]]);
});

test('file mode forwards OS failures and resumes subsequent requests', async t => {
  const failures = ['EACCES', 'EPERM', 'EROFS', 'EIO'];
  const change = t.mock.method(fsPromises, 'chmod', async () => {
    const code = failures.shift();
    if (code) throw Object.assign(new Error('injected chmod failure'), { code });
  });
  syncBuiltinESMExports();
  t.after(() => { change.mock.restore(); syncBuiltinESMExports(); });
  const script = failures.map(code => ({ code: 31, args: ['path', '493'],
    status: 1, answer: `${code}: injected chmod failure` }));
  await slotScript([...script, { code: 31, args: ['path', '493'], answer: '' }]);
  assert.equal(change.mock.callCount(), 5);
});

test('file truncate shrinks, extends with zeros, repeats and composes with append and reads', async t => {
  const s = await sandbox(t);
  const bytes = Buffer.from([0, 255, 65, 254, 10]);
  await writeFile(s.out, bytes);
  await slotScript([
    { code: 30, args: [s.out, '3'], body: Buffer.from([255]), answer: '' },
    { code: 2, args: [s.out, '0', '8'], answer: bytes.subarray(0, 3) },
    { code: 30, args: [s.out, '3'], answer: '' },
    { code: 2, args: [s.out, '0', '8'], answer: bytes.subarray(0, 3) },
    { code: 30, args: [s.out, '65537'], answer: '' },
    { code: 5, args: [s.out], answer: '65537' },
    { code: 2, args: [s.out, '0', '3'], answer: bytes.subarray(0, 3) },
    { code: 2, args: [s.out, '3', '65534'], answer: Buffer.alloc(65534) },
    { code: 30, args: [s.out, '0'], answer: '' },
    { code: 5, args: [s.out], answer: '0' },
    { code: 2, args: [s.out, '0', '8'], answer: '' },
    { code: 29, args: [s.out], body: bytes, answer: '' },
    { code: 2, args: [s.out, '0', '8'], answer: bytes },
    { code: 19, args: [s.out], answer: '' },
  ]);
  await absent(s.out);
});

test('file truncate preserves identity, permissions, hard links and final symlinks', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const hard = join(s.path, 'hard');
  const live = join(s.path, 'live');
  await writeFile(s.out, Buffer.from([255, 0, 65, 254]));
  await fsPromises.chmod(s.out, 0o640);
  await fsPromises.link(s.out, hard);
  await symlink('stdout', live);
  const before = await lstat(s.out);
  const linkBefore = await lstat(live);
  await slotScript([{ code: 30, args: [hard, '2'], answer: '' }]);
  assert.deepEqual(await readFile(s.out), Buffer.from([255, 0]));
  await slotScript([{ code: 30, args: [live, '5'], answer: '' }]);
  for (const path of [s.out, hard]) {
    const after = await lstat(path);
    assert.deepEqual([after.dev, after.ino, after.mode, after.nlink],
      [before.dev, before.ino, before.mode, before.nlink]);
    assert.deepEqual(await readFile(path), Buffer.from([255, 0, 0, 0, 0]));
  }
  const linkAfter = await lstat(live);
  assert.ok(linkAfter.isSymbolicLink());
  assert.deepEqual([linkAfter.dev, linkAfter.ino], [linkBefore.dev, linkBefore.ino]);
  assert.equal(await readlink(live), 'stdout');
});

test('file truncate preserves relative paths, parent symlinks and dot segments', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const real = join(s.path, 'real');
  const alias = join(s.path, 'alias');
  await mkdir(join(real, 'nested'), { recursive: true });
  await symlink(join(real, 'nested'), alias);
  const actual = join(real, 'data');
  const decoy = join(s.path, 'data');
  const unicode = join(s.path, 'héllo space');
  await writeFile(actual, 'actual');
  await writeFile(decoy, 'decoy');
  await writeFile(unicode, Buffer.from([0, 255, 65]));
  await slotScript([
    { code: 30, args: [relative(process.cwd(), unicode), '2'], answer: '' },
    { code: 30, args: [alias + '//../data', '3'], answer: '' },
  ]);
  assert.deepEqual(await readFile(unicode), Buffer.from([0, 255]));
  assert.equal(await readFile(actual, 'utf8'), 'act');
  assert.equal(await readFile(decoy, 'utf8'), 'decoy');
  assert.equal(await readlink(alias), join(real, 'nested'));
});

test('file truncate reports path failures without creating entries and continues', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const missing = join(s.path, 'missing');
  const dangling = join(s.path, 'dangling');
  const loop = join(s.path, 'loop');
  await writeFile(s.out, 'kept');
  await symlink('missing', dangling);
  await symlink('loop', loop);
  const requests = [[missing, /^ENOENT:/], [join(missing, 'child'), /^ENOENT:/],
    [dangling, /^ENOENT:/], [s.path, /^EISDIR:/], [join(s.out, 'child'), /^ENOTDIR:/],
    [s.out + '/', /^ENOTDIR:/], [loop, /^ELOOP:/], ['', /^ENOENT:/]];
  await slotScript([
    ...requests.map(([path, answer]) => ({ code: 30, args: [path, '0'], status: 1, answer })),
    { code: 2, args: [s.out, '0', '8'], answer: 'kept' },
    { code: 30, args: [s.out, '2'], answer: '' },
  ]);
  await absent(missing);
  assert.equal(await readFile(s.out, 'utf8'), 'ke');
  assert.equal(await readlink(dangling), 'missing');
  assert.equal(await readlink(loop), 'loop');
});

test('file truncate rejects malformed lengths, argument counts and OS strings before filesystem access', async t => {
  const resize = t.mock.method(fsPromises, 'truncate', async () => {});
  syncBuiltinESMExports();
  t.after(() => { resize.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([[], ['path'], ['path', '0', 'surplus']].map(args => ({ code: 30, args,
    status: 1, answer: `IO: OS request 30 expects 2 arguments, got ${args.length}` })));
  const invalid = ['', ' ', ' 1', '1 ', '1\n', '1\r', '1\r\n', '1\t', '1\u2028', '1\u2029',
    '-1', '-0', '+1', '1.5', '1e2', '0x10', 'NaN', 'Infinity', '１', '9007199254740992', '9'.repeat(400)];
  await slotScript(invalid.map(length => ({ code: 30, args: ['path', length],
    status: 1, answer: 'IO: invalid OS numeric argument' })));
  for (const [bytes, message] of [[Buffer.from('x\0y'), 'NUL in OS string argument'],
    [Buffer.from([255]), 'non-UTF-8 bytes in OS string argument']]) {
    for (const args of [[bytes, '0'], ['path', bytes]]) {
      await assert.rejects(slotScript([{ code: 30, args, answer: '' }]), { message });
    }
  }
  assert.equal(resize.mock.callCount(), 0);
});

test('file truncate forwards exact safe lengths and ignores its binary payload', async t => {
  const resize = t.mock.method(fsPromises, 'truncate', async () => {});
  syncBuiltinESMExports();
  t.after(() => { resize.mock.restore(); syncBuiltinESMExports(); });
  const path = '../héllo//alias/../file';
  const lengths = [['0', 0], ['0007', 7], ['65537', 65537], ['1073741824', 1073741824],
    ['2147483648', 2147483648], ['4294967296', 4294967296], ['9007199254740991', 9007199254740991]];
  await slotScript(lengths.map(([length]) => ({ code: 30, args: [path, length],
    body: Buffer.alloc(65537, 255), answer: '' })));
  assert.deepEqual(resize.mock.calls.map(call => call.arguments), lengths.map(([, length]) => [path, length]));
});

test('file truncate forwards OS failures and resumes subsequent requests', async t => {
  const failures = ['EACCES', 'ENOSPC', 'EFBIG', 'EROFS', 'EIO'];
  const resize = t.mock.method(fsPromises, 'truncate', async () => {
    const code = failures.shift();
    if (code) throw Object.assign(new Error('injected truncate failure'), { code });
  });
  syncBuiltinESMExports();
  t.after(() => { resize.mock.restore(); syncBuiltinESMExports(); });
  const script = failures.map(code => ({ code: 30, args: ['path', '3'],
    status: 1, answer: `${code}: injected truncate failure` }));
  await slotScript([...script, { code: 30, args: ['path', '3'], answer: '' }]);
  assert.equal(resize.mock.callCount(), 6);
});

test('file append preserves binary contents across empty and maximum-size chunks', async t => {
  const s = await sandbox(t);
  const prefix = Buffer.from([0, 255, 65]);
  const chunk = Buffer.from(Array.from({ length: 65536 }, (_, index) => index % 256));
  await writeFile(s.out, prefix);
  await slotScript([
    { code: 29, args: [s.out], body: Buffer.alloc(0), answer: '' },
    { code: 29, args: [s.out], body: chunk, answer: '' },
    { code: 29, args: [s.out], body: prefix, answer: '' },
    { code: 5, args: [s.out], answer: String(prefix.length * 2 + chunk.length) },
    { code: 2, args: [s.out, String(prefix.length), '65536'], answer: chunk },
  ]);
  assert.deepEqual(await readFile(s.out), Buffer.concat([prefix, chunk, prefix]));
  await slotScript([{ code: 19, args: [s.out], answer: '' }]);
  await absent(s.out);
});

test('file append creates private files subject to umask even for empty payloads', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const originalMask = process.umask();
  for (const mask of [0, 0o277]) {
    for (const body of [Buffer.alloc(0), Buffer.from([0, 255])]) {
      const path = join(s.path, `private-${mask}-${body.length}`);
      try {
        process.umask(mask);
        await slotScript([{ code: 29, args: [path], body, answer: '' }]);
      } finally { process.umask(originalMask); }
      const info = await lstat(path);
      assert.ok(info.isFile());
      assert.equal(info.mode & 0o777, 0o600 & ~mask);
      assert.deepEqual(await readFile(path), body);
    }
  }
});

test('file append preserves existing identity, permissions, hard links and symlinks', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const hard = join(s.path, 'hard');
  const live = join(s.path, 'live');
  const dangling = join(s.path, 'dangling');
  const prefix = Buffer.from([254, 0]);
  const chunk = Buffer.from([255, 65]);
  await writeFile(s.out, prefix);
  await fsPromises.chmod(s.out, 0o640);
  await fsPromises.link(s.out, hard);
  await symlink('stdout', live);
  await symlink('new-target', dangling);
  const before = await lstat(s.out);
  const liveBefore = await lstat(live);
  const danglingBefore = await lstat(dangling);
  await slotScript([s.out, hard, live, dangling].map(path => ({ code: 29, args: [path], body: chunk, answer: '' })));
  const expected = Buffer.concat([prefix, chunk, chunk, chunk]);
  for (const path of [s.out, hard]) {
    const after = await lstat(path);
    assert.deepEqual([after.dev, after.ino, after.mode], [before.dev, before.ino, before.mode]);
    assert.deepEqual(await readFile(path), expected);
  }
  for (const [path, target, previous] of [[live, 'stdout', liveBefore], [dangling, 'new-target', danglingBefore]]) {
    const after = await lstat(path);
    assert.ok(after.isSymbolicLink());
    assert.deepEqual([after.dev, after.ino], [previous.dev, previous.ino]);
    assert.equal(await readlink(path), target);
  }
  assert.deepEqual(await readFile(join(s.path, 'new-target')), chunk);
  assert.equal((await stat(dangling)).mode & 0o777, 0o600 & ~process.umask());
});

test('file append preserves relative paths, parent symlinks and dot segments', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const real = join(s.path, 'real');
  const alias = join(s.path, 'alias');
  await mkdir(join(real, 'nested'), { recursive: true });
  await symlink(join(real, 'nested'), alias);
  const actual = join(real, 'data');
  const decoy = join(s.path, 'data');
  await writeFile(actual, 'actual');
  await writeFile(decoy, 'decoy');
  const relativePath = relative(process.cwd(), join(s.path, 'héllo space'));
  await slotScript([
    { code: 29, args: [relativePath], body: Buffer.from([0, 255]), answer: '' },
    { code: 29, args: [alias + '/../data'], body: Buffer.from(' appended'), answer: '' },
  ]);
  assert.deepEqual(await readFile(join(s.path, 'héllo space')), Buffer.from([0, 255]));
  assert.equal(await readFile(actual, 'utf8'), 'actual appended');
  assert.equal(await readFile(decoy, 'utf8'), 'decoy');
  assert.equal(await readlink(alias), join(real, 'nested'));
});

test('file append reports path errors without creating parents and continues', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const missing = join(s.path, 'missing');
  const loop = join(s.path, 'loop');
  await writeFile(s.out, 'kept');
  await symlink('loop', loop);
  const requests = [
    [s.path, /^EISDIR:/],
    [join(missing, 'child'), /^ENOENT:/],
    [join(s.out, 'child'), /^ENOTDIR:/],
    [s.out + '/', /^ENOTDIR:/],
    [loop, /^ELOOP:/],
    ['', /^ENOENT:/],
  ];
  await slotScript([
    ...requests.map(([path, answer]) => ({ code: 29, args: [path], body: Buffer.from('unwritten'), status: 1, answer })),
    { code: 29, args: [s.marker], body: Buffer.from('continued'), answer: '' },
  ]);
  await absent(missing);
  assert.equal(await readFile(s.out, 'utf8'), 'kept');
  assert.equal(await readFile(s.marker, 'utf8'), 'continued');
  assert.equal(await readlink(loop), 'loop');
});

test('file append rejects oversized payloads before creating or changing files', async t => {
  const s = await sandbox(t);
  await writeFile(s.out, 'kept');
  await slotScript([
    ...[s.out, s.marker].map(path => ({ code: 29, args: [path], body: Buffer.alloc(65537, 255),
      status: 1, answer: 'IO: append exceeds maximum OS chunk size' })),
    { code: 29, args: [s.out], body: Buffer.from([0, 255]), answer: '' },
  ]);
  assert.deepEqual(await readFile(s.out), Buffer.concat([Buffer.from('kept'), Buffer.from([0, 255])]));
  await absent(s.marker);
});

test('file append rejects malformed requests before filesystem access', async t => {
  const append = t.mock.method(fsPromises, 'appendFile', async () => {});
  syncBuiltinESMExports();
  t.after(() => { append.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([[], ['path', 'surplus']].map(args => ({
    code: 29, args, body: Buffer.from([255]), status: 1,
    answer: `IO: OS request 29 expects 1 argument, got ${args.length}`,
  })));
  for (const [invalid, message] of [[Buffer.from('path\0suffix'), 'NUL in OS string argument'],
    [Buffer.from([255]), 'non-UTF-8 bytes in OS string argument']]) {
    await assert.rejects(slotScript([{ code: 29, args: [invalid], answer: '' }]), { message });
  }
  await slotScript([{ code: 29, args: ['path'], body: Buffer.alloc(65537), status: 1,
    answer: 'IO: append exceeds maximum OS chunk size' }]);
  assert.equal(append.mock.callCount(), 0);
  const path = '../héllo//alias/../file';
  const body = Buffer.from([0, 255, 65]);
  await slotScript([{ code: 29, args: [path], body, answer: '' }]);
  assert.equal(append.mock.callCount(), 1);
  assert.deepEqual(append.mock.calls[0].arguments, [path, body, { flag: 'a', mode: 0o600 }]);
});

test('file append forwards OS failures and resumes subsequent requests', async t => {
  const failures = ['EACCES', 'ENOSPC', 'EROFS', 'EIO'];
  const append = t.mock.method(fsPromises, 'appendFile', async () => {
    const code = failures.shift();
    if (code) throw Object.assign(new Error('injected append failure'), { code });
  });
  syncBuiltinESMExports();
  t.after(() => { append.mock.restore(); syncBuiltinESMExports(); });
  const script = failures.map(code => ({ code: 29, args: ['path'], body: Buffer.from([0, 255]),
    status: 1, answer: `${code}: injected append failure` }));
  await slotScript([...script, { code: 29, args: ['path'], answer: '' }]);
  assert.equal(append.mock.callCount(), 5);
});

test('directory creation uses private permissions subject to umask', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const originalMask = process.umask();
  for (const mask of [0, 0o277]) {
    const path = join(s.path, `private-${mask}`);
    try {
      process.umask(mask);
      await slotScript([{ code: 28, args: [path], body: Buffer.from([0, 255]), answer: '' }]);
    } finally { process.umask(originalMask); }
    const info = await lstat(path);
    assert.ok(info.isDirectory());
    assert.equal(info.mode & 0o777, 0o700 & ~mask);
    assert.deepEqual(await readdir(path), []);
  }
});

test('directory creation composes with nested creation, files, listing and cleanup', async t => {
  const s = await sandbox(t);
  const parent = join(s.path, 'parent');
  const child = join(parent, 'child');
  const file = join(child, 'data');
  await slotScript([
    { code: 28, args: [parent], answer: '' },
    { code: 28, args: [child], answer: '' },
    { code: 23, args: [child], answer: 'directory' },
    { code: 22, args: [child], answer: '' },
    { code: 3, args: [file], body: Buffer.from([0, 255, 65]), answer: '' },
    { code: 22, args: [parent], answer: Buffer.from('child\0') },
    { code: 22, args: [child], answer: Buffer.from('data\0') },
    { code: 2, args: [file, '0', '3'], answer: Buffer.from([0, 255, 65]) },
    { code: 19, args: [file], answer: '' },
    { code: 20, args: [child], answer: '' },
    { code: 20, args: [parent], answer: '' },
  ]);
  await absent(parent);
  assert.deepEqual(await readdir(s.path), []);
});

test('directory creation preserves relative paths, parent symlinks and dot segments', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const real = join(s.path, 'real');
  await mkdir(join(real, 'nested'), { recursive: true });
  const alias = join(s.path, 'alias');
  await symlink(join(real, 'nested'), alias);
  const relativePath = relative(process.cwd(), join(s.path, 'héllo space'));
  await slotScript([
    { code: 28, args: [relativePath + '//'], answer: '' },
    { code: 28, args: [alias + '/../created'], answer: '' },
  ]);
  assert.ok((await lstat(join(s.path, 'héllo space'))).isDirectory());
  assert.ok((await lstat(join(real, 'created'))).isDirectory());
  await absent(join(s.path, 'created'));
  assert.equal(await readlink(alias), join(real, 'nested'));
});

test('directory creation refuses existing entries and preserves their identity and contents', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const directory = join(s.path, 'existing');
  const live = join(s.path, 'live');
  const dangling = join(s.path, 'dangling');
  await mkdir(directory, { mode: 0o750 });
  await writeFile(join(directory, 'kept'), 'contents');
  await writeFile(s.out, 'file contents');
  await symlink('existing', live);
  await symlink('missing', dangling);
  for (const path of [directory, s.out, live, dangling, directory + '/.', directory + '/']) {
    const before = await lstat(path);
    await slotScript([{ code: 28, args: [path], status: 1, answer: /^EEXIST:/ }]);
    const after = await lstat(path);
    assert.deepEqual([after.dev, after.ino, after.mode], [before.dev, before.ino, before.mode]);
  }
  assert.equal(await readFile(join(directory, 'kept'), 'utf8'), 'contents');
  assert.equal(await readFile(s.out, 'utf8'), 'file contents');
  assert.equal(await readlink(live), 'existing');
  assert.equal(await readlink(dangling), 'missing');
  await absent(join(s.path, 'missing'));
});

test('directory creation reports path errors without creating parents and continues', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const missing = join(s.path, 'missing');
  const loop = join(s.path, 'loop');
  await writeFile(s.out, 'kept');
  await symlink('loop', loop);
  const requests = [
    [join(missing, 'child'), /^ENOENT:/],
    [join(s.out, 'child'), /^ENOTDIR:/],
    [join(loop, 'child'), /^ELOOP:/],
    ['', /^ENOENT:/],
  ];
  await slotScript([
    ...requests.map(([path, answer]) => ({ code: 28, args: [path], status: 1, answer })),
    { code: 28, args: [s.marker], answer: '' },
  ]);
  await absent(missing);
  assert.ok((await lstat(s.marker)).isDirectory());
  assert.equal(await readFile(s.out, 'utf8'), 'kept');
  assert.equal(await readlink(loop), 'loop');
});

test('directory creation rejects malformed requests before filesystem access', async t => {
  const create = t.mock.method(fsPromises, 'mkdir', async () => {});
  syncBuiltinESMExports();
  t.after(() => { create.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([[], ['path', 'surplus']].map(args => ({
    code: 28, args, status: 1, answer: `IO: OS request 28 expects 1 argument, got ${args.length}`,
  })));
  for (const [invalid, message] of [[Buffer.from('path\0suffix'), 'NUL in OS string argument'],
    [Buffer.from([255]), 'non-UTF-8 bytes in OS string argument']]) {
    await assert.rejects(slotScript([{ code: 28, args: [invalid], answer: '' }]), { message });
  }
  assert.equal(create.mock.callCount(), 0);
  const path = '../héllo//alias/../directory/';
  await slotScript([{ code: 28, args: [path], body: Buffer.from([0, 255]), answer: '' }]);
  assert.equal(create.mock.callCount(), 1);
  assert.deepEqual(create.mock.calls[0].arguments, [path, { mode: 0o700 }]);
});

test('directory creation forwards OS failures and resumes subsequent requests', async t => {
  const failures = ['EACCES', 'ENOSPC', 'EROFS', 'EIO'];
  const create = t.mock.method(fsPromises, 'mkdir', async () => {
    const code = failures.shift();
    if (code) throw Object.assign(new Error('injected directory failure'), { code });
  });
  syncBuiltinESMExports();
  t.after(() => { create.mock.restore(); syncBuiltinESMExports(); });
  const script = failures.map(code => ({ code: 28, args: ['path'], status: 1,
    answer: `${code}: injected directory failure` }));
  await slotScript([...script, { code: 28, args: ['path'], answer: '' }]);
  assert.equal(create.mock.callCount(), 5);
});

test('file copy preserves empty and large binary contents with independent file identities', async t => {
  const s = await sandbox(t);
  for (const size of [0, 65536, 131077]) {
    const source = join(s.path, `source-${size}`);
    const destination = join(s.path, `copy-${size}`);
    const bytes = Buffer.from(Array.from({ length: size }, (_, index) => index % 256));
    await writeFile(source, bytes);
    const original = await lstat(source);
    await slotScript([{ code: 27, args: [source, destination], body: Buffer.from([0, 255]), answer: '' }]);
    const copied = await lstat(destination);
    assert.ok(copied.isFile());
    assert.notDeepEqual([copied.dev, copied.ino], [original.dev, original.ino]);
    assert.equal((await lstat(source)).nlink, original.nlink);
    assert.deepEqual(await readFile(source), bytes);
    assert.deepEqual(await readFile(destination), bytes);
    await writeFile(source, 'source update');
    assert.deepEqual(await readFile(destination), bytes);
    await writeFile(destination, 'copy update');
    assert.equal(await readFile(source, 'utf8'), 'source update');
    await slotScript([
      { code: 19, args: [source], answer: '' },
      { code: 2, args: [destination, '0', '32'], answer: 'copy update' },
    ]);
    await absent(source);
  }
});

test('file copy composes with atomic replacement, size, read and cleanup', async t => {
  const s = await sandbox(t);
  await slotScript([
    { code: 3, args: [s.out], body: 'original', answer: '' },
    { code: 27, args: [s.out, s.marker], answer: '' },
    { code: 5, args: [s.marker], answer: '8' },
    { code: 3, args: [s.out], body: 'replacement', answer: '' },
    { code: 2, args: [s.marker, '0', '32'], answer: 'original' },
    { code: 19, args: [s.marker], answer: '' },
    { code: 2, args: [s.out, '0', '32'], answer: 'replacement' },
  ]);
  await absent(s.marker);
});

test('file copy follows source symlinks and preserves OS path resolution and relative names', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const actual = join(s.path, 'actual');
  const nested = join(actual, 'nested');
  const alias = join(s.path, 'alias');
  await mkdir(nested, { recursive: true });
  await symlink(nested, alias);
  await writeFile(join(actual, 'source'), 'correct');
  await writeFile(join(s.path, 'source'), 'decoy');
  const sourceLink = join(actual, 'source-link');
  await symlink('source', sourceLink);
  const relativeCopy = join(nested, 'héllo world\nfile');
  await slotScript([
    { code: 27, args: [alias + '/../source-link', alias + '/../created'], answer: '' },
    { code: 27, args: [relative(process.cwd(), sourceLink), relative(process.cwd(), relativeCopy)], answer: '' },
  ]);
  for (const path of [join(actual, 'created'), relativeCopy]) {
    const info = await lstat(path);
    assert.ok(info.isFile());
    assert.notEqual(info.ino, (await lstat(join(actual, 'source'))).ino);
    assert.equal(await readFile(path, 'utf8'), 'correct');
  }
  await absent(join(s.path, 'created'));
  assert.equal(await readFile(join(s.path, 'source'), 'utf8'), 'decoy');
  assert.equal(await readlink(sourceLink), 'source');
  assert.equal(await readlink(alias), nested);
});

test('file copy refuses existing destinations including symlinks and the source itself', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const directory = join(s.path, 'directory');
  const link = join(s.path, 'link');
  const dangling = join(s.path, 'dangling');
  await writeFile(s.out, 'source');
  await writeFile(s.err, 'destination');
  await mkdir(directory);
  await symlink('stderr', link);
  await symlink('absent', dangling);
  const paths = [s.out, s.err, directory, link, dangling];
  const identities = await Promise.all(paths.map(path => lstat(path)));
  await slotScript(paths.map(path => ({ code: 27, args: [s.out, path], status: 1, answer: /^EEXIST:/ })));
  assert.deepEqual(await Promise.all(paths.map(async path => (await lstat(path)).ino)), identities.map(info => info.ino));
  assert.equal(await readFile(s.out, 'utf8'), 'source');
  assert.equal(await readFile(s.err, 'utf8'), 'destination');
  assert.deepEqual(await readdir(directory), []);
  assert.equal(await readlink(link), 'stderr');
  assert.equal(await readlink(dangling), 'absent');
  await absent(join(s.path, 'absent'));
});

test('file copy reports path errors without creating parents and continues', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const directory = join(s.path, 'directory');
  const missing = join(s.path, 'missing');
  const dangling = join(s.path, 'dangling');
  const loop = join(s.path, 'loop');
  await writeFile(s.out, 'kept');
  await mkdir(directory);
  await symlink('missing', dangling);
  await symlink('loop', loop);
  const rejected = [
    [missing, s.marker, /^ENOENT:/], [s.out, join(missing, 'child'), /^ENOENT:/],
    [directory, s.marker, /^(EISDIR|EPERM|EACCES|ENOTSUP):/],
    [dangling, s.marker, /^ENOENT:/], [loop, s.marker, /^ELOOP:/],
    [s.out, join(s.out, 'child'), /^ENOTDIR:/], [join(s.out, 'child'), s.marker, /^ENOTDIR:/],
    [s.out, join(loop, 'child'), /^ELOOP:/],
    ['', s.marker, /^ENOENT:/], [s.out, '', /^ENOENT:/],
    [s.out + '/', s.marker, /^ENOTDIR:/], [s.out, s.marker + '/', /^(ENOENT|ENOTDIR):/],
  ];
  await slotScript([
    ...rejected.map(([source, destination, answer]) => ({ code: 27, args: [source, destination], status: 1, answer })),
    { code: 27, args: [s.out, s.err], answer: '' },
    { code: 2, args: [s.err, '0', '4'], answer: 'kept' },
  ]);
  await absent(s.marker);
  await absent(missing);
  assert.deepEqual(await readdir(directory), []);
  assert.equal(await readlink(dangling), 'missing');
  assert.equal(await readlink(loop), 'loop');
  assert.equal(await readFile(s.out, 'utf8'), 'kept');
});

test('file copy rejects malformed requests before filesystem access', async t => {
  const copy = t.mock.method(fsPromises, 'copyFile', async () => {});
  syncBuiltinESMExports();
  t.after(() => { copy.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([[], ['source'], ['source', 'destination', 'surplus']].map(args => ({
    code: 27, args, status: 1, answer: `IO: OS request 27 expects 2 arguments, got ${args.length}`,
  })));
  for (const [invalid, message] of [[Buffer.from('path\0suffix'), 'NUL in OS string argument'],
    [Buffer.from([255]), 'non-UTF-8 bytes in OS string argument']]) {
    for (const args of [[invalid, 'destination'], ['source', invalid]]) {
      await assert.rejects(slotScript([{ code: 27, args, answer: '' }]), { message });
    }
  }
  assert.equal(copy.mock.callCount(), 0);
  const args = ['../héllo//source', './alias/../destination'];
  await slotScript([{ code: 27, args, body: Buffer.from([0, 255]), answer: '' }]);
  assert.equal(copy.mock.callCount(), 1);
  assert.deepEqual(copy.mock.calls[0].arguments, [...args, fsConstants.COPYFILE_EXCL]);
});

test('file copy forwards OS failures and resumes subsequent requests', async t => {
  const failures = ['ENOSPC', 'EIO', 'EACCES'];
  const copy = t.mock.method(fsPromises, 'copyFile', async () => {
    const code = failures.shift();
    if (code) throw Object.assign(new Error('injected copy failure'), { code });
  });
  syncBuiltinESMExports();
  t.after(() => { copy.mock.restore(); syncBuiltinESMExports(); });
  const script = failures.map(code => ({ code: 27, args: ['source', 'destination'], status: 1,
    answer: `${code}: injected copy failure` }));
  await slotScript([...script, { code: 27, args: ['source', 'destination'], answer: '' }]);
  assert.equal(copy.mock.callCount(), 4);
});

test('hard-link creation shares file identity and contents and survives unlinking either name', async t => {
  const s = await sandbox(t);
  const bytes = Buffer.from([0, 255, 128, 10, 65]);
  await writeFile(s.out, bytes);
  const original = await lstat(s.out);
  await slotScript([{ code: 26, args: [s.out, s.marker], body: Buffer.from('ignored'), answer: '' }]);
  const linked = await lstat(s.marker);
  assert.ok(linked.isFile());
  assert.deepEqual([linked.dev, linked.ino], [original.dev, original.ino]);
  assert.equal(linked.nlink, original.nlink + 1);
  assert.deepEqual(await readFile(s.out), bytes);
  assert.deepEqual(await readFile(s.marker), bytes);
  await writeFile(s.marker, 'shared');
  assert.equal(await readFile(s.out, 'utf8'), 'shared');
  await slotScript([
    { code: 19, args: [s.out], answer: '' },
    { code: 2, args: [s.marker, '0', '6'], answer: 'shared' },
    { code: 26, args: [s.marker, s.err], answer: '' },
    { code: 19, args: [s.err], answer: '' },
    { code: 5, args: [s.marker], answer: '6' },
  ]);
  await absent(s.out);
  await absent(s.err);
  assert.equal((await lstat(s.marker)).nlink, original.nlink);
  assert.equal(await readFile(s.marker, 'utf8'), 'shared');
});

test('hard-link creation retains old contents when atomic write replaces one name', async t => {
  const s = await sandbox(t);
  await slotScript([
    { code: 3, args: [s.out], body: 'original', answer: '' },
    { code: 26, args: [s.out, s.marker], answer: '' },
    { code: 3, args: [s.out], body: 'replacement', answer: '' },
    { code: 2, args: [s.out, '0', '32'], answer: 'replacement' },
    { code: 2, args: [s.marker, '0', '32'], answer: 'original' },
  ]);
  assert.notEqual((await lstat(s.out)).ino, (await lstat(s.marker)).ino);
});

test('hard-link creation preserves OS resolution for both paths and accepts relative names', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const actual = join(s.path, 'actual');
  const nested = join(actual, 'nested');
  const alias = join(s.path, 'alias');
  await mkdir(nested, { recursive: true });
  await symlink(nested, alias);
  await writeFile(join(actual, 'source'), 'correct');
  await writeFile(join(s.path, 'source'), 'decoy');
  const relativeLink = join(nested, 'héllo world\nfile');
  await slotScript([
    { code: 26, args: [alias + '/../source', alias + '/../created'], answer: '' },
    { code: 2, args: [join(actual, 'created'), '0', '7'], answer: 'correct' },
    { code: 26, args: [relative(process.cwd(), join(actual, 'created')), relative(process.cwd(), relativeLink)], answer: '' },
  ]);
  const original = await lstat(join(actual, 'source'));
  for (const path of [join(actual, 'created'), relativeLink]) {
    const info = await lstat(path);
    assert.deepEqual([info.dev, info.ino], [original.dev, original.ino]);
  }
  await absent(join(s.path, 'created'));
  assert.equal(await readFile(join(s.path, 'source'), 'utf8'), 'decoy');
  assert.equal(await readlink(alias), nested);
});

test('hard-link creation refuses existing destinations and preserves their identities', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const directory = join(s.path, 'directory');
  const link = join(s.path, 'link');
  const dangling = join(s.path, 'dangling');
  await writeFile(s.out, 'source');
  await writeFile(s.err, 'destination');
  await mkdir(directory);
  await symlink('stderr', link);
  await symlink('absent', dangling);
  const paths = [s.out, s.err, directory, link, dangling];
  const identities = await Promise.all(paths.map(path => lstat(path)));
  await slotScript(paths.map(path => ({ code: 26, args: [s.out, path], status: 1, answer: /^EEXIST:/ })));
  assert.deepEqual(await Promise.all(paths.map(async path => (await lstat(path)).ino)), identities.map(info => info.ino));
  assert.equal(await readFile(s.out, 'utf8'), 'source');
  assert.equal(await readFile(s.err, 'utf8'), 'destination');
  assert.deepEqual(await readdir(directory), []);
  assert.equal(await readlink(link), 'stderr');
  assert.equal(await readlink(dangling), 'absent');
  await absent(join(s.path, 'absent'));
});

test('hard-link creation reports path errors without creating parents and continues', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const directory = join(s.path, 'directory');
  const missing = join(s.path, 'missing');
  const loop = join(s.path, 'loop');
  await writeFile(s.out, 'kept');
  await mkdir(directory);
  await symlink('loop', loop);
  const rejected = [
    [missing, s.marker, /^ENOENT:/], [s.out, join(missing, 'child'), /^ENOENT:/],
    [directory, s.marker, /^(EPERM|EACCES|EISDIR):/],
    [s.out, join(s.out, 'child'), /^ENOTDIR:/], [join(s.out, 'child'), s.marker, /^ENOTDIR:/],
    [s.out, join(loop, 'child'), /^ELOOP:/], [join(loop, 'child'), s.marker, /^ELOOP:/],
    ['', s.marker, /^ENOENT:/], [s.out, '', /^ENOENT:/],
    [s.out + '/', s.marker, /^ENOTDIR:/], [s.out, s.marker + '/', /^(ENOENT|ENOTDIR):/],
  ];
  await slotScript(rejected.map(([source, destination, answer]) => ({ code: 26, args: [source, destination], status: 1, answer })));
  await absent(s.marker);
  await absent(missing);
  assert.deepEqual(await readdir(directory), []);
  assert.equal(await readlink(loop), 'loop');
  await slotScript([
    { code: 26, args: [s.out, s.marker], answer: '' },
    { code: 2, args: [s.marker, '0', '4'], answer: 'kept' },
  ]);
});

test('hard-link creation rejects malformed requests before filesystem access', async t => {
  const create = t.mock.method(fsPromises, 'link', async () => {});
  syncBuiltinESMExports();
  t.after(() => { create.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([[], ['source'], ['source', 'destination', 'surplus']].map(args => ({
    code: 26, args, status: 1, answer: `IO: OS request 26 expects 2 arguments, got ${args.length}`,
  })));
  for (const [invalid, message] of [[Buffer.from('path\0suffix'), 'NUL in OS string argument'],
    [Buffer.from([255]), 'non-UTF-8 bytes in OS string argument']]) {
    for (const args of [[invalid, 'destination'], ['source', invalid]]) {
      await assert.rejects(slotScript([{ code: 26, args, answer: '' }]), { message });
    }
  }
  assert.equal(create.mock.callCount(), 0);
  const args = ['../héllo//source', './alias/../destination'];
  await slotScript([{ code: 26, args, body: Buffer.from([0, 255]), answer: '' }]);
  assert.equal(create.mock.callCount(), 1);
  assert.deepEqual(create.mock.calls[0].arguments, args);
});

test('hard-link creation returns OS failures without copy fallback and resumes subsequent requests', async t => {
  const failures = ['EXDEV', 'EPERM', 'EMLINK'];
  const create = t.mock.method(fsPromises, 'link', async () => {
    const code = failures.shift();
    if (code) throw Object.assign(new Error('injected link failure'), { code });
  });
  syncBuiltinESMExports();
  t.after(() => { create.mock.restore(); syncBuiltinESMExports(); });
  const script = failures.map(code => ({ code: 26, args: ['source', 'destination'], status: 1,
    answer: `${code}: injected link failure` }));
  await slotScript([...script, { code: 26, args: ['source', 'destination'], answer: '' }]);
  assert.equal(create.mock.callCount(), 4);
});

test('symlink creation preserves literal targets including dangling and cyclic links', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  await writeFile(s.out, 'kept');
  await mkdir(join(s.path, 'directory'));
  const targets = [s.out, 'stdout', 'directory', 'missing/../dangling', './directory//../stdout',
    'héllo world\n', 'created-0', 'created-7'];
  await slotScript(targets.flatMap((target, index) => {
    const path = join(s.path, `created-${index}`);
    return [
      { code: 25, args: [target, path], body: Buffer.from([0, 255, 128]), answer: '' },
      { code: 24, args: [path], answer: Buffer.from(target) },
      { code: 23, args: [path], answer: 'symlink' },
    ];
  }));
  assert.equal(await readFile(s.out, 'utf8'), 'kept');
  assert.deepEqual(await readdir(join(s.path, 'directory')), []);
  for (const [index, target] of targets.entries()) {
    assert.deepEqual(await readlink(join(s.path, `created-${index}`), { encoding: 'buffer' }), Buffer.from(target));
  }
});

test('symlink creation preserves OS resolution of parent components and relative destinations', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const actual = join(s.path, 'actual');
  const nested = join(actual, 'nested');
  const alias = join(s.path, 'alias');
  await mkdir(nested, { recursive: true });
  await symlink(nested, alias);
  await slotScript([
    { code: 25, args: ['target', alias + '/../created'], answer: '' },
    { code: 24, args: [join(actual, 'created')], answer: 'target' },
    { code: 25, args: ['../literal', relative(process.cwd(), join(nested, 'héllo world'))], answer: '' },
    { code: 24, args: [join(nested, 'héllo world')], answer: '../literal' },
  ]);
  await assert.rejects(lstat(join(s.path, 'created')), { code: 'ENOENT' });
  assert.equal(await readlink(alias), nested);
});

test('symlink creation refuses existing destinations without replacing entries or targets', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const directory = join(s.path, 'directory');
  const link = join(s.path, 'link');
  const dangling = join(s.path, 'dangling');
  await writeFile(s.out, 'kept');
  await mkdir(directory);
  await symlink('stdout', link);
  await symlink('absent', dangling);
  const paths = [s.out, directory, link, dangling];
  const identities = await Promise.all(paths.map(path => lstat(path)));
  await slotScript([
    ...paths.map(path => ({ code: 25, args: ['replacement', path], status: 1, answer: /^EEXIST:/ })),
    { code: 25, args: [s.out, s.out], status: 1, answer: /^EEXIST:/ },
    { code: 25, args: ['replacement', directory + '/'], status: 1, answer: /^EEXIST:/ },
    { code: 25, args: ['stdout', s.marker], answer: '' },
  ]);
  assert.deepEqual(await Promise.all(paths.map(async path => (await lstat(path)).ino)), identities.map(info => info.ino));
  assert.equal(await readFile(s.out, 'utf8'), 'kept');
  assert.deepEqual(await readdir(directory), []);
  assert.equal(await readlink(link), 'stdout');
  assert.equal(await readlink(dangling), 'absent');
  await assert.rejects(lstat(join(s.path, 'absent')), { code: 'ENOENT' });
});

test('symlink creation reports path errors without creating parents and continues', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const missing = join(s.path, 'missing');
  const loop = join(s.path, 'loop');
  await writeFile(s.out, 'kept');
  await symlink('loop', loop);
  await slotScript([
    { code: 25, args: ['target', join(missing, 'child')], status: 1, answer: /^ENOENT:/ },
    { code: 25, args: ['target', join(s.out, 'child')], status: 1, answer: /^ENOTDIR:/ },
    { code: 25, args: ['target', join(loop, 'child')], status: 1, answer: /^ELOOP:/ },
    { code: 25, args: ['target', ''], status: 1, answer: /^ENOENT:/ },
    { code: 25, args: ['target', s.marker + '/'], status: 1, answer: /^ENOENT:/ },
    { code: 25, args: ['missing/target', s.marker], answer: '' },
    { code: 24, args: [s.marker], answer: 'missing/target' },
  ]);
  await assert.rejects(lstat(missing), { code: 'ENOENT' });
  assert.equal(await readFile(s.out, 'utf8'), 'kept');
  assert.equal(await readlink(loop), 'loop');
});

test('symlink creation composes with file reads and unlink while preserving the target', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const directory = join(s.path, 'nested');
  const path = join(directory, 'link');
  const bytes = Buffer.from([0, 255, 128, 10, 65]);
  await mkdir(directory);
  await writeFile(s.out, bytes);
  await slotScript([
    { code: 25, args: ['../stdout', path], answer: '' },
    { code: 2, args: [path, '0', '5'], answer: bytes },
    { code: 19, args: [path], answer: '' },
    { code: 23, args: [path], status: 1, answer: /^ENOENT:/ },
  ]);
  await assert.rejects(lstat(path), { code: 'ENOENT' });
  assert.deepEqual(await readFile(s.out), bytes);
});

test('symlink creation rejects malformed requests before filesystem access', async t => {
  const create = t.mock.method(fsPromises, 'symlink', async () => {});
  syncBuiltinESMExports();
  t.after(() => { create.mock.restore(); syncBuiltinESMExports(); });
  await slotScript([[], ['target'], ['target', 'link', 'surplus']].map(args => ({
    code: 25, args, status: 1, answer: `IO: OS request 25 expects 2 arguments, got ${args.length}`,
  })));
  for (const [invalid, message] of [[Buffer.from('path\0suffix'), 'NUL in OS string argument'],
    [Buffer.from([255]), 'non-UTF-8 bytes in OS string argument']]) {
    for (const args of [[invalid, 'link'], ['target', invalid]]) {
      await assert.rejects(slotScript([{ code: 25, args, answer: '' }]), { message });
    }
  }
  assert.equal(create.mock.callCount(), 0);
  await slotScript([
    { code: 25, args: ['../héllo//world', './link'], answer: '' },
    { code: 25, args: ['', 'empty-target'], answer: '' },
  ]);
  assert.equal(create.mock.callCount(), 2);
  assert.deepEqual(create.mock.calls[0].arguments, ['../héllo//world', './link']);
  assert.deepEqual(create.mock.calls[1].arguments, ['', 'empty-target']);
});

test('symlink target returns stored bytes for existing, dangling, chained and cyclic links', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const file = join(s.path, 'héllo world\nfile');
  const directory = join(s.path, 'directory');
  await writeFile(file, 'preserved');
  await mkdir(directory);
  const targets = ['./héllo world\nfile', file, directory, 'missing/../still-missing', 'link-0', 'link-5'];
  for (const [index, target] of targets.entries()) await symlink(target, join(s.path, `link-${index}`));
  await slotScript([
    ...targets.map((target, index) => ({ code: 24, args: [join(s.path, `link-${index}`)],
      body: 'unused payload', answer: Buffer.from(target) })),
    { code: 24, args: [relative(process.cwd(), join(s.path, 'link-0'))], answer: Buffer.from(targets[0]) },
  ]);
  for (const [index, target] of targets.entries()) assert.equal(await readlink(join(s.path, `link-${index}`)), target);
  assert.equal(await readFile(file, 'utf8'), 'preserved');
  assert.deepEqual(await readdir(directory), []);
  await absent(join(s.path, 'still-missing'));
});

test('symlink target preserves OS resolution of parent components and trailing separators', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const nested = join(s.path, 'actual', 'nested');
  const alias = join(s.path, 'alias');
  await mkdir(nested, { recursive: true });
  await symlink(nested, alias);
  await symlink('kept', join(s.path, 'actual', 'link'));
  await symlink('wrong', join(s.path, 'link'));
  await writeFile(join(nested, 'file'), 'preserved');
  await symlink('file', join(nested, 'file-link'));
  await slotScript([
    { code: 24, args: [alias], answer: nested },
    { code: 24, args: [join(alias, 'file-link')], answer: 'file' },
    { code: 24, args: [alias + '/../link'], answer: 'kept' },
    { code: 24, args: [alias + '/'], status: 1, answer: /^EINVAL:/ },
    { code: 24, args: [join(alias, 'file-link') + '/'], status: 1, answer: /^ENOTDIR:/ },
  ]);
  assert.equal(await readFile(join(nested, 'file'), 'utf8'), 'preserved');
});

test('symlink target reports path errors and continues with subsequent requests', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  await writeFile(s.out, 'preserved');
  await symlink('stdout', s.marker);
  const loop = join(s.path, 'loop');
  await symlink('loop', loop);
  await slotScript([
    { code: 24, args: [join(s.path, 'missing')], status: 1, answer: /^ENOENT:/ },
    { code: 24, args: [''], status: 1, answer: /^ENOENT:/ },
    { code: 24, args: [s.out], status: 1, answer: /^EINVAL:/ },
    { code: 24, args: [s.path], status: 1, answer: /^EINVAL:/ },
    { code: 24, args: [join(s.out, 'child')], status: 1, answer: /^ENOTDIR:/ },
    { code: 24, args: [join(loop, 'child')], status: 1, answer: /^ELOOP:/ },
    { code: 24, args: [s.marker], answer: 'stdout' },
  ]);
  assert.equal(await readFile(s.out, 'utf8'), 'preserved');
});

// Native filesystems may reject arbitrary target bytes or targets this large.
// Sync the mock into named builtin imports, and restore both views after each test.
const mockReadlink = (t, implementation) => {
  const mocked = t.mock.method(fsPromises, 'readlink', implementation);
  syncBuiltinESMExports();
  t.after(() => { mocked.mock.restore(); syncBuiltinESMExports(); });
  return mocked;
};

test('symlink target preserves raw non-UTF-8 bytes without terminators', async t => {
  const target = Buffer.from([46, 47, 255, 128, 254, 10, 195, 169]);
  mockReadlink(t, async (path, options) => options?.encoding === 'buffer'
    ? target : target.toString(options?.encoding ?? 'utf8'));
  await slotScript([{ code: 24, args: ['raw-link'], answer: target }]);
});

test('symlink target accepts 65536 bytes and rejects 65537 without a partial answer', async t => {
  const full = Buffer.from('é'.repeat(32768));
  const oversized = Buffer.concat([full, Buffer.from('!')]);
  const targets = new Map([['full', full], ['oversized', oversized], ['small', Buffer.from('target')]]);
  mockReadlink(t, async (path, options) => options?.encoding === 'buffer'
    ? targets.get(path) : targets.get(path).toString(options?.encoding ?? 'utf8'));
  await slotScript([
    { code: 24, args: ['full'], answer: full },
    { code: 24, args: ['oversized'], status: 1, answer: 'IO: symlink target exceeds maximum OS chunk size' },
    { code: 24, args: ['small'], answer: 'target' },
  ]);
});

test('symlink target rejects malformed requests before filesystem access', async t => {
  const read = mockReadlink(t, async () => Buffer.from('target'));
  await slotScript([
    { code: 24, args: [], status: 1, answer: 'IO: OS request 24 expects 1 argument, got 0' },
    { code: 24, args: ['link', 'surplus'], status: 1, answer: 'IO: OS request 24 expects 1 argument, got 2' },
  ]);
  for (const [invalid, message] of [[Buffer.from('link\0suffix'), 'NUL in OS string argument'],
    [Buffer.from([255]), 'non-UTF-8 bytes in OS string argument']]) {
    await assert.rejects(slotScript([{ code: 24, args: [invalid], answer: '' }]), { message });
  }
  assert.equal(read.mock.callCount(), 0);
  await slotScript([{ code: 24, args: ['link'], answer: 'target' }]);
  assert.equal(read.mock.callCount(), 1);
});

test('directory listing returns sorted direct names with NUL framing and no recursion', async t => {
  const s = await sandbox(t);
  const child = join(s.path, 'child');
  await mkdir(child);
  await writeFile(join(child, 'nested'), 'nested content');
  for (const name of ['zeta', 'A space', 'line\nbreak', '.hidden', 'héllo', '\uE000', '\u{10000}']) {
    await writeFile(join(s.path, name), 'file content');
  }
  const expected = Buffer.from('.hidden\0A space\0child\0héllo\0line\nbreak\0zeta\0\uE000\0\u{10000}\0');
  await slotScript([
    { code: 22, args: [s.path], body: 'unused payload', answer: expected },
    { code: 22, args: [relative(process.cwd(), s.path)], answer: expected },
    { code: 22, args: [child], answer: Buffer.from('nested\0') },
  ]);
  assert.equal(await readFile(join(child, 'nested'), 'utf8'), 'nested content');
});

test('directory listing includes symlink names and follows a requested directory symlink', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const directory = join(s.path, 'directory');
  const link = join(s.path, 'link');
  await mkdir(directory);
  await symlink(directory, link);
  await slotScript([{ code: 22, args: [link], answer: Buffer.alloc(0) }]);
  await writeFile(s.out, 'target');
  await symlink(s.out, join(directory, 'file-link'));
  await symlink(s.marker, join(directory, 'dangling'));
  await symlink(s.path, join(directory, 'parent-link'));
  await slotScript([
    { code: 22, args: [directory], answer: Buffer.from('dangling\0file-link\0parent-link\0') },
    { code: 22, args: [link], answer: Buffer.from('dangling\0file-link\0parent-link\0') },
    { code: 22, args: [join(link, 'parent-link', 'directory')], answer: Buffer.from('dangling\0file-link\0parent-link\0') },
  ]);
  assert.equal(await readFile(s.out, 'utf8'), 'target');
  assert.equal(await readlink(join(directory, 'dangling')), s.marker);
});

test('directory listing preserves raw non-UTF-8 entry bytes', async t => {
  const s = await sandbox(t);
  // Inject the entry bytes: some filesystems or sandboxes refuse to create
  // these names. The real directory handle still opens and closes normally.
  const entries = [[255, 97], [128, 97], [254, 97]].map(bytes => ({ name: Buffer.from(bytes) }));
  t.mock.method(Dir.prototype, 'read', async () => entries.shift() ?? null);
  await slotScript([{ code: 22, args: [s.path], answer: Buffer.from([128, 97, 0, 254, 97, 0, 255, 97, 0]) }]);
});

test('directory listing reports path errors and rejects undecodable arguments', async t => {
  const s = await sandbox(t);
  await writeFile(s.out, 'preserved');
  await slotScript([
    { code: 22, args: [s.marker], status: 1, answer: /^ENOENT:/ },
    { code: 22, args: [s.out], status: 1, answer: /^ENOTDIR:/ },
    { code: 22, args: [''], status: 1, answer: /^ENOENT:/ },
    { code: 22, args: [s.path], answer: Buffer.from('stdout\0') },
  ]);
  for (const [invalid, message] of [[Buffer.from(`${s.path}\0ignored`), 'NUL in OS string argument'],
    [Buffer.from([255]), 'non-UTF-8 bytes in OS string argument']]) {
    await assert.rejects(slotScript([{ code: 22, args: [invalid], answer: '' }]), { message });
  }
  assert.equal(await readFile(s.out, 'utf8'), 'preserved');
});

test('directory listing accepts 65536 bytes, rejects one more and closes each handle', async t => {
  const s = await sandbox(t);
  const directory = join(s.path, 'bounded');
  const empty = join(s.path, 'empty');
  await mkdir(directory);
  await mkdir(empty);
  const names = Array.from({ length: 255 }, (_, index) => `${String(index).padStart(3, '0')}-${'x'.repeat(251)}`);
  const boundary = '\uE000'.repeat(84) + 'y';
  for (const name of [...names, 'z', boundary]) await writeFile(join(directory, name), '');
  const expected = Buffer.from([...names, 'z', boundary, ''].join('\0'));
  assert.equal(expected.length, 65536);
  const closes = [];
  const close = Dir.prototype.close;
  t.mock.method(Dir.prototype, 'close', function (...args) {
    if (args.length === 0) closes.push(this.path);
    return close.apply(this, args);
  });
  await slotScript([{ code: 22, args: [directory], answer: expected }]);
  assert.deepEqual(closes, [directory]);
  await rename(join(directory, boundary), join(directory, boundary + 'y'));
  await slotScript([
    { code: 22, args: [directory], status: 1, answer: 'IO: directory listing exceeds maximum OS chunk size' },
    { code: 22, args: [empty], answer: Buffer.alloc(0) },
  ]);
  assert.deepEqual(closes, [directory, directory, empty]);
});

test('directory listing discards partial results and closes the handle after a read failure', async t => {
  const s = await sandbox(t);
  const empty = join(s.path, 'empty');
  await mkdir(empty);
  await writeFile(s.out, 'preserved');
  const read = Dir.prototype.read;
  const close = Dir.prototype.close;
  let reads = 0;
  const closes = [];
  t.mock.method(Dir.prototype, 'read', async function (...args) {
    if (args.length === 0 && this.path === s.path && ++reads === 2) throw Object.assign(new Error('injected directory read failure'), { code: 'EIO' });
    return read.apply(this, args);
  });
  t.mock.method(Dir.prototype, 'close', function (...args) {
    if (args.length === 0) closes.push(this.path);
    return close.apply(this, args);
  });
  await slotScript([
    { code: 22, args: [s.path], status: 1, answer: 'EIO: injected directory read failure' },
    { code: 22, args: [empty], answer: Buffer.alloc(0) },
  ]);
  assert.equal(reads, 2);
  assert.deepEqual(closes, [s.path, empty]);
});

test('well-formed OS requests preserve bytes and accept a process with no argv', async t => {
  const s = await sandbox(t);
  const path = join(s.path, 'content');
  const root = join(s.path, 'directories');
  const content = 'héllo\0';
  const canonical = await realpath(s.path);
  await slotScript([
    { code: 1, args: [root, 'request-'], answer: /[/\\]request-[^/\\]+$/ },
    { code: 3, args: [path], body: content, answer: '' },
    { code: 2, args: [path, '0', '65536'], answer: content },
    { code: 5, args: [path], answer: String(Buffer.byteLength(content)) },
    { code: 6, args: [], answer: '' }, { code: 7, args: [], answer: '' },
    { code: 8, args: [path], answer: join(canonical, 'content') },
    { code: 9, args: [s.path, 'content'], answer: path },
    { code: 4, args: [s.out, s.err, s.path, '0', process.execPath], answer: ['0', '0', '0', '0', ''].join('\0') },
  ]);
  assert.equal((await readdir(root)).length, 1);
  assert.equal(await readFile(path, 'utf8'), content);
  assert.equal((await readFile(s.out)).length, 0);
  assert.equal((await readFile(s.err)).length, 0);
});

test('joint computation accepts one or several shares and unknown requests resume with an error', async () => {
  await slotScript([
    { code: 15, args: ['3'], answer: '1' },
    { code: 16, args: ['1', '3', '1'], answer: '2' },
    { code: 17, args: ['2'], answer: '4' },
    { code: 16, args: ['3', '0', '1', '2', '1'], answer: '3' },
    { code: 17, args: ['3'], answer: '10' },
    { code: 1073741823, args: [], status: 1, answer: 'IO: unknown OS request 1073741823' },
    { code: 15, args: ['5'], answer: '4' },
  ]);
});

test('blob release invalidates every reader without reusing handles or disturbing live slots', async () => {
  await slotScript([
    { code: 10, args: ['9', '3'], answer: '1' },
    { code: 12, args: ['2', '5'], answer: '2' },
    { code: 15, args: ['7'], answer: '3' },
    { code: 13, args: ['3', '3', '2'], answer: '4' },
    { code: 16, args: ['2', '0', '2', '3'], answer: '5' },
    { code: 18, args: ['0002'], answer: '' },
    { code: 15, args: ['11'], answer: '6' },
    { code: 11, args: ['1', '9', '2'], answer: '1' },
    { code: 17, args: ['3'], answer: '7' },
    { code: 14, args: ['4'], answer: '6' },
    { code: 17, args: ['5'], answer: '12' },
    ...[[11, ['2', '25', '2']], [13, ['3', '0', '2']], [14, ['2']],
      [16, ['2', '0', '3', '2']], [17, ['2']], [18, ['2']]].map(([code, args]) =>
      ({ code, args, status: 1, answer: 'IO: unknown blob slot 2' })),
    { code: 15, args: ['13'], answer: '7' },
    ...['1', '3', '4', '5', '6', '7'].map(slot => ({ code: 18, args: [slot], answer: '' })),
    { code: 10, args: ['16', '4'], answer: '8' },
    { code: 11, args: ['8', '16', '2'], answer: '1' },
    { code: 18, args: ['8'], answer: '' },
    { code: 18, args: ['8'], status: 1, answer: 'IO: unknown blob slot 8' },
  ]);
});

test('blob release rejects malformed and unknown indices while preserving live slots', async () => {
  await slotScript([
    { code: 15, args: ['7'], answer: '1' },
    ...['', '-1', '+1', '1.0', '1e0', ' 1', '1 ', '1\n', '\u0661', '9007199254740992'].map(slot =>
      ({ code: 18, args: [slot], status: 1, answer: 'IO: invalid OS numeric argument' })),
    ...['0', '2', '9007199254740991'].map(slot =>
      ({ code: 18, args: [slot], status: 1, answer: `IO: unknown blob slot ${slot}` })),
    { code: 17, args: ['1'], answer: '7' },
    { code: 15, args: ['8'], answer: '2' },
    { code: 18, args: ['1'], answer: '' },
    { code: 17, args: ['2'], answer: '8' },
  ]);
});

test('blob release supports repeated allocation and release within one invocation', async () => {
  const script = [];
  for (let index = 1; index <= 128; index += 1) {
    script.push({ code: 15, args: [String(index)], answer: String(index) },
      { code: 18, args: [String(index)], answer: '' },
      { code: 17, args: [String(index)], status: 1, answer: `IO: unknown blob slot ${index}` });
  }
  await slotScript(script);
});

for (const failure of [false, true]) {
  test(`veil blob stores isolate overlapping runs when the second ${failure ? 'fails' : 'completes'}`, async () => {
    const firstScript = [
      { code: 10, args: ['9', '3'], answer: '1' },
      { code: 12, args: ['4', '9007199254740993'], answer: '2' },
      { code: 15, args: ['7'], answer: '3' },
      { code: 15, args: ['8'], answer: '4' },
      { code: 6, args: [], answer: '' },
      { code: 11, args: ['1', '9', '2'], answer: '1' },
      { code: 14, args: ['2'], answer: '9007199254740993' },
      { code: 17, args: ['3'], answer: '7' },
      { code: 13, args: ['5', '3', '2'], answer: '5' },
      { code: 14, args: ['5'], answer: '9007199254740994' },
      { code: 16, args: ['2', '0', '3', '4'], answer: '6' },
      { code: 17, args: ['6'], answer: '15' },
    ];
    const secondScript = [
      ...[11, 14, 17, 18].map(code => ({ code, args: code === 11 ? ['1', '9', '2'] : ['1'],
        status: 1, answer: /unknown blob slot 1/ })),
      { code: 10, args: ['25', '5'], answer: '1' },
      { code: 12, args: ['2', '42'], answer: '2' },
      { code: 15, args: ['10'], answer: '3' },
      { code: 11, args: ['1', '25', '2'], answer: '1' },
      { code: 14, args: ['2'], answer: '42' },
      { code: 17, args: ['3'], answer: '10' },
      ...['1', '2', '3'].map(slot => ({ code: 18, args: [slot], answer: '' })),
      { code: 15, args: ['11'], answer: '4' },
      { code: 17, args: ['1'], status: 1, answer: 'IO: unknown blob slot 1' },
      { code: 17, args: ['4'], answer: '11' },
    ];
    const first = slotScriptApi(firstScript);
    const second = slotScriptApi(secondScript);
    const injected = new Error('second reactor failed at init');
    if (failure) second.api.init = () => { throw injected; };
    const engine = globalThis.WebAssembly;
    const write = process.stdout.write;
    const listeners = ['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal));
    const instances = [first.api, second.api];
    let started = 0;
    globalThis.WebAssembly = { instantiate: async () => ({
      instance: { exports: instances.at(started++) ?? assert.fail('no instance left') } }) };
    const marker = Buffer.from('veil-isolation-barrier');
    first.api.requestBody = state => state === 4 ? [...marker] : [];
    let release;
    let entered;
    const paused = new Promise(resolve => { entered = resolve; });
    // The stream signature is write(chunk, encoding, callback), so the
    // callback is the second argument only when it is a function.
    process.stdout.write = function (...args) {
      const [chunk, second, third] = args;
      if (Buffer.isBuffer(chunk) && chunk.equals(marker)) {
        release = typeof second === 'function' ? second : third;
        entered();
        return true;
      }
      return write.apply(this, args);
    };
    const modulePath = new URL('../runtime/reactor.mjs', import.meta.url);
    const running = runReactor(modulePath, []);
    // Observe rejection immediately, and release the barrier on every exit.
    // The second run starts only after the first owns four slots and is paused.
    const finished = Promise.allSettled([running]);
    try {
      await Promise.race([paused, running.then(() => assert.fail('first run did not pause'))]);
      if (failure) await assert.rejects(runReactor(modulePath, []), error => error === injected);
      else {
        assert.equal(await runReactor(modulePath, []), 0);
        assert.equal(second.answers.length, secondScript.length);
      }
      release();
      release = undefined;
      assert.equal(await running, 0);
      assert.equal(first.answers.length, firstScript.length);
      assert.equal(started, instances.length);
    } finally {
      release?.();
      await finished;
      process.stdout.write = write;
      globalThis.WebAssembly = engine;
    }
    assert.deepEqual(['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal)), listeners);
  });
}

test('veil blob stores start empty on sequential runs', async () => {
  await slotScript([{ code: 15, args: ['123'], answer: '1' }]);
  await slotScript([
    { code: 17, args: ['1'], status: 1, answer: /unknown blob slot 1/ },
    { code: 15, args: ['456'], answer: '1' },
    { code: 17, args: ['1'], answer: '456' },
  ]);
});

test('veil host naturals roundtrip across i31 and safe-integer boundaries', async () => {
  const script = [];
  let nextSlot = 0;
  for (const input of ['0', '0000', '00042', '1073741823', '1073741824',
    '9007199254740991', '9007199254740992', '9007199254740993',
    '123456789012345678901234567890123456789012345678901234567890']) {
    const canonical = BigInt(input).toString();
    const proof = String(++nextSlot);
    const cipher = String(++nextSlot);
    const evaluated = String(++nextSlot);
    const share = String(++nextSlot);
    script.push(
      { code: 10, args: [input, input], answer: proof },
      { code: 11, args: [proof, canonical, '0'], answer: '1' },
      { code: 11, args: [proof, String(BigInt(input) + 1n), '0'], answer: '0' },
      { code: 12, args: [input, input], answer: cipher },
      { code: 14, args: [cipher], answer: canonical },
      { code: 13, args: [input, '0', cipher], answer: evaluated },
      { code: 14, args: [evaluated], answer: canonical },
      { code: 15, args: [input], answer: share },
      { code: 17, args: [share], answer: canonical },
    );
  }
  await slotScript(script);
});

test('veil host naturals compute exact zk, fhc and mpc results', async () => {
  await slotScript([
    { code: 10, args: ['100000000000000000000', '10000000000'], answer: '1' },
    { code: 11, args: ['1', '100000000000000000000', '2'], answer: '1' },
    { code: 11, args: ['1', '100000000000000000001', '2'], answer: '0' },
    { code: 10, args: ['100000000000000000000', '10000000001'], answer: '2' },
    { code: 11, args: ['2', '100000000000000000000', '2'], answer: '0' },
    { code: 12, args: ['0', '1073741823'], answer: '3' },
    { code: 13, args: ['1', '3', '3'], answer: '4' },
    { code: 14, args: ['4'], answer: '1073741824' },
    { code: 12, args: ['0', '9007199254740992'], answer: '5' },
    { code: 13, args: ['1', '3', '5'], answer: '6' },
    { code: 14, args: ['6'], answer: '9007199254740993' },
    { code: 13, args: ['2', '2', '6'], answer: '7' },
    { code: 14, args: ['7'], answer: '81129638414606699710187514626049' },
    { code: 15, args: ['9007199254740993'], answer: '8' },
    { code: 15, args: ['2'], answer: '9' },
    { code: 16, args: ['2', '0', '8', '9'], answer: '10' },
    { code: 17, args: ['10'], answer: '9007199254740995' },
    { code: 16, args: ['2', '1', '8', '9'], answer: '11' },
    { code: 17, args: ['11'], answer: '18014398509481986' },
    { code: 16, args: ['2', '2', '8', '9'], answer: '12' },
    { code: 17, args: ['12'], answer: '81129638414606735738984533590025' },
    { code: 16, args: ['2', '3', '8', '9'], answer: '13' },
    { code: 17, args: ['13'], answer: '9007199254740996' },
    { code: 15, args: ['0'], answer: '14' },
    { code: 16, args: ['2', '1', '8', '14'], answer: '15' },
    { code: 17, args: ['15'], answer: '0' },
    // Operation 11 is the one request that reads a slot flag, so it is the
    // one observation of the level that operation 13 stores. Both levels
    // sit above the safe-integer limit, and they differ by one.
    { code: 12, args: ['0', '9007199254740993'], answer: '16' },
    { code: 13, args: ['9007199254740993', '0', '16'], answer: '17' },
    { code: 11, args: ['17', '9007199254740993', '0'], answer: '1' },
    { code: 13, args: ['9007199254740994', '0', '16'], answer: '18' },
    { code: 11, args: ['18', '9007199254740993', '0'], answer: '0' },
  ]);
});

test('veil host naturals reject malformed decimals without allocating slots', async () => {
  const script = [{ code: 10, args: ['1', '1'], answer: '1' }];
  const positions = [
    [10, ['1', '1'], 0], [10, ['1', '1'], 1], [11, ['1', '1', '0'], 1],
    [12, ['0', '1'], 0], [12, ['0', '1'], 1], [13, ['1', '0', '1'], 0],
    [15, ['1'], 0],
  ];
  for (const invalid of ['', '-1', '+1', '1.0', '1e3', '0x10', '0b10', '1_000',
    ' 1', '1 ', '1\n', '\t1', 'Infinity', '\u0661']) {
    for (const [code, args, position] of positions) {
      script.push({ code, args: args.map((arg, index) => index === position ? invalid : arg),
        status: 1, answer: /^IO: invalid veil natural argument$/ });
    }
  }
  for (const args of [[], ['1']]) {
    script.push({ code: 10, args, status: 1,
      answer: `IO: OS request 10 expects 2 arguments, got ${args.length}` });
  }
  script.push({ code: 15, args: ['7'], answer: '2' },
    { code: 17, args: ['2'], answer: '7' });
  await slotScript(script);
});

test('veil host naturals keep bounded slot, function and subset indices', async () => {
  const invalid = '9007199254740992';
  await slotScript([
    { code: 15, args: ['3'], answer: '1' },
    { code: 14, args: [invalid], status: 1, answer: /^IO: invalid OS numeric argument$/ },
    { code: 13, args: ['0', invalid, '1'], status: 1, answer: /^IO: invalid OS numeric argument$/ },
    { code: 16, args: [invalid, '0', '1'], status: 1, answer: /^IO: invalid OS numeric argument$/ },
    { code: 11, args: ['1', '4', '4'], status: 1, answer: /^IO: unknown host function 4$/ },
    { code: 16, args: ['0', '0', '1'], status: 1, answer: /^IO: the subset holds fewer parties/ },
    { code: 16, args: ['1', '0'], status: 1, answer: 'IO: OS request 16 expects at least 3 arguments, got 2' },
    { code: 15, args: ['4'], answer: '2' },
  ]);
});
