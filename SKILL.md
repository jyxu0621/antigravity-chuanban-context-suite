---
name: antigravity-chuanban-context-suite
description: Deploy, adapt, and verify the integrated Antigravity desktop UI suite on Windows, macOS, or Linux: Chuanban theme patch (with i18n/metrics disabled and high-priority z-index popup stacking) plus streamlined Antigravity ContextViewer (v3.3.4 Chinese i18n, removed 256K/ProxyNoTun/color drawers, 580px capped popup, conservative anti-lag optimizations, pure CDP + dynamic loopback HTTP bridge daemon without modifying app.asar). Use when setting up a new machine, cloning this skill from GitHub, re-applying after Antigravity updates, or troubleshooting missing titlebar meter, i18n, or popup layering.
---

# Antigravity Chuanban + ContextViewer Suite

This skill automates setup and verification for **Antigravity Desktop** by integrating two upstream repositories through a CDP + loopback HTTP daemon architecture:

1. **Chuanban Theme Patch** (`https://github.com/Anarcadia/chuanban-antigravity-theme-patch`)
   - Installs Chuanban typography and theme styling alongside its background CDP daemon (`antigravity-font-daemon.mjs`).
   - Applies adapted configuration ([`assets/theme-user-config.json`](assets/theme-user-config.json)): disables Chuanban's conflicting `i18n` and `metrics` modules (`false`), while keeping `composerWaxSeal`, `deadlockHealer`, `customCss`, and `customJs` enabled (`true`).
   - Applies popup stacking script ([`assets/theme-user-custom.js`](assets/theme-user-custom.js)): promotes `#ag-context-meter` and stacking ancestors to `z-index: 2147483500` when any meter popup is open (restoring original styles when closed) and coordinates `window.electronNative?.wcvBrowser?.setPortalOverlayOpen` so native WebContentsView browser panes do not overlap the panel.

2. **Antigravity ContextViewer** (`https://github.com/elviscjn-cjn/antigravity-context-viewer`) + [`patches/context-viewer.patch`](patches/context-viewer.patch)
   - Pinned verified base commit: `a204823f597e1aee482f35574798ecbec61874c9`.
   - Retains the titlebar context meter, `v3.3.4` runtime Chinese localization (`chinese` module), and `Escape`/outside-click panel dismissal.
   - Removes unwanted UI (`unlock-256k-drawer`, `proxy-notun-drawer`, `btn-toggle-colors`, and upstream auto-update prompts) and caps `#panel` height (`max-height: 580px`).
   - Routes renderer backend requests through `window.__AGContextMeterLive` + `callLiveBridge` (`http://127.0.0.1:<livePort>`).
   - Applies conservative anti-lag optimizations:
     - `meter-renderer.js`: `hostDomObserver` checks `observedTitlebar` first; `tick()` staggers `/scan` by `900ms` on live route switches and deduplicates `/token-history` within `5s`.
     - `i18n/i18n-runtime.js`: `flushPendingNodes` time-slices DOM work in `8ms` `requestAnimationFrame` batches; `translateSingleUnit` skips regex scanning for DOM strings longer than `500` characters after checking `exactDict`.

3. **Pure CDP + Dynamic Loopback Bridge Daemon** ([`assets/antigravity-patch-guardian.mjs`](assets/antigravity-patch-guardian.mjs))
   - Deployed to `~/.gemini/antigravity/scripts/antigravity-patch-guardian.mjs`.
   - Keeps official `app.asar` untouched (`process.noAsar = true`), automatically restoring a clean `app-*-base.asar` backup if an older ASAR patch marker is present.
   - Re-injects across page reloads, `language_server` port changes, new windows, client restarts, and Antigravity updates via `Page.addScriptToEvaluateOnNewDocument`, navigation events, and a `15s` lightweight check.
   - Registers OS logon autostart outside short-lived agent Job Objects (`AntigravityPatchGuardian` Scheduled Task on Windows, `LaunchAgent` on macOS, `systemd --user` on Linux).

## Prerequisites

- **Node.js `>= 22.0.0`** (uses built-in global `WebSocket` and `node:test`) and **Git**.
- **Antigravity Desktop** installed. Chuanban's `install --channel auto` configures DevTools debugging launch arguments on Windows shortcuts; if Antigravity was open without `--remote-debugging-port`, quit and relaunch Antigravity once after setup.
- **Fonts (Optional / Recommended for Chuanban)**: Anthropic + Sarasa font pack from Google Drive (`https://drive.google.com/drive/folders/1NX92SgVUqtSjWg6bt6sIJXy-cn7J_boC`). Download locally and pass `--fonts-from <folder>` during setup (or install fonts into your OS manually).

## Workflow

### 1. Dry-Run Path Check

```bash
node scripts/setup.mjs --dry-run
```

### 2. Idempotent Setup

Run from the root of this skill directory:

```bash
node scripts/setup.mjs
```

Optional flags:

| Flag | Purpose |
| --- | --- |
| `--context-viewer-dir <dir>` | Custom path for `antigravity-context-viewer` (default: `repo-path.txt`, existing `D:\antigravity-context-viewer` on Windows, or `~/.gemini/antigravity/antigravity-context-viewer`) |
| `--theme-repo-dir <dir>` | Custom path for `chuanban-antigravity-theme-patch` (default: `~/.gemini/antigravity/chuanban-theme-repo`) |
| `--fonts-from <dir>` | Folder containing Chuanban fonts to pass to `install-fonts --from` |
| `--latest` | Apply patch against upstream `HEAD` instead of pinned commit `a204823` |
| `--skip-tests` | Skip `node --test` after patching `antigravity-context-viewer` |
| `--skip-verify` | Skip running `verify.mjs` after setup |

### 3. Live Verification

```bash
# Full check (files, clean official app.asar, running daemons, live CDP state/bridge/z-index)
node scripts/verify.mjs

# Static + daemon check only (when Antigravity desktop is closed)
node scripts/verify.mjs --skip-cdp
```

Passing output fields in `verify.mjs`:
- `ok: true`
- `cleanOfficialAsar !== false` (`true` when `app.asar` contains no `__AGContextMeter` marker)
- `themeConfigAdapted: true` and `themeCustomJsExists: true`
- `modulesState.chinese.enabled === true` and `modulesState.proxy.enabled === false`
- Non-empty `daemons.themeDaemonPids` and `daemons.patchGuardianPids`
- When CDP window is open: `chuanbanVersion` present, `chuanbanI18nObserver === false`, `contextMeterMounted === true`, `i18nBooted === true`, `bridgeModulesOk === true`, `openZ === "2147483500"`, `closedZ === "20"`, and all `deletedAbsent` flags `true`.

## Troubleshooting & Rollback

- **Antigravity was open before setup and CDP is unreachable**: Completely quit Antigravity, relaunch from the updated shortcut so `--remote-debugging-port` is active, then run `node scripts/verify.mjs`.
- **Dirty `app.asar` detected**: Close Antigravity completely so file locks release, then re-run `node scripts/setup.mjs` to restore a clean `app-*-base.asar` backup.
- **Backups**: Overwritten user files are backed up under `<STATE_DIR>/backups/skill-setup/` (Windows default: `%LOCALAPPDATA%\AntigravityContextMeter\backups\skill-setup`).
- **Rollback**: Stop the two background Node daemons (`AntigravityPatchGuardian` / `~/.gemini/antigravity/scripts/antigravity-patch-guardian.mjs` and Chuanban's `uninstall` command) and restart or reload Antigravity. Official `app.asar` stays untouched.
