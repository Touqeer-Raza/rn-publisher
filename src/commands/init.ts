import fs from 'node:fs';
import path from 'node:path';

import { PLACEHOLDERS } from '../config/placeholders.js';
import { confirm } from '../prompts/confirm.js';
import * as log from '../util/log.js';
import { templatesDir } from '../util/paths.js';
import { detectProject } from './detectProject.js';

export interface InitOptions {
  cwd?: string;
  yes?: boolean;
}

const DEFAULT_SECRETS_DIR = './publish-secrets';

function readTemplate(name: string): string {
  return fs.readFileSync(path.join(templatesDir(), name), 'utf8');
}

function appendGitignore(projectRoot: string, secretsDir: string): void {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  const normalized = secretsDir.replace(/\\/g, '/');
  const block = [
    '',
    '# @touqeerraza/rn-publisher',
    normalized,
    '.release',
    '.release.*',
    '',
  ].join('\n');

  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, `${block.trimStart()}\n`);
    return;
  }

  const existing = fs.readFileSync(gitignorePath, 'utf8');
  if (existing.includes('# @touqeerraza/rn-publisher')) {
    if (!existing.split(/\r?\n/).includes(normalized)) {
      const prefix = existing.endsWith('\n') ? '' : '\n';
      fs.appendFileSync(gitignorePath, `${prefix}${normalized}\n`);
    }
    return;
  }
  const prefix = existing.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(gitignorePath, `${prefix}${block}`);
}

export async function runInit(options: InitOptions = {}): Promise<void> {
  const projectRoot = path.resolve(options.cwd ?? process.cwd());
  const configPath = path.join(projectRoot, 'rn-publisher.config.js');
  const detected = detectProject(projectRoot);

  if (fs.existsSync(configPath) && !options.yes) {
    const overwrite = await confirm(
      'Config/keys already exist. Overwrite rn-publisher.config.js and keys.json?',
      false,
    );
    if (!overwrite) {
      log.warn('Init cancelled. Existing files were left unchanged.');
      return;
    }
  }

  const secretsDir = DEFAULT_SECRETS_DIR;
  const keysFile = path.posix.join(secretsDir, 'keys.json');

  const packageName = detected.packageName ?? PLACEHOLDERS.packageName;
  const bundleId = detected.bundleId ?? PLACEHOLDERS.bundleId;

  const config = readTemplate('rn-publisher.config.js')
    .replaceAll('__SECRETS_DIR__', secretsDir)
    .replaceAll('__KEYS_FILE__', keysFile)
    .replaceAll('__VERSION_CODE_FILE__', detected.versionCodeFile)
    .replaceAll('__WORKSPACE__', detected.workspace)
    .replaceAll('__SCHEME__', detected.scheme);

  const keys = readTemplate('keys.json')
    .replaceAll('__FIREBASE_APP_ID__', PLACEHOLDERS.firebaseAppId)
    .replaceAll('__PACKAGE_NAME__', packageName)
    .replaceAll('__BUNDLE_ID__', bundleId);

  const secretsReadme = readTemplate('secrets-README.md');

  const absSecrets = path.resolve(projectRoot, secretsDir);
  fs.mkdirSync(absSecrets, { recursive: true });
  fs.writeFileSync(configPath, config);
  fs.writeFileSync(path.join(absSecrets, 'keys.json'), keys);
  fs.writeFileSync(path.join(absSecrets, 'README.md'), secretsReadme);
  appendGitignore(projectRoot, secretsDir);

  log.blank();
  log.success('Init complete. Files written:');
  log.info(`  ${path.relative(projectRoot, configPath) || 'rn-publisher.config.js'}`);
  log.info(`  ${path.join(secretsDir, 'keys.json')}  (gitignored)`);
  log.info(`  ${path.join(secretsDir, 'README.md')}`);
  log.info('  .gitignore  (publisher entries)');
  log.blank();
  log.info('Detected from this app:');
  log.info(`  play.packageName: ${packageName}${detected.packageName ? '' : '  (example — replace)'}`);
  log.info(`  apple.bundleId:   ${bundleId}${detected.bundleId ? '' : '  (example — replace)'}`);
  log.info(`  ios.workspace:    ${detected.workspace}`);
  log.info(`  ios.scheme:       ${detected.scheme}`);
  log.blank();
  log.info('Next:');
  log.info('  1. Review rn-publisher.config.js — Gradle tasks, APK/AAB paths, Xcode scheme.');
  log.info(`  2. Replace remaining example values in ${keysFile} (Firebase app id, Apple API key).`);
  log.info(`  3. Drop Play JSON and AuthKey .p8 into ${secretsDir}.`);
  log.info('  4. Add a script:  "publish:app": "rn-publisher"');
  log.info('  5. Run `rn-publisher doctor` then `rn-publisher`.');
  log.blank();
  if (!detected.packageName || !detected.bundleId) {
    log.info(
      `Still using examples where detection failed: ${PLACEHOLDERS.firebaseAppId}, ${PLACEHOLDERS.packageName}, ${PLACEHOLDERS.apiKeyId}`,
    );
  } else {
    log.info(
      `Still replace Firebase/Apple placeholders: ${PLACEHOLDERS.firebaseAppId}, ${PLACEHOLDERS.apiKeyId}`,
    );
  }
}
