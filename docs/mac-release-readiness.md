# macOS release readiness

Windows publication is on hold until the Mac release is usable.

## Verified on 2026-10-15 UTC

- Version 0.4.2 ad-hoc signed packages passed strict/deep bundle signature verification and native process startup on both arm64 and Intel macOS runners. Run: https://github.com/HelloCodingWorldM/floatcode/actions/runs/38672250312
- The production collaboration health endpoint responds successfully.
- Railway has one collaboration replica with a persistent volume mounted at `/data`.
- Production API preflight requests from the packaged application's `null` origin return 204 without `Access-Control-Allow-Origin`. This prevents renderer API requests from proceeding. The branch fixes the allowed-origin response, including preflight, without permitting arbitrary origins.
- `node --test scripts/test-collaboration.cjs` passes against the actual local collaboration server: packaged-app CORS, rejected origins, unauthenticated API rejection, two independent WebSocket clients, concurrent edits, presence, offline edits/reconnection, a new participant, and cross-room token rejection.
- Test authentication tokens are local fixtures. These tests do not verify production Supabase login, account creation, invite redemption RPCs, macOS deep links, or Gatekeeper behavior.
- The live invitation page still points downloads to v0.4.1-beta.1, the old unsigned beta.

## Required before calling the release ready

1. Review and deploy the CORS fix from the Mac-only PR. Verify production OPTIONS responses for `Origin: null` include the matching allow-origin header and unauthorized origins remain rejected.
2. For normal public distribution, configure a Developer ID Application certificate and Apple notarization credentials securely in CI. Do not paste private keys, passwords, or certificates into chat. The current `identity: "-"` is ad-hoc signing and is not a notarized public release.
3. Build signed and notarized packages for both architectures; verify the application signature, notarization ticket and Gatekeeper assessment on the downloaded package. Existing CI startup checks alone do not prove this.
4. On two Macs using the downloaded app: sign in as an owner; start a room; copy the invitation; open it on the second Mac as a guest; verify simultaneous editing and participant indicators; disconnect/reconnect; quit/reopen and verify saved shared content. Confirm a revoked or expired invitation cannot join as a new participant.
5. Publish the verified Mac packages and checksums as a public GitHub release. Verify downloads without signing in, then update the invitation page's `FLOATCODE_DOWNLOAD_URL` to that exact release and verify it.

The previous attempt to merge a combined Mac/Windows feature branch into main was rejected by automatic approval review because it could publish public releases. This PR is Mac-only; no production merge, server deployment, release publication, or download redirect has been performed by this readiness work.
