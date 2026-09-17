import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const original = childProcess.spawnSync;
const started = performance.now();
const calls = [];
childProcess.spawnSync = (...args) => {
  const start = performance.now();
  const result = original(...args);
  calls.push({ executable: args[0], arguments: args[1]?.slice(0, 3),
    elapsed_ms: Math.round(performance.now() - start), status: result.status });
  return result;
};
syncBuiltinESMExports();
process.on('exit', () => {
  const elapsed_ms = Math.round(performance.now() - started);
  const subprocess_ms = calls.reduce((sum, call) => sum + call.elapsed_ms, 0);
  const slowest = [...calls].sort((left, right) => right.elapsed_ms - left.elapsed_ms).slice(0, 8);
  process.stderr.write(JSON.stringify({ elapsed_ms, subprocess_ms, calls: calls.length, slowest }) + '\n');
});
