# Antigravity Chuanban Theme + ContextViewer Suite

[简体中文](README.md) · **English**

A **Claude-style UI beautification and localization plugin for Google Antigravity 2.x** (仿Claude风格的antigravity反重力美化插件). It integrates the **Chuanban theme patch** with a **streamlined Antigravity ContextViewer and v3.3.4 Chinese UI localization** via a pure Chrome DevTools Protocol (CDP) and loopback HTTP daemon, injecting and updating the UI without modifying Antigravity's official `app.asar`.

---

## Preview

**Full Claude-Style Workbench View (workspace names, session titles, diff counts, and chat transcript redacted):**

![Full Workbench Preview](assets/preview-workbench-full.png)

**Toolbar Capsules (Chuanban Theme + Context Meter + Speed + Token Total + CLI):**

![Toolbar Preview](assets/preview-titlebar.png)

| Streamlined Context Panel (`580px` max height; 256K, ProxyNoTun, and color drawer removed) | Token Usage Summary and 52-Week Heatmap |
| :---: | :---: |
| ![Context Panel Preview](assets/preview-context-panel.png) | ![Tokens Panel Preview](assets/preview-tokens-panel.png) |

---

## Upstream Projects and Adaptations

This repository combines and adapts two open-source community projects so they run side by side without UI conflicts or heavy main-thread stalls:

1. **[Anarcadia/chuanban-antigravity-theme-patch](https://github.com/Anarcadia/chuanban-antigravity-theme-patch)**
   - Reused components: Theme styling, font setup, CDP launcher configuration, and daemon architecture.
   - Suite adaptations ([`assets/theme-user-config.json`](assets/theme-user-config.json), [`assets/theme-user-custom.js`](assets/theme-user-custom.js)): Disables Chuanban's overlapping `i18n` and `metrics` modules (`false`), while retaining `composerWaxSeal`, `deadlockHealer`, `customCss`, and `customJs`. When a ContextMeter popup opens, `theme-user-custom.js` promotes `#ag-context-meter` and its stacking ancestors to `z-index: 2147483500` and invokes `wcvBrowser.setPortalOverlayOpen` so native browser panes do not cover the panel.
2. **[elviscjn-cjn/antigravity-context-viewer](https://github.com/elviscjn-cjn/antigravity-context-viewer)** (pinned verified base commit `a204823f597e1aee482f35574798ecbec61874c9`)
   - Reused components: Titlebar context meter, generation speed stats, token history panels, and the `v3.3.4` desktop Chinese localization runtime (`chinese` module).
   - Suite adaptations ([`patches/context-viewer.patch`](patches/context-viewer.patch), [`assets/antigravity-patch-guardian.mjs`](assets/antigravity-patch-guardian.mjs)):
     - Replaces `app.asar` disk modification with CDP runtime injection backed by a dynamic multi-origin loopback HTTP bridge (`process.noAsar = true`), and restores a clean `app-*-base.asar` backup if an earlier ASAR marker is found.
     - Removes `unlock-256k-drawer`, `proxy-notun-drawer`, `btn-toggle-colors`, and upstream update prompts, while capping `#panel` height at `580px`.
     - Adds conservative anti-lag guards: `hostDomObserver` checks `observedTitlebar` first, live route switches stagger `/scan` by `900ms` and deduplicate `/token-history` within `5s`, `flushPendingNodes` time-slices DOM translation in `8ms` `requestAnimationFrame` batches, and `translateSingleUnit` skips full regex scanning for DOM strings longer than `500` characters after checking `exactDict`.

---

## One-Sentence Prompt for AI Agents

Copy either prompt below to Antigravity or another AI coding agent on a target machine to clone and install the suite automatically:

**English prompt:**

> Clone `https://github.com/jyxu0621/antigravity-chuanban-context-suite` into `~/.gemini/config/skills/antigravity-chuanban-context-suite`, read `SKILL.md` and `README.en.md`, and run `node scripts/setup.mjs` followed by `node scripts/verify.mjs` to install and verify the Chuanban theme and streamlined ContextViewer suite in pure CDP mode without modifying `app.asar`.

**中文一句指令：**

> 请把 `https://github.com/jyxu0621/antigravity-chuanban-context-suite` 克隆到全局 Skills 目录（`~/.gemini/config/skills/antigravity-chuanban-context-suite`），阅读里面的 `SKILL.md` 和 `README.md`，运行 `node scripts/setup.mjs` 和 `node scripts/verify.mjs` 完成安装与校验（保持纯 CDP 模式，不要修改 `app.asar`）。

> [!IMPORTANT] **Execution Notes for AI Agents (see [`SKILL.md`](SKILL.md))**
> - Do not modify official `app.asar`. On Windows, `setup.mjs` registers Scheduled Task `AntigravityPatchGuardian` via `Register-ScheduledTask` so the daemon outlives short-lived agent Win32 Job Objects; on macOS and Linux, it writes a `LaunchAgent` and a `systemd --user` service.
> - Do not force-kill the running Antigravity host process from inside an active session. If CDP is not active yet after first setup, ask the user to quit and relaunch Antigravity once using the updated shortcut, then run `node scripts/verify.mjs`.
> - Chuanban fonts (Anthropic + Sarasa) are optional and distributed separately on [Google Drive](https://drive.google.com/drive/folders/1NX92SgVUqtSjWg6bt6sIJXy-cn7J_boC); pass `--fonts-from <font-folder>` during setup after downloading.

---

## Summary of Changes

- Separated module ownership: Chuanban handles theme styling and typography, while ContextViewer provides context metrics, generation speed, `v3.3.4` localization, and token history without overlapping drawers.
- Fixed panel overlap: Elevated `#ag-context-meter` stacking context keeps the popover above right-hand web or preview panes and restores original styles on close.
- Reduced viewport clutter: Unused experimental 256K, ProxyNoTun, color customizer, and update drawers stay removed, and `#panel` `max-height` stays capped at `580px`.
- Smoothed route transitions: Staggered scanning, request deduplication, `8ms` rAF time-slicing, and long-string regex bypassing reduce main-thread frame spikes during conversation switches.
- Preserved across updates: `Page.addScriptToEvaluateOnNewDocument` and OS logon autostart re-apply the injected bundle automatically across window reloads, client restarts, and Antigravity updates.

---

## Quick Start

Prerequisites: **Node.js `>= 22.0.0`** and **Git**.

### Windows (PowerShell)

```powershell
git clone https://github.com/jyxu0621/antigravity-chuanban-context-suite.git "$env:USERPROFILE\.gemini\config\skills\antigravity-chuanban-context-suite"
cd "$env:USERPROFILE\.gemini\config\skills\antigravity-chuanban-context-suite"

# Preview resolved paths without modifying files
node scripts/setup.mjs --dry-run

# Run idempotent installation and verification (optionally add --fonts-from "C:\path\to\fonts")
node scripts/setup.mjs
```

### macOS / Linux

```bash
git clone https://github.com/jyxu0621/antigravity-chuanban-context-suite.git ~/.gemini/config/skills/antigravity-chuanban-context-suite
cd ~/.gemini/config/skills/antigravity-chuanban-context-suite

node scripts/setup.mjs --dry-run
node scripts/setup.mjs
```

### Optional Flags

| Flag | Purpose |
| --- | --- |
| `--context-viewer-dir <dir>` | Custom path for the `antigravity-context-viewer` clone |
| `--theme-repo-dir <dir>` | Custom path for `chuanban-antigravity-theme-patch` (default: `~/.gemini/antigravity/chuanban-theme-repo`) |
| `--fonts-from <dir>` | Path to downloaded Chuanban font folder passed to `install-fonts --from` |
| `--latest` | Apply the patch onto upstream `HEAD` instead of resetting to pinned commit `a204823` |
| `--skip-tests` | Skip `node --test` unit tests after patching `antigravity-context-viewer` |
| `--skip-verify` | Skip final `verify.mjs` execution |

---

## Verification and Rollback

```bash
# Full check (config files, clean official app.asar, running daemons, live CDP DOM/bridge/z-index)
node scripts/verify.mjs

# Static and daemon check only (when Antigravity is closed)
node scripts/verify.mjs --skip-cdp
```

Run upstream ContextViewer unit tests directly inside the patched viewer folder:

```bash
node --test meter-core.test.js meter-renderer.test.js meter-integration.test.js
```

> Overwritten user files are backed up under `<STATE_DIR>/backups/skill-setup/`. Stopping the two CDP daemons and uninstalling Chuanban restores stock Antigravity UI on reload or restart without modifying `app.asar`.

---

## Repository Layout

```text
antigravity-chuanban-context-suite/
├── .gitattributes                       # Keeps .patch byte-exact with LF line endings
├── .gitignore
├── SKILL.md                             # Antigravity skill definition and workflow
├── README.md                            # Chinese documentation
├── README.en.md                         # English documentation (this file)
├── assets/
│   ├── antigravity-patch-guardian.mjs   # Portable CDP + loopback HTTP bridge daemon
│   ├── preview-workbench-full.png       # Preview: full Claude-style workbench (redacted)
│   ├── preview-titlebar.png             # Preview: titlebar capsules and Chuanban theme
│   ├── preview-context-panel.png        # Preview: streamlined conversation context popover
│   ├── preview-tokens-panel.png         # Preview: token summary and heatmap popover
│   ├── theme-user-config.json           # Adapted Chuanban user/config.json
│   └── theme-user-custom.js             # Adapted Chuanban user/custom.js (stacking & WebContentsView sync)
├── patches/
│   └── context-viewer.patch             # Clean patch over upstream@a204823
└── scripts/
    ├── setup.mjs                        # Cross-platform idempotent installer
    └── verify.mjs                       # Static, daemon, and live CDP verification script
```
