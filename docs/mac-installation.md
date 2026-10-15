# macOS 0.4.2 test build

This patch only changes Mac packaging. The existing editor, shortcuts, accounts,
and collaboration behavior are unchanged. Windows work is held until this Mac
build has been tested successfully.

The 0.4.1 build explicitly skipped code signing. Version 0.4.2 applies ad-hoc
signatures to the app and nested binaries, with the entitlements required by
Electron. CI verifies the finished bundle with `codesign --verify --deep --strict`
and launches each architecture on a matching Mac runner before uploading it.

Ad-hoc signing proves bundle consistency but is not an Apple Developer ID
signature or Apple notarization. A downloaded test build can still be blocked
by Gatekeeper. This patch does not claim to remove all macOS security warnings.

## Install and test

1. Download the arm64 DMG for Apple Silicon (M-series), or x64 for Intel.
2. Quit the older FloatCode app, open the DMG, and drag FloatCode into Applications,
   replacing the older app. This does not delete its local code or account data.
3. Try opening it. If blocked, check System Settings → Privacy & Security for
   **Open Anyway**. Only approve the copy you downloaded from this repository.
4. Confirm that it opens, allows sign-in, edits code, and toggles mouse pass-through.

## If macOS still says the test app is damaged

First compare the downloaded file with the SHA256SUMS file attached to the build:

```bash
shasum -a 256 ~/Downloads/FloatCode-0.4.2-arm64.dmg
```

Use the x64 filename instead for Intel. After installation, check the bundle:

```bash
codesign --verify --deep --strict --verbose=2 /Applications/FloatCode.app
```

If the download checksum matches and the bundle verification succeeds, but this
trusted test copy remains blocked because it is not notarized, remove the
quarantine flag from this app only and reopen it:

```bash
xattr -dr com.apple.quarantine /Applications/FloatCode.app
open /Applications/FloatCode.app
```

Do not use this step when the checksum or signature verification fails. It does
not sign or notarize an app and does not disable Gatekeeper for other apps.
A public release without this setup requires a Developer ID Application
certificate and Apple notarization.
