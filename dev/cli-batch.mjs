import { execFile } from 'node:child_process';

// Keep each CLI invocation isolated, with at most four live children.
export const runCliBatch = async (command, cases, options = {}) => {
  const results = [];
  for (let start = 0; start < cases.length; start += 4) {
    const batch = await Promise.allSettled(cases.slice(start, start + 4).map(args =>
      new Promise(resolve => {
        let outputBytes = 0;
        let outputError;
        const child = execFile(command, args,
          { encoding: 'utf8', timeout: 20000, maxBuffer: 1048576, ...options },
          (error, stdout, stderr) => {
            error = outputError ?? error;
            // Three fields depart from the spawnSync shape: status is null for
            // every killed child instead of its exit code, signal is null on
            // the ENOBUFS path, and error.code is absent on every killed path.
            resolve({
              status: child.killed ? null : error ? (Number.isInteger(error.code) ? error.code : null) : 0,
              signal: error?.signal ?? null,
              error: error && !Number.isInteger(error.code) ? error
                : child.killed ? new Error('CLI child was killed') : undefined,
              stdout,
              stderr,
            });
          });
        // spawnSync bounds stdout and stderr together; execFile bounds each stream.
        const countOutput = chunk => {
          outputBytes += Buffer.byteLength(chunk);
          if (outputBytes > (options.maxBuffer ?? 1048576) && !outputError) {
            outputError = Object.assign(new Error('CLI output exceeded maxBuffer'), { code: 'ENOBUFS' });
            child.kill();
          }
        };
        child.stdout?.on('data', countOutput);
        child.stderr?.on('data', countOutput);
        child.stdin?.end();
      })));
    // Drain the current batch before reporting an invalid invocation.
    for (const result of batch) {
      if (result.status === 'rejected') throw result.reason;
      results.push(result.value);
    }
  }
  return results;
};
