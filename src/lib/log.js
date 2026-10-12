import { formatDate } from './format.js';

const COLORS = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  magenta: '\u001b[35m',
  cyan: '\u001b[36m',
  gray: '\u001b[90m',
};

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

function supportsColor(stream) {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(stream && stream.isTTY);
}

export function createLogger(options = {}) {
  const level = options.level || 'info';
  const json = Boolean(options.json);
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  const color = options.color === undefined ? supportsColor(stderr) : Boolean(options.color);
  const threshold = LEVELS[level] === undefined ? LEVELS.info : LEVELS[level];

  const paint = (name, text) => (color ? `${COLORS[name]}${text}${COLORS.reset}` : text);

  const emit = (levelName, target, args) => {
    if (LEVELS[levelName] > threshold) return;
    if (json) {
      const record = {
        time: new Date().toISOString(),
        level: levelName,
        message: args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '),
      };
      target.write(JSON.stringify(record) + '\n');
      return;
    }
    const tag =
      levelName === 'error'
        ? paint('red', 'error')
        : levelName === 'warn'
          ? paint('yellow', 'warn')
          : levelName === 'debug'
            ? paint('gray', 'debug')
            : paint('cyan', 'info');
    target.write(`${paint('gray', `[${tag}]`)} ${args.join(' ')}\n`);
  };

  return {
    level,
    colors: color,
    paint,
    error: (...args) => emit('error', stderr, args),
    warn: (...args) => emit('warn', stderr, args),
    info: (...args) => emit('info', stdout, args),
    debug: (...args) => emit('debug', stderr, args),
    out: (text = '') => stdout.write(`${text}\n`),
    raw: (text = '') => stdout.write(text),
    timestamp: () => paint('gray', formatDate(new Date())),
  };
}

export const silentLogger = createLogger({ level: 'silent', color: false });