/** Example values written by `rn-publisher init`. Preflight rejects these. */
export const PLACEHOLDERS = {
  firebaseAppId: '1:1234567890:android:abcdef',
  firebaseGroups: 'testers',
  packageName: 'com.example.app',
  bundleId: 'com.example.app',
  apiKeyId: 'XXXXXXXXXX',
  apiIssuerId: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
  apiKeyP8: './AuthKey_XXXXXXXXXX.p8',
  serviceAccountJson: './play-service-account.json',
  closedTrack: 'alpha',
} as const;

export function isPlaceholder(value: string, examples: readonly string[]): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }
  return examples.includes(trimmed);
}
