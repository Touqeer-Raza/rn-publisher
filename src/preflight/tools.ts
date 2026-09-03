import picocolors from 'picocolors';

import type { Availability, AvailabilityItem, Platform } from '../types.js';
import type { Config } from '../config/schema.js';
import { hasCommand, isDarwin } from '../util/which.js';
import { execa } from 'execa';

function platformEnabled(config: Config, platform: Platform): boolean {
  const flag = config.platforms?.[platform]?.enabled;
  return flag !== false;
}

async function firebaseLoggedIn(): Promise<boolean> {
  if (!hasCommand('firebase')) {
    return false;
  }
  const result = await execa('firebase', ['projects:list'], {
    reject: false,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return result.exitCode === 0;
}

export async function detectAvailability(config: Config): Promise<Availability> {
  const firebaseOn = platformEnabled(config, 'firebase');
  const playOn = platformEnabled(config, 'play');
  const iosOn = platformEnabled(config, 'ios');

  const firebaseCli = hasCommand('firebase');
  const fastlane = hasCommand('fastlane');
  const xcode = isDarwin() && hasCommand('xcodebuild');

  let firebaseAuth = false;
  if (firebaseOn && firebaseCli) {
    firebaseAuth = await firebaseLoggedIn();
  }

  const firebase: AvailabilityItem = !firebaseOn
    ? { available: false, enabled: false, reason: 'disabled in rn-publisher.config.js (platforms.firebase.enabled)' }
    : !firebaseCli
      ? {
          available: false,
          enabled: true,
          reason: 'firebase CLI not found',
        }
      : !firebaseAuth
        ? { available: false, enabled: true, reason: 'firebase CLI is not logged in' }
        : { available: true, enabled: true };

  const play: AvailabilityItem = !playOn
    ? { available: false, enabled: false, reason: 'disabled in rn-publisher.config.js (platforms.play.enabled)' }
    : !fastlane
      ? { available: false, enabled: true, reason: 'fastlane not found' }
      : { available: true, enabled: true };

  const ios: AvailabilityItem = !iosOn
    ? { available: false, enabled: false, reason: 'disabled in rn-publisher.config.js (platforms.ios.enabled)' }
    : !isDarwin()
      ? { available: false, enabled: true, reason: 'iOS TestFlight requires macOS' }
      : !xcode
        ? { available: false, enabled: true, reason: 'xcodebuild not found' }
        : { available: true, enabled: true };

  return { firebase, play, ios };
}

export function availabilityLines(availability: Availability): string[] {
  const rows: Array<[string, AvailabilityItem]> = [
    ['Firebase App Distribution', availability.firebase],
    ['Google Play', availability.play],
    ['iOS TestFlight', availability.ios],
  ];

  return rows.map(([label, item]) => {
    if (item.available) {
      return `${picocolors.green('✔')} ${label}`;
    }
    const reason = item.reason ? ` — ${item.reason}` : '';
    return `${picocolors.red('✖')} ${label}${reason}`;
  });
}

export function suggestionForAvailability(item: AvailabilityItem, platform: Platform): string {
  if (item.available) {
    return '';
  }
  switch (platform) {
    case 'firebase':
      if (!item.enabled) {
        return 'Set platforms.firebase.enabled to true in rn-publisher.config.js.';
      }
      if (item.reason?.includes('not found')) {
        return 'Install the Firebase CLI: npm install -g firebase-tools';
      }
      return 'Run `firebase login` then retry.';
    case 'play':
      if (!item.enabled) {
        return 'Set platforms.play.enabled to true in rn-publisher.config.js.';
      }
      return 'Install fastlane: `brew install fastlane` or `gem install fastlane`.';
    case 'ios':
      if (!item.enabled) {
        return 'Set platforms.ios.enabled to true in rn-publisher.config.js.';
      }
      if (item.reason?.includes('macOS')) {
        return 'Run iOS publishing on a Mac with Xcode installed.';
      }
      return 'Install Xcode from the App Store and accept the license (`sudo xcodebuild -license`).';
    default:
      return 'See README → Prerequisites.';
  }
}
