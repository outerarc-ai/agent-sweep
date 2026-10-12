import os from 'node:os';

export const PLATFORM = process.platform;

export const isDarwin = PLATFORM === 'darwin';
export const isLinux = PLATFORM === 'linux';
export const isWindows = PLATFORM === 'win32';

export function platformLabel(platform = PLATFORM) {
  switch (platform) {
    case 'darwin':
      return 'macOS';
    case 'linux':
      return 'Linux';
    case 'win32':
      return 'Windows';
    default:
      return platform;
  }
}

export function homedir() {
  return process.env.AGENT_SWEEP_HOME_DIR || os.homedir();
}