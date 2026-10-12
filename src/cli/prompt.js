import readline from 'node:readline';

export async function promptConfirm(question, { input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY) return null;
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await new Promise((resolve) => rl.question(`${question} [y/N] `, resolve));
    return /^y(es)?$/i.test(String(answer).trim());
  } finally {
    rl.close();
  }
}

export function isInteractive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}