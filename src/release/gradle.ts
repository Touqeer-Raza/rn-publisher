import fs from 'node:fs';
import path from 'node:path';

import { execa } from 'execa';

import type { AndroidConfig, EnvironmentConfig } from '../config/schema.js';
import { PublishError } from '../util/errors.js';
import { resolveProjectPath } from '../util/paths.js';

export function findAndroidRoot(projectRoot: string, android: AndroidConfig): string {
  let dir = path.dirname(resolveProjectPath(projectRoot, android.versionCodeFile));
  while (true) {
    if (
      fs.existsSync(path.join(dir, 'gradlew')) ||
      fs.existsSync(path.join(dir, 'gradlew.bat'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  const fallback = path.join(projectRoot, 'android');
  if (
    fs.existsSync(path.join(fallback, 'gradlew')) ||
    fs.existsSync(path.join(fallback, 'gradlew.bat'))
  ) {
    return fallback;
  }

  throw new PublishError(
    'Could not find Gradle wrapper (gradlew).',
    'Run this from a React Native project with an android/ folder, or set android.versionCodeFile so it sits under the Gradle root.',
  );
}

function gradlewBin(androidRoot: string): string {
  if (process.platform === 'win32') {
    return path.join(androidRoot, 'gradlew.bat');
  }
  return path.join(androidRoot, 'gradlew');
}

export async function runGradle(
  projectRoot: string,
  env: EnvironmentConfig,
  tasks: string[],
): Promise<void> {
  if (!env.android) {
    throw new PublishError(
      'Missing android config for this environment.',
      'Add an `android` block in rn-publisher.config.js.',
    );
  }
  const androidRoot = findAndroidRoot(projectRoot, env.android);
  const bin = gradlewBin(androidRoot);

  const result = await execa(bin, tasks, {
    cwd: androidRoot,
    stdio: 'inherit',
    reject: false,
  });

  if (result.exitCode !== 0) {
    throw new PublishError(
      `Gradle failed (${tasks.join(' ')}) with exit code ${result.exitCode}.`,
      'Scroll the Gradle output above. Common fixes: signing config, or assembleTask / bundleTask names.',
    );
  }
}
