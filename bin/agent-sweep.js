#!/usr/bin/env node
import { main } from '../src/cli/index.js';

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = typeof code === 'number' ? code : 0;
  })
  .catch((err) => {
    const message = err && err.stack ? err.stack : String(err);
    process.stderr.write(`agent-sweep: fatal: ${message}\n`);
    process.exitCode = 1;
  });