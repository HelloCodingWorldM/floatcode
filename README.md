# FloatCode

FloatCode is a movable, transparent, frameless code editor for macOS. It keeps
syntax-highlighted code visible while providing an always-visible title bar for
moving the window and switching modes.

## Features

- Fully transparent editor background
- Always-visible border and a full-width draggable title bar
- macOS-style close, minimize, and maximize/restore buttons
- Switch between transparent and fully white editor backgrounds
- Optional always-on-top behavior with a saved Pinned / Unpinned setting
- Lower-right resize handle in interactive mode
- Passive startup that appears without taking keyboard focus
- Editable CodeMirror 6 editor with local autosave
- CoderPad-style line numbers with active-line highlighting
- Visible 11–36 px code-font controls with a saved preference
- Python, JavaScript/TypeScript, Java, and C/C++ highlighting
- Mouse pass-through mode
- Selective pass-through that keeps the title bar and controls clickable
- Automatic upper-half code scrolling while pass-through remains enabled
- Multi-person editing with live cursors and selections
- Expiring, revocable guest links; invited guests do not register an email
- Authenticated WebSocket rooms with persistent server storage
- Global hide/show and edit/pass-through shortcuts
- Always-visible title-bar controls and a menu bar tray icon
- Best-effort macOS screen-capture content protection
- Supabase email/password registration and encrypted local session storage
- No analytics

## Configure Supabase registration

1. Create a Supabase project.
2. In **Authentication → Providers**, enable Email.
3. Copy the project URL and the project's publishable key from the API settings.
4. In this folder, create the local configuration:

```bash
cp .env.example .env.local
```

5. Open `.env.local` and replace the placeholder values:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
VITE_FLOATCODE_API_URL=https://collab.YOUR_DOMAIN.com
VITE_FLOATCODE_JOIN_URL=https://collab.YOUR_DOMAIN.com/join
```

Use only a publishable/anon key in this desktop application. Never include a
Supabase `service_role` key. If email confirmation is enabled, new users must
click the confirmation email before signing in.

## Run it on a Mac

Install [Node.js](https://nodejs.org/) 22 or later, open Terminal in this
folder, and run:

```bash
npm install
npm start
```

Without `.env.local`, FloatCode opens a setup screen instead of the editor.

For development with live reload:

```bash
npm run dev
```

## Live collaboration

The production collaboration server authenticates Supabase sessions, issues
short-lived room tokens, and persists Yjs documents to an attached volume. The
owner creates a room and chooses **Copy guest link**. A guest opens that link and
receives an anonymous Supabase identity automatically—no email registration is
required. Links expire after 24 hours, accept at most 25 first-time guests, and
can be invalidated with **Revoke link**.

See [DEPLOYMENT.md](DEPLOYMENT.md) for the database migration, Docker service,
server-only variables, persistent volume, and production build steps.

For UI testing on a trusted local network without authentication, leave the two
`VITE_FLOATCODE_*` collaboration URLs unset and run:

```bash
npm run collab-server:legacy
```

The legacy server is intentionally not suitable for the public internet.

## Build a macOS app

Build for the Mac you are currently using:

```bash
npm install
npm run dist:mac
```

The `.dmg`, `.zip`, and `.app` output will be placed in `release/`. Supabase
settings are embedded when `npm run dist:mac` builds the app, so configure
`.env.local` first. This beta build is unsigned; macOS may require testers to
right-click the app and choose **Open** on first launch. A later public release
should be signed and notarized with an Apple Developer account.

Apple Silicon only:

```bash
npm run dist:mac:arm64
```

Intel only:

```bash
npm run dist:mac:x64
```

## Controls

| Action | Shortcut |
| --- | --- |
| Toggle editing and mouse pass-through | `⌥ 2` |
| Emergency quit and release the overlay | `⌥ 3` |
| Increase font size | `⌘ +` |
| Decrease font size | `⌘ -` |
| Reset font size | `⌘ 0` |

After sign-in, FloatCode starts in interactive mode without taking focus. Use
the always-visible top controls. Drag any empty part of the top title bar
to move the window, drag the lower-right handle or a native window edge to resize it, and
use the mouse wheel or trackpad to scroll the code. Press `⌥ 2` to enable
mouse pass-through: while enabled, clicks and scrolling go to the application
behind FloatCode when the pointer is over the code area. The title bar and top
controls stay visible and clickable, so you can change language, background,
pinning, sharing, or return to edit mode without using the shortcut. Press
`⌥ 2` at any time to return to edit and scroll mode. Remote collaboration
updates do not focus the window.

Use the `− / number / +` control in the top toolbar to resize only the code
text. Click the number to reset it to 17 px. The setting is saved automatically.

While mouse pass-through is enabled, moving the pointer into the upper half of
the editor temporarily activates FloatCode so the mouse wheel or trackpad can
scroll the code. Moving into the lower half restores pass-through automatically.
The split follows the current window height at every window size.

The red button in the upper-left hides FloatCode without quitting it; reopen it
from the menu-bar icon. The yellow button minimizes the window, and the green
button toggles between maximized and the previous window size.

Use the **Transparent / White** button to switch backgrounds. White mode fills
the entire editor and title bar and automatically switches the editor to a
readable light syntax theme. Use **Pinned / Unpinned** independently to control
whether FloatCode stays above other apps. Both settings are restored the next
time FloatCode starts and are also available from the menu-bar icon.

When Pinned is enabled, FloatCode stays above normal and fullscreen macOS
windows. It also enables
Electron's official content-protection API as a best-effort privacy measure.
It deliberately stays below macOS system dialogs so an application error cannot
leave an invisible window blocking part of the desktop. If the overlay ever
misbehaves, press `⌥ 3` to release it and exit immediately.
Electron documents that newer macOS applications using ScreenCaptureKit may
still capture the window, so FloatCode cannot guarantee invisibility in every
meeting, recording, screenshot, or screen-sharing application. It does not hide
its process or attempt to bypass monitoring or assessment controls.

Your latest code, selected language, connection settings, and font size are
stored locally in Electron's app data. Code is sent over the network only while
you are connected to a collaboration room.

Use FloatCode for personal notes, practice, teaching, or presentations, and
follow the rules of any workplace, meeting, interview, or assessment environment.
