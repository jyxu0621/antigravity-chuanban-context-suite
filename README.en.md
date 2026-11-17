# Antigravity Chuanban Theme + ContextViewer Suite

[简体中文](README.md) · **English**

A **Claude-style UI beautification and localization plugin for Google Antigravity 2.x** (仿Claude风格的antigravity反重力美化插件, verified on `2.32.1`). It integrates the **Chuanban theme patch `v5.4.2`** with a **streamlined Antigravity ContextViewer `v0.8.7` (Quota Ring, Speed tab, crisp DPI popup positioning, v3.3.4 Chinese localization with merged Chuanban dictionary fallback)** via pure Chrome DevTools Protocol (CDP) and loopback HTTP daemons without modifying official `app.asar`.

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

1. **[Anarcadia/chuanban-antigravity-theme-patch](https://github.com/Anarcadia/chuanban-antigravity-theme-patch)** (`v5.4.2`)
   - Reused components: Theme styling, font setup (including Antigravity `2.32.1` PDF/DirectWrite font fixes, live `plugin://swarm--` iframe theme relay, host fingerprint gate, WSL2 dual-track support, native ME-SDDL Scheduled Task autostart, and optional warm dark preset), CDP launcher configuration, and daemon architecture.
   - Suite adaptations ([`assets/theme-user-config.json`](assets/theme-user-config.json), [`assets/theme-user-custom.js`](assets/theme-user-custom.js)): Disables Chuanban's overlapping `i18n` and `metrics` modules (`false`), sets `"darkPreset": "onyx"` (switchable to `"claude-warm"`), and retains `composerWaxSeal`, `deadlockHealer`, `coldBootHealer`, `zoomShortcuts`, `customCss`, and `customJs`. When a ContextMeter or Quota popup (`#panel`, `#panel-quota`, `#panel-tokens`, etc.) opens, `theme-user-custom.js` promotes `#ag-context-meter` and its stacking ancestors to `z-index: 2147483500`, invokes `wcvBrowser.setPortalOverlayOpen`, and watches host parent `childList` plus capture-phase clicks so re-injected meters rebind immediately.
2. **[elviscjn-cjn/antigravity-context-viewer](https://github.com/elviscjn-cjn/antigravity-context-viewer)** (pinned verified base commit `5951a7ceda2e2c63266b2d8033226e33d82b900e`, `v0.8.7`)
   - Reused components: Titlebar context meter, Model Quota Ring (`#badge-quota` + `/quota` panel), speed comparison tab, crisp external-display font & DPI pixel-grid positioning (`ELV-84`/`ELV-86`), token history panels, brand/language toggles, and the `v3.3.4` desktop Chinese localization runtime (`chinese` module).
   - Suite adaptations ([`patches/context-viewer.patch`](patches/context-viewer.patch), [`assets/antigravity-patch-guardian.mjs`](assets/antigravity-patch-guardian.mjs)):
     - Replaces `app.asar` disk modification with CDP runtime injection backed by a dynamic multi-origin loopback HTTP bridge (`process.noAsar = true`), enforces Antigravity host fingerprint checks so local preview pages are never touched, aligns live version and capability reporting with `v0.8.7` across `/quota`, `/modules-status`, `/toggle-module`, and `/open-external`, and restores a clean `app-*-base.asar` backup if an earlier ASAR marker is found.
     - Merges safe filtered entries from Chuanban `core/i18n.json` as fallback behind ContextViewer `zh-CN.json` (plus injecting `window.__AGY_I18N_CONFIG__`) while keeping only one DOM observer active.
     - Removes binary-patching/bloat panels (`#tab-ctx-models`, `#ctx-compact-card`, enhance preset/prompt cards, `proxy-notun-drawer`, `btn-toggle-colors` / panel palette), cleans up upstream orphan closing tags, suppresses startup update prompts (`autoCheckUpdate = false`), and caps `#panel` and `#panel-quota` height at `580px`.
     - Pairs upstream `6ms` `rAF` DOM translation slicing and `observedTitlebar` checks with `900ms` staggered `/scan` on live route changes, `5s` `/token-history` deduplication, and skipping full regex scans in `translateSingleUnit` after `exactDict` lookup for strings longer than `500` characters.

---

## One-Sentence Prompt for AI Agents

Copy either prompt below to Antigravity or another AI coding agent on a target machine to clone and install the suite automatically:

**English prompt:**

> Clone `https://github.com/jyxu0621/antigravity-chuanban-context-suite` into `~/.gemini/config/skills/antigravity-chuanban-context-suite`, read `SKILL.md` and `README.en.md`, and run `node scripts/setup.mjs` followed by `node scripts/verify.mjs` to install and verify the Chuanban theme and streamlined ContextViewer suite in pure CDP mode without modifying `app.asar`.

**中文一句指令：**

> 请把 `https://github.com/jyxu0621/antigravity-chuanban-context-suite` 克隆到全局 Skills 目录（`~/.gemini/config/skills/antigravity-chuanban-context-suite`），阅读里面的 `SKILL.md` 和 `README.md`，运行 `node scripts/setup.mjs` 和 `node scripts/verify.mjs` 完成安装与校验（保持纯 CDP 模式，不要修改 `app.asar`）。

> [!IMPORTANT] **Execution Notes for AI Agents (see [`SKILL.md`](SKILL.md))**
> - Do not modify official `app.asar`. On Windows, `setup.mjs` registers and starts Scheduled Tasks `AntigravityThemeDaemon` and `AntigravityPatchGuardian` via `Register-ScheduledTask` so both daemons outlive short-lived agent Win32 Job Objects; on macOS and Linux, it writes a `LaunchAgent` and a `systemd --user` service.
> - Do not force-kill the running Antigravity host process from inside an active session. If CDP is not active yet after first setup, ask the user to quit and relaunch Antigravity once using the updated shortcut, then run `node scripts/verify.mjs`.
> - Chuanban fonts (Anthropic + Sarasa) are optional and distributed separately on [Google Drive](https://drive.google.com/drive/folders/1NX92SgVUqtSjWg6bt6sIJXy-cn7J_boC); pass `--fonts-from <font-folder>` during setup after downloading.

---

## Summary of Changes

- Separated module ownership: Chuanban `v5.4.2` handles theme styling, typography, Swarm/PDF live rendering fixes, and cold-boot/deadlock recovery, while ContextViewer `v0.8.7` provides context metrics, Model Quota Ring, speed comparison, crisp DPI placement, `v3.3.4` localization (with merged Chuanban dictionary fallback), and token history without overlapping observers.
- Fixed panel overlap: Elevated `#ag-context-meter` stacking context keeps `#panel`, `#panel-quota`, and token popovers above right-hand web or preview panes and restores original styles on close, with immediate rebinding on DOM remounts.
- Reduced viewport clutter: Unused experimental Models/256K, Enhance prompt/title, ProxyNoTun, color customizer, and update drawers stay removed, and both `#panel` and `#panel-quota` `max-height` stay capped at `580px`.
- Smoothed route transitions: Pairs upstream `6ms` rAF time-slicing and `observedTitlebar` fast checks with `900ms` staggered `/scan`, `/token-history` deduplication, and long-string regex bypassing to reduce main-thread frame spikes during conversation switches.
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
| `--latest` | Apply the patch onto upstream `HEAD` instead of resetting to pinned commit `5951a7c` |
| `--skip-tests` | Skip `node --test` unit tests after patching `antigravity-context-viewer` |
| `--skip-verify` | Skip final `verify.mjs` execution |

---

## Verification and Rollback

```bash
# Full check (config files, clean official app.asar, running daemons, live CDP DOM/bridge/quota/z-index)
node scripts/verify.mjs

# Static and daemon check only (when Antigravity is closed)
node scripts/verify.mjs --skip-cdp
```

Run upstream ContextViewer core unit tests directly inside the patched viewer folder (187 tests passing):

```bash
node --test meter-core.test.js meter-renderer.test.js meter-integration.test.js meter-v083-fixes.test.js meter-hotload.test.js
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
│   └── context-viewer.patch             # Clean patch over upstream@5951a7c (v0.8.7)
└── scripts/
    ├── setup.mjs                        # Cross-platform idempotent installer
    └── verify.mjs                       # Static, daemon, and live CDP verification script
```
