/** @type {import('@touqeerraza/rn-publisher').Config} */
module.exports = {
  secretsDir: "__SECRETS_DIR__",
  keysFile: "__KEYS_FILE__",
  environments: {
    prod: {
      label: "Production",
      android: {
        assembleTask: "assembleRelease",
        bundleTask: "bundleRelease",
        apkPath: "android/app/build/outputs/apk/release/app-release.apk",
        aabPath: "android/app/build/outputs/bundle/release/app-release.aab",
        versionCodeFile: "__VERSION_CODE_FILE__",
        // Optional doctor check only:
        // keystoreProperties: "android/keystore.properties",
      },
      ios: {
        workspace: "__WORKSPACE__",
        scheme: "__SCHEME__",
        configuration: "Release",
        exportOptionsPlist: "ios/ExportOptions-Prod.plist",
        projectDir: "ios",
      },
    },
    /**
     * you can create more environments here same as prod
     */
  },
  platforms: {
    firebase: { enabled: true },
    play: { enabled: true },
    ios: { enabled: true },
  },
};
