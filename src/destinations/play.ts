import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { execa } from "execa";

import type { LoadedProject } from "../config/load.js";
import { resolveSecret } from "../config/resolveSecrets.js";
import { readAndroidVersionCode } from "../release/bump.js";
import type { PlayTrack } from "../types.js";
import { PublishError } from "../util/errors.js";
import * as log from "../util/log.js";
import { resolveProjectPath } from "../util/paths.js";

export function resolvePlayTrack(
  choice: string,
  closedTrack: string | undefined,
  releaseStatus: PlayTrack['releaseStatus'] = 'draft',
): PlayTrack {
  switch (choice) {
    case 'closed':
    case 'closed-testing':
    case 'close':
    case 'alpha':
      return {
        track: closedTrack?.trim() || 'alpha',
        label: 'Closed testing',
        releaseStatus,
      };
    case 'open':
    case 'open-testing':
    case 'online':
    case 'beta':
      return {
        track: 'beta',
        label: 'Open testing',
        releaseStatus,
      };
    case 'production':
    case 'prod':
      return {
        track: 'production',
        label: 'Production',
        releaseStatus,
      };
    default:
      throw new PublishError(
        `Unknown Play track: ${choice}`,
        'Use closed, open, or production (or pass --track with one of those names).',
      );
  }
}

/**
 * fastlane supply has no --changelog flag. Notes go in metadata:
 *   <metadata_path>/<locale>/changelogs/<versionCode>.txt
 *   <metadata_path>/<locale>/changelogs/default.txt
 */
function writePlayChangelogMetadata(
  notes: string,
  versionCode: number,
): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rn-publisher-play-"));
  const changelogDir = path.join(root, "en-US", "changelogs");
  fs.mkdirSync(changelogDir, { recursive: true });
  const text = notes.length > 500 ? `${notes.slice(0, 497)}...` : notes;
  fs.writeFileSync(path.join(changelogDir, "default.txt"), text);
  fs.writeFileSync(path.join(changelogDir, `${versionCode}.txt`), text);
  return root;
}

export async function uploadPlay(
  project: LoadedProject,
  envName: string,
  track: PlayTrack,
  notes: string,
): Promise<void> {
  const env = project.config.environments[envName];
  const play = project.keys[envName]?.play;
  if (!env?.android || !play) {
    throw new PublishError(
      "Google Play upload is missing android config or play keys.",
      "Add android paths in rn-publisher.config.js and play.packageName / play.serviceAccountJson in the keys file.",
    );
  }

  let aabPath = resolveProjectPath(project.projectRoot, env.android.aabPath);
  if (!fs.existsSync(aabPath)) {
    const found = findAab(project.projectRoot);
    if (found) {
      aabPath = found;
    } else {
      throw new PublishError(
        `AAB not found: ${aabPath}`,
        "Confirm android.aabPath matches Gradle bundle output, or build the bundle first.",
      );
    }
  }

  const jsonKey = resolveSecret(
    project.projectRoot,
    project.config,
    play.serviceAccountJson,
  );
  const size = fs.statSync(aabPath).size;
  log.success(`AAB ready: ${aabPath} (${formatSize(size)})`);
  log.blank();
  log.info("Uploading to Google Play...");
  log.info(`  Env:     ${envName}`);
  log.info(`  Package: ${play.packageName}`);
  log.info(`  Track:   ${track.track} (${track.label})`);
  log.info(`  Status:  ${track.releaseStatus}`);
  log.blank();

  const args = [
    "supply",
    "--aab",
    aabPath,
    "--package_name",
    play.packageName,
    "--json_key",
    jsonKey,
    "--track",
    track.track,
    "--release_status",
    track.releaseStatus,
    "--skip_upload_metadata",
    "--skip_upload_images",
    "--skip_upload_screenshots",
  ];

  let metadataRoot: string | undefined;
  const changelog = notes.trim();
  if (changelog) {
    const gradleFile = resolveProjectPath(
      project.projectRoot,
      env.android.versionCodeFile,
    );
    const versionCode = readAndroidVersionCode(gradleFile);
    metadataRoot = writePlayChangelogMetadata(changelog, versionCode);
    args.push("--metadata_path", metadataRoot);
  } else {
    args.push("--skip_upload_changelogs");
  }

  try {
    const result = await execa("fastlane", args, {
      cwd: project.projectRoot,
      stdio: "inherit",
      reject: false,
    });

    if (result.exitCode !== 0) {
      throw new PublishError(
        `Google Play upload failed (exit ${result.exitCode}).`,
        "Check play.packageName, the service-account JSON, and that the Play API is enabled for this app. See README → Google Play setup.",
      );
    }
  } finally {
    if (metadataRoot) {
      fs.rmSync(metadataRoot, { recursive: true, force: true });
    }
  }

  log.blank();
  if (track.releaseStatus === "draft") {
    log.success(
      "Upload complete (draft). Finish the release in Play Console when ready.",
    );
  } else {
    log.success("Google Play upload complete.");
  }
}

function findAab(projectRoot: string): string | undefined {
  const bundleDir = path.join(projectRoot, "android/app/build/outputs/bundle");
  if (!fs.existsSync(bundleDir)) {
    return undefined;
  }
  const stack = [bundleDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      break;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name.endsWith(".aab")) {
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
