# macOS release readiness

Windows publication remains on hold. The user authorized merging and deploying
Mac fixes, and publishing only after acceptance passes.

## Completed on 2026-10-15 UTC

- PR #2 merged into main as `d54b4636224a387b4270621c26547655696c857e`.
- Railway deployment `32d8f172-aa7e-4013-8484-e57288215d7b` reached SUCCESS.
- Production CORS preflight now permits the packaged app's `null` origin and
  continues to reject untrusted origins.
- Both v0.4.2 Mac packages passed strict/deep ad-hoc signature verification and
  native startup on matching Apple Silicon and Intel runners:
  https://github.com/HelloCodingWorldM/floatcode/actions/runs/38680255026
- Production acceptance uncovered a second bug: the invitation RPC's output
  variable `document_id` collided with the ON CONFLICT column name. Migration
  `20261015042925_fix_invite_document_id_ambiguity.sql` was applied and read back
  successfully. It targets the existing primary-key constraint explicitly and
  preserves SECURITY INVOKER and service-role-only execution permissions.
- Real production acceptance passed using temporary accounts and independent
  WebSocket clients (cross-tab broadcast disabled): registration/password login;
  anonymous guests; owner-created rooms; uninvited access rejection; invitation
  redemption; simultaneous edits; presence; offline edits/reconnection; access
  token refresh; reopening shared content; revoked-invitation rejection.
- npm check/build, local collaboration integration tests and Verify CI passed.

The production tests exercise the real Auth, API, database and WebSocket stack.
They are not a substitute for testing the downloaded app's macOS UI, invitation
protocol handler or Gatekeeper behavior. They do not test server restart recovery
or prove document retention beyond the observed reconnect/reopen.

## Test downloads

GitHub sign-in is required for Actions artifacts. Extract the archive and install
its matching DMG, replacing the old app in Applications.

- Apple Silicon: https://github.com/HelloCodingWorldM/floatcode/actions/runs/38680255026/artifacts/11948210023
- Intel: https://github.com/HelloCodingWorldM/floatcode/actions/runs/38680255026/artifacts/11948340199

## Remaining release gates

1. User confirms the downloaded Mac app opens, signs in and joins a shared room
   through an invitation on a second Mac. See mac-installation.md if blocked.
2. Publish a clearly labeled, non-notarized v0.4.2 beta only after that acceptance.
   Existing authorization covers this publication; do not request it again.
3. Verify public downloads without GitHub sign-in, then update the live invitation
   page's FLOATCODE_DOWNLOAD_URL. It still points to v0.4.1-beta.1 until then.
4. A normal public distribution without manual Gatekeeper exceptions requires
   Developer ID signing and Apple notarization, neither of which is configured.

## Test cleanup

All nine temporary acceptance sessions across three runs were signed out. The
successful run cleared its shared test text. Attempts to delete the temporary
accounts via execute_sql and apply_migration returned `Invalid or expired
requestState`; cleanup is not confirmed. scripts/cleanup-acceptance.sql scopes
cleanup to those exact run markers and the test email pattern/anonymous flag.
No real user accounts are targeted. Run it through an authorized database client
and confirm no matching accounts or their cascaded room records remain.

## Existing Auth advisories

The security advisor reports anonymous-user RLS policies (expected for invited
guests; membership predicates and service-only RPC permissions are preserved):
https://supabase.com/docs/guides/database/database-advisors?queryGroups=lint&lint=0012_auth_allow_anonymous_sign_ins

It also reports that leaked-password protection is disabled; this pre-existing
Auth setting was not changed:
https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
