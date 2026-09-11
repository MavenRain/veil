import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, readdir, realpath, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
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
// W4-F19: under load the marker write can lag the SIGKILL race by more
// than a scheduler tick, so the escalation subtest polls up to one second
// (50 rounds of 20 ms) before it falls through to the existing read.
const awaitMarker = async path => {
  for (let round = 0; round < 50 && !existsSync(path); round += 1) await delay(20);
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

test('timeout escalates for a child that ignores SIGTERM', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const response = fields(await executeProcess(command(s, '150', `
    process.on('SIGTERM', () => {});
    require('node:fs').writeFileSync(${JSON.stringify(s.marker)}, String(process.pid));
    setInterval(() => {}, 1000);
  `), { signal: null }));
  assert.deepEqual(response.slice(0, 4), ['124', String(constants.signals.SIGKILL), '1', '0']);
  const pid = Number(await readFile(s.marker, 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('signal callback errors reject normally after killing and reaping the child', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
  const originalKill = process.kill;
  const injected = Object.assign(new Error('injected signal failure'), { code: 'EIO' });
  process.kill = (pid, signal) => {
    if (signal === 'SIGTERM') throw injected;
    return originalKill.call(process, pid, signal);
  };
  try {
    await assert.rejects(executeProcess(command(s, '150', `
      require('node:fs').writeFileSync(${JSON.stringify(s.marker)}, String(process.pid));
      setInterval(() => {}, 1000);
    `), { signal: null }), error => error === injected);
    const pid = Number(await readFile(s.marker, 'utf8'));
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

test('escalation callback errors are caught and cleanup retries the kill', { skip: process.platform === 'win32' }, async t => {
  const s = await sandbox(t);
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
    await assert.rejects(executeProcess(command(s, '150', `
      process.on('SIGTERM', () => {});
      require('node:fs').writeFileSync(${JSON.stringify(s.marker)}, String(process.pid));
      setInterval(() => {}, 1000);
    `), { signal: null }), error => error === injected);
    await awaitMarker(s.marker);
    const pid = Number(await readFile(s.marker, 'utf8'));
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
      assert.equal(status, step.status ?? 0, `step ${state}, operation ${step.code}: ${answer}`);
      if (step.answer instanceof RegExp) assert.match(answer, step.answer);
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
  globalThis.WebAssembly = { instantiate: async () => ({ instance: { exports: api } }) };
  try {
    assert.equal(await runReactor(new URL('../runtime/reactor.mjs', import.meta.url), []), 0);
    assert.equal(answers.length, script.length);
  } finally {
    globalThis.WebAssembly = engine;
  }
};

test('request arities reject missing and surplus arguments before host effects', async t => {
  const s = await sandbox(t);
  const root = join(s.path, 'new-root');
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
      assert.equal(spawns.started, started);
    });
  }
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
    { code: 19, args: [], status: 1, answer: 'IO: unknown OS request 19' },
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
