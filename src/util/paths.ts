import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PublishError } from './errors.js';

export function packageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
}

export function templatesDir(): string {
  return path.join(packageRoot(), 'templates');
}

export function resolveProjectPath(projectRoot: string, target: string): string {
  if (path.isAbsolute(target)) {
    return target;
  }
  return path.resolve(projectRoot, target);
}

export function resolveSecretPath(
  projectRoot: string,
  secretsDir: string,
  target: string,
): string {
  if (path.isAbsolute(target)) {
    return target;
  }
  return path.resolve(resolveProjectPath(projectRoot, secretsDir), target);
}

export function findProjectRoot(start = process.cwd()): string {
  let dir = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(dir, 'rn-publisher.config.js'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return path.resolve(start);
    }
    dir = parent;
  }
}

export function requireFile(
  filePath: string,
  message: string,
  suggestion: string,
): void {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new PublishError(message, suggestion);
  }
}

export function requireDir(
  dirPath: string,
  message: string,
  suggestion: string,
): void {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    throw new PublishError(message, suggestion);
  }
}
