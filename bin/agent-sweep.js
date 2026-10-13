#!/usr/bin/env node
import { main } from '../src/cli/index.js';

// A closed downstream pipe (`agent-sweep scan | head`) is a normal way for a
// CLI to stop, not a crash.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err) => {
    if (err && err.code === 'EPIPE') process.exit(process.exitCode || 0);
    throw err;
  });
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = typeof code === 'number' ? code : 0;
  })
  .catch((err) => {
    const message = err && err.stack ? err.stack : String(err);
    process.stderr.write(`agent-sweep: fatal: ${message}\n`);
    process.exitCode = 1;
  });