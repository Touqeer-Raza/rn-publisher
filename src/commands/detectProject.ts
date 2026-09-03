import fs from 'node:fs';
import path from 'node:path';

export interface DetectedProject {
  packageName: string | null;
  bundleId: string | null;
  workspace: string;
  scheme: string;
  versionCodeFile: string;
}

function readPackageJsonName(projectRoot: string): string | null {
  const pkgPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return null;
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { name?: unknown };
    return typeof pkg.name === 'string' && pkg.name.trim() ? pkg.name.trim() : null;
  } catch {
    return null;
  }
}

function firstMatch(content: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = content.match(pattern);
    const value = match?.[1]?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}

function detectAndroidApplicationId(projectRoot: string): string | null {
  const candidates = [
    'android/app/build.gradle',
    'android/app/build.gradle.kts',
  ];

  for (const rel of candidates) {
    const filePath = path.join(projectRoot, rel);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const id = firstMatch(content, [
      /applicationId\s+["']([^"']+)["']/,
      /applicationId\s*=\s*["']([^"']+)["']/,
      /namespace\s+["']([^"']+)["']/,
      /namespace\s*=\s*["']([^"']+)["']/,
    ]);
    if (id) {
      return id;
    }
  }

  return null;
}

function detectIosBundleId(projectRoot: string): string | null {
  const iosDir = path.join(projectRoot, 'ios');
  if (!fs.existsSync(iosDir)) {
    return null;
  }

  const pbxprojFiles: string[] = [];
  for (const entry of fs.readdirSync(iosDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.endsWith('.xcodeproj')) {
      const pbx = path.join(iosDir, entry.name, 'project.pbxproj');
      if (fs.existsSync(pbx)) {
        pbxprojFiles.push(pbx);
      }
    }
  }

  for (const pbx of pbxprojFiles) {
    const content = fs.readFileSync(pbx, 'utf8');
    const ids = [
      ...content.matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+);/g),
    ]
      .map((match) => match[1]?.trim().replace(/^"|"$/g, ''))
      .filter((value): value is string => Boolean(value))
      .filter((value) => !value.includes('$(') && value !== '$(PRODUCT_BUNDLE_IDENTIFIER)');

    if (ids.length > 0) {
      return ids.find((id) => !/\.(tests?|uitests?)$/i.test(id)) ?? ids[0] ?? null;
    }
  }

  return null;
}

export function detectWorkspace(projectRoot: string): string {
  const iosDir = path.join(projectRoot, 'ios');
  if (!fs.existsSync(iosDir)) {
    return 'ios/MyApp.xcworkspace';
  }
  const found = fs.readdirSync(iosDir).find((name) => name.endsWith('.xcworkspace'));
  if (found) {
    return path.join('ios', found).replace(/\\/g, '/');
  }
  return 'ios/MyApp.xcworkspace';
}

export function detectScheme(workspaceRel: string): string {
  const base = path.basename(workspaceRel, '.xcworkspace');
  return base && base !== 'MyApp' ? base : 'Prod';
}

function detectVersionCodeFile(projectRoot: string): string {
  if (fs.existsSync(path.join(projectRoot, 'android/app/build.gradle'))) {
    return 'android/app/build.gradle';
  }
  if (fs.existsSync(path.join(projectRoot, 'android/app/build.gradle.kts'))) {
    return 'android/app/build.gradle.kts';
  }
  return 'android/app/build.gradle';
}

/**
 * Infer common React Native project values for init templates.
 * Returns placeholders-friendly nulls when detection fails.
 */
export function detectProject(projectRoot: string): DetectedProject {
  const androidId = detectAndroidApplicationId(projectRoot);
  const iosId = detectIosBundleId(projectRoot);
  const pkgName = readPackageJsonName(projectRoot);
  const workspace = detectWorkspace(projectRoot);

  return {
    packageName: androidId ?? (pkgName && !pkgName.startsWith('@') ? pkgName : null),
    bundleId: iosId ?? androidId ?? null,
    workspace,
    scheme: detectScheme(workspace),
    versionCodeFile: detectVersionCodeFile(projectRoot),
  };
}
