import { gitCommitExists, gitLogSubjects } from '../util/git.js';
import { readReleaseCommit, releaseMarkerPath } from './bump.js';

function stripPrefix(line: string): string {
  return line.replace(/^[a-z]+(\([^)]*\))?: /, '');
}

export async function buildReleaseNotes(
  projectRoot: string,
  envName: string,
  labelPrefix?: string,
): Promise<string> {
  const marker = releaseMarkerPath(envName, projectRoot);
  const last = readReleaseCommit(marker);

  let subjects: string[];
  if (last && (await gitCommitExists(projectRoot, last))) {
    subjects = await gitLogSubjects(projectRoot, `${last}..HEAD`);
  } else {
    subjects = await gitLogSubjects(projectRoot, undefined, 20);
  }

  let feats = '';
  let fixes = '';
  for (const line of subjects) {
    if (line.startsWith('feat')) {
      feats += `• ${stripPrefix(line)}\n`;
    } else if (line.startsWith('fix')) {
      fixes += `• ${stripPrefix(line)}\n`;
    }
  }

  let notes = '';
  if (feats) {
    notes = `What's New:\n${feats}`;
  }
  if (fixes) {
    if (notes) {
      notes += '\n';
    }
    notes += `Bug Fixes:\n${fixes}`;
  }
  if (!notes) {
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    notes = `Build ${stamp}`;
  }

  if (labelPrefix) {
    return `[${labelPrefix}] ${notes}`;
  }
  return notes;
}
