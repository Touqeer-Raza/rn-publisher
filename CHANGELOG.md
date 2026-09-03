# Changelog

## Unreleased

- `init` always uses `./publish-secrets` (no path prompt).
- Optional `play.releaseStatus` in keys.json: `draft` (default) or `completed`.
- Fix Google Play upload: write release notes via supply metadata changelogs instead of invalid `--changelog`.
- Prefer reading/writing iOS versions from `project.pbxproj`; ignore unsafe `agvtool` Info.plist lines that corrupted projects.
- Refuse to write/revert non-semver marketing versions or non-numeric build numbers.
- Validate version name interactively (e.g. 1.2.3).
- Removed `envFile` — native builds use their own env handling.
- `android.keystoreProperties` is optional; omitted by default.
- README rewritten for end users around default React Native project layout.

## 0.1.0

- First release of `@touqeerraza/rn-publisher`.
- `init` writes `rn-publisher.config.js`, `publish-secrets/keys.json`, secrets README, and `.gitignore` entries.
- Interactive publish with Inquirer select / checkbox / confirm (arrow keys and Space; no typed `1,2,3`).
- Destinations: Firebase App Distribution, Google Play (`fastlane supply`), TestFlight (`xcodebuild` + `altool`).
- Publisher never reads app `.env` files; native builds still receive `ENVFILE`.
- `doctor` command and errors that always include a fix suggestion.
