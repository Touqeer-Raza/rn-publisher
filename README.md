# @touqeerraza/rn-publisher

Interactive CLI to publish a React Native app to **Firebase App Distribution**, **Google Play**, and **TestFlight**.

It assumes a standard React Native layout (`android/`, `ios/`, release Gradle tasks, Xcode workspace). If your project uses custom flavors or paths, edit the generated config.

## Requirements

- **Node.js 20+**
- A React Native app with Android and/or iOS native projects
- Tools for the destinations you use:

| Destination | Tool |
| ----------- | ---- |
| Firebase App Distribution | [Firebase CLI](https://firebase.google.com/docs/cli) (`firebase login`) |
| Google Play | [fastlane](https://docs.fastlane.tools) (`supply`) |
| TestFlight | macOS + Xcode (`xcodebuild`, `xcrun altool`) |

## Install

```bash
npm install -D @touqeerraza/rn-publisher
# or
yarn add -D @touqeerraza/rn-publisher
```

Optional script in `package.json`:

```json
{
  "scripts": {
    "publish:app": "rn-publisher"
  }
}
```

## Quick start

From your React Native project root:

```bash
npx rn-publisher init
npx rn-publisher doctor
npx rn-publisher
```

### What `init` creates

| File | Tracked? | Purpose |
| ---- | -------- | ------- |
| `rn-publisher.config.js` | yes | Build tasks, artifact paths, Xcode settings |
| `publish-secrets/keys.json` | no | Destination credentials and IDs |
| `publish-secrets/README.md` | no | What to put in the secrets folder |
| `.gitignore` entries | yes | Ignores the secrets folder and release markers |

`init` always creates `./publish-secrets` (gitignored). Change `secretsDir` / `keysFile` in the config if you need a different path.

It also fills values it can detect from a normal RN app:

- Android `applicationId` → `play.packageName`
- iOS bundle identifier → `apple.bundleId`
- `ios/*.xcworkspace` → `ios.workspace` and `ios.scheme`
- `android/app/build.gradle` or `.kts` → `android.versionCodeFile`

You still need to add Firebase / Play / Apple credentials and an iOS ExportOptions plist.

## Default config

Generated config matches the usual RN release layout:

```js
/** @type {import('@touqeerraza/rn-publisher').Config} */
module.exports = {
  secretsDir: "./publish-secrets",
  keysFile: "./publish-secrets/keys.json",
  environments: {
    prod: {
      label: "Production",
      android: {
        assembleTask: "assembleRelease",
        bundleTask: "bundleRelease",
        apkPath: "android/app/build/outputs/apk/release/app-release.apk",
        aabPath: "android/app/build/outputs/bundle/release/app-release.aab",
        versionCodeFile: "android/app/build.gradle",
      },
      ios: {
        workspace: "ios/MyApp.xcworkspace",
        scheme: "MyApp",
        configuration: "Release",
        exportOptionsPlist: "ios/ExportOptions-Prod.plist",
        projectDir: "ios",
      },
    },
  },
  platforms: {
    firebase: { enabled: true },
    play: { enabled: true },
    ios: { enabled: true },
  },
};
```

| Field | Meaning |
| ----- | ------- |
| `secretsDir` | Folder for Play JSON and Apple `.p8` files |
| `keysFile` | Path to destination credentials JSON |
| `environments` | One or more publish targets (menus use these keys) |
| `android.assembleTask` / `bundleTask` | Gradle tasks for APK / AAB |
| `android.apkPath` / `aabPath` | Expected outputs after those tasks |
| `android.versionCodeFile` | Gradle file that holds `versionName` / `versionCode` |
| `android.keystoreProperties` | Optional existence check for doctor only |
| `ios.workspace` / `scheme` / `configuration` | Archive settings |
| `ios.exportOptionsPlist` | Plist for `-exportArchive` (`method` = `app-store`) |
| `ios.projectDir` | Folder with the `.xcodeproj` (usually `ios`) |
| `platforms.*.enabled` | Hide a destination from the menu |

Add more environments by copying the `prod` block and matching keys in `keys.json`.

## Keys file

Credentials live in `publish-secrets/keys.json`. Environment names must match `environments` in the config.

```json
{
  "prod": {
    "firebase": {
      "appId": "1:1234567890:android:abcdef",
      "groups": "testers"
    },
    "play": {
      "packageName": "com.example.app",
      "serviceAccountJson": "./play-service-account.json",
      "closedTrack": "alpha",
      "releaseStatus": "draft"
    },
    "apple": {
      "bundleId": "com.example.app",
      "apiKeyId": "XXXXXXXXXX",
      "apiIssuerId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "apiKeyP8": "./AuthKey_XXXXXXXXXX.p8"
    }
  }
}
```

| Key | Used for |
| --- | -------- |
| `firebase.appId` | Firebase Android app id |
| `firebase.groups` | App Distribution tester group(s) |
| `play.packageName` | Play Console application id |
| `play.serviceAccountJson` | Service-account JSON under `secretsDir` |
| `play.closedTrack` | Closed-testing track name (default `alpha`) |
| `play.releaseStatus` | `draft` (default) or `completed` — Play release status for uploads |
| `apple.bundleId` | iOS bundle id |
| `apple.apiKeyId` / `apiIssuerId` / `apiKeyP8` | App Store Connect API key (preferred) |
| `apple.uploadEmail` / `appSpecificPassword` | Alternative to API key |

Relative paths in keys resolve against `secretsDir`.

For Apple: if any API key field is set, all three are required. Otherwise both `uploadEmail` and `appSpecificPassword` are required.

## How publish works

```bash
npx rn-publisher
```

Interactive flow:

1. Shows which destinations are available on this machine
2. Pick an environment
3. Pick destinations (Firebase / Play / TestFlight)
4. Pick a Play track if Play is selected
5. Edit or accept release notes
6. Edit or accept **version name** (defaults to current) and **version code** (defaults to current + 1)
7. Confirm, then build and upload

What runs per destination:

| Destination | Build | Upload |
| ----------- | ----- | ------ |
| Firebase | `assembleTask` → APK | `firebase appdistribution:distribute` |
| Google Play | `bundleTask` → AAB | `fastlane supply` (notes via changelog metadata) |
| TestFlight | `xcodebuild` archive + export | `xcrun altool` |

### Versioning

Publish asks before building. It does not silently bump:

| Field | Android | iOS | Prompt default |
| ----- | ------- | --- | -------------- |
| Version name | `versionName` | `MARKETING_VERSION` | Current value |
| Version code | `versionCode` | `CURRENT_PROJECT_VERSION` | Current + 1 |

Version name must look like `1.0` or `1.2.3`. The same pair is applied to every selected platform.

**iOS:** `Info.plist` (app and every extension) should use `$(MARKETING_VERSION)` and `$(CURRENT_PROJECT_VERSION)`, not hardcoded numbers. Otherwise the IPA keeps the old build and App Store Connect / extensions can reject the upload.

If every destination fails, version file changes are reverted. If any destination succeeds, changes are kept.

## Destinations

### Firebase App Distribution

1. Copy the Android app id from Firebase Console → Project settings
2. Set a tester group name from App Distribution
3. Put both under `firebase` in `keys.json`
4. Run `firebase login` on the publishing machine

### Google Play

1. Create a Play Console service account with release access
2. Put the JSON key in `publish-secrets/`
3. Set `play.packageName` and `play.serviceAccountJson`
4. Set `play.releaseStatus` to `draft` (required while the app is still draft in Play Console) or `completed` once the app can accept completed releases
5. Closed testing uses track `alpha` unless `closedTrack` is set

### TestFlight

1. Create an App Store Connect API key
2. Put `AuthKey_<id>.p8` in `publish-secrets/`
3. Set `apple.apiKeyId`, `apple.apiIssuerId`, `apple.apiKeyP8`, and `apple.bundleId`
4. Add an ExportOptions plist and set `ios.exportOptionsPlist`
5. Ensure the app **and** any extensions (e.g. notification service) share the same version via Build Settings / `$(CURRENT_PROJECT_VERSION)`

Example plist (`ios/ExportOptions-Prod.plist`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>app-store</string>
	<key>teamID</key>
	<string>YOUR_TEAM_ID</string>
	<key>uploadSymbols</key>
	<true/>
	<key>signingStyle</key>
	<string>automatic</string>
</dict>
</plist>
```

## CI / flags

```bash
npx rn-publisher publish \
  --env prod \
  --platforms firebase,play \
  --track closed \
  --version-name 1.2.3 \
  --version-code 42 \
  --yes \
  --commit
```

| Flag | Meaning |
| ---- | ------- |
| `--env` | Environment key from config |
| `--platforms` | `firebase`, `play`, `ios` (comma-separated) |
| `--track` | Play: `closed`, `open`, or `production` |
| `--notes` | Release notes (skips git-generated notes) |
| `--version-name` | App version name (default: current) |
| `--version-code` | Android `versionCode` / iOS build number (interactive default: current + 1; CI default: current) |
| `--yes` / `-y` | Skip confirm |
| `--commit` | Commit version file changes as `chore: release <env>` |

Non-interactive runs must pass the required flags. Without `--version-name` / `--version-code`, CI keeps the current project versions.

## Doctor

```bash
npx rn-publisher doctor
npx rn-publisher doctor --env prod
```

Checks tools, config paths, and keys without publishing.

## Troubleshooting

Failures include a suggestion. Common cases:

| Symptom | Fix |
| ------- | --- |
| Config not found | Run `rn-publisher init` in the app root |
| Keys still placeholders | Fill `publish-secrets/keys.json` |
| Play JSON missing | Put the file in `secretsDir` and set `play.serviceAccountJson` |
| Firebase not logged in | `firebase login` |
| fastlane missing | Install fastlane |
| TestFlight unavailable | Use macOS with Xcode |
| Workspace missing | `cd ios && pod install`, then check `ios.workspace` |
| Archive / export failed | Check `ios/build/archive-*.log` or `export-*.log` |
| TestFlight build already used | Use a higher version code; ASC rejects duplicate `CFBundleVersion` |
| Extension version mismatch | Match app + `.appex` build numbers (`$(CURRENT_PROJECT_VERSION)`) |
| Gradle signing failed | Fix Android signing in Gradle / CI |

## License

MIT
