---
name: antigravity-chuanban-context-suite
description: Deploy, adapt, and verify the integrated Antigravity desktop UI suite on Windows, macOS, or Linux — a Claude-style Antigravity beautification and localization plugin (仿Claude风格的antigravity反重力美化插件): Chuanban theme patch v5.5.3 (Antigravity 2.34.0+ M1+M2 CDP opt-in relay, cdpAutoRelaunch, Google Sans Flex + Windows split Sarasa-Split-SC-TTF typography, single 1,940-key i18n engine, native Settings Token Analytics, DSH-style bottom metrics capsule, high-refresh-rate GPU animation-offload user/custom.css, native Swarm live relay, host fingerprint gate, and high-priority z-index popup stacking) plus ultra-slim Antigravity ContextViewer v0.8.9 (titlebar Context Ring + Speed capsule with pure SVG hourglass only; removed Quota Ring, CLI, Token Heatmap, Models/256K, Enhance, Brand/Lang card, ProxyNoTun, color drawers, and duplicate i18n; 580px capped panel, closed-panel O(1) fast-path, on-demand /scan, zero background /quota /accounts-overview /record-calls /token-history storms, self-healing --ensure CDP + lightweight loopback HTTP bridge daemon without modifying app.asar). Use when setting up a new machine, cloning this skill from GitHub, upgrading an existing installation, re-applying after Antigravity updates, or troubleshooting missing titlebar meter, bottom DSH pill, GPU lag, i18n, or popup layering.
---

# Antigravity Chuanban + ContextViewer Suite

This skill automates installation, upgrade, and verification for **Antigravity Desktop** (`2.34.0+`) by integrating two upstream repositories through a pure CDP + ultra-light loopback HTTP daemon architecture:

1. **Chuanban Theme Patch** (`https://github.com/Anarcadia/chuanban-antigravity-theme-patch`, verified with `v5.5.3` / `0aec663`, Antigravity `2.34.0+`)
   - Installs Chuanban `Google Sans Flex` + `AgSarasaUI` typography (with `win32` `SuperTTC` local-font bypass and split `Windows-Sarasa-Split-SC-TTF` recommendation), Antigravity `2.33.0/2.34.0+` M1+M2 CDP opt-in relay (patching `.lnk`/`.desktop` launchers with `--remote-debugging-port=0` and cold-start `--updated` `cdpAutoRelaunch`), curtain/Swarm live theme relay, host fingerprint gating, ME-SDDL `schtasks` autostart, and theme styling alongside its background CDP daemon (`antigravity-font-daemon.mjs` -> `core/daemon.mjs`).
   - Applies adapted configuration ([`assets/theme-user-config.json`](assets/theme-user-config.json)): enables Chuanban as the **sole desktop localization engine** (`i18n: true`, `1,940` keys), enables bottom live metrics (`metrics: true`) and native Settings → Token Analytics (`tokenAnalytics: true`), sets `"darkPreset": "onyx"` (supporting `"claude-warm"`), and keeps `composerWaxSeal`, `deadlockHealer`, `coldBootHealer`, `zoomShortcuts`, `cdpAutoRelaunch`, `customCss`, and `customJs` enabled (`true`).
   - Applies high-refresh-rate GPU offload CSS ([`assets/theme-user-custom.css`](assets/theme-user-custom.css)): disables continuous 120–144Hz GPU-composited idle animations (`[data-agent-state-dot]` / `agentStateDot` pulse, `.shimmer-text-mask/.shimmer-text-content` mask animation, per-word streaming `span[style*="fade-in"]`, decorative `.animate-pulse/.animate-ping/.animate-bounce`, and full-surface `[class*="backdrop-blur"]`) while preserving interactive hover/click transitions.
   - Applies unified extension hook ([`assets/theme-user-custom.js`](assets/theme-user-custom.js)):
     - Event-driven DSH Harness bottom capsule formatter wrapping `window.__ag_render_metrics` (`入 <used>/<limit> (<pct>%) · 出 <out> · <tps> tok/s · 首字 <ttft>`) with zero extra polling and full preservation of Chuanban's native hover card.
     - High-priority popup stacking manager: promotes `#ag-context-meter` and stacking ancestors to `z-index: 2147483500` when `#panel` or any modal/popover is open (restoring original styles on close), coordinates `window.electronNative?.wcvBrowser?.setPortalOverlayOpen` so native WebContentsView panes do not cover panels, observes parent `childList` + capture-phase `click`/`pointerdown`, and slows fallback reconnect checks to `15s`.

2. **Antigravity ContextViewer** (`https://github.com/elviscjn-cjn/antigravity-context-viewer`, `v0.8.9`) + [`patches/context-viewer.patch`](patches/context-viewer.patch)
   - Pinned verified base commit: `1ec6f3d381e687f51846d3690c10373bb8832a92` (`v0.8.9` tag / `release/v0.8.9`).
   - **Ultra-slim titlebar & panel**: keeps ONLY `#badge` (context ring + `%`) and `#badge-speed` (`⚡ tok/s` + ELV-93 pure SVG waiting hourglass) in the titlebar, plus the slimmed Context / Speed Comparison / Session Overview / Settings popover (`#panel`, capped at `max-height: min(580px, calc(100vh - 96px))`, `content-visibility: hidden` when closed).
   - **Removed bloat & duplicate subsystems**: removes `#badge-quota` / `#panel-quota`, `#badge-cli` / `#cli-launch-toast`, `#badge-tokens` / `#panel-tokens` (replaced by Chuanban `v5.5.3` Settings → Token Analytics), `#tab-ctx-models` / `#pane-ctx-models`, `#enhance-preset-card` / `#enhance-prompt-card`, `#client-brand-lang-card`, `#proxy-notun-drawer`, `#ui-slim-prefs-card`, color drawer, and startup update prompts (`autoCheckUpdate = false`); fixes upstream `v0.8.9` premature `</div></div>` nesting in `#pane-ctx-settings`; disables ContextViewer's duplicate `chinese` module (`modules.chinese.enabled = false`) so only Chuanban's single i18n observer runs.
   - **Zero-lag renderer optimizations** (`src/renderer/main.js`, `src/renderer/heatmap.js`, `src/renderer/styles.css`, `src/renderer/template.html`, rebuilt into `meter-renderer.js`):
     - Closed-panel O(1) fast-path in `render()`, `syncSpeedBadgeText()`, and `updateWaitOnly()` (flushing immediately via `panelRenderDirty` on `showPanel('context')`).
     - O(1) 16-item tail-window + memoization in `resolveLatestSessionCallRecord()`, O(1) streaming detection, and unchanged-visual-signature skip in `requestPoll()` (`1.5s` streaming / `5s` closed idle / `3s` open idle / `20s` hidden) + hidden-tab `2s` `tick()` throttle.
     - Hard-stops `/quota`, `/accounts-overview`, `/record-calls`, and 15s background `/token-history` polling in slim `cdp-daemon` mode (including gating startup `syncTokenHistoryFromHost()` in `heatmap.js` to eliminate the cold-start 10s CPU / +170 MB RSS spike); keeps `/scan` strictly on-demand (when the technical audit drawer opens or manual refresh is clicked).
     - Drops `characterData`/`attributes` from `hostDomObserver` with `250ms` throttling + titlebar fast-path, preserves elevated `z-index` in `ensureHostDocked()`, and routes `openGithubRepo` through live bridge `/open-external`.

3. **Pure CDP + Ultra-Light Loopback Bridge Daemon** ([`assets/antigravity-patch-guardian.mjs`](assets/antigravity-patch-guardian.mjs))
   - Deployed to `~/.gemini/antigravity/scripts/antigravity-patch-guardian.mjs`.
   - Keeps official `app.asar` untouched (`process.noAsar = true`), automatically restoring a clean `app-*-base.asar` backup if an older ASAR patch marker is present.
   - Guards CDP injection with Antigravity host fingerprint verification, runs at `5s` tick / `30s` lightweight heartbeat (reloads handled in real time by CDP WebSocket events), dirty-checks `.live-session.json` writes, short-circuits `/record-calls` in slim mode (eliminating `35 MB` `pricing_ledger_v1.json` rewrite storms), reports slim capabilities (`quota: false`, `recordCalls: false`, `launchCli: false`, `accounts: false`), and exposes token-authenticated loopback `GET /health` with `rssMB` and `routeHits`.
   - On Windows, preserves Chuanban `v5.4+`'s native XML `ME` SDDL `AntigravityThemeDaemon` Scheduled Task (re-triggering via `schtasks /Run`) and registers `AntigravityPatchGuardian` using the same `schtasks /Create /XML` `S:(ML;;NW;;;ME)` SDDL pattern with `MultipleInstancesPolicy: Parallel`, `StopOnIdleEnd: false`, and dual triggers (`LogonTrigger` + `PT1M` repeating `TimeTrigger` invoking `--ensure`) for self-healing KeepAlive parity with macOS `LaunchAgent` and Linux `systemd --user`.

## Prerequisites

- **Node.js `>= 22.0.0`** (uses built-in global `WebSocket` and `node:test`) and **Git**.
- **Antigravity Desktop** installed (`2.34.0+` verified). Chuanban's `install --channel auto` configures DevTools debugging launch arguments on Windows shortcuts; if Antigravity was open without `--remote-debugging-port`, quit and relaunch Antigravity once after setup.
- **Fonts (Optional / Recommended for Chuanban)**: Anthropic + Sarasa font pack from Google Drive (`https://drive.google.com/drive/folders/1NX92SgVUqtSjWg6bt6sIJXy-cn7J_boC`). On Windows, prefer the split `Windows-Sarasa-Split-SC-TTF` package and run `node install.mjs install-fonts --from <split-ttf-dir> --retire-super-ttc` so `Sarasa-SuperTTC.ttc` is retired cleanly.

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
| `--fonts-from <dir>` | Folder containing Chuanban fonts to pass to `install-fonts --from` (auto-adds `--retire-super-ttc` on Windows if split `SarasaUiSC-*.ttf` files are detected) |
| `--retire-super-ttc` | Explicitly pass `--retire-super-ttc` to Chuanban `install-fonts` on Windows |
| `--skip-super-ttc-fix` | Skip automatic download/install of `Windows-Sarasa-Split-SC-TTF` when `Sarasa-SuperTTC.ttc` is active on Windows |
| `--latest` | Apply patch against upstream `HEAD` instead of pinned commit `1ec6f3d` (`v0.8.9`) |
| `--skip-tests` | Skip `node --test` after patching `antigravity-context-viewer` |
| `--skip-verify` | Skip running `verify.mjs` after setup |

### 3. Live Verification

```bash
# Full check (files, clean official app.asar, running daemons, PatchGuardian /health, Windows SuperTTC check, live CDP state/bridge/z-index)
node scripts/verify.mjs

# Static + daemon + /health check only (when Antigravity desktop is closed)
node scripts/verify.mjs --skip-cdp

# Allow active Windows Sarasa-SuperTTC.ttc during verification (not recommended)
node scripts/verify.mjs --allow-super-ttc
```

Passing output fields in `verify.mjs`:
- `ok: true` and empty `remediations: []`
- `cleanOfficialAsar !== false` (`true` when `app.asar` contains no `__AGContextMeter` marker)
- `themeConfigAdapted: true` (`i18n: true`, `metrics: true`, `tokenAnalytics !== false`, `coldBootHealer !== false`, `zoomShortcuts !== false`, `cdpAutoRelaunch !== false`, `customCss !== false`, `customJs !== false`), `themeCustomJsExists: true`, `themeCustomCssExists: true`
- `chineseDisabledInDiskAndRuntime: true` (`modules.chinese.enabled === false` AND `modules.chinese.language === "en"`, verified via `loadModulesConfig()`, plus `PatchGuardian` automatically suppressing `i18n-runtime.js` whenever Chuanban `i18n: true` is active) and `modulesState.proxy.enabled === false`
- On Windows: `windowsFonts.superTtcActive === false` (791 MB `Sarasa-SuperTTC.ttc` retired in favor of split `SarasaUiSC`/`SarasaMonoSlabSC` TTFs)
- Non-empty `daemons.themeDaemonPids` and `daemons.patchGuardianPids`
- `guardianHealth.ok === true`, `guardianHealth.wantZh === false`, and `guardianHealth.bannedRoutesZero === true` (zero `/quota` & `/accounts-overview` hits, low RSS typically `20–35 MB`)
- When CDP window is open: `chuanbanVersion` present, `chuanbanI18nObserver === true`, `chuanbanTokenAnalyticsReady === true`, `chuanbanGpuCssApplied === true`, `dshBottomPillHooked === true`, `contextMeterMounted === true`, `speedBadgeMounted === true`, `speedWaitSvgMounted === true`, `speedTabMounted === true`, `i18nBooted === false` (if upgrading an already-open window where legacy `i18n-runtime.js` was injected, reload once via `Ctrl+Shift+R`), `liveCapabilitiesOk === true`, `bridgeModulesOk === true`, `openZ === "2147483500"`, `closedZ === "20"`, `panelHeight <= 580`, and all 11 `deletedAbsent` flags `true`.

## Troubleshooting & Rollback

- **Antigravity was open before setup and CDP is unreachable**: Completely quit Antigravity, relaunch from the updated shortcut so `--remote-debugging-port` is active, then run `node scripts/verify.mjs`.
- **Dirty `app.asar` detected**: Close Antigravity completely so file locks release, then re-run `node scripts/setup.mjs` to restore a clean `app-*-base.asar` backup.
- **Backups**: Overwritten user files are backed up under `<STATE_DIR>/backups/skill-setup/` (Windows default: `%LOCALAPPDATA%\AntigravityContextMeter\backups\skill-setup`).
- **Rollback**: Stop the two background Node daemons (`AntigravityPatchGuardian` / `~/.gemini/antigravity/scripts/antigravity-patch-guardian.mjs` and Chuanban's `uninstall` command) and restart or reload Antigravity. Official `app.asar` stays untouched.
