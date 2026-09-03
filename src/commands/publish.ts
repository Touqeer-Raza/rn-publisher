import fs from 'node:fs';

import { loadProject, type LoadedProject } from '../config/load.js';
import { distributeFirebase } from '../destinations/firebase.js';
import { uploadTestFlight } from '../destinations/ios.js';
import { resolvePlayTrack, uploadPlay } from '../destinations/play.js';
import { assertNoIssues, collectPreflightIssues } from '../preflight/destinations.js';
import { availabilityLines, detectAvailability } from '../preflight/tools.js';
import { confirm } from '../prompts/confirm.js';
import { selectMany } from '../prompts/selectMany.js';
import { selectOne } from '../prompts/selectOne.js';
import { text } from '../prompts/text.js';
import {
  isSafeBuildNumber,
  isSafeMarketingVersion,
  readAndroidVersionCode,
  readAndroidVersionName,
  readIosBuildNumber,
  readIosMarketingVersion,
  releaseMarkerPath,
  writeAndroidVersions,
  writeIosVersions,
  writeReleaseMarker,
} from '../release/bump.js';
import { runGradle } from '../release/gradle.js';
import { buildReleaseNotes } from '../release/notes.js';
import type { Platform, PlayTrack, PublishPlan } from '../types.js';
import { PublishError } from '../util/errors.js';
import { gitAddCommit, gitRevParseHead, gitStatusShort } from '../util/git.js';
import * as log from '../util/log.js';
import { findProjectRoot, resolveProjectPath } from '../util/paths.js';

export interface PublishCliOptions {
  env?: string;
  platforms?: string;
  track?: string;
  notes?: string;
  versionName?: string;
  versionCode?: string;
  yes?: boolean;
  commit?: boolean;
  cwd?: string;
}

const PLATFORM_ALIASES: Record<string, Platform> = {
  firebase: 'firebase',
  play: 'play',
  googleplay: 'play',
  'google-play': 'play',
  ios: 'ios',
  testflight: 'ios',
};

function parsePlatforms(raw: string): Platform[] {
  const out = new Set<Platform>();
  for (const token of raw.split(/[,\s]+/).filter(Boolean)) {
    const mapped = PLATFORM_ALIASES[token.toLowerCase()];
    if (!mapped) {
      throw new PublishError(
        `Unknown platform: ${token}`,
        'Use firebase, play, and/or ios (comma-separated). Example: --platforms firebase,play',
      );
    }
    out.add(mapped);
  }
  if (out.size === 0) {
    throw new PublishError(
      'Select at least one platform.',
      'Pass --platforms firebase,play,ios or run in a terminal to pick with the checkbox menu.',
    );
  }
  return [...out];
}

function isTty(): boolean {
  return Boolean(process.stdin.isTTY);
}

function normalizeVersionCodeInput(raw: string): string {
  let trimmed = raw.trim();
  // Inquirer shows defaults as (value); users sometimes keep the parentheses.
  if (trimmed.startsWith('(') && trimmed.endsWith(')') && trimmed.length > 2) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseVersionCode(raw: string, label: string): number {
  const trimmed = normalizeVersionCodeInput(raw);
  if (!/^\d+$/.test(trimmed)) {
    throw new PublishError(
      `Invalid ${label}: ${raw}`,
      'Version code / build number must be a positive integer.',
    );
  }
  const value = Number(trimmed);
  if (value < 1) {
    throw new PublishError(
      `Invalid ${label}: ${raw}`,
      'Version code / build number must be >= 1.',
    );
  }
  return value;
}

function versionCodeError(raw: string): string | null {
  const trimmed = normalizeVersionCodeInput(raw);
  if (!trimmed) {
    return 'Enter a positive integer (e.g. 2).';
  }
  if (!/^\d+$/.test(trimmed)) {
    return 'Version code / build number must be a positive integer.';
  }
  if (Number(trimmed) < 1) {
    return 'Version code / build number must be >= 1.';
  }
  return null;
}

function versionNameError(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return 'Version name cannot be empty. Enter a value like 1.2.3.';
  }
  if (!isSafeMarketingVersion(trimmed)) {
    return 'Use a version like 1.2.3 (optional suffix: 1.2.3-beta.1).';
  }
  return null;
}

interface CurrentVersions {
  versionName: string;
  versionCode: number;
  android?: { versionName: string; versionCode: number; file: string };
  ios?: { versionName: string; buildNumber: string; projectDir: string };
}

async function readCurrentVersions(
  project: LoadedProject,
  envName: string,
  platforms: Platform[],
): Promise<CurrentVersions> {
  const env = project.config.environments[envName];
  const needsAndroid = platforms.includes('firebase') || platforms.includes('play');
  const needsIos = platforms.includes('ios');

  let android: CurrentVersions['android'];
  let ios: CurrentVersions['ios'];

  if (needsAndroid && env.android) {
    const file = resolveProjectPath(project.projectRoot, env.android.versionCodeFile);
    android = {
      versionName: readAndroidVersionName(file),
      versionCode: readAndroidVersionCode(file),
      file,
    };
  }

  if (needsIos && env.ios) {
    const projectDir = resolveProjectPath(project.projectRoot, env.ios.projectDir);
    ios = {
      versionName: await readIosMarketingVersion(projectDir),
      buildNumber: await readIosBuildNumber(projectDir),
      projectDir,
    };
  }

  const versionName = android?.versionName ?? ios?.versionName ?? '1.0.0';
  const versionCode = android?.versionCode ?? (ios ? Number(ios.buildNumber) || 1 : 1);

  return { versionName, versionCode, android, ios };
}

async function resolveVersions(
  current: CurrentVersions,
  options: PublishCliOptions,
): Promise<{ versionName: string; versionCode: number }> {
  const defaultName = options.versionName?.trim() || current.versionName;
  // Interactive default: next build number. Flags / non-TTY keep explicit or current.
  const suggestedCode = options.versionCode
    ? parseVersionCode(options.versionCode, 'version code')
    : current.versionCode + 1;

  if (isTty()) {
    log.heading('App version');
    if (current.android) {
      log.info(
        `  Android current: ${current.android.versionName} · code ${current.android.versionCode}`,
      );
    }
    if (current.ios) {
      log.info(
        `  iOS current:     ${current.ios.versionName} · build ${current.ios.buildNumber}`,
      );
    }
    log.blank();

    const versionName = (
      await text('Version name', defaultName, (value) => versionNameError(value) ?? true)
    ).trim();

    const codeRaw = await text(
      'Version code / build number',
      String(suggestedCode),
      (value) => versionCodeError(value) ?? true,
    );

    return {
      versionName,
      versionCode: parseVersionCode(codeRaw, 'version code'),
    };
  }

  return {
    versionName: defaultName,
    versionCode: options.versionCode
      ? suggestedCode
      : current.versionCode,
  };
}

async function resolvePlan(
  project: LoadedProject,
  options: PublishCliOptions,
): Promise<PublishPlan> {
  const availability = await detectAvailability(project.config);
  log.banner(availabilityLines(availability));

  const envEntries = Object.entries(project.config.environments);

  let envName = options.env?.trim();
  if (!envName) {
    if (!isTty()) {
      throw new PublishError(
        '--env is required when not running interactively.',
        `Pass --env <name>. Available: ${envEntries.map(([key]) => key).join(', ')}`,
      );
    }
    envName = await selectOne(
      'Environment',
      envEntries.map(([key, value]) => ({
        name: value.label ? `${key} — ${value.label}` : key,
        value: key,
      })),
    );
  }

  if (!project.config.environments[envName]) {
    throw new PublishError(
      `Unknown environment: ${envName}`,
      `Use one of: ${envEntries.map(([key]) => key).join(', ')}. Add it in rn-publisher.config.js if needed.`,
    );
  }

  let platforms: Platform[];
  if (options.platforms) {
    platforms = parsePlatforms(options.platforms);
  } else if (isTty()) {
    platforms = await selectMany('Platforms', [
      {
        name: 'Firebase App Distribution (Android APK)',
        value: 'firebase',
        disabled: availability.firebase.available
          ? false
          : availability.firebase.reason ?? 'unavailable',
      },
      {
        name: 'Google Play (Android AAB)',
        value: 'play',
        disabled: availability.play.available ? false : availability.play.reason ?? 'unavailable',
      },
      {
        name: 'iOS TestFlight',
        value: 'ios',
        disabled: availability.ios.available ? false : availability.ios.reason ?? 'unavailable',
      },
    ]);
  } else {
    throw new PublishError(
      '--platforms is required when not running interactively.',
      'Pass --platforms firebase,play,ios (comma-separated).',
    );
  }

  let playTrack: PlayTrack | undefined;
  if (platforms.includes('play')) {
    const playKeys = project.keys[envName]?.play;
    const closedTrack = playKeys?.closedTrack;
    const releaseStatus = playKeys?.releaseStatus ?? 'draft';
    if (options.track) {
      playTrack = resolvePlayTrack(options.track, closedTrack, releaseStatus);
    } else if (isTty()) {
      const choice = await selectOne('Google Play track', [
        { name: 'Closed testing (Play API: alpha)', value: 'closed' },
        { name: 'Open testing (Play API: beta)', value: 'open' },
        { name: 'Production', value: 'production' },
      ]);
      playTrack = resolvePlayTrack(choice, closedTrack, releaseStatus);
    } else {
      throw new PublishError(
        '--track is required when Google Play is selected.',
        'Pass --track closed, open, or production.',
      );
    }
  }

  const env = project.config.environments[envName];
  const generated = await buildReleaseNotes(
    project.projectRoot,
    envName,
    envName === 'prod' ? undefined : env.label || envName,
  );

  let notes = options.notes ?? generated;
  if (!options.notes && isTty()) {
    log.heading('Release notes');
    log.info(generated);
    log.blank();
    notes = await text('Edit notes, or press Enter to keep', generated);
  } else {
    log.heading(`Release notes (${envName})`);
    log.info(notes);
    log.blank();
  }

  const current = await readCurrentVersions(project, envName, platforms);
  const versions = await resolveVersions(current, options);

  return {
    envName,
    platforms,
    playTrack,
    notes,
    versionName: versions.versionName,
    versionCode: versions.versionCode,
    skipConfirm: Boolean(options.yes),
    doCommit: Boolean(options.commit),
  };
}

export async function runPublish(options: PublishCliOptions = {}): Promise<void> {
  const projectRoot = findProjectRoot(options.cwd ?? process.cwd());
  const project = await loadProject(projectRoot);
  const plan = await resolvePlan(project, options);
  const availability = await detectAvailability(project.config);

  log.info('Preflight...');
  log.blank();
  const status = await gitStatusShort(projectRoot);
  if (status) {
    log.info('git status:');
    log.info(status);
    log.blank();
  }

  const issues = collectPreflightIssues(
    project,
    plan.envName,
    plan.platforms,
    availability,
  );
  assertNoIssues(issues);
  log.success('Preflight passed.');
  log.blank();

  const env = project.config.environments[plan.envName];
  const needsAndroid = plan.platforms.includes('firebase') || plan.platforms.includes('play');
  const needsIos = plan.platforms.includes('ios');
  const current = await readCurrentVersions(project, plan.envName, plan.platforms);

  const androidWillChange =
    Boolean(current.android) &&
    (current.android!.versionName !== plan.versionName ||
      current.android!.versionCode !== plan.versionCode);
  const iosWillChange =
    Boolean(current.ios) &&
    (current.ios!.versionName !== plan.versionName ||
      current.ios!.buildNumber !== String(plan.versionCode));

  log.info('────────────────────────────────────────');
  log.info(`  Env:        ${plan.envName}  (${env.label})`);
  log.info(`  Version:    ${plan.versionName} (${plan.versionCode})`);
  if (current.android) {
    log.info(
      `  Android:    ${current.android.versionName} (${current.android.versionCode})${
        androidWillChange ? ` → ${plan.versionName} (${plan.versionCode})` : '  (unchanged)'
      }`,
    );
  }
  if (current.ios) {
    log.info(
      `  iOS:        ${current.ios.versionName} (${current.ios.buildNumber})${
        iosWillChange ? ` → ${plan.versionName} (${plan.versionCode})` : '  (unchanged)'
      }`,
    );
  }
  log.info(
    plan.platforms.includes('firebase')
      ? `  Firebase:   APK  → ${project.keys[plan.envName]?.firebase?.groups}`
      : '  Firebase:   skipped',
  );
  log.info(
    plan.platforms.includes('play') && plan.playTrack
      ? `  Play:       AAB  → ${project.keys[plan.envName]?.play?.packageName} / ${plan.playTrack.track} (${plan.playTrack.label})`
      : '  Play:       skipped',
  );
  log.info(
    plan.platforms.includes('ios')
      ? `  iOS:        TestFlight ${project.keys[plan.envName]?.apple?.bundleId}`
      : '  iOS:        skipped',
  );
  log.info('────────────────────────────────────────');
  log.blank();

  if (!plan.skipConfirm) {
    if (!isTty()) {
      throw new PublishError(
        'Refusing to publish without --yes when not running interactively.',
        'Re-run with --yes after flags, or run in a terminal to confirm.',
      );
    }
    const ok = await confirm('Proceed?', false);
    if (!ok) {
      log.warn('Cancelled.');
      return;
    }
    log.blank();
  }

  let androidBumped = false;
  let iosBumped = false;
  let firebaseOk = false;
  let playOk = false;
  let iosOk = false;

  const revert = async (): Promise<void> => {
    if (firebaseOk || playOk || iosOk) {
      log.warn('Partial publish — keeping version changes so store version codes stay unique.');
      return;
    }
    if (androidBumped && current.android) {
      writeAndroidVersions(
        current.android.file,
        current.android.versionName,
        current.android.versionCode,
      );
      log.info(
        `Reverted Android to ${current.android.versionName} (${current.android.versionCode})`,
      );
    }
    if (iosBumped && current.ios) {
      if (
        isSafeMarketingVersion(current.ios.versionName) &&
        isSafeBuildNumber(current.ios.buildNumber)
      ) {
        await writeIosVersions(
          current.ios.projectDir,
          current.ios.versionName,
          current.ios.buildNumber,
        );
        log.info(`Reverted iOS to ${current.ios.versionName} (${current.ios.buildNumber})`);
      } else {
        log.warn(
          'Skipped iOS version revert — previous values were unsafe. Restore project.pbxproj from git if needed.',
        );
      }
    }
  };

  try {
    if (needsAndroid && current.android && androidWillChange) {
      writeAndroidVersions(current.android.file, plan.versionName, plan.versionCode);
      androidBumped = true;
      log.info(
        `Android version: ${current.android.versionName} (${current.android.versionCode}) → ${plan.versionName} (${plan.versionCode})`,
      );
    }

    if (needsIos && current.ios && iosWillChange) {
      await writeIosVersions(current.ios.projectDir, plan.versionName, String(plan.versionCode));
      iosBumped = true;
      log.info(
        `iOS version: ${current.ios.versionName} (${current.ios.buildNumber}) → ${plan.versionName} (${plan.versionCode})`,
      );
    }
    if (androidBumped || iosBumped) {
      log.blank();
    }

    if (needsAndroid && env.android) {
      const tasks: string[] = [];
      if (plan.platforms.includes('firebase')) {
        tasks.push(env.android.assembleTask);
      }
      if (plan.platforms.includes('play')) {
        tasks.push(env.android.bundleTask);
      }
      log.info(`Gradle: ${tasks.join(' ')}`);
      log.blank();
      await runGradle(projectRoot, env, tasks);
      log.blank();
    }

    if (plan.platforms.includes('firebase')) {
      log.heading(`Firebase App Distribution (${plan.envName})`);
      await distributeFirebase(project, plan.envName, plan.notes);
      firebaseOk = true;
    }

    if (plan.platforms.includes('play') && plan.playTrack) {
      log.heading(`Google Play (${plan.envName} / ${plan.playTrack.label})`);
      await uploadPlay(project, plan.envName, plan.playTrack, plan.notes);
      playOk = true;
    }

    if (plan.platforms.includes('ios')) {
      log.heading(`iOS TestFlight (${plan.envName})`);
      await uploadTestFlight(project, plan.envName);
      iosOk = true;
    }
  } catch (error) {
    await revert();
    throw error;
  }

  const commitPaths: string[] = [];
  if (androidBumped && env.android) {
    commitPaths.push(env.android.versionCodeFile);
  }
  if (iosBumped && env.ios) {
    const iosDir = resolveProjectPath(projectRoot, env.ios.projectDir);
    const pbxCandidates = fs
      .readdirSync(iosDir)
      .filter((name) => name.endsWith('.xcodeproj'))
      .map((name) => `${env.ios?.projectDir}/${name}/project.pbxproj`);
    commitPaths.push(...pbxCandidates);
  }

  if (plan.doCommit && commitPaths.length > 0) {
    await gitAddCommit(projectRoot, commitPaths, `chore: release ${plan.envName}`);
  } else if (commitPaths.length > 0) {
    log.blank();
    log.info('Version changes left uncommitted. Review with git diff, or re-run with --commit.');
  }

  const head = await gitRevParseHead(projectRoot);
  if (head) {
    writeReleaseMarker(releaseMarkerPath(plan.envName, projectRoot), head);
    log.blank();
    log.success(`Published ${plan.envName} — .release.${plan.envName} updated: ${head}`);
  } else {
    log.success(`Published ${plan.envName}`);
  }
}
