'use strict';

const { execFile } = require('child_process');

const DEFAULT_TIMEOUT = 5 * 60 * 1000; // 5 minutes

function runCommand(cmd, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const timeout = options.timeout || DEFAULT_TIMEOUT;
    const cwd = options.cwd || process.cwd();
    const env = options.env || process.env;

    const child = execFile(
      cmd,
      args,
      { cwd, env, maxBuffer: 10 * 1024 * 1024, timeout },
      (error, stdout, stderr) => {
        if (error && error.killed) {
          return reject(new Error(`Command timed out after ${timeout}ms: ${cmd} ${args.join(' ')}`));
        }
        resolve({
          stdout: stdout || '',
          stderr: stderr || '',
          exitCode: error ? (error.code || 1) : 0,
        });
      }
    );

    if (options.onStdout) {
      child.stdout.on('data', options.onStdout);
    }
    if (options.onStderr) {
      child.stderr.on('data', options.onStderr);
    }
  });
}

module.exports = { runCommand };
