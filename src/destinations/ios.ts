import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';

import type { LoadedProject } from '../config/load.js';
import { resolveSecret } from '../config/resolveSecrets.js';
import { PublishError } from '../util/errors.js';
import * as log from '../util/log.js';
import { resolveProjectPath } from '../util/paths.js';
import { isDarwin } from '../util/which.js';

function dumpLogTail(logFile: string): void {
  if (!fs.existsSync(logFile)) {
    return;
  }
  const lines = fs.readFileSync(logFile, 'utf8').split(/\r?\n/);
  const tail = lines.slice(-80).join('\n');
  log.info(`  Last 80 lines of ${logFile}:`);
  console.log(tail);
}

function ensureAscApiKey(apiKeyId: string, p8Path: string): void {
  const destDir = path.join(os.homedir(), '.appstoreconnect/private_keys');
  const dest = path.join(destDir, `AuthKey_${apiKeyId}.p8`);
  fs.mkdirSync(destDir, { recursive: true });
  if (fs.existsSync(dest)) {
    return;
  }
  try {
    fs.symlinkSync(p8Path, dest);
  } catch {
    fs.copyFileSync(p8Path, dest);
  }
}

export async function uploadTestFlight(
  project: LoadedProject,
  envName: string,
): Promise<void> {
  if (!isDarwin()) {
    throw new PublishError(
      'iOS TestFlight publishing is only available on macOS.',
      'Run this destination on a Mac with Xcode installed.',
    );
  }

  const env = project.config.environments[envName];
  const apple = project.keys[envName]?.apple;
  if (!env?.ios || !apple) {
    throw new PublishError(
      'iOS upload is missing ios config or apple keys.',
      'Add ios.workspace / scheme in rn-publisher.config.js and apple keys in the keys file.',
    );
  }

  const workspace = resolveProjectPath(project.projectRoot, env.ios.workspace);
  const exportPlist = resolveProjectPath(project.projectRoot, env.ios.exportOptionsPlist);
  const projectDir = resolveProjectPath(project.projectRoot, env.ios.projectDir);
  const buildDir = path.join(projectDir, 'build');
  fs.mkdirSync(buildDir, { recursive: true });

  const archivePath = path.join(buildDir, `archive-${envName}.xcarchive`);
  const exportPath = path.join(buildDir, `export-${envName}`);
  const archiveLog = path.join(buildDir, `archive-${envName}.log`);
  const exportLog = path.join(buildDir, `export-${envName}.log`);

  log.info(`Archiving ${env.ios.scheme} (${envName}, ${env.ios.configuration}) — this takes a few minutes...`);
  log.info(`  Log: ${archiveLog}`);
  log.blank();

  fs.rmSync(archivePath, { recursive: true, force: true });

  const archiveArgs = [
    'archive',
    '-workspace',
    workspace,
    '-scheme',
    env.ios.scheme,
    '-configuration',
    env.ios.configuration,
    '-destination',
    'generic/platform=iOS',
    '-archivePath',
    archivePath,
    '-allowProvisioningUpdates',
  ];

  const archive = await execa('xcodebuild', archiveArgs, {
    cwd: project.projectRoot,
    reject: false,
    all: true,
  });
  fs.writeFileSync(archiveLog, archive.all ?? '');
  if (archive.exitCode !== 0) {
    dumpLogTail(archiveLog);
    throw new PublishError(
      `Archive failed. See ${archiveLog}`,
      'Open the log for signing / scheme / workspace errors. Confirm ios.scheme and ios.configuration, and that CocoaPods are installed.',
    );
  }
  if (!fs.existsSync(archivePath)) {
    dumpLogTail(archiveLog);
    throw new PublishError(
      `Archive not found at ${archivePath}`,
      'The xcodebuild archive step did not produce an .xcarchive. See the archive log.',
    );
  }

  log.success(`Archive created: ${archivePath}`);
  log.blank();
  log.info('Exporting IPA...');
  log.info(`  Log: ${exportLog}`);

  fs.rmSync(exportPath, { recursive: true, force: true });

  const exported = await execa(
    'xcodebuild',
    [
      '-exportArchive',
      '-archivePath',
      archivePath,
      '-exportOptionsPlist',
      exportPlist,
      '-exportPath',
      exportPath,
      '-allowProvisioningUpdates',
    ],
    { cwd: project.projectRoot, reject: false, all: true },
  );
  fs.writeFileSync(exportLog, exported.all ?? '');
  if (exported.exitCode !== 0) {
    dumpLogTail(exportLog);
    throw new PublishError(
      `Export failed. See ${exportLog}`,
      'Check ios.exportOptionsPlist (method should be app-store) and signing certificates.',
    );
  }

  const ipaPath = findIpa(exportPath);
  if (!ipaPath) {
    dumpLogTail(exportLog);
    throw new PublishError(
      `No .ipa found in ${exportPath}`,
      'Export succeeded but produced no IPA. Inspect the export log and ExportOptions plist.',
    );
  }

  const size = fs.statSync(ipaPath).size;
  log.success(`IPA exported: ${ipaPath} (${formatSize(size)})`);
  log.blank();
  log.info('Uploading to TestFlight...');
  log.info(`  Env:       ${envName}`);
  log.info(`  Bundle ID: ${apple.bundleId}`);

  const apiKeyId = apple.apiKeyId?.trim();
  const apiIssuerId = apple.apiIssuerId?.trim();
  const apiKeyP8 = apple.apiKeyP8?.trim();
  const useApiKey = Boolean(apiKeyId && apiIssuerId && apiKeyP8);

  let upload;
  if (useApiKey && apiKeyId && apiIssuerId && apiKeyP8) {
    const p8 = resolveSecret(project.projectRoot, project.config, apiKeyP8);
    log.info(`  Auth:      App Store Connect API key ${apiKeyId}`);
    log.blank();
    ensureAscApiKey(apiKeyId, p8);
    upload = await execa(
      'xcrun',
      [
        'altool',
        '--upload-app',
        '-f',
        ipaPath,
        '-t',
        'ios',
        '--apiKey',
        apiKeyId,
        '--apiIssuer',
        apiIssuerId,
      ],
      { cwd: project.projectRoot, stdio: 'inherit', reject: false },
    );
  } else {
    log.info(`  Apple ID:  ${apple.uploadEmail}`);
    log.blank();
    upload = await execa(
      'xcrun',
      [
        'altool',
        '--upload-app',
        '-f',
        ipaPath,
        '-t',
        'ios',
        '-u',
        apple.uploadEmail ?? '',
        '-p',
        apple.appSpecificPassword ?? '',
      ],
      { cwd: project.projectRoot, stdio: 'inherit', reject: false },
    );
  }

  if (upload.exitCode !== 0) {
    throw new PublishError(
      `TestFlight upload failed (exit ${upload.exitCode}).`,
      'Verify apple.apiKeyId / apiIssuerId / apiKeyP8 (or upload email + app-specific password) in the keys file.',
    );
  }

  log.blank();
  log.success('Upload complete. The build will appear in TestFlight within a few minutes.');
}

function findIpa(exportPath: string): string | undefined {
  if (!fs.existsSync(exportPath)) {
    return undefined;
  }
  const stack = [exportPath];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      break;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name.endsWith('.ipa')) {
        return full;
      }
    }
  }
  return undefined;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}
