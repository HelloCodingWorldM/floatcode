# FloatCode 0.4.1 deployment

This release uses three components:

1. The macOS Electron app.
2. Supabase Auth and Postgres for accounts, memberships, and invitation metadata.
3. One Docker service for authenticated Yjs WebSocket collaboration and the guest landing page.

## 1. Supabase

Apply the SQL files in `supabase/migrations/` in numeric order. Migration `001`
creates the collaboration schema and `002` removes unnecessary client execution
rights from Supabase's automatic RLS event function when that function is present.
In **Authentication → Sign In / Providers**, keep Email enabled and enable anonymous sign-ins.
Keep the default anonymous sign-in rate limit or lower it for the beta. Anonymous users can
only redeem an unexpired invitation; they cannot create documents or invitations.

The desktop build uses only the project URL and publishable key. Never add a secret or
`service_role` key to `.env.local`, Vite variables, Git, an installer, or a public log.

## 2. Collaboration service

Deploy the root `Dockerfile` as one service. Attach a persistent volume at `/data`; without
that volume, shared document contents are lost on redeploy. Configure `/health` as the health
check and expose the generated HTTPS domain.

Set these server-only variables in the hosting dashboard:

```text
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY=SET_IN_HOSTING_DASHBOARD_ONLY
FLOATCODE_COLLAB_SECRET=AT_LEAST_32_RANDOM_CHARACTERS
FLOATCODE_PUBLIC_WS_URL=wss://YOUR_PUBLIC_SERVICE_DOMAIN
FLOATCODE_ALLOWED_ORIGINS=null,file://,http://127.0.0.1:5173
FLOATCODE_DATA_DIR=/data/yjs
FLOATCODE_DOWNLOAD_URL=https://YOUR_DOWNLOAD_URL/FloatCode-latest.dmg
```

Generate `FLOATCODE_COLLAB_SECRET` with `openssl rand -base64 48`. Do not reuse the
Supabase secret. Run one service replica: LevelDB persistence is local to the attached volume.

## 3. Desktop production build

Add the public service URLs to `.env.local` before building:

```text
VITE_FLOATCODE_API_URL=https://YOUR_PUBLIC_SERVICE_DOMAIN
VITE_FLOATCODE_JOIN_URL=https://YOUR_PUBLIC_SERVICE_DOMAIN/join
```

Then run on macOS:

```bash
npm ci
npm run dist:mac
```

The owner signs in with email and creates a room. **Copy guest link** creates a 256-bit
random invitation valid for 24 hours and up to 25 first-time guests. The server stores only
its SHA-256 hash. **Revoke link** invalidates it immediately. Guests open the HTTPS link and
join through the `floatcode://` deep link without entering an email address.

## Production release requirements

- Sign and notarize the app with an Apple Developer ID before public distribution.
- Enable email confirmation and configure production SMTP in Supabase.
- Add bot protection before a large public launch; Supabase recommends CAPTCHA for anonymous sign-ins.
- Back up the `/data` volume and monitor disk usage, health checks, authentication errors, and rate limits.
- Keep one replica unless persistence is migrated from LevelDB to shared durable storage.
