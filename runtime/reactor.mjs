// Generic OS driver for a pure Kanon request/response state machine.
// Application decisions and serialization belong to the compiled program.
import { readFile, open, mkdir, mkdtemp, chmod, rename, unlink, stat, realpath, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

const MAX_IO = 65536;
const nat = value => {
  if (!Number.isInteger(value) || value < 0 || value > 1073741823) throw new RangeError('invalid ABI natural');
  return value;
};
const numeric = value => {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new RangeError('invalid OS numeric argument');
  return Number(value);
};
// Slot data crosses as decimal bytes, independently of the i31 export ABI
// and the safe-integer OS arguments. Parse it without narrowing through Number.
const veilNatural = value => {
  if (typeof value !== 'string' || value.length === 0 || /[^0-9]/.test(value)) {
    throw new RangeError('invalid veil natural argument');
  }
  return BigInt(value);
};
const signalCode = signal => signal ? 128 + (constants.signals[signal] ?? 0) : 0;
// How long the runtime waits for the rest of the process group after the
// leader has exited. The same budget as the termination escalation.
const GROUP_DRAIN_MS = 250;
// Started processes, counted so a suite can observe that a guard which
// must run before any spawn did run. The runtime never reads it.
export const spawns = { started: 0 };
// An OS string argument crosses the boundary as bytes, and Node needs a
// JavaScript string. A lossy decode would rewrite the bytes with U+FFFD
// and report success, so bytes that do not survive the round trip are
// rejected. The request loop decodes the arguments before it performs the
// operation, so a rejection ends the run with an error and no resume.
export const osString = buffer => {
  if (buffer.includes(0)) throw new Error('NUL in OS string argument');
  const text = buffer.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(buffer)) throw new Error('non-UTF-8 bytes in OS string argument');
  return text;
};

// A failing output stream reports the failure twice: the write callback
// receives the error, and the stream emits an 'error' event after it. An
// unhandled 'error' event ends the whole process, so a broken pipe would
// never reach the request loop. The callback is the reported path, so each
// written stream keeps one listener that leaves the event to it. The
// promise below then carries the failure to the caller.
const guarded = new WeakSet();
export const writeStream = (stream, chunk) => {
  if (!guarded.has(stream)) {
    stream.on('error', () => {});
    guarded.add(stream);
  }
  return new Promise((ok, fail) => stream.write(chunk, error => error ? fail(error) : ok()));
};

export async function executeProcess(args, interrupted) {
  const [outPath, errPath, cwd, deadline, ...argv] = args;
  if (args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) throw new TypeError('process arguments must be NUL-free strings');
  if (!outPath || !errPath || typeof cwd !== 'string') throw new Error('spawn requires capture paths and working directory');
  if (!argv.length || !argv[0]) throw new Error('spawn requires an executable');
  const timeoutMs = numeric(deadline);
  if (timeoutMs > 2147483647) throw new RangeError('timeout exceeds OS timer range');
  const out = await open(outPath, 'wx', 0o600);
  let err;
  try {
    err = await open(errPath, 'wx', 0o600);
    // Opening the captures can yield to a signal handler. Check again at
    // the last synchronous boundary before starting a process.
    if (interrupted.signal) {
      return Buffer.from([signalCode(interrupted.signal), constants.signals[interrupted.signal] ?? 0,
        0, 1, ''].join('\0'));
    }
    const child = spawn(argv[0], argv.slice(1), {
      cwd: cwd || '.', shell: false, detached: process.platform !== 'win32',
      stdio: ['ignore', out.fd, err.fd],
    });
    spawns.started += 1;
    let spawnError = '';
    let timedOut = false;
    let stopped = false;
    let escalation;
    let escalationTimer;
    let resolveFault;
    const faulted = new Promise(resolveFaulted => { resolveFault = resolveFaulted; });
    const fail = error => resolveFault({ error });
    const wait = async promise => {
      const outcome = await Promise.race([promise.then(value => ({ value })), faulted]);
      if (outcome.error) throw outcome.error;
      return outcome.value;
    };
    const signal = name => {
      if (!child.pid) return null;
      try {
        if (process.platform === 'win32') child.kill(name);
        else process.kill(-child.pid, name);
        return null;
      } catch (error) { return error.code === 'ESRCH' ? null : error; }
    };
    const terminate = name => {
      if (stopped) return;
      stopped = true;
      const error = signal(name);
      if (error) fail(error);
      escalation = new Promise(resolveEscalation => {
        escalationTimer = setTimeout(() => {
          const error = signal('SIGKILL');
          if (error) fail(error);
          resolveEscalation();
        }, 250);
      });
    };
    const finished = new Promise(resolveExit => {
      child.on('error', error => {
        if (child.pid) fail(error);
        else spawnError = `${error.code ?? 'SPAWN'}: ${error.message}`;
      });
      child.once('close', (code, sig) => resolveExit({ code, sig }));
    });
    const timeout = timeoutMs ? setTimeout(() => { timedOut = true; terminate('SIGTERM'); }, timeoutMs) : null;
    const interruptPoll = setInterval(() => { if (interrupted.signal) terminate(interrupted.signal); }, 25);
    try {
      const result = await wait(finished);
      // The deadline governs the leader. Once the leader has closed, its
      // own status is the answer, so the timer must not fire during the
      // group drain and overwrite that status with a timeout.
      if (timeout) clearTimeout(timeout);
      if (process.platform !== 'win32' && child.pid && !spawnError) {
        // The drain is bounded: a group member that outlives the leader
        // by more than the budget is killed, so no deadline can leave
        // this loop running without end.
        const drainUntil = Date.now() + GROUP_DRAIN_MS;
        while (!stopped) {
          try { process.kill(-child.pid, 0); }
          catch (error) { if (error.code === 'ESRCH') break; throw error; }
          if (Date.now() >= drainUntil) { terminate('SIGKILL'); break; }
          await wait(delay(25));
        }
      }
      if (escalation) await wait(escalation);
      const code = timedOut ? 124 : spawnError ? 127 : result.code ?? signalCode(result.sig);
      return Buffer.from([code, constants.signals[result.sig] ?? 0, Number(timedOut), Number(Boolean(interrupted.signal)), spawnError].join('\0'));
    } catch (error) {
      // An unexpected wait or signal error must not abandon a detached
      // child. Attempt the group first, then the leader if that fails.
      const cleanupError = signal('SIGKILL');
      if (cleanupError) {
        try {
          if (!child.kill('SIGKILL') && child.exitCode === null && child.signalCode === null) throw cleanupError;
        }
        catch (leaderError) {
          throw new AggregateError([error, cleanupError, leaderError], 'process cleanup failed');
        }
      }
      await finished;
      if (cleanupError) throw new AggregateError([error, cleanupError], 'process group cleanup failed');
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
      clearInterval(interruptPoll);
      if (escalationTimer) clearTimeout(escalationTimer);
    }
  } finally {
    await Promise.all([out.close(), ...(err ? [err.close()] : [])]);
  }
}

async function atomicWrite(path, body) {
  const temporary = join(dirname(path), `.kanon-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, body, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

// The eight veil host ops, REACTOR.md rows 10 to 17. A blob is a slot
// that holds a flag and a plaintext. The flag is the instance for the zk ops, the
// level for the fhc ops, and the party flag for the mpc ops. The party
// flag is the constant 0 in version one. A slot index and a plaintext
// cross the request boundary as decimal byte strings, like every other
// numeric argument. This twin has no security.
// The request boundary carries byte strings, so a function value cannot
// cross it, and the runtime adds no export for one. The host twin names
// a function with a code into this table. The Wasm twin
// (runtime/reactor.kan) takes the function value itself.
const hostFunctions = [
  values => values.reduce((total, value) => total + value, 0n),
  values => values.reduce((total, value) => total * value, 1n),
  values => values.reduce((total, value) => total + value, 0n) ** 2n,
  values => values.reduce((total, value) => total + value, 0n) + 1n,
];
const hostFunction = argument => {
  const code = numeric(argument);
  const chosen = hostFunctions.at(code);
  if (!chosen || code >= hostFunctions.length) throw new RangeError(`unknown host function ${code}`);
  return chosen;
};
const readSlot = (blobs, argument) => {
  const index = numeric(argument);
  const slot = blobs.get(index);
  if (!slot) throw new Error(`unknown blob slot ${index}`);
  return slot;
};
const writeSlot = (blobs, flag, plain) => {
  const index = blobs.size + 1;
  blobs.set(index, { flag, plain });
  return Buffer.from(String(index));
};

async function perform(code, args, body, interrupted, blobs) {
  switch (code) {
    case 1: {
      const root = resolve(args[0]);
      await mkdir(root, { recursive: true, mode: 0o700 });
      const path = await mkdtemp(join(root, args[1]));
      await chmod(path, 0o700);
      return Buffer.from(path);
    }
    case 2: {
      const offset = numeric(args[1]);
      const length = numeric(args[2]);
      if (length > MAX_IO) throw new RangeError('read exceeds maximum OS chunk size');
      const file = await open(args[0], 'r');
      try {
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await file.read(buffer, 0, length, offset);
        return buffer.subarray(0, bytesRead);
      } finally { await file.close(); }
    }
    case 3: await atomicWrite(args[0], body); return Buffer.alloc(0);
    case 4: return executeProcess(args, interrupted);
    case 5: {
      const info = await stat(args[0]);
      if (!info.isFile()) throw new Error('expected a regular file');
      return Buffer.from(String(info.size));
    }
    case 6: await writeStream(process.stdout, body); return Buffer.alloc(0);
    case 7: await writeStream(process.stderr, body); return Buffer.alloc(0);
    case 8: return Buffer.from(await realpath(args[0]));
    case 9: return Buffer.from(resolve(args[0], args[1]));
    case 10: return writeSlot(blobs, veilNatural(args[0]), veilNatural(args[1]));
    case 11: {
      const slot = readSlot(blobs, args[0]);
      const instance = veilNatural(args[1]);
      const relation = hostFunction(args[2]);
      return Buffer.from(String(Number(slot.flag === instance && relation([slot.plain]) === instance)));
    }
    case 12: return writeSlot(blobs, veilNatural(args[0]), veilNatural(args[1]));
    case 13: {
      const level = veilNatural(args[0]);
      const evaluated = hostFunction(args[1]);
      const slot = readSlot(blobs, args[2]);
      return writeSlot(blobs, level, evaluated([slot.plain]));
    }
    case 14: return Buffer.from(String(readSlot(blobs, args[0]).plain));
    case 15: return writeSlot(blobs, 0n, veilNatural(args[0]));
    case 16: {
      const subset = numeric(args[0]);
      const joint = hostFunction(args[1]);
      const slots = args.slice(2).map(argument => readSlot(blobs, argument));
      if (!slots.length) throw new RangeError('a joint computation needs one share or more');
      if (subset < slots.length) throw new RangeError('the subset holds fewer parties than the joint computation has shares');
      return writeSlot(blobs, 0n, joint(slots.map(slot => slot.plain)));
    }
    case 17: return Buffer.from(String(readSlot(blobs, args[0]).plain));
    default: throw new Error(`unknown OS request ${code}`);
  }
}

export async function runReactor(wasmPath, argv = process.argv.slice(2)) {
  const { instance } = await WebAssembly.instantiate(await readFile(wasmPath));
  const api = instance.exports;
  // Slots belong to this invocation, including while an OS request yields
  // to another reactor run. Completion or failure releases this store.
  const blobs = new Map();
  const required = ['emptyBytes', 'consBytes', 'bytesEmpty', 'bytesHead', 'bytesTail', 'emptyWords', 'consWords',
    'wordsEmpty', 'wordsHead', 'wordsTail', 'init', 'resume', 'requestCode', 'requestArgs', 'requestBody', 'exitCode'];
  for (const name of required) if (typeof api[name] !== 'function') throw new Error(`missing reactor export ${name}`);
  const toBytes = buffer => {
    let list = api.emptyBytes();
    for (let i = buffer.length - 1; i >= 0; i--) list = api.consBytes(buffer[i], list);
    return list;
  };
  const fromBytes = list => {
    const bytes = [];
    while (!api.bytesEmpty(list)) {
      const byte = nat(api.bytesHead(list));
      if (byte > 255) throw new RangeError('invalid byte in reactor request');
      bytes.push(byte);
      list = api.bytesTail(list);
    }
    return Buffer.from(bytes);
  };
  let words = api.emptyWords();
  for (let i = argv.length - 1; i >= 0; i--) words = api.consWords(toBytes(Buffer.from(argv[i])), words);
  const interrupted = { signal: null };
  const onInt = () => { interrupted.signal ??= 'SIGINT'; };
  const onTerm = () => { interrupted.signal ??= 'SIGTERM'; };
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  try {
    let state = api.init(words);
    // Set when operation 4 has already handed the program the interruption
    // flag. That delivery earns one further request, so the program can
    // write a summary or release what it holds before the loop ends.
    let grace = false;
    while (true) {
      // A latched SIGINT or SIGTERM ends the loop between requests. Only
      // operation 4 reads the flag while it runs, so a signal delivered
      // during any other operation would otherwise be swallowed.
      if (interrupted.signal && !grace) return signalCode(interrupted.signal);
      grace = false;
      const code = nat(api.requestCode(state));
      if (code === 0) {
        // A terminal shutdown request keeps the latched interruption status.
        return interrupted.signal ? signalCode(interrupted.signal) : nat(api.exitCode(state));
      }
      const args = [];
      let values = api.requestArgs(state);
      while (!api.wordsEmpty(values)) {
        args.push(osString(fromBytes(api.wordsHead(values))));
        values = api.wordsTail(values);
      }
      const body = fromBytes(api.requestBody(state));
      // Only an operation 4 that began without a latched signal can be the
      // one that reports a fresh interruption to the program.
      const armed = code === 4 && !interrupted.signal;
      let status = 0;
      let answer;
      try { answer = await perform(code, args, body, interrupted, blobs); }
      catch (error) { status = 1; answer = Buffer.from(`${error.code ?? 'IO'}: ${error.message}`); }
      grace = armed && status === 0 && Boolean(interrupted.signal);
      state = api.resume(state, status, toBytes(answer));
    }
  } finally {
    process.removeListener('SIGINT', onInt);
    process.removeListener('SIGTERM', onTerm);
  }
}
