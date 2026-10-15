macOS test build with ad-hoc signatures and automated bundle-integrity verification.

Download **arm64.dmg** for Apple Silicon (M-series) or **x64.dmg** for Intel. Open the disk image and drag FloatCode into Applications, replacing the older test version. Existing local code and account data are preserved.

This build fixes the previous packaging configuration that skipped signing entirely. The app and nested binaries now receive ad-hoc signatures, and `codesign --verify --deep --strict` must pass before publication. SHA-256 checksums are attached.

**This is not a Developer ID signed or Apple-notarized release.** Gatekeeper may still block a downloaded beta. If you trust this repository and the download matches the attached checksum, try System Settings → Privacy & Security → Open Anyway after the first blocked launch. If macOS still reports the app as damaged, retain the error and verify the installed bundle with `codesign --verify --deep --strict --verbose=2 /Applications/FloatCode.app`; do not assume the warning has been resolved by rebuilding.

Other changes: reliable tray images and Alt/Option+1 hide/show shortcut. Mac and Windows builds use the same accounts and collaboration service.
