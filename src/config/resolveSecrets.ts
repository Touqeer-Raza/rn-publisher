import type { Config } from './schema.js';
import { resolveProjectPath, resolveSecretPath } from '../util/paths.js';

export function resolveKeysPath(projectRoot: string, config: Config): string {
  return resolveProjectPath(projectRoot, config.keysFile);
}

export function resolveSecret(
  projectRoot: string,
  config: Config,
  relativeOrAbsolute: string,
): string {
  return resolveSecretPath(projectRoot, config.secretsDir, relativeOrAbsolute);
}
