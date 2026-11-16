---
name: antigravity-chuanban-context-suite
description: Deploy, adapt, and verify the integrated Antigravity desktop UI suite on Windows, macOS, or Linux — a Claude-style Antigravity beautification and localization plugin (仿Claude风格的antigravity反重力美化插件): Chuanban theme patch v5.3.0 (with i18n/metrics disabled and high-priority z-index popup stacking) plus streamlined Antigravity ContextViewer v0.8.5 (Quota Ring, Speed tab, v3.3.4 Chinese i18n with Chuanban v5.3.0 dictionary fallback, removed Models/256K/Enhance/ProxyNoTun/color drawers, 580px capped popups, conservative anti-lag optimizations, pure CDP + dynamic loopback HTTP bridge daemon without modifying app.asar). Use when setting up a new machine, cloning this skill from GitHub, upgrading an existing installation, re-applying after Antigravity updates, or troubleshooting missing titlebar meter, quota popover, i18n, or popup layering.
---

# Antigravity Chuanban + ContextViewer Suite

This skill automates installation, upgrade, and verification for **Antigravity Desktop** by integrating two upstream repositories through a pure CDP + loopback HTTP daemon architecture:

1. **Chuanban Theme Patch** (`https://github.com/Anarcadia/chuanban-antigravity-theme-patch`, verified with `v5.3.0` / Antigravity `2.32.1`)
   - Installs Chuanban typography, curtain/Swarm fixes, and theme styling alongside its background CDP daemon (`antigravity-font-daemon.mjs` -> `core/daemon.mjs`).
   - Applies adapted configuration ([`assets/theme-user-config.json`](assets/theme-user-config.json)): disables Chuanban's overlapping `i18n` and `metrics` modules (`false`), while keeping `composerWaxSeal`, `deadlockHealer`, `coldBootHealer`, `zoomShortcuts`, `customCss`, and `customJs` enabled (`true`).
   - Applies popup stacking script ([`assets/theme-user-custom.js`](assets/theme-user-custom.js)): promotes `#ag-context-meter` and stacking ancestors to `z-index: 2147483500` when any meter or quota popup (`#panel`, `#panel-quota`, `#panel-tokens`, `#overflow-menu`, etc.) is open (restoring original styles on close), coordinates `window.electronNative?.wcvBrowser?.setPortalOverlayOpen` so native WebContentsView panes do not cover panels, and observes parent `childList` + capture-phase `click`/`pointerdown` so dynamically re-injected meter hosts rebind immediately.

2. **Antigravity ContextViewer** (`https://github.com/elviscjn-cjn/antigravity-context-viewer`, `v0.8.5`) + [`patches/context-viewer.patch`](patches/context-viewer.patch)
   - Pinned verified base commit: `868b25b46e2ac773daea2623f9e09e769e1384c1`.
   - Retains the titlebar context meter, Model Quota Ring (`#badge-quota` + `#panel-quota`), Speed Comparison (`#tab-ctx-speed`), Session Overview (`#tab-ctx-session`), Token History heatmaps, and `v3.3.4` runtime Chinese localization (`chinese` module with pure-CDP `简体中文`/`English` and brand title toggle).
   - Removes unwanted binary-patching/bloat UI (`#tab-ctx-models`, `#pane-ctx-models`, `#ctx-compact-card`, `#enhance-preset-card`, `#enhance-prompt-card`, `#proxy-notun-drawer`, `#btn-toggle-colors`, `#btn-panel-palette`), fixes upstream orphan wrapper tags around removed drawers, disables upstream startup auto-update prompts (`autoCheckUpdate = false`), and caps both `#panel` and `#panel-quota` at `max-height: min(580px, calc(100vh - 96px))`.
   - Routes renderer backend requests (including `/quota`, `/scan`, `/token-history`, `/modules-status`, `/toggle-module`, and `/open-external`) through `window.__AGContextMeterLive` (`http://127.0.0.1:<livePort>`).
   - Keeps conservative anti-lag protections:
     - `meter-renderer.js` (`src/renderer/main.js` rebuilt via `build-renderer.js`): `hostDomObserver` checks `observedTitlebar` first; `tick()` staggers `/scan` by `900ms` on live route switches and deduplicates `/token-history` within `5s`.
     - `i18n/i18n-runtime.js`: pairs upstream `6ms` `requestAnimationFrame` DOM batching with skipping full regex scans in `translateSingleUnit` after `exactDict` lookup for strings `> 500` characters.

3. **Pure CDP + Dynamic Loopback Bridge Daemon** ([`assets/antigravity-patch-guardian.mjs`](assets/antigravity-patch-guardian.mjs))
   - Deployed to `~/.gemini/antigravity/scripts/antigravity-patch-guardian.mjs`.
   - Keeps official `app.asar` untouched (`process.noAsar = true`), automatically restoring a clean `app-*-base.asar` backup if an older ASAR patch marker is present.
   - Merges safe filtered entries from Chuanban `v5.3.0`'s `theme-patch/core/i18n.json` as fallback behind ContextViewer `zh-CN.json` (and injects `window.__AGY_I18N_CONFIG__`) without turning on a second DOM `MutationObserver`.
   - Re-injects across page reloads, `language_server` port changes, new windows, client restarts, and Antigravity updates via `Page.addScriptToEvaluateOnNewDocument`, navigation events, and a `15s` lightweight check.
   - On Windows, `setup.mjs` registers and starts BOTH `AntigravityThemeDaemon` and `AntigravityPatchGuardian` via `Register-ScheduledTask` + `Start-ScheduledTask` so both daemons run outside short-lived agent Win32 Job Objects (using `LaunchAgent` on macOS and `systemd --user` on Linux).

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
| `--latest` | Apply patch against upstream `HEAD` instead of pinned commit `868b25b` |
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
- `themeConfigAdapted: true` (`i18n: false`, `metrics: false`, `coldBootHealer !== false`, `zoomShortcuts !== false`) and `themeCustomJsExists: true`
- `modulesState.chinese.enabled === true` and `modulesState.proxy.enabled === false`
- Non-empty `daemons.themeDaemonPids` and `daemons.patchGuardianPids`
- When CDP window is open: `chuanbanVersion` present, `chuanbanI18nObserver === false`, `contextMeterMounted === true`, `quotaMounted === true`, `i18nBooted === true`, `bridgeModulesOk === true`, `bridgeQuotaOk === true`, `openZ === "2147483500"`, `closedZ === "20"`, `quotaOpenZ === "2147483500"`, `quotaClosedZ === "20"`, and all `deletedAbsent` flags `true`.

## Troubleshooting & Rollback

- **Antigravity was open before setup and CDP is unreachable**: Completely quit Antigravity, relaunch from the updated shortcut so `--remote-debugging-port` is active, then run `node scripts/verify.mjs`.
- **Dirty `app.asar` detected**: Close Antigravity completely so file locks release, then re-run `node scripts/setup.mjs` to restore a clean `app-*-base.asar` backup.
- **Backups**: Overwritten user files are backed up under `<STATE_DIR>/backups/skill-setup/` (Windows default: `%LOCALAPPDATA%\AntigravityContextMeter\backups\skill-setup`).
- **Rollback**: Stop the two background Node daemons (`AntigravityPatchGuardian` / `~/.gemini/antigravity/scripts/antigravity-patch-guardian.mjs` and Chuanban's `uninstall` command) and restart or reload Antigravity. Official `app.asar` stays untouched.
