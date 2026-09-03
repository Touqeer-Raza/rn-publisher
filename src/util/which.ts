import { execFileSync } from 'node:child_process';

export function hasCommand(name: string): boolean {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    execFileSync(cmd, [name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function isDarwin(): boolean {
  return process.platform === 'darwin';
}
