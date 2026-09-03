#!/usr/bin/env node
import { Command } from 'commander';

import { runDoctor } from './commands/doctor.js';
import { runInit } from './commands/init.js';
import { runPublish } from './commands/publish.js';
import { PublishError } from './util/errors.js';
import * as log from './util/log.js';

const program = new Command();

program
  .name('rn-publisher')
  .description(
    'Publish a React Native app to Firebase App Distribution, Google Play, and TestFlight.',
  )
  .version('0.1.0');

program
  .command('init')
  .description('Create config, keys file, secrets folder, and gitignore entries')
  .option('-y, --yes', 'Overwrite existing generated files without asking')
  .action(async (opts: { yes?: boolean }) => {
    await runInit({ yes: opts.yes });
  });

program
  .command('doctor')
  .description('Check tools, config, and keys without publishing')
  .option('--env <name>', 'Only check one environment')
  .action(async (opts: { env?: string }) => {
    await runDoctor({ env: opts.env });
  });

program
  .command('publish', { isDefault: true })
  .description('Interactive (or flagged) multi-destination publish')
  .option('--env <name>', 'Environment key from rn-publisher.config.js')
  .option('--platforms <list>', 'Comma-separated: firebase,play,ios')
  .option('--track <track>', 'Play track: closed, open, production')
  .option('--notes <text>', 'Release notes (skips git-generated notes)')
  .option('--version-name <version>', 'App version name (e.g. 1.2.3)')
  .option('--version-code <code>', 'Android versionCode / iOS build number')
  .option('-y, --yes', 'Skip the final confirm prompt')
  .option('--commit', 'Commit version changes as chore: release <env>')
  .action(
    async (opts: {
      env?: string;
      platforms?: string;
      track?: string;
      notes?: string;
      versionName?: string;
      versionCode?: string;
      yes?: boolean;
      commit?: boolean;
    }) => {
      await runPublish(opts);
    },
  );

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof PublishError) {
      log.blank();
      log.printError(error);
      process.exitCode = 1;
      return;
    }
    log.blank();
    log.error(error instanceof Error ? error.message : String(error));
    log.suggestion('If this looks like a missing file or tool, run `rn-publisher doctor`.');
    process.exitCode = 1;
  }
}

void main();
