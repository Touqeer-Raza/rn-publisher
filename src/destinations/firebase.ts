import fs from 'node:fs';

import { execa } from 'execa';

import type { LoadedProject } from '../config/load.js';
import { resolveProjectPath } from '../util/paths.js';
import { PublishError } from '../util/errors.js';
import * as log from '../util/log.js';

export async function distributeFirebase(
  project: LoadedProject,
  envName: string,
  notes: string,
): Promise<void> {
  const env = project.config.environments[envName];
  const firebase = project.keys[envName]?.firebase;
  if (!env?.android || !firebase) {
    throw new PublishError(
      'Firebase upload is missing android config or firebase keys.',
      'Add android paths in rn-publisher.config.js and firebase.appId / firebase.groups in the keys file.',
    );
  }

  const apkPath = resolveProjectPath(project.projectRoot, env.android.apkPath);
  if (!fs.existsSync(apkPath)) {
    throw new PublishError(
      `APK not found: ${apkPath}`,
      'Confirm android.apkPath matches Gradle output (flavor/build type). Run without skipping the Android build.',
    );
  }

  const size = fs.statSync(apkPath).size;
  log.success(`APK ready: ${apkPath} (${formatSize(size)})`);
  log.blank();
  log.info('Uploading to Firebase App Distribution...');
  log.info(`  Env:    ${envName}`);
  log.info(`  App ID: ${firebase.appId}`);
  log.info(`  Groups: ${firebase.groups}`);
  log.blank();

  const result = await execa(
    'firebase',
    [
      'appdistribution:distribute',
      apkPath,
      '--app',
      firebase.appId,
      '--release-notes',
      notes,
      '--groups',
      firebase.groups,
    ],
    { cwd: project.projectRoot, stdio: 'inherit', reject: false },
  );

  if (result.exitCode !== 0) {
    throw new PublishError(
      `Firebase App Distribution failed (exit ${result.exitCode}).`,
      'Confirm firebase.appId and testers groups in the keys file, and that `firebase login` can see this project.',
    );
  }

  log.blank();
  log.success('Firebase upload complete.');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}
