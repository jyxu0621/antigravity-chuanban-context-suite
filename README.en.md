# Antigravity Chuanban Theme + ContextViewer Suite

[简体中文](README.md) · **English**

An all-in-one Antigravity skill and cross-platform installer that integrates the **Chuanban theme patch** with a **streamlined, low-lag Antigravity ContextViewer + v3.3.4 Chinese UI localization**, running via a **pure Chrome DevTools Protocol (CDP) + loopback HTTP daemon** without ever modifying Antigravity's official `app.asar`.

---

## 🙏 Upstream Projects & Acknowledgements

This repository builds directly upon two outstanding open-source community projects, adapting their configuration and runtime architecture so they coexist cleanly without UI conflicts or frame stalls:

1. **[Anarcadia/chuanban-antigravity-theme-patch](https://github.com/Anarcadia/chuanban-antigravity-theme-patch)**
   - **What we borrow**: Theme styling/typography injection, CDP shortcut flag setup, and background CDP guardian model.
   - **What this suite adapts** ([`assets/theme-user-config.json`](assets/theme-user-config.json), [`assets/theme-user-custom.js`](assets/theme-user-custom.js)): Keeps theme styling and `ui.showTitlebarThemeButton: true` while disabling Chuanban's overlapping `i18n` and `metrics` modules (`false`); injects popup stacking management so `#ag-context-meter` rises to `z-index: 2147483500` when expanded (restoring `20` on close) and supports `Escape` / outside-click dismissal even alongside right-hand web/preview panes.
2. **[elviscjn-cjn/antigravity-context-viewer](https://github.com/elviscjn-cjn/antigravity-context-viewer)** (pinned verified base commit `a204823f597e1aee482f35574798ecbec61874c9`)
   - **What we borrow**: Titlebar live context usage capsule, generation speed summary, Token history heatmap/charts, and `v3.3.4` desktop Chinese runtime localization (`chinese` module).
   - **What this suite streamlines & hardens** ([`patches/context-viewer.patch`](patches/context-viewer.patch), [`assets/antigravity-patch-guardian.mjs`](assets/antigravity-patch-guardian.mjs)):
     - Replaces ASAR disk patching with a pure CDP + dynamic multi-origin loopback HTTP bridge daemon (`process.noAsar = true`), automatically restoring a clean `app-*-base.asar` backup if an older ASAR patch is detected.
     - Removes `unlock-256k-drawer`, `proxy-notun-drawer`, `btn-toggle-colors`, and the upstream auto-update modal, while capping `#panel` height at `580px`.
     - Adds conservative anti-lag optimizations: `observedTitlebar` O(1) fast-path in `hostDomObserver`, `900ms` staggered `/scan` scheduling + `5s` `/token-history` deduplication on live route switches, `8ms` `requestAnimationFrame` time-slicing in `flushPendingNodes`, and skipping full regex passes for DOM strings `> 500` characters after `exactDict` lookup.

---

## 🤖 One-Sentence Prompt for AI Agents

Send either sentence below directly to Antigravity or another AI coding agent on a new computer:

**English (Recommended):**

> Clone `https://github.com/jyxu0621/antigravity-chuanban-context-suite` into `~/.gemini/config/skills/antigravity-chuanban-context-suite`, read `SKILL.md` and `README.en.md`, and run `node scripts/setup.mjs` followed by `node scripts/verify.mjs` to install and verify the Chuanban theme + streamlined ContextViewer suite in pure CDP mode without modifying `app.asar`.

**中文一句指令：**

> 请把 `https://github.com/jyxu0621/antigravity-chuanban-context-suite` 克隆到我的全局 Skills 目录（`~/.gemini/config/skills/antigravity-chuanban-context-suite`），读取里面的 `SKILL.md` 和 `README.md`，然后运行 `node scripts/setup.mjs` 和 `node scripts/verify.mjs` 完成安装与校验（保持纯 CDP 模式，不要修改 `app.asar`）。

> [!IMPORTANT] **Execution Notes for AI Agents (see [`SKILL.md`](SKILL.md))**:
> - **Non-destructive pure CDP**: Never patch `app.asar`. On Windows, `setup.mjs` registers user-scoped Scheduled Task `AntigravityPatchGuardian` via PowerShell `Register-ScheduledTask` so the daemon runs detached outside short-lived agent Win32 Job Objects; on macOS and Linux it writes a `LaunchAgent` and `systemd --user` service.
> - **Do not force-kill the host Antigravity app**: When running from inside an Antigravity session, if Antigravity was launched without `--remote-debugging-port`, ask the user to fully quit and relaunch via the updated shortcut after setup, then re-run `node scripts/verify.mjs`.
> - **Optional Chuanban fonts**: Download Anthropic + Sarasa fonts separately from [Google Drive](https://drive.google.com/drive/folders/1NX92SgVUqtSjWg6bt6sIJXy-cn7J_boC) and pass `--fonts-from <font-folder>` during setup.

---

## ✨ Features & Customizations

- **Conflict-Free Coexistence**: Chuanban manages theme styling and typography while ContextViewer handles context monitoring, speed stats, `v3.3.4` localization, and token history.
- **High-Priority Popup Layering**: Automatically promotes `#ag-context-meter` to `z-index: 2147483500` when open and restores `20` on close so right-side web/preview panes never cover the panel.
- **Compact Viewport**: Removes unused experimental 256K, ProxyNoTun, color drawer, and update popups with `max-height: 580px`.
- **Conservative Anti-Lag Tuning**: Prevents frame hiccups on conversation switches and large DOM updates.
- **Update & Restart Resilient**: Re-injects cleanly across reloads, `language_server` port changes, new windows, client restarts, and Antigravity updates via `Page.addScriptToEvaluateOnNewDocument` + OS logon autostart.

---

## 🚀 Quick Start

Prerequisites: **Node.js `>= 22.0.0`** and **Git**.

### Windows (PowerShell)

```powershell
git clone https://github.com/jyxu0621/antigravity-chuanban-context-suite.git "$env:USERPROFILE\.gemini\config\skills\antigravity-chuanban-context-suite"
cd "$env:USERPROFILE\.gemini\config\skills\antigravity-chuanban-context-suite"

# Preview resolved paths without making changes
node scripts/setup.mjs --dry-run

# Full idempotent install + live verification (optionally add --fonts-from "C:\path\to\fonts")
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

| Flag | Description |
| --- | --- |
| `--context-viewer-dir <dir>` | Custom directory for `antigravity-context-viewer` clone |
| `--theme-repo-dir <dir>` | Custom directory for `chuanban-antigravity-theme-patch` clone (default `~/.gemini/antigravity/chuanban-theme-repo`) |
| `--fonts-from <dir>` | Path to downloaded Chuanban font pack passed to `install-fonts --from` |
| `--latest` | Test applying patch on upstream `HEAD` instead of resetting to pinned `a204823` |
| `--skip-tests` | Skip `node --test` unit tests after patching `antigravity-context-viewer` |
| `--skip-verify` | Skip final `verify.mjs` execution |

---

## 🧪 Verification & Testing

```bash
# Full check (files, clean official app.asar, daemon PIDs, live CDP DOM/bridge/z-index/height)
node scripts/verify.mjs

# Static + daemon check only (when Antigravity desktop is closed)
node scripts/verify.mjs --skip-cdp
```

Run upstream ContextViewer unit tests inside the patched viewer directory:

```bash
node --test meter-core.test.js meter-renderer.test.js meter-integration.test.js
```

> Backups of overwritten user files are saved under `<STATE_DIR>/backups/skill-setup/`. Because `app.asar` is never modified, stopping the two CDP daemons cleanly restores stock Antigravity UI.

---

## 📁 Repository Structure

```text
antigravity-chuanban-context-suite/
├── .gitattributes                       # Keeps .patch byte-exact with LF line endings
├── .gitignore
├── SKILL.md                             # Antigravity skill manifest & instructions
├── README.md                            # Chinese documentation
├── README.en.md                         # English documentation (this file)
├── assets/
│   ├── antigravity-patch-guardian.mjs   # Portable pure CDP + loopback HTTP bridge daemon
│   ├── theme-user-config.json           # Adapted Chuanban user/config.json
│   └── theme-user-custom.js             # Adapted Chuanban user/custom.js (z-index & Esc close)
├── patches/
│   └── context-viewer.patch             # Clean patch over upstream@a204823
└── scripts/
    ├── setup.mjs                        # Cross-platform idempotent installer
    └── verify.mjs                       # Static + daemon + live CDP verification script
```
