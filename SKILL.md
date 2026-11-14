---
name: antigravity-chuanban-context-suite
description: Deploy, adapt, and verify the integrated Antigravity desktop UI suite on another machine or after app updates: Chuanban theme patch (with i18n/metrics disabled + high-priority z-index popup bridge) + customized Antigravity ContextViewer (v3.3.4 Chinese i18n, removed 256K/ProxyNoTun/color drawers, 580px capped popup, conservative anti-lag optimizations, pure CDP + dynamic loopback HTTP bridge daemon without modifying app.asar). Use when setting up a new PC, cloning/reusing this skill from GitHub, re-applying after Antigravity updates, or troubleshooting missing titlebar meter, i18n, or popup layering.
---

# Antigravity Chuanban + ContextViewer Suite

This skill packages and automates the complete integrated setup for **Antigravity Desktop** combining two upstream repositories through a non-destructive CDP + local HTTP daemon architecture:

1. **Chuanban Theme Patch** (`https://github.com/Anarcadia/chuanban-antigravity-theme-patch`)
   - Installs the Chuanban typography/color theme and manages its background CDP font daemon (`antigravity-font-daemon.mjs`).
   - Applies adapted user configuration (`assets/theme-user-config.json`): disables Chuanban's conflicting `i18n` and `metrics` modules (`false`) while keeping `ui.showTitlebarThemeButton: true`.
   - Applies popup layering adapter (`assets/theme-user-custom.js`): elevates `#ag-context-meter` host `z-index` to `2147483500` when open (restoring `20` when closed), adds `Escape` & outside-click dismissal, and mirrors theme pills cleanly.

2. **Antigravity ContextViewer** (`https://github.com/elviscjn-cjn/antigravity-context-viewer`) + [`patches/context-viewer.patch`](patches/context-viewer.patch)
   - Pinned verified base commit: `a204823f597e1aee482f35574798ecbec61874c9`.
   - Retains the titlebar context meter and `v3.3.4` runtime Chinese localization (`chinese` module).
   - Removes unwanted drawers (`unlock-256k-drawer`, `proxy-notun-drawer`, `btn-toggle-colors`) and keeps `#panel` compact (`max-height: 580px`).
   - Routes renderer backend requests through `window.__AGContextMeterLive` + `callLiveBridge` (`http://127.0.0.1:<livePort>`).
   - Applies conservative anti-lag optimizations:
     - `meter-renderer.js`: `hostDomObserver` fast-path via `observedTitlebar`; `tick()` staggers heavy `/scan` calls by `900ms` on live route switches and deduplicates `/token-history` within `5s`.
     - `i18n/i18n-runtime.js`: `flushPendingNodes` 8ms `requestAnimationFrame` time-slicing; `translateSingleUnit` skips regex scanning for long DOM strings (`normalized.length > 500`) after `exactDict` lookup.

3. **Pure CDP + Dynamic Loopback Bridge Daemon** ([`assets/antigravity-patch-guardian.mjs`](assets/antigravity-patch-guardian.mjs))
   - Deployed to `~/.gemini/antigravity/scripts/antigravity-patch-guardian.mjs`.
   - Keeps official `app.asar` untouched (`process.noAsar = true`), automatically restoring a clean `app-*-base.asar` backup if an older ASAR patch is detected.
   - Survives reloads, `language_server` port changes, new windows, Antigravity restarts, and Antigravity updates via `Page.addScriptToEvaluateOnNewDocument` + navigation/load events + lightweight heartbeat.
   - Uses OS-native logon autostart outside short-lived agent Job Objects (`AntigravityPatchGuardian` Scheduled Task on Windows, `LaunchAgent` on macOS, `systemd --user` on Linux).

## Prerequisites

- **Node.js `>= 22.0.0`** (uses built-in global `WebSocket` and `node:test`) and **Git**.
- **Antigravity Desktop** installed. On Windows, Chuanban's installer automatically adds the DevTools debugging flag to desktop/Start Menu shortcuts; if Antigravity is currently running without `--remote-debugging-port`, restart it cleanly after running setup.
- **Fonts (Optional / Recommended for Chuanban)**: Anthropic + Sarasa font pack from Google Drive (`https://drive.google.com/drive/folders/1NX92SgVUqtSjWg6bt6sIJXy-cn7J_boC`). Download the font folder locally and pass `--fonts-from <folder>` during setup (or install fonts into your OS manually).

## Workflow for Setup & Reuse

### 1. Preview Paths Before Writing (Dry Run)

```bash
node scripts/setup.mjs --dry-run
```

### 2. Full Idempotent Setup

Run from the root of this skill folder:

```bash
# Standard setup (clones/updates repos, applies context-viewer.patch at verified commit,
# runs unit tests, configures modules.json, installs/adapts Chuanban, deploys guardian + autostart,
# and executes verify.mjs)
node scripts/setup.mjs
```

Useful optional flags:

| Flag | Purpose |
| --- | --- |
| `--context-viewer-dir <dir>` | Custom clone/location for `antigravity-context-viewer` (default: `repo-path.txt`, existing `D:\antigravity-context-viewer` on Windows, or `~/.gemini/antigravity/antigravity-context-viewer`) |
| `--theme-repo-dir <dir>` | Custom clone location for `chuanban-antigravity-theme-patch` (default: `~/.gemini/antigravity/chuanban-theme-repo`) |
| `--fonts-from <dir>` | Path to downloaded Chuanban font folder to pass to `install-fonts --from` |
| `--latest` | Keep/test against upstream `HEAD` instead of resetting to verified commit `a204823` |
| `--skip-tests` | Skip `node --test` unit tests after patching `antigravity-context-viewer` |
| `--skip-verify` | Skip final live `verify.mjs` pass |

### 3. Verify Live Installation

```bash
# Full verification (files, clean official app.asar, running daemons, live CDP DOM/bridge/z-index)
node scripts/verify.mjs

# Static + daemon check only (when Antigravity desktop is not open)
node scripts/verify.mjs --skip-cdp
```

Expected passing checks in `verify.mjs` JSON output:
- `ok: true`
- `cleanOfficialAsar: true`
- `themeConfigAdapted: true` and `themeCustomJsExists: true`
- `modulesState.chinese.enabled === true` and `modulesState.proxy.enabled === false`
- Both `daemons.themeDaemonPids` and `daemons.patchGuardianPids` non-empty
- When CDP window is open: `chuanbanVersion` set, `chuanbanI18nObserver === false`, `contextMeterMounted === true`, `i18nBooted === true`, `bridgeModulesOk === true`, `openZ === "2147483500"`, `closedZ === "20"`, `deletedAbsent` all `true`.

## Troubleshooting & Rollback

- **Antigravity was open before setup and CDP is unreachable**: Completely quit Antigravity (`File -> Exit` / terminate all Antigravity processes) and relaunch it using the updated shortcut so `--remote-debugging-port` is active, then run `node scripts/verify.mjs`.
- **Backups**: Before overwriting any existing config, `custom.js`, or daemon script, `setup.mjs` stores timestamped copies under `<STATE_DIR>/backups/skill-setup/` (Windows default `%LOCALAPPDATA%\AntigravityContextMeter\backups\skill-setup`).
- **Rollback**: Stop the two background Node daemons (`AntigravityPatchGuardian` / `~/.gemini/antigravity/scripts/antigravity-patch-guardian.mjs` and Chuanban's `uninstall` command) and reload/restart Antigravity. Because `app.asar` is never modified by this workflow, stopping CDP injection cleanly reverts Antigravity to stock UI.
