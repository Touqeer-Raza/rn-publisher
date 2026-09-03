import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

import { configSchema, keysSchema, type Config, type KeysFile } from './schema.js';
import { resolveKeysPath } from './resolveSecrets.js';
import { PublishError } from '../util/errors.js';

export interface LoadedProject {
  projectRoot: string;
  config: Config;
  keys: KeysFile;
  keysPath: string;
}

function zodMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const loc = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${loc}: ${issue.message}`;
    })
    .join('\n');
}

async function importConfigModule(configPath: string): Promise<unknown> {
  const mod: { default?: unknown } = await import(pathToFileURL(configPath).href);
  if (mod.default && typeof mod.default === 'object') {
    return mod.default;
  }
  return mod;
}

export async function loadConfig(projectRoot: string): Promise<Config> {
  const configPath = path.join(projectRoot, 'rn-publisher.config.js');
  if (!fs.existsSync(configPath)) {
    throw new PublishError(
      `Config file not found: ${configPath}`,
      'Run `rn-publisher init` in the React Native project root, then edit rn-publisher.config.js.',
    );
  }

  let raw: unknown;
  try {
    const pkgJson = path.join(projectRoot, 'package.json');
    const require = createRequire(fs.existsSync(pkgJson) ? pkgJson : configPath);
    raw = require(configPath);
  } catch {
    try {
      raw = await importConfigModule(configPath);
    } catch (error) {
      throw new PublishError(
        `Could not load rn-publisher.config.js: ${error instanceof Error ? error.message : String(error)}`,
        'Fix syntax errors in rn-publisher.config.js. Use `module.exports = { ... }` (CommonJS) or `export default { ... }` (ESM).',
      );
    }
  }

  if (raw && typeof raw === 'object' && 'default' in raw && (raw as { default: unknown }).default) {
    raw = (raw as { default: unknown }).default;
  }

  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PublishError(
      `Invalid rn-publisher.config.js\n${zodMessage(parsed.error)}`,
      'Compare your file with the init template and README → Config reference. Then run `rn-publisher doctor`.',
    );
  }
  return parsed.data;
}

export function loadKeysFile(projectRoot: string, config: Config): { keys: KeysFile; keysPath: string } {
  const keysPath = resolveKeysPath(projectRoot, config);
  if (!fs.existsSync(keysPath)) {
    throw new PublishError(
      `Keys file not found: ${keysPath}`,
      `Run \`rn-publisher init\` or create ${config.keysFile} from the template.`,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
  } catch (error) {
    throw new PublishError(
      `Could not parse keys JSON: ${keysPath}`,
      `Fix JSON syntax (${error instanceof Error ? error.message : String(error)}). See README → Keys file.`,
    );
  }

  const parsed = keysSchema.safeParse(json);
  if (!parsed.success) {
    throw new PublishError(
      `Invalid keys file ${keysPath}\n${zodMessage(parsed.error)}`,
      'Replace example values with real destination keys. See README → Keys file.',
    );
  }

  return { keys: parsed.data, keysPath };
}

export async function loadProject(projectRoot: string): Promise<LoadedProject> {
  const config = await loadConfig(projectRoot);
  const { keys, keysPath } = loadKeysFile(projectRoot, config);
  return { projectRoot, config, keys, keysPath };
}
