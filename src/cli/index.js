import { parseArgs } from './args.js';
import { createLogger } from '../lib/log.js';
import { helpText, versionText } from './help.js';
import { createContext } from './context.js';

import * as scanCommand from './commands/scan.js';
import * as planCommand from './commands/plan.js';
import * as cleanCommand from './commands/clean.js';
import * as restoreCommand from './commands/restore.js';
import * as trashCommand from './commands/trash.js';
import * as harnessesCommand from './commands/harnesses.js';
import * as doctorCommand from './commands/doctor.js';
import * as uiCommand from './commands/ui.js';

const COMMANDS = new Map([
  ['scan', scanCommand],
  ['plan', planCommand],
  ['clean', cleanCommand],
  ['restore', restoreCommand],
  ['trash', trashCommand],
  ['harnesses', harnessesCommand],
  ['doctor', doctorCommand],
  ['ui', uiCommand],
  ['serve', uiCommand],
  ['web', uiCommand],
]);

function resolveLoggerLevel(flags) {
  if (flags.quiet) return 'warn';
  if (flags.verbose) return 'debug';
  return 'info';
}

export async function main(argv = []) {
  const { flags, positionals } = parseArgs(argv);

  if (flags.version) {
    process.stdout.write(`${versionText()}\n`);
    return 0;
  }

  let command = 'scan';
  const first = positionals[0];
  if (first && COMMANDS.has(first)) {
    command = positionals.shift();
  } else if (first === 'help') {
    positionals.shift();
    command = 'help';
  } else if (first === 'version') {
    positionals.shift();
    command = 'version';
  } else if (first) {
    command = first;
  }

  if (command === 'version') {
    process.stdout.write(`${versionText()}\n`);
    return 0;
  }

  if (flags.help || command === 'help') {
    process.stdout.write(helpText());
    return 0;
  }

  const logger = createLogger({
    level: resolveLoggerLevel(flags),
    json: Boolean(flags.json),
    color: flags.noColor ? false : undefined,
  });

  if (flags.unknown && flags.unknown.length > 0) {
    logger.warn(`忽略未知参数: ${flags.unknown.map((u) => (u.length === 1 ? `-${u}` : `--${u}`)).join(', ')}`);
  }

  const handler = COMMANDS.get(command);
  if (!handler) {
    logger.error(`未知命令: ${command}`);
    process.stdout.write(helpText());
    return 2;
  }

  let ctx;
  try {
    ctx = await createContext({ flags, positionals, logger });
  } catch (err) {
    logger.error(err && err.message ? err.message : String(err));
    return 1;
  }

  try {
    return await handler.run(ctx);
  } catch (err) {
    logger.error(err && err.stack ? err.stack : String(err));
    return 1;
  }
}

export { COMMANDS };