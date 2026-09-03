import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';

import { PublishError } from '../util/errors.js';
import { resolveProjectPath } from '../util/paths.js';
import { hasCommand } from '../util/which.js';

function firstUncommentedMatch(text: string, pattern: RegExp): RegExpMatchArray | null {
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith('//')) {
      continue;
    }
    const match = line.match(pattern);
    if (match) {
      return match;
    }
  }
  return null;
}

export function readAndroidVersionCode(filePath: string): number {
  const text = fs.readFileSync(filePath, 'utf8');
  const match = firstUncommentedMatch(text, /versionCode\s*(?:=\s*)?(\d+)/);
  if (match) {
    return Number(match[1]);
  }
  throw new PublishError(
    `Could not find versionCode in ${filePath}`,
    'Ensure the file contains `versionCode <number>` (not commented out), or point android.versionCodeFile at android/app/build.gradle.',
  );
}

export function readAndroidVersionName(filePath: string): string {
  const text = fs.readFileSync(filePath, 'utf8');
  const match = firstUncommentedMatch(
    text,
    /versionName\s*(?:=\s*)?["']([^"']+)["']/,
  );
  if (match?.[1]) {
    return match[1];
  }
  throw new PublishError(
    `Could not find versionName in ${filePath}`,
    'Ensure the file contains `versionName "x.y.z"` (not commented out).',
  );
}

export function writeAndroidVersionCode(filePath: string, next: number): void {
  const text = fs.readFileSync(filePath, 'utf8');
  let replaced = false;
  const nextText = text
    .split(/\r?\n/)
    .map((line) => {
      if (replaced || line.trim().startsWith('//')) {
        return line;
      }
      if (/versionCode\s*(?:=\s*)?\d+/.test(line)) {
        replaced = true;
        return line.replace(/versionCode\s*(?:=\s*)?(\d+)/, (full, _old) =>
          full.replace(String(_old), String(next)),
        );
      }
      return line;
    })
    .join('\n');

  if (!replaced) {
    throw new PublishError(
      `Could not update versionCode in ${filePath}`,
      'The file must contain an uncommented `versionCode <number>` assignment.',
    );
  }
  fs.writeFileSync(filePath, nextText);
}

export function writeAndroidVersionName(filePath: string, next: string): void {
  const text = fs.readFileSync(filePath, 'utf8');
  let replaced = false;
  const nextText = text
    .split(/\r?\n/)
    .map((line) => {
      if (replaced || line.trim().startsWith('//')) {
        return line;
      }
      if (/versionName\s*(?:=\s*)?["'][^"']+["']/.test(line)) {
        replaced = true;
        return line.replace(
          /(versionName\s*(?:=\s*)?)(["'])([^"']+)\2/,
          `$1$2${next}$2`,
        );
      }
      return line;
    })
    .join('\n');

  if (!replaced) {
    throw new PublishError(
      `Could not update versionName in ${filePath}`,
      'The file must contain an uncommented `versionName "x.y.z"` assignment.',
    );
  }
  fs.writeFileSync(filePath, nextText);
}

export function writeAndroidVersions(
  filePath: string,
  versionName: string,
  versionCode: number,
): void {
  writeAndroidVersionName(filePath, versionName);
  writeAndroidVersionCode(filePath, versionCode);
}

/** True for values safe to write into Xcode (e.g. 1.2.3, 1.0, 1.0.0-beta.1). */
export function isSafeMarketingVersion(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('$(') || trimmed.includes('/') || trimmed.includes('=')) {
    return false;
  }
  return /^\d+\.\d+(\.\d+)?([-+.][0-9A-Za-z.-]+)?$/.test(trimmed);
}

/** True for CFBundleVersion / CURRENT_PROJECT_VERSION style integers. */
export function isSafeBuildNumber(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

/**
 * agvtool often prints: "Path/To/Info.plist"=1.0.0
 * or: "Path/To/Info.plist"=$(MARKETING_VERSION)
 */
function parseAgvtoolVersionLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  const eq = trimmed.indexOf('=');
  const candidate = (eq >= 0 ? trimmed.slice(eq + 1) : trimmed).trim().replace(/^"|"$/g, '');
  return candidate || null;
}

function readMarketingVersionFromPbx(pbxPath: string): string | null {
  const text = fs.readFileSync(pbxPath, 'utf8');
  const matches = [...text.matchAll(/MARKETING_VERSION = ([^;]+);/g)]
    .map((match) => match[1]?.trim().replace(/^"|"$/g, '') ?? '')
    .filter(Boolean);
  const concrete = matches.find((value) => isSafeMarketingVersion(value));
  return concrete ?? null;
}

function readBuildNumberFromPbx(pbxPath: string): string | null {
  const text = fs.readFileSync(pbxPath, 'utf8');
  const matches = [...text.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)]
    .map((match) => match[1]?.trim().replace(/^"|"$/g, '') ?? '')
    .filter(Boolean);
  const concrete = matches.find((value) => isSafeBuildNumber(value));
  return concrete ?? null;
}

export async function readIosBuildNumber(projectDir: string): Promise<string> {
  const pbx = findPbxproj(projectDir);
  const fromPbx = readBuildNumberFromPbx(pbx);
  if (fromPbx) {
    return fromPbx;
  }

  if (hasCommand('agvtool')) {
    const result = await execa('agvtool', ['what-version', '-terse'], {
      cwd: projectDir,
      reject: false,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (result.exitCode === 0 && result.stdout.trim()) {
      const parsed = parseAgvtoolVersionLine(result.stdout.split(/\r?\n/).find(Boolean) ?? '');
      if (parsed && isSafeBuildNumber(parsed)) {
        return parsed.trim();
      }
    }
  }

  throw new PublishError(
    `Could not read a numeric CURRENT_PROJECT_VERSION in ${pbx}`,
    'In Xcode → Build Settings, set Current Project Version to an integer (e.g. 1), not a variable reference.',
  );
}

export async function readIosMarketingVersion(projectDir: string): Promise<string> {
  const pbx = findPbxproj(projectDir);
  const fromPbx = readMarketingVersionFromPbx(pbx);
  if (fromPbx) {
    return fromPbx;
  }

  if (hasCommand('agvtool')) {
    const result = await execa('agvtool', ['what-marketing-version', '-terse'], {
      cwd: projectDir,
      reject: false,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (result.exitCode === 0 && result.stdout.trim()) {
      for (const line of result.stdout.split(/\r?\n/)) {
        const parsed = parseAgvtoolVersionLine(line);
        if (parsed && isSafeMarketingVersion(parsed)) {
          return parsed;
        }
      }
    }
  }

  throw new PublishError(
    `Could not read MARKETING_VERSION in ${pbx}`,
    'In Xcode → Build Settings, set Marketing Version to a value like 1.0.0 (not $(MARKETING_VERSION) / Info.plist-only).',
  );
}

export async function writeIosBuildNumber(projectDir: string, version: string): Promise<void> {
  const next = version.trim();
  if (!isSafeBuildNumber(next)) {
    throw new PublishError(
      `Refusing to write unsafe iOS build number: ${version}`,
      'Build number must be a positive integer.',
    );
  }

  // Prefer editing pbxproj directly. agvtool can rewrite Info.plist paths and corrupt projects
  // when versions are not set up for Apple Generic Versioning.
  const pbx = findPbxproj(projectDir);
  const text = fs.readFileSync(pbx, 'utf8');
  const replaced = text.replace(
    /CURRENT_PROJECT_VERSION = [^;]+;/g,
    `CURRENT_PROJECT_VERSION = ${next};`,
  );
  if (replaced !== text) {
    fs.writeFileSync(pbx, replaced);
    return;
  }

  if (hasCommand('agvtool')) {
    const result = await execa('agvtool', ['new-version', '-all', next], {
      cwd: projectDir,
      reject: false,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (result.exitCode === 0) {
      return;
    }
  }

  throw new PublishError(
    `Could not update CURRENT_PROJECT_VERSION in ${pbx}`,
    'Set CURRENT_PROJECT_VERSION in the Xcode project Build Settings.',
  );
}

export async function writeIosMarketingVersion(
  projectDir: string,
  version: string,
): Promise<void> {
  const next = version.trim();
  if (!isSafeMarketingVersion(next)) {
    throw new PublishError(
      `Refusing to write unsafe iOS marketing version: ${version}`,
      'Use a version like 1.2.3. Set Marketing Version in Xcode Build Settings.',
    );
  }

  const pbx = findPbxproj(projectDir);
  const text = fs.readFileSync(pbx, 'utf8');
  const replaced = text.replace(
    /MARKETING_VERSION = [^;]+;/g,
    `MARKETING_VERSION = ${next};`,
  );
  if (replaced !== text) {
    fs.writeFileSync(pbx, replaced);
    return;
  }

  if (hasCommand('agvtool')) {
    const result = await execa(
      'agvtool',
      ['new-marketing-version', next],
      {
        cwd: projectDir,
        reject: false,
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    if (result.exitCode === 0) {
      return;
    }
  }

  throw new PublishError(
    `Could not update MARKETING_VERSION in ${pbx}`,
    'Set MARKETING_VERSION in the Xcode project Build Settings to a concrete value like 1.0.0.',
  );
}

export async function writeIosVersions(
  projectDir: string,
  versionName: string,
  buildNumber: string,
): Promise<void> {
  await writeIosMarketingVersion(projectDir, versionName);
  await writeIosBuildNumber(projectDir, buildNumber);
}

/** @deprecated Use writeIosBuildNumber — kept name for clarity in older call sites */
export async function writeIosVersion(projectDir: string, version: string): Promise<void> {
  await writeIosBuildNumber(projectDir, version);
}

/** @deprecated Use readIosBuildNumber */
export async function readIosVersion(projectDir: string): Promise<string> {
  return readIosBuildNumber(projectDir);
}

export function findPbxproj(projectDir: string): string {
  const entries = fs.readdirSync(projectDir);
  const xcodeproj = entries.find((name) => name.endsWith('.xcodeproj'));
  if (!xcodeproj) {
    throw new PublishError(
      `No .xcodeproj in ${projectDir}`,
      'Set ios.projectDir to the folder that contains YourApp.xcodeproj.',
    );
  }
  return path.join(projectDir, xcodeproj, 'project.pbxproj');
}

export function releaseMarkerPath(envName: string, projectRoot: string): string {
  return resolveProjectPath(projectRoot, `.release.${envName}`);
}

export function writeReleaseMarker(filePath: string, commit: string): void {
  fs.writeFileSync(filePath, `COMMIT_ID=${commit}${os.EOL}`);
}

export function readReleaseCommit(filePath: string): string | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  const line = fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .find((row) => row.startsWith('COMMIT_ID='));
  return line?.slice('COMMIT_ID='.length).trim() || undefined;
}
