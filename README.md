# Antigravity Chuanban + ContextViewer Suite (`antigravity-chuanban-context-suite`)

One-command skill & cross-platform installer integrating:
- **[chuanban-antigravity-theme-patch](https://github.com/Anarcadia/chuanban-antigravity-theme-patch)** — Adapted so Chuanban's built-in `i18n` and `metrics` modules stay off while theme styling + titlebar controls stay active, plus popup layering elevation (`z-index: 2147483500`) for `#ag-context-meter`.
- **[antigravity-context-viewer](https://github.com/elviscjn-cjn/antigravity-context-viewer)** (pinned base commit `a204823f597e1aee482f35574798ecbec61874c9`) + [`patches/context-viewer.patch`](patches/context-viewer.patch):
  - Keeps titlebar context meter and `v3.3.4` Chinese runtime translation (`chinese` module).
  - Removes 256K experimental unlock drawer, ProxyNoTun drawer, and color customization drawer.
  - Caps popup panel height at `580px` and bridges renderer API calls via loopback HTTP (`callLiveBridge`).
  - Removes upstream GitHub auto-update prompt logic.
  - Applies conservative latency optimizations (`observedTitlebar` O(1) `hostDomObserver` fast-path, `900ms` `/scan` stagger + `5s` `/token-history` deduplication on live route switches, 8ms rAF `flushPendingNodes` time-slicing, and `> 500` char DOM bypass on regex pass in `i18n-runtime.js`).
- **Pure CDP + Dynamic Loopback Bridge Daemon** (`assets/antigravity-patch-guardian.mjs`):
  - Zero `app.asar` disk modification (`process.noAsar = true`), automatic clean base ASAR recovery if needed.
  - Persists automatically across page reloads, `language_server` port changes, new windows, client restarts, and Antigravity updates.
  - Registers OS-native logon autostart (Windows Scheduled Task outside agent Job Objects, macOS LaunchAgent, Linux `systemd --user`).

## Quick Install on a New Machine

Clone directly into your Antigravity global skills directory (`~/.gemini/config/skills/`):

```bash
git clone https://github.com/jyxu0621/antigravity-chuanban-context-suite.git ~/.gemini/config/skills/antigravity-chuanban-context-suite
cd ~/.gemini/config/skills/antigravity-chuanban-context-suite
node scripts/setup.mjs
```

### Windows (PowerShell)

```powershell
git clone https://github.com/jyxu0621/antigravity-chuanban-context-suite.git "$env:USERPROFILE\.gemini\config\skills\antigravity-chuanban-context-suite"
cd "$env:USERPROFILE\.gemini\config\skills\antigravity-chuanban-context-suite"
node scripts/setup.mjs
```

Optional Chuanban font pack:
1. Download fonts from [Google Drive](https://drive.google.com/drive/folders/1NX92SgVUqtSjWg6bt6sIJXy-cn7J_boC).
2. Run setup with `--fonts-from <path-to-font-folder>`.

## Verification

```bash
node scripts/verify.mjs
```

If Antigravity is currently closed:

```bash
node scripts/verify.mjs --skip-cdp
```

## Directory Layout

```text
antigravity-chuanban-context-suite/
├── SKILL.md                             # Antigravity skill definition & workflow guide
├── README.md                            # Repository quickstart & architecture overview
├── assets/
│   ├── antigravity-patch-guardian.mjs   # Portable CDP + loopback HTTP bridge daemon
│   ├── theme-user-config.json           # Adapted Chuanban user/config.json
│   └── theme-user-custom.js             # Adapted Chuanban user/custom.js (popup z-index & Esc close)
├── patches/
│   └── context-viewer.patch             # Clean patch over antigravity-context-viewer@a204823
└── scripts/
    ├── setup.mjs                        # Cross-platform idempotent installer
    └── verify.mjs                       # Static + daemon + live CDP verification script
```
