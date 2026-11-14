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

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_ROOT = path.resolve(__dirname, '..');

const UPSTREAM_THEME_REPO = 'https://github.com/Anarcadia/chuanban-antigravity-theme-patch.git';
const UPSTREAM_VIEWER_REPO = 'https://github.com/elviscjn-cjn/antigravity-context-viewer.git';
const VERIFIED_VIEWER_COMMIT = 'a204823f597e1aee482f35574798ecbec61874c9';

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
const DRY_RUN = process.argv.includes('--dry-run');
const FONTS_FROM = getArg('--fonts-from', null);

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
        if (String(dirty.stdout || '').trim()) {
          throw new Error(
            `Repository ${viewerDir} has local uncommitted changes and is not on pinned commit ${VERIFIED_VIEWER_COMMIT}. Clean it or run with --latest.`
          );
        }
        runChecked('git', ['-C', viewerDir, 'fetch', 'origin']);
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
    console.log('      Running unit tests (meter-core, meter-renderer, meter-integration)...');
    runChecked(
      process.execPath,
      [
        '--test',
        path.join(viewerDir, 'meter-core.test.js'),
        path.join(viewerDir, 'meter-renderer.test.js'),
        path.join(viewerDir, 'meter-integration.test.js')
      ],
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
  cfg.modules.chinese = { ...(cfg.modules.chinese || {}), enabled: true, desktopOnly: true };
  cfg.modules.proxy = { ...(cfg.modules.proxy || {}), enabled: false };
  saveModulesConfig(cfg);

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
    runChecked(process.execPath, [themeInstall, 'install-fonts', '--from', path.resolve(FONTS_FROM)], {
      cwd: themeRepoDir
    });
  }

  const docRes = spawnSync(process.execPath, [themeInstall, 'doctor', '--channel', 'auto'], {
    cwd: themeRepoDir,
    encoding: 'utf8',
    windowsHide: true
  });
  let fontsReady = null;
  try {
    const parsed = JSON.parse(docRes.stdout || '{}');
    fontsReady = parsed.fontsReady ?? parsed.fonts?.allReady ?? null;
  } catch {}
  if (fontsReady === false) {
    console.warn(
      '      [HINT] Chuanban fonts (Anthropic / Sarasa) appear missing on this PC.\n' +
        '             Download from https://drive.google.com/drive/folders/1NX92SgVUqtSjWg6bt6sIJXy-cn7J_boC\n' +
        '             and run: node install.mjs install-fonts --from <font-folder> (on Windows) or install to OS Fonts.'
    );
  }

  runChecked(process.execPath, [themeInstall, 'install', '--channel', 'auto'], { cwd: themeRepoDir });

  const userDir = path.join(os.homedir(), '.gemini', 'antigravity', 'theme-patch', 'user');
  fs.mkdirSync(userDir, { recursive: true });
  const srcCfg = path.join(SKILL_ROOT, 'assets', 'theme-user-config.json');
  const srcJs = path.join(SKILL_ROOT, 'assets', 'theme-user-custom.js');
  const dstCfg = path.join(userDir, 'config.json');
  const dstJs = path.join(userDir, 'custom.js');

  backupIfDifferent(dstCfg, fs.readFileSync(srcCfg), backupDir);
  backupIfDifferent(dstJs, fs.readFileSync(srcJs), backupDir);
  fs.copyFileSync(srcCfg, dstCfg);
  fs.copyFileSync(srcJs, dstJs);

  const realThemeDaemon = path.join(os.homedir(), '.gemini', 'antigravity', 'theme-patch', 'core', 'daemon.mjs');
  if (fs.existsSync(realThemeDaemon)) {
    spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', realThemeDaemon, '--once'], {
      stdio: 'ignore',
      windowsHide: true
    });
  }
}

function stopExistingGuardian(stateDir) {
  const pidFile = path.join(stateDir, 'patch-guardian.pid');
  try {
    if (!fs.existsSync(pidFile)) return;
    const oldPid = Number.parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (Number.isInteger(oldPid) && oldPid > 0) {
      process.kill(oldPid, 'SIGTERM');
    }
  } catch {}
}

function deployGuardianAndAutostart(stateDir, backupDir) {
  console.log('[4/5] Deploying ContextMeter + v3.3.4 i18n CDP daemon & OS autostart...');
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
    const cmd = `""${process.execPath}"" --disable-warning=ExperimentalWarning ""${dstGuardian}""`;
    const vbsBody = `\uFEFFSet WshShell = CreateObject("WScript.Shell")\r\nWshShell.Run "${cmd}", 0, False\r\n`;
    const vbsBuf = Buffer.from(vbsBody, 'utf16le');
    backupIfDifferent(vbsPath, vbsBuf, backupDir);
    fs.writeFileSync(vbsPath, vbsBody, 'utf16le');

    const psRegister = `
$ErrorActionPreference = 'Stop'
$vbs = '${vbsPath.replace(/'/g, "''")}'
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('//B //NoLogo "' + $vbs + '"')
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'AntigravityPatchGuardian' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
reg delete 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' /v 'AntigravityPatchGuardian' /f 2>&1 | Out-Null
Start-ScheduledTask -TaskName 'AntigravityPatchGuardian'
`;
    const taskRes = spawnSync('powershell.exe', ['-NoProfile', '-Command', psRegister], {
      encoding: 'utf8',
      windowsHide: true
    });
    if (taskRes.status !== 0) {
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
      const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', dstGuardian], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      child.unref();
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

  if (!SKIP_VERIFY) {
    console.log('[5/5] Waiting 3s for daemon warmup & verifying live state...');
    await new Promise((r) => setTimeout(r, 3000));
    runChecked(process.execPath, [path.join(__dirname, 'verify.mjs')]);
  }
}

main().catch((err) => {
  console.error('[setup ERROR]', err?.stack || err?.message || String(err));
  process.exit(1);
});
