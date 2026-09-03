import fs from 'node:fs';

import type { LoadedProject } from '../config/load.js';
import { PLACEHOLDERS, isPlaceholder } from '../config/placeholders.js';
import { resolveSecret } from '../config/resolveSecrets.js';
import type { EnvironmentConfig, EnvKeys } from '../config/schema.js';
import type { Availability, Platform } from '../types.js';
import { PublishError } from '../util/errors.js';
import { resolveProjectPath } from '../util/paths.js';
import { suggestionForAvailability } from './tools.js';

export interface Issue {
  message: string;
  suggestion: string;
}

function issue(message: string, suggestion: string): Issue {
  return { message, suggestion };
}

function envKeys(
  project: LoadedProject,
  envName: string,
): EnvKeys {
  const keys = project.keys[envName];
  if (!keys) {
    throw new PublishError(
      `No keys for environment "${envName}" in ${project.keysPath}`,
      `Add a "${envName}" object to ${project.config.keysFile} (see the init example).`,
    );
  }
  return keys;
}

export function collectPreflightIssues(
  project: LoadedProject,
  envName: string,
  platforms: Platform[],
  availability: Availability,
): Issue[] {
  const issues: Issue[] = [];
  const env = project.config.environments[envName];
  if (!env) {
    issues.push(
      issue(
        `Unknown environment "${envName}".`,
        `Use one of: ${Object.keys(project.config.environments).join(', ')}. Add it under environments in rn-publisher.config.js if it is missing.`,
      ),
    );
    return issues;
  }

  let keys: EnvKeys;
  try {
    keys = envKeys(project, envName);
  } catch (error) {
    if (error instanceof PublishError) {
      issues.push(issue(error.message, error.suggestion));
      return issues;
    }
    throw error;
  }

  const needsAndroid = platforms.includes('firebase') || platforms.includes('play');
  if (needsAndroid) {
    issues.push(...androidIssues(project, env));
  }
  if (platforms.includes('firebase')) {
    issues.push(...firebaseIssues(project, keys, availability));
  }
  if (platforms.includes('play')) {
    issues.push(...playIssues(project, keys, availability));
  }
  if (platforms.includes('ios')) {
    issues.push(...iosIssues(project, env, keys, availability));
  }

  return issues;
}

function androidIssues(project: LoadedProject, env: EnvironmentConfig): Issue[] {
  const issues: Issue[] = [];
  if (!env.android) {
    issues.push(
      issue(
        `Environment is missing android config.`,
        'Add an `android` block (assembleTask, bundleTask, apkPath, aabPath, versionCodeFile) in rn-publisher.config.js.',
      ),
    );
    return issues;
  }

  const gradle = resolveProjectPath(project.projectRoot, env.android.versionCodeFile);
  if (!fs.existsSync(gradle)) {
    issues.push(
      issue(
        `Android versionCode file not found: ${gradle}`,
        'Set android.versionCodeFile to your app build.gradle (usually android/app/build.gradle).',
      ),
    );
  }

  // Optional: only checked when the user sets android.keystoreProperties.
  // Most apps keep signing config in Gradle / CI secrets; this CLI does not sign itself.
  if (env.android.keystoreProperties) {
    const keystoreRel = env.android.keystoreProperties;
    const keystore = resolveProjectPath(project.projectRoot, keystoreRel);
    if (!fs.existsSync(keystore)) {
      issues.push(
        issue(
          `keystoreProperties file not found: ${keystore}`,
          `Create ${keystoreRel} or remove android.keystoreProperties from rn-publisher.config.js if you sign another way.`,
        ),
      );
    }
  }

  return issues;
}

function firebaseIssues(
  project: LoadedProject,
  keys: EnvKeys,
  availability: Availability,
): Issue[] {
  const issues: Issue[] = [];
  if (!availability.firebase.available) {
    issues.push(
      issue(
        `Firebase is not available: ${availability.firebase.reason ?? 'unknown'}`,
        suggestionForAvailability(availability.firebase, 'firebase'),
      ),
    );
  }

  const firebase = keys.firebase;
  if (!firebase) {
    issues.push(
      issue(
        `Missing firebase keys for this environment in ${project.keysPath}`,
        `Add firebase.appId and firebase.groups. Example values from init must be replaced.`,
      ),
    );
    return issues;
  }

  if (isPlaceholder(firebase.appId, [PLACEHOLDERS.firebaseAppId])) {
    issues.push(
      issue(
        `firebase.appId is missing or still the init example (${PLACEHOLDERS.firebaseAppId}).`,
        `Set the real Android app id from Firebase Console → Project settings → Your apps in ${project.keysPath}.`,
      ),
    );
  }

  if (!firebase.groups.trim()) {
    issues.push(
      issue(
        'firebase.groups is empty.',
        `Set testers group name(s) from Firebase App Distribution in ${project.keysPath}.`,
      ),
    );
  }

  return issues;
}

function playIssues(
  project: LoadedProject,
  keys: EnvKeys,
  availability: Availability,
): Issue[] {
  const issues: Issue[] = [];
  if (!availability.play.available) {
    issues.push(
      issue(
        `Google Play is not available: ${availability.play.reason ?? 'unknown'}`,
        suggestionForAvailability(availability.play, 'play'),
      ),
    );
  }

  const play = keys.play;
  if (!play) {
    issues.push(
      issue(
        `Missing play keys for this environment in ${project.keysPath}`,
        `Add play.packageName and play.serviceAccountJson. Put the JSON file in ${project.config.secretsDir}.`,
      ),
    );
    return issues;
  }

  if (isPlaceholder(play.packageName, [PLACEHOLDERS.packageName])) {
    issues.push(
      issue(
        `play.packageName is missing or still the init example (${PLACEHOLDERS.packageName}).`,
        `Set the Play Console application id in ${project.keysPath}.`,
      ),
    );
  }

  if (isPlaceholder(play.serviceAccountJson, [PLACEHOLDERS.serviceAccountJson])) {
    issues.push(
      issue(
        `play.serviceAccountJson is still the init example (${PLACEHOLDERS.serviceAccountJson}).`,
        `Drop your Play service-account JSON into ${project.config.secretsDir} and set play.serviceAccountJson to that filename.`,
      ),
    );
  }

  const jsonPath = resolveSecret(project.projectRoot, project.config, play.serviceAccountJson);
  if (
    !isPlaceholder(play.serviceAccountJson, [PLACEHOLDERS.serviceAccountJson]) &&
    !fs.existsSync(jsonPath)
  ) {
    issues.push(
      issue(
        `Play service-account JSON not found: ${jsonPath}`,
        `Put the file in ${project.config.secretsDir} and set play.serviceAccountJson in ${project.keysPath}. See README → Google Play setup.`,
      ),
    );
  }

  return issues;
}

function iosIssues(
  project: LoadedProject,
  env: EnvironmentConfig,
  keys: EnvKeys,
  availability: Availability,
): Issue[] {
  const issues: Issue[] = [];
  if (!availability.ios.available) {
    issues.push(
      issue(
        `iOS TestFlight is not available: ${availability.ios.reason ?? 'unknown'}`,
        suggestionForAvailability(availability.ios, 'ios'),
      ),
    );
  }

  if (!env.ios) {
    issues.push(
      issue(
        'Environment is missing ios config.',
        'Add an `ios` block (workspace, scheme, configuration, exportOptionsPlist, projectDir) in rn-publisher.config.js.',
      ),
    );
    return issues;
  }

  const workspace = resolveProjectPath(project.projectRoot, env.ios.workspace);
  if (!fs.existsSync(workspace)) {
    issues.push(
      issue(
        `Xcode workspace not found: ${workspace}`,
        `Set ios.workspace correctly, then run \`cd ${env.ios.projectDir} && pod install\`.`,
      ),
    );
  }

  const plist = resolveProjectPath(project.projectRoot, env.ios.exportOptionsPlist);
  if (!fs.existsSync(plist)) {
    issues.push(
      issue(
        `Export options plist not found: ${plist}`,
        'Create an ExportOptions plist (method app-store) and set ios.exportOptionsPlist. Xcode → Product → Archive → Distribute can generate one.',
      ),
    );
  }

  const apple = keys.apple;
  if (!apple) {
    issues.push(
      issue(
        `Missing apple keys for this environment in ${project.keysPath}`,
        'Add apple.bundleId plus either App Store Connect API key fields or uploadEmail + appSpecificPassword.',
      ),
    );
    return issues;
  }

  if (isPlaceholder(apple.bundleId, [PLACEHOLDERS.bundleId])) {
    issues.push(
      issue(
        `apple.bundleId is missing or still the init example (${PLACEHOLDERS.bundleId}).`,
        `Set the real bundle identifier in ${project.keysPath}.`,
      ),
    );
  }

  const apiKeyId = apple.apiKeyId?.trim() ?? '';
  const apiIssuerId = apple.apiIssuerId?.trim() ?? '';
  const apiKeyP8 = apple.apiKeyP8?.trim() ?? '';
  const anyApi = Boolean(apiKeyId || apiIssuerId || apiKeyP8);

  if (anyApi) {
    if (!apiKeyId || isPlaceholder(apiKeyId, [PLACEHOLDERS.apiKeyId])) {
      issues.push(
        issue(
          'apple.apiKeyId is missing or still the init example.',
          `Set apple.apiKeyId from App Store Connect → Users and Access → Integrations → App Store Connect API in ${project.keysPath}.`,
        ),
      );
    }
    if (!apiIssuerId || isPlaceholder(apiIssuerId, [PLACEHOLDERS.apiIssuerId])) {
      issues.push(
        issue(
          'apple.apiIssuerId is missing or still the init example.',
          `Set apple.apiIssuerId (Issuer ID) in ${project.keysPath}.`,
        ),
      );
    }
    if (!apiKeyP8 || isPlaceholder(apiKeyP8, [PLACEHOLDERS.apiKeyP8])) {
      issues.push(
        issue(
          'apple.apiKeyP8 is missing or still the init example.',
          `Drop AuthKey_<id>.p8 into ${project.config.secretsDir} and set apple.apiKeyP8 to that filename.`,
        ),
      );
    } else {
      const p8 = resolveSecret(project.projectRoot, project.config, apiKeyP8);
      if (!fs.existsSync(p8)) {
        issues.push(
          issue(
            `APPLE .p8 key not found: ${p8}`,
            `Place the AuthKey .p8 file in ${project.config.secretsDir} and update apple.apiKeyP8.`,
          ),
        );
      }
    }
  } else {
    if (!apple.uploadEmail?.trim()) {
      issues.push(
        issue(
          'apple.uploadEmail is not set (and no App Store Connect API key was provided).',
          `Set apple.apiKeyId, apple.apiIssuerId, and apple.apiKeyP8 (recommended), or apple.uploadEmail + apple.appSpecificPassword in ${project.keysPath}.`,
        ),
      );
    }
    if (!apple.appSpecificPassword?.trim()) {
      issues.push(
        issue(
          'apple.appSpecificPassword is not set.',
          'Generate one at https://appleid.apple.com → App-Specific Passwords, then put it in the keys file. Prefer an API key instead.',
        ),
      );
    }
  }

  return issues;
}

export function assertNoIssues(issues: Issue[]): void {
  if (issues.length === 0) {
    return;
  }
  throw new PublishError(
    issues.map((item) => item.message).join('\n'),
    issues.map((item) => item.suggestion).join('\n'),
  );
}
