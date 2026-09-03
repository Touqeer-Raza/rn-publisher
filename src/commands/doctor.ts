import { loadProject } from '../config/load.js';
import { collectPreflightIssues } from '../preflight/destinations.js';
import { availabilityLines, detectAvailability } from '../preflight/tools.js';
import type { Platform } from '../types.js';
import * as log from '../util/log.js';
import { findProjectRoot } from '../util/paths.js';

export interface DoctorOptions {
  cwd?: string;
  env?: string;
}

export async function runDoctor(options: DoctorOptions = {}): Promise<void> {
  const projectRoot = findProjectRoot(options.cwd ?? process.cwd());
  const project = await loadProject(projectRoot);
  const availability = await detectAvailability(project.config);

  log.banner(availabilityLines(availability));

  const envNames = options.env
    ? [options.env]
    : Object.keys(project.config.environments);

  let failed = 0;
  for (const envName of envNames) {
    log.heading(`Environment: ${envName}`);
    if (!project.config.environments[envName]) {
      log.error(`Unknown environment "${envName}".`);
      log.suggestion(
        `Use one of: ${Object.keys(project.config.environments).join(', ')}`,
      );
      failed += 1;
      continue;
    }

    const platforms: Platform[] = [];
    if (project.config.platforms?.firebase?.enabled !== false) {
      platforms.push('firebase');
    }
    if (project.config.platforms?.play?.enabled !== false) {
      platforms.push('play');
    }
    if (project.config.platforms?.ios?.enabled !== false) {
      platforms.push('ios');
    }

    const issues = collectPreflightIssues(project, envName, platforms, availability);
    if (issues.length === 0) {
      log.success('Ready to publish (for enabled destinations that are available).');
      continue;
    }

    failed += issues.length;
    for (const issue of issues) {
      log.error(issue.message);
      log.suggestion(issue.suggestion);
      log.blank();
    }
  }

  if (failed > 0) {
    process.exitCode = 1;
    log.warn(`${failed} issue(s) found. Fix them, then run doctor again.`);
  } else {
    log.success('Doctor finished with no issues.');
  }
}
