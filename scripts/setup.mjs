#!/usr/bin/env node
/**
 * Cross-platform idempotent installer for antigravity-chuanban-context-suite.
 * Clones/updates upstream Chuanban Theme Patch + ContextViewer, applies the
 * adapted patch cleanly, restores patched app.asar if needed, deploys the
 * Chuanban-style CDP + loopback bridge daemon, registers OS autostart outside
 * agent Job Objects, and verifies the live Antigravity workbench.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { getGoMemLimitStatus, setGoMemLimit, unsetGoMemLimit } from './go-mem-limit.mjs';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_ROOT = path.resolve(__dirname, '..');

const UPSTREAM_THEME_REPO = 'https://github.com/Anarcadia/chuanban-antigravity-theme-patch.git';
const UPSTREAM_VIEWER_REPO = 'https://github.com/elviscjn-cjn/antigravity-context-viewer.git';
const VERIFIED_VIEWER_COMMIT = 'ab5a41b7d515643fbbdd9dde8dc940e520a131b0';
const WINDOWS_SARASA_SPLIT_ZIP_URL =
  'https://drive.usercontent.google.com/download?id=1iVVvZXtwUcDiHy42tJ25X6N-JlOf3l7A&export=download&confirm=t';
const WINDOWS_SARASA_SPLIT_SHARE_URL =
  'https://drive.google.com/file/d/1iVVvZXtwUcDiHy42tJ25X6N-JlOf3l7A/view?usp=sharing';
const SUITE_PATCHED_VIEWER_FILES = new Set([
  'i18n/i18n-runtime.js',
  'src/i18n/i18n-runtime.js',
  'meter-renderer.js',
  'meter-renderer.test.js',
  'src/renderer/heatmap.js',
  'src/renderer/template.html',
  'src/renderer/styles.css',
  'src/renderer/main.js'
]);

function getArg(flag, fallback = null) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length && !process.argv[idx + 1].startsWith('--')) {
    return process.argv[idx + 1];
  }
  return fallback;
}

const USE_LATEST = process.argv.includes('--latest');
const SKIP_TESTS = process.argv.includes('--skip-tests');
const SKIP_VERIFY = process.argv.includes('--skip-verify');
const SKIP_SUPER_TTC_FIX = process.argv.includes('--skip-super-ttc-fix');
const RETIRE_SUPER_TTC = process.argv.includes('--retire-super-ttc');
const DRY_RUN = process.argv.includes('--dry-run');
const FONTS_FROM = getArg('--fonts-from', null);
const GO_MEM_LIMIT = getArg('--go-mem-limit', null);

function resolveStateDir() {
  if (process.env.AG_METER_STATE_DIR) return process.env.AG_METER_STATE_DIR;
  const home = os.homedir();
  const base =
    process.platform === 'win32'
      ? process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
      : process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support')
      : process.env.XDG_STATE_HOME || path.join(home, '.local', 'state');
  return path.join(base, 'AntigravityContextMeter');
}

function resolveDefaultViewerDir(stateDir) {
  const explicit = getArg('--context-viewer-dir', null);
  if (explicit) return path.resolve(explicit);
  if (process.env.AG_VIEWER_REPO) return path.resolve(process.env.AG_VIEWER_REPO);
  try {
    const pointer = path.join(stateDir, 'repo-path.txt');
    if (fs.existsSync(pointer)) {
      const saved = fs.readFileSync(pointer, 'utf8').trim();
      if (saved) return path.resolve(saved);
    }
  } catch {}
  if (process.platform === 'win32' && fs.existsSync('D:\\antigravity-context-viewer')) {
    return 'D:\\antigravity-context-viewer';
  }
  return path.join(os.homedir(), '.gemini', 'antigravity', 'antigravity-context-viewer');
}

function runChecked(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    stdio: opts.stdio || 'inherit',
    cwd: opts.cwd,
    encoding: 'utf8',
    windowsHide: true
  });
  if (res.status !== 0) {
    throw new Error(`Command failed (${res.status}): ${cmd} ${args.join(' ')}\n${res.stderr || ''}`);
  }
  return res;
}

function backupIfDifferent(targetPath, nextContentBuffer, backupDir) {
  if (!fs.existsSync(targetPath)) return;
  const existing = fs.readFileSync(targetPath);
  if (Buffer.compare(existing, nextContentBuffer) === 0) return;
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(backupDir, `${path.basename(targetPath)}.bak.${stamp}`);
  fs.copyFileSync(targetPath, dest);
}

function ensureViewerRepoAndPatch(viewerDir, stateDir) {
  const patchFile = path.join(SKILL_ROOT, 'patches', 'context-viewer.patch');
  if (!fs.existsSync(patchFile)) throw new Error(`Missing patch file: ${patchFile}`);

  if (!fs.existsSync(path.join(viewerDir, '.git'))) {
    console.log(`[1/5] Cloning antigravity-context-viewer into ${viewerDir}...`);
    fs.mkdirSync(path.dirname(viewerDir), { recursive: true });
    runChecked('git', ['clone', UPSTREAM_VIEWER_REPO, viewerDir]);
  } else {
    console.log(`[1/5] Using existing antigravity-context-viewer at ${viewerDir}`);
  }

  const alreadyApplied = spawnSync('git', ['-C', viewerDir, 'apply', '--reverse', '--check', patchFile], {
    stdio: 'ignore',
    windowsHide: true
  });

  if (alreadyApplied.status === 0) {
    console.log('      ContextViewer patch is already cleanly applied.');
  } else {
    if (!USE_LATEST) {
      const headRes = spawnSync('git', ['-C', viewerDir, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true });
      if (String(headRes.stdout || '').trim() !== VERIFIED_VIEWER_COMMIT) {
        const dirty = spawnSync('git', ['-C', viewerDir, 'status', '--porcelain'], { encoding: 'utf8', windowsHide: true });
        const dirtyEntries = String(dirty.stdout || '')
          .split(/\r?\n/)
          .filter((line) => line.trim().length > 0)
          .map((line) => ({
            status: line.slice(0, 2),
            rel: line.slice(3).trim().replace(/^"|"$/g, '').replace(/\\/g, '/')
          }));
        const trackedDirty = dirtyEntries.filter((entry) => entry.status !== '??');
        const unexpected = trackedDirty.filter((entry) => !SUITE_PATCHED_VIEWER_FILES.has(entry.rel));
        if (unexpected.length > 0) {
          throw new Error(
            `Repository ${viewerDir} has unexpected local uncommitted changes (${unexpected.map((e) => e.rel).join(', ')}) and is not on pinned commit ${VERIFIED_VIEWER_COMMIT}. Clean it or run with --latest.`
          );
        }
        if (trackedDirty.length > 0) {
          const upgradeBackupDir = path.join(stateDir, 'backups', 'skill-setup', `viewer-pre-upgrade-${Date.now()}`);
          console.log(`      Backing up ${trackedDirty.length} suite-patched file(s) before upgrading to ${VERIFIED_VIEWER_COMMIT.slice(0, 8)}...`);
          for (const entry of trackedDirty) {
            const abs = path.join(viewerDir, entry.rel);
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
              const dst = path.join(upgradeBackupDir, entry.rel);
              fs.mkdirSync(path.dirname(dst), { recursive: true });
              fs.copyFileSync(abs, dst);
            }
          }
          runChecked('git', ['-C', viewerDir, 'checkout', '--', ...trackedDirty.map((entry) => entry.rel)]);
        }
        runChecked('git', ['-C', viewerDir, 'fetch', 'origin', '--tags']);
        runChecked('git', ['-C', viewerDir, 'checkout', VERIFIED_VIEWER_COMMIT]);
      }
    }
    const canApply = spawnSync('git', ['-C', viewerDir, 'apply', '--check', patchFile], {
      encoding: 'utf8',
      windowsHide: true
    });
    if (canApply.status !== 0) {
      throw new Error(`Patch conflict applying ${patchFile} to ${viewerDir}:\n${canApply.stderr}`);
    }
    runChecked('git', ['-C', viewerDir, 'apply', patchFile]);
    console.log('      Applied patches/context-viewer.patch cleanly.');
  }

  for (const rel of ['meter-core.js', 'meter-renderer.js', path.join('i18n', 'i18n-runtime.js')]) {
    runChecked(process.execPath, ['--check', path.join(viewerDir, rel)], { stdio: 'ignore' });
  }

  if (!SKIP_TESTS) {
    const testFiles = [
      'meter-core.test.js',
      'meter-renderer.test.js',
      'meter-integration.test.js',
      ...(fs.existsSync(path.join(viewerDir, 'meter-v083-fixes.test.js')) ? ['meter-v083-fixes.test.js'] : []),
      ...(fs.existsSync(path.join(viewerDir, 'meter-hotload.test.js')) ? ['meter-hotload.test.js'] : []),
      ...(fs.existsSync(path.join(viewerDir, 'meter-elv91-speed.test.js')) ? ['meter-elv91-speed.test.js'] : []),
      ...(fs.existsSync(path.join(viewerDir, 'meter-v089-usage.test.js')) ? ['meter-v089-usage.test.js'] : []),
      ...(fs.existsSync(path.join(viewerDir, 'meter-v234-compat.test.js')) ? ['meter-v234-compat.test.js'] : [])
    ];
    console.log(`      Running unit tests (${testFiles.map((f) => f.replace(/\.test\.js$/, '')).join(', ')})...`);
    runChecked(
      process.execPath,
      ['--test', ...testFiles.map((f) => path.join(viewerDir, f))],
      { cwd: viewerDir }
    );
  }

  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'repo-path.txt'), viewerDir + '\n', 'utf8');
}

function configureStateAndCheckAsar(viewerDir, stateDir) {
  console.log('[2/5] Configuring AntigravityContextMeter modules & checking app.asar cleanliness...');
  const { loadModulesConfig, saveModulesConfig } = require(path.join(viewerDir, 'modules-config.js'));
  const cfg = loadModulesConfig();
  cfg.modules = cfg.modules || {};
  cfg.modules.meter = { ...(cfg.modules.meter || {}), enabled: true };
  // Desktop localization is owned exclusively by Chuanban v5.5.3 (1,940 keys) to avoid dual DOM MutationObservers.
  // IMPORTANT: modules-config.js derives chinese.enabled from (chinese.language === 'zh-CN'), so language MUST be set to 'en'.
  cfg.modules.chinese = {
    ...(cfg.modules.chinese || {}),
    enabled: false,
    language: 'en',
    brandTitle: 'english',
    desktopOnly: true
  };
  cfg.modules.proxy = { ...(cfg.modules.proxy || {}), enabled: false };
  saveModulesConfig(cfg);

  const reloaded = loadModulesConfig();
  if (reloaded?.modules?.chinese?.enabled !== false || reloaded?.modules?.chinese?.language !== 'en') {
    throw new Error(
      `ContextViewer chinese module did not stay disabled after reload (enabled=${reloaded?.modules?.chinese?.enabled}, language=${reloaded?.modules?.chinese?.language})`
    );
  }

  try {
    const { findAsarPath } = require(path.join(viewerDir, 'asar-engine.js'));
    const asarPath = findAsarPath();
    const content = fs.readFileSync(asarPath);
    if (content.includes('__AGContextMeter')) {
      const backupsDir = path.join(stateDir, 'backups');
      const candidates = fs.existsSync(backupsDir)
        ? fs
            .readdirSync(backupsDir)
            .filter((f) => f.startsWith('app-') && f.endsWith('-base.asar'))
            .map((f) => path.join(backupsDir, f))
        : [];
      const cleanBase = candidates.find((p) => !fs.readFileSync(p).includes('__AGContextMeter'));
      if (cleanBase) {
        fs.copyFileSync(cleanBase, asarPath);
        console.log(`      Restored clean official app.asar from ${path.basename(cleanBase)}.`);
      } else {
        console.warn(
          `      [WARN] ${asarPath} still contains an older ASAR patch marker and no clean *-base.asar backup was found.`
        );
      }
    }
  } catch (e) {
    console.log(`      Skipping app.asar probe (${e.message}).`);
  }
}

function hasSplitSarasaTtfInDir(dirPath) {
  try {
    const stack = [dirPath];
    while (stack.length > 0) {
      const cur = stack.pop();
      for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          stack.push(path.join(cur, entry.name));
        } else if (/^SarasaUiSC-.*\.ttf$/i.test(entry.name)) {
          return true;
        }
      }
    }
  } catch {}
  return false;
}

function autoReplaceWindowsSuperTtc(themeRepoDir, themeInstall) {
  const workDir = path.join(os.tmpdir(), `ag-sarasa-split-${process.pid}-${Date.now()}`);
  const zipPath = path.join(workDir, 'Windows-Sarasa-Split-SC-TTF-v1.0.43.zip');
  const extractDir = path.join(workDir, 'extracted');
  fs.mkdirSync(extractDir, { recursive: true });
  try {
    console.log(
      '      [Windows Font Fix] Active 791MB Sarasa-SuperTTC.ttc detected; downloading split Windows-Sarasa-Split-SC-TTF-v1.0.43.zip...'
    );
    const dl = spawnSync(
      'curl.exe',
      ['-fsSL', '--retry', '2', '--connect-timeout', '15', '--max-time', '240', '-o', zipPath, WINDOWS_SARASA_SPLIT_ZIP_URL],
      { encoding: 'utf8', windowsHide: true }
    );
    if (dl.status !== 0 || !fs.existsSync(zipPath)) {
      throw new Error(`curl download failed (${dl.status}): ${(dl.stderr || '').trim()}`);
    }
    const stat = fs.statSync(zipPath);
    const headBuf = Buffer.alloc(4);
    const fd = fs.openSync(zipPath, 'r');
    try {
      fs.readSync(fd, headBuf, 0, 4, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (stat.size < 50 * 1024 * 1024 || headBuf[0] !== 0x50 || headBuf[1] !== 0x4b) {
      throw new Error(`Downloaded payload is not a valid split-TTF zip (${stat.size} bytes)`);
    }

    let extracted = false;
    const tarRes = spawnSync('tar.exe', ['-xf', zipPath, '-C', extractDir], { encoding: 'utf8', windowsHide: true });
    if (tarRes.status === 0 && hasSplitSarasaTtfInDir(extractDir)) {
      extracted = true;
    } else {
      const psRes = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`
        ],
        { encoding: 'utf8', windowsHide: true }
      );
      extracted = psRes.status === 0 && hasSplitSarasaTtfInDir(extractDir);
    }
    if (!extracted) {
      throw new Error('Failed to extract SarasaUiSC-*.ttf from downloaded archive');
    }

    runChecked(
      process.execPath,
      [themeInstall, 'install-fonts', '--from', extractDir, '--retire-super-ttc'],
      { cwd: themeRepoDir }
    );
    console.log('      [Windows Font Fix] Installed split Sarasa SC TTFs and retired Sarasa-SuperTTC.ttc.');
    return true;
  } catch (err) {
    console.warn(
      `      [WARN] Auto SuperTTC replacement failed (${err?.message || err}).\n` +
        `             Please download Windows-Sarasa-Split-SC-TTF-v1.0.43.zip manually from:\n` +
        `             ${WINDOWS_SARASA_SPLIT_SHARE_URL}\n` +
        '             then run: node scripts/setup.mjs --fonts-from <unzipped-dir> --retire-super-ttc'
    );
    return false;
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {}
  }
}

function tryChuanbanAutoDownloadFonts(themeRepoDir, themeInstall, { retireSuperTtc = false } = {}) {
  try {
    const srcText = fs.readFileSync(themeInstall, 'utf8');
    if (!srcText.includes('--auto-download')) return false;
  } catch {
    return false;
  }
  const args = [themeInstall, 'install-fonts', '--auto-download'];
  if (process.platform === 'win32' && retireSuperTtc) {
    args.push('--retire-super-ttc');
  }
  console.log(`      [Chuanban v6.0.2+ Auto-Font] Running: node install.mjs ${args.slice(1).join(' ')}`);
  const res = spawnSync(process.execPath, args, {
    cwd: themeRepoDir,
    stdio: 'inherit',
    windowsHide: true
  });
  return res.status === 0;
}

function mergeChuanbanUserConfig(srcCfgPath, dstCfgPath, preExisting = null) {
  const templateCfg = JSON.parse(fs.readFileSync(srcCfgPath, 'utf8'));
  let existing = preExisting;
  if (!existing) {
    try {
      if (fs.existsSync(dstCfgPath)) {
        existing = JSON.parse(fs.readFileSync(dstCfgPath, 'utf8'));
      }
    } catch {}
  }
  const VALID_LIGHT_PRESETS = new Set(['native', 'morandi', 'absolutely', 'claude-desktop-purewhite', 'vintage-deep']);
  const VALID_DARK_PRESETS = new Set(['onyx', 'claude-warm']);
  const merged = {
    ...templateCfg,
    ...(existing && typeof existing === 'object' ? existing : {}),
    preset:
      existing && VALID_LIGHT_PRESETS.has(existing.preset)
        ? existing.preset
        : templateCfg.preset,
    darkPreset:
      existing && VALID_DARK_PRESETS.has(existing.darkPreset)
        ? existing.darkPreset
        : templateCfg.darkPreset,
    installedLocale:
      existing && (existing.installedLocale === 'en' || existing.installedLocale === 'zh-CN')
        ? existing.installedLocale
        : templateCfg.installedLocale,
    metricsMode:
      existing && (existing.metricsMode === 'full' || existing.metricsMode === 'compact')
        ? existing.metricsMode
        : templateCfg.metricsMode,
    allowedOrigins: Array.from(
      new Set([
        ...(Array.isArray(templateCfg.allowedOrigins) ? templateCfg.allowedOrigins : []),
        ...(Array.isArray(existing?.allowedOrigins) ? existing.allowedOrigins : [])
      ])
    ),
    modules: {
      ...(existing?.modules && typeof existing.modules === 'object' ? existing.modules : {}),
      ...(templateCfg.modules || {})
    }
  };
  return Buffer.from(`${JSON.stringify(merged, null, 2)}\n`, 'utf8');
}

function installChuanbanTheme(themeRepoDir, backupDir) {
  console.log(`[3/5] Installing & adapting chuanban-antigravity-theme-patch (${themeRepoDir})...`);
  if (!fs.existsSync(path.join(themeRepoDir, '.git'))) {
    fs.mkdirSync(path.dirname(themeRepoDir), { recursive: true });
    runChecked('git', ['clone', UPSTREAM_THEME_REPO, themeRepoDir]);
  } else {
    const pull = spawnSync('git', ['-C', themeRepoDir, 'pull', '--ff-only'], { stdio: 'ignore', windowsHide: true });
    if (pull.status !== 0) {
      console.log('      Using existing local chuanban clone without fast-forward pull.');
    }
  }

  const themeInstall = path.join(themeRepoDir, 'install.mjs');
  if (FONTS_FROM) {
    const resolvedFonts = path.resolve(FONTS_FROM);
    const fontArgs = [themeInstall, 'install-fonts', '--from', resolvedFonts];
    if (process.platform === 'win32' && (RETIRE_SUPER_TTC || hasSplitSarasaTtfInDir(resolvedFonts))) {
      fontArgs.push('--retire-super-ttc');
    }
    runChecked(process.execPath, fontArgs, { cwd: themeRepoDir });
  }

  const docRes = spawnSync(process.execPath, [themeInstall, 'doctor', '--channel', 'auto', '--json'], {
    cwd: themeRepoDir,
    encoding: 'utf8',
    windowsHide: true
  });
  let fontsReady = null;
  let superTtcActive = false;
  let superTtcWarning = null;
  try {
    const parsed = JSON.parse(docRes.stdout || '{}');
    const fonts = parsed.fonts || {};
    fontsReady = parsed.fontsReady ?? fonts.allRequiredInstalled ?? fonts.allReady ?? null;
    superTtcActive = Boolean(parsed.superTtcActive ?? fonts.superTtcActive);
    superTtcWarning = parsed.superTtcWarning || fonts.superTtcWarning || (superTtcActive ? 'Sarasa-SuperTTC.ttc active' : null);
  } catch {}
  if (process.platform === 'win32' && superTtcActive) {
    if (SKIP_SUPER_TTC_FIX) {
      console.warn(
        `      [WARN] Windows Sarasa-SuperTTC detected (${superTtcWarning}).\n` +
          `             Run: node ${JSON.stringify(themeInstall)} install-fonts --auto-download --retire-super-ttc`
      );
    } else {
      const okNative = tryChuanbanAutoDownloadFonts(themeRepoDir, themeInstall, { retireSuperTtc: true });
      if (!okNative) {
        autoReplaceWindowsSuperTtc(themeRepoDir, themeInstall);
      }
    }
  } else if (fontsReady === false && !SKIP_SUPER_TTC_FIX) {
    const okNative = tryChuanbanAutoDownloadFonts(themeRepoDir, themeInstall, { retireSuperTtc: false });
    if (!okNative) {
      console.warn(
        '      [HINT] Chuanban fonts (Anthropic / Sarasa) appear missing on this PC.\n' +
          '             Download from https://drive.google.com/drive/folders/1NX92SgVUqtSjWg6bt6sIJXy-cn7J_boC\n' +
          '             and run: node scripts/setup.mjs --fonts-from <font-folder-or-zip>'
      );
    }
  }

  const userDir = path.join(os.homedir(), '.gemini', 'antigravity', 'theme-patch', 'user');
  const dstCfg = path.join(userDir, 'config.json');
  let preExistingUserCfg = null;
  try {
    if (fs.existsSync(dstCfg)) {
      preExistingUserCfg = JSON.parse(fs.readFileSync(dstCfg, 'utf8'));
    }
  } catch {}

  runChecked(process.execPath, [themeInstall, 'install', '--channel', 'auto'], { cwd: themeRepoDir });

  fs.mkdirSync(userDir, { recursive: true });
  const srcCfg = path.join(SKILL_ROOT, 'assets', 'theme-user-config.json');
  const srcJs = path.join(SKILL_ROOT, 'assets', 'theme-user-custom.js');
  const srcCss = path.join(SKILL_ROOT, 'assets', 'theme-user-custom.css');
  const dstJs = path.join(userDir, 'custom.js');
  const dstCss = path.join(userDir, 'custom.css');

  const mergedCfgBuf = mergeChuanbanUserConfig(srcCfg, dstCfg, preExistingUserCfg);
  backupIfDifferent(dstCfg, mergedCfgBuf, backupDir);
  backupIfDifferent(dstJs, fs.readFileSync(srcJs), backupDir);
  fs.writeFileSync(dstCfg, mergedCfgBuf);
  fs.copyFileSync(srcJs, dstJs);
  if (fs.existsSync(srcCss)) {
    backupIfDifferent(dstCss, fs.readFileSync(srcCss), backupDir);
    fs.copyFileSync(srcCss, dstCss);
  }

  const realThemeDaemon = path.join(os.homedir(), '.gemini', 'antigravity', 'theme-patch', 'core', 'daemon.mjs');
  if (fs.existsSync(realThemeDaemon)) {
    spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', realThemeDaemon, '--once'], {
      stdio: 'ignore',
      windowsHide: true
    });
  }

  if (process.platform === 'win32') {
    const existingTask = spawnSync('schtasks', ['/Query', '/TN', 'AntigravityThemeDaemon'], {
      stdio: 'ignore',
      windowsHide: true
    });
    if (existingTask.status === 0) {
      // Preserve Chuanban v5.4+ XML ME-SDDL task definition and re-trigger outside Job Object
      spawnSync('schtasks', ['/Run', '/TN', 'AntigravityThemeDaemon'], {
        stdio: 'ignore',
        windowsHide: true
      });
    } else {
      const themeVbs = path.join(os.homedir(), '.gemini', 'antigravity', 'theme-patch', 'AntigravityThemeDaemon.vbs');
      if (fs.existsSync(themeVbs)) {
        const taskRes = registerWindowsLogonVbsTask('AntigravityThemeDaemon', themeVbs, 'AntigravityThemeDaemon');
        if (!taskRes.ok) {
          console.warn(`      [WARN] Could not promote AntigravityThemeDaemon to Scheduled Task: ${taskRes.reason}`);
        }
      }
    }
  }
}

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {}
}

function xmlEsc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function registerWindowsLogonVbsTask(taskName, vbsPath, regRunName, { repeatInterval = null } = {}) {
  let userAuthor =
    (process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\` : '') + (process.env.USERNAME || os.userInfo().username);
  let userSid = '';
  try {
    const whoRes = spawnSync('whoami', ['/user', '/fo', 'csv', '/nh'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000
    });
    if (whoRes.status === 0) {
      const m = String(whoRes.stdout || '').trim().match(/^"([^"]+)","(S-1-[^"]+)"/);
      if (m) {
        userAuthor = m[1];
        userSid = m[2];
      }
    }
  } catch {}

  const principalId = userSid || userAuthor;
  const sddl = `D:(A;;FA;;;BA)(A;;FA;;;SY)(A;;FA;;;IU)${userSid ? `(A;;FA;;;${userSid})` : ''}S:(ML;;NW;;;ME)`;
  const triggersXml = [
    '    <LogonTrigger>',
    '      <Enabled>true</Enabled>',
    `      <UserId>${xmlEsc(principalId)}</UserId>`,
    '    </LogonTrigger>'
  ];
  if (repeatInterval) {
    triggersXml.push(
      '    <TimeTrigger>',
      '      <Repetition>',
      `        <Interval>${xmlEsc(repeatInterval)}</Interval>`,
      '        <StopAtDurationEnd>false</StopAtDurationEnd>',
      '      </Repetition>',
      '      <StartBoundary>2025-01-01T00:00:00</StartBoundary>',
      '      <Enabled>true</Enabled>',
      '    </TimeTrigger>'
    );
  }

  const taskXml = [
    '\uFEFF<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    '  <RegistrationInfo>',
    `    <Author>${xmlEsc(userAuthor)}</Author>`,
    `    <URI>\\${xmlEsc(taskName)}</URI>`,
    `    <SecurityDescriptor>${xmlEsc(sddl)}</SecurityDescriptor>`,
    '  </RegistrationInfo>',
    '  <Principals>',
    '    <Principal id="Author">',
    `      <UserId>${xmlEsc(principalId)}</UserId>`,
    '      <LogonType>InteractiveToken</LogonType>',
    '      <RunLevel>LeastPrivilege</RunLevel>',
    '    </Principal>',
    '  </Principals>',
    '  <Settings>',
    '    <MultipleInstancesPolicy>Parallel</MultipleInstancesPolicy>',
    '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
    '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
    '    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>',
    '    <IdleSettings>',
    '      <StopOnIdleEnd>false</StopOnIdleEnd>',
    '      <RestartOnIdle>false</RestartOnIdle>',
    '    </IdleSettings>',
    '    <Enabled>true</Enabled>',
    '    <UseUnifiedSchedulingEngine>true</UseUnifiedSchedulingEngine>',
    '  </Settings>',
    '  <Triggers>',
    ...triggersXml,
    '  </Triggers>',
    '  <Actions Context="Author">',
    '    <Exec>',
    '      <Command>wscript.exe</Command>',
    `      <Arguments>//B //NoLogo &quot;${xmlEsc(vbsPath)}&quot;</Arguments>`,
    '    </Exec>',
    '  </Actions>',
    '</Task>',
    ''
  ].join('\r\n');

  const tmpXmlPath = path.join(os.tmpdir(), `ag-suite-task-${taskName}-${process.pid}.xml`);
  let created = false;
  let lastReason = '';
  try {
    fs.writeFileSync(tmpXmlPath, taskXml, 'utf16le');
    const createRes = spawnSync('schtasks', ['/Create', '/TN', taskName, '/XML', tmpXmlPath, '/F'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8000
    });
    if (createRes.status === 0) {
      created = true;
    } else {
      lastReason = String(createRes.stderr || createRes.stdout || `schtasks create exit ${createRes.status}`).trim();
      const queryRes = spawnSync('schtasks', ['/Query', '/TN', taskName, '/XML'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 4000
      });
      if (queryRes.status === 0 && String(queryRes.stdout || '').toLowerCase().includes(path.basename(vbsPath).toLowerCase())) {
        created = true;
      }
    }
  } catch (e) {
    lastReason = e?.message || String(e);
  } finally {
    try {
      if (fs.existsSync(tmpXmlPath)) fs.unlinkSync(tmpXmlPath);
    } catch {}
  }

  if (!created) {
    return { ok: false, reason: lastReason || 'schtasks XML registration failed' };
  }

  if (regRunName) {
    try {
      spawnSync(
        'reg',
        ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', regRunName, '/f'],
        { stdio: 'ignore', windowsHide: true }
      );
    } catch {}
  }

  const runRes = spawnSync('schtasks', ['/Run', '/TN', taskName], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 6000
  });
  return {
    ok: runRes.status === 0,
    reason: String(runRes.stderr || runRes.stdout || `schtasks run exit ${runRes.status}`).trim()
  };
}

function stopExistingGuardian(stateDir) {
  const pidFile = path.join(stateDir, 'patch-guardian.pid');
  const candidatePids = new Set();
  try {
    if (fs.existsSync(pidFile)) {
      const oldPid = Number.parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
      if (Number.isInteger(oldPid) && oldPid > 0 && oldPid !== process.pid) {
        candidatePids.add(oldPid);
      }
    }
  } catch {}

  try {
    if (process.platform === 'win32') {
      const scan = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'antigravity-patch-guardian' -and $_.CommandLine -notmatch '(setup|verify)\\.mjs' } | ForEach-Object { $_.ProcessId }"
        ],
        { encoding: 'utf8', windowsHide: true, timeout: 4000 }
      );
      for (const line of String(scan.stdout || '').split(/\r?\n/)) {
        const p = Number.parseInt(line.trim(), 10);
        if (Number.isInteger(p) && p > 0 && p !== process.pid) candidatePids.add(p);
      }
    } else {
      const scan = spawnSync('ps', ['-ax', '-o', 'pid=,args='], { encoding: 'utf8', timeout: 3000 });
      for (const line of String(scan.stdout || '').split(/\r?\n/)) {
        if (!line.includes('antigravity-patch-guardian') || line.includes('setup.mjs') || line.includes('verify.mjs')) continue;
        const p = Number.parseInt(line.trim().split(/\s+/)[0], 10);
        if (Number.isInteger(p) && p > 0 && p !== process.pid) candidatePids.add(p);
      }
    }
  } catch {}

  for (const oldPid of candidatePids) {
    try {
      process.kill(oldPid, 0);
    } catch (err) {
      if (!err || err.code !== 'EPERM') continue;
    }
    try {
      process.kill(oldPid, 'SIGTERM');
    } catch {}
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
      try {
        process.kill(oldPid, 0);
        sleepSync(80);
      } catch {
        break;
      }
    }
  }

  try {
    if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
  } catch {}
}

function waitForLiveGuardianPid(stateDir, maxWaitMs = 4500) {
  const pidFile = path.join(stateDir, 'patch-guardian.pid');
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      if (fs.existsSync(pidFile)) {
        const pid = Number.parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
        if (Number.isInteger(pid) && pid > 0) {
          process.kill(pid, 0);
          return pid;
        }
      }
    } catch {}
    sleepSync(120);
  }
  return null;
}

function deployGuardianAndAutostart(stateDir, backupDir) {
  console.log('[4/5] Deploying ContextMeter v0.8.10 (slim) + Chuanban v6.0.7 (Antigravity 2.36.0+) CDP daemon & OS autostart...');
  const scriptsDir = path.join(os.homedir(), '.gemini', 'antigravity', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });

  const srcGuardian = path.join(SKILL_ROOT, 'assets', 'antigravity-patch-guardian.mjs');
  const dstGuardian = path.join(scriptsDir, 'antigravity-patch-guardian.mjs');
  backupIfDifferent(dstGuardian, fs.readFileSync(srcGuardian), backupDir);
  fs.copyFileSync(srcGuardian, dstGuardian);
  runChecked(process.execPath, ['--check', dstGuardian], { stdio: 'ignore' });

  stopExistingGuardian(stateDir);

  if (process.platform === 'win32') {
    const vbsPath = path.join(scriptsDir, 'AntigravityPatchGuardian.vbs');
    const cmd = `""${process.execPath}"" --disable-warning=ExperimentalWarning ""${dstGuardian}"" --ensure`;
    const vbsBody = `\uFEFFSet WshShell = CreateObject("WScript.Shell")\r\nWshShell.Run "${cmd}", 0, False\r\n`;
    const vbsBuf = Buffer.from(vbsBody, 'utf16le');
    backupIfDifferent(vbsPath, vbsBuf, backupDir);
    fs.writeFileSync(vbsPath, vbsBody, 'utf16le');

    const taskRes = registerWindowsLogonVbsTask('AntigravityPatchGuardian', vbsPath, 'AntigravityPatchGuardian', {
      repeatInterval: 'PT1M'
    });
    const bootedPid = taskRes.ok ? waitForLiveGuardianPid(stateDir, 4500) : null;
    if (!taskRes.ok || !bootedPid) {
      if (!taskRes.ok) {
        console.warn(`      [WARN] Scheduled Task registration fallback (${taskRes.reason}); using HKCU\\Run.`);
        spawnSync(
          'reg',
          [
            'add',
            'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
            '/v',
            'AntigravityPatchGuardian',
            '/t',
            'REG_SZ',
            '/d',
            `wscript.exe //B //NoLogo "${vbsPath}"`,
            '/f'
          ],
          { stdio: 'ignore', windowsHide: true }
        );
      }
      const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', dstGuardian, '--ensure'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      child.unref();
      waitForLiveGuardianPid(stateDir, 3000);
    }
    return;
  }

  if (process.platform === 'darwin') {
    const uid = process.getuid ? process.getuid() : 501;
    const label = 'com.antigravity.contextpatch';
    const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
    fs.mkdirSync(path.dirname(plistPath), { recursive: true });
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>--disable-warning=ExperimentalWarning</string>
    <string>${dstGuardian}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>\n`;
    fs.writeFileSync(plistPath, plist, 'utf8');
    try {
      execSync(`launchctl bootout gui/${uid}/${label} 2>/dev/null || true`);
      execSync(`launchctl bootstrap gui/${uid} "${plistPath}" 2>/dev/null || launchctl load -w "${plistPath}" 2>/dev/null || true`);
      execSync(`launchctl kickstart -k gui/${uid}/${label} 2>/dev/null || true`);
    } catch {}
    return;
  }

  const unitDir = path.join(os.homedir(), '.config', 'systemd', 'user');
  fs.mkdirSync(unitDir, { recursive: true });
  const unitPath = path.join(unitDir, 'antigravity-contextpatch.service');
  fs.writeFileSync(
    unitPath,
    `[Unit]
Description=Antigravity ContextMeter & i18n CDP Daemon
After=default.target

[Service]
ExecStart="${process.execPath}" --disable-warning=ExperimentalWarning "${dstGuardian}"
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
`,
    'utf8'
  );
  try {
    execSync('systemctl --user daemon-reload && systemctl --user enable --now antigravity-contextpatch.service 2>/dev/null || true');
  } catch {}
}

async function main() {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (major < 22) {
    throw new Error(`Node.js >= 22.0.0 required (current: ${process.version})`);
  }

  const stateDir = resolveStateDir();
  const viewerDir = resolveDefaultViewerDir(stateDir);
  const themeRepoDir = path.resolve(
    getArg('--theme-repo-dir', path.join(os.homedir(), '.gemini', 'antigravity', 'chuanban-theme-repo'))
  );
  const backupDir = path.join(stateDir, 'backups', 'skill-setup');

  if (DRY_RUN) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          node: process.version,
          platform: process.platform,
          skillRoot: SKILL_ROOT,
          viewerDir,
          themeRepoDir,
          stateDir,
          useLatest: USE_LATEST
        },
        null,
        2
      )
    );
    return;
  }

  ensureViewerRepoAndPatch(viewerDir, stateDir);
  configureStateAndCheckAsar(viewerDir, stateDir);
  installChuanbanTheme(themeRepoDir, backupDir);
  deployGuardianAndAutostart(stateDir, backupDir);

  if (GO_MEM_LIMIT) {
    const res =
      String(GO_MEM_LIMIT).toLowerCase() === 'off'
        ? unsetGoMemLimit()
        : setGoMemLimit(GO_MEM_LIMIT);
    if (!res.ok) {
      throw new Error(`Failed to configure GOMEMLIMIT (${GO_MEM_LIMIT}): ${res.error}`);
    }
    console.log(
      `      [GOMEMLIMIT] ${res.action === 'unset' ? 'Removed user GOMEMLIMIT' : `Configured GOMEMLIMIT=${res.configuredValue}`} (${res.note})`
    );
  } else {
    const memStatus = getGoMemLimitStatus();
    if (!memStatus.configured) {
      console.log(
        `      [TIP] Optional Go language_server memory cap not set. To cap RAM gently, run: node scripts/go-mem-limit.mjs --set ${memStatus.recommendedValue}`
      );
    }
  }

  if (!SKIP_VERIFY) {
    console.log('[5/5] Waiting for daemon warmup & verifying live state...');
    await new Promise((r) => setTimeout(r, 4500));
    const vRes = spawnSync(process.execPath, [path.join(__dirname, 'verify.mjs')], {
      stdio: 'inherit',
      windowsHide: true
    });
    if (vRes.status !== 0) {
      console.log('      Initial verify still warming up; retrying verify.mjs in 3s...');
      await new Promise((r) => setTimeout(r, 3000));
      runChecked(process.execPath, [path.join(__dirname, 'verify.mjs')]);
    }
  }
}

main().catch((err) => {
  console.error('[setup ERROR]', err?.stack || err?.message || String(err));
  process.exit(1);
});
