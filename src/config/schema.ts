import { z } from 'zod';

const androidConfigSchema = z.object({
  assembleTask: z.string().min(1),
  bundleTask: z.string().min(1),
  apkPath: z.string().min(1),
  aabPath: z.string().min(1),
  versionCodeFile: z.string().min(1),
  keystoreProperties: z.string().min(1).optional(),
});

const iosConfigSchema = z.object({
  workspace: z.string().min(1),
  scheme: z.string().min(1),
  configuration: z.string().min(1),
  exportOptionsPlist: z.string().min(1),
  projectDir: z.string().min(1).default('ios'),
});

const environmentSchema = z.object({
  label: z.string().min(1),
  android: androidConfigSchema.optional(),
  ios: iosConfigSchema.optional(),
});

const platformsSchema = z.object({
  firebase: z.object({ enabled: z.boolean() }).optional(),
  play: z.object({ enabled: z.boolean() }).optional(),
  ios: z.object({ enabled: z.boolean() }).optional(),
});

export const configSchema = z.object({
  secretsDir: z.string().min(1).default('./publish-secrets'),
  keysFile: z.string().min(1).default('./publish-secrets/keys.json'),
  environments: z
    .record(z.string().min(1), environmentSchema)
    .refine((value) => Object.keys(value).length > 0, {
      message: 'environments must contain at least one environment',
    }),
  platforms: platformsSchema.optional(),
});

const firebaseKeysSchema = z.object({
  appId: z.string(),
  groups: z.string(),
});

const playKeysSchema = z.object({
  packageName: z.string(),
  serviceAccountJson: z.string(),
  closedTrack: z.string().optional(),
  /** Play release status for supply uploads. Draft apps require `draft`. */
  releaseStatus: z.enum(['draft', 'completed']).optional().default('draft'),
});

const appleKeysSchema = z.object({
  bundleId: z.string(),
  apiKeyId: z.string().optional(),
  apiIssuerId: z.string().optional(),
  apiKeyP8: z.string().optional(),
  uploadEmail: z.string().optional(),
  appSpecificPassword: z.string().optional(),
});

const envKeysSchema = z.object({
  firebase: firebaseKeysSchema.optional(),
  play: playKeysSchema.optional(),
  apple: appleKeysSchema.optional(),
});

export const keysSchema = z.record(z.string().min(1), envKeysSchema);

export type Config = z.infer<typeof configSchema>;
export type EnvironmentConfig = z.infer<typeof environmentSchema>;
export type AndroidConfig = z.infer<typeof androidConfigSchema>;
export type IosConfig = z.infer<typeof iosConfigSchema>;
export type KeysFile = z.infer<typeof keysSchema>;
export type EnvKeys = z.infer<typeof envKeysSchema>;
export type FirebaseKeys = z.infer<typeof firebaseKeysSchema>;
export type PlayKeys = z.infer<typeof playKeysSchema>;
export type AppleKeys = z.infer<typeof appleKeysSchema>;
