#!/usr/bin/env node
/**
 * Standalone verification script for antigravity-chuanban-context-suite.
 * Checks installed files, clean app.asar state, running background daemons,
 * PatchGuardian loopback /health, and live Antigravity CDP state
 * (Chuanban v5.5.3 + single i18n + DSH bottom pill + GPU custom.css + slim ContextViewer v0.8.9 + z-index + heights).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { getGoMemLimitStatus } from './go-mem-limit.mjs';

const require = createRequire(import.meta.url);
const SKIP_CDP = process.argv.includes('--skip-cdp');
const ALLOW_SUPER_TTC = process.argv.includes('--allow-super-ttc');

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

function resolveViewerRepoDir(stateDir) {
  const candidates = [];
  if (process.env.AG_VIEWER_REPO) candidates.push(process.env.AG_VIEWER_REPO);
  try {
    const p = path.join(stateDir, 'repo-path.txt');
    if (fs.existsSync(p)) {
      const saved = fs.readFileSync(p, 'utf8').trim();
      if (saved) candidates.push(saved);
    }
  } catch {}
  candidates.push(
    path.join(os.homedir(), '.gemini', 'antigravity', 'antigravity-context-viewer'),
    'D:\\antigravity-context-viewer'
  );
  for (const dir of candidates) {
    if (dir && fs.existsSync(path.join(dir, 'meter-renderer.js'))) return path.resolve(dir);
  }
  return null;
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return Boolean(err && err.code === 'EPERM');
  }
}

function readFallbackDaemonPids(stateDir, guardianHealth) {
  const themePids = new Set();
  const guardianPids = new Set();
  try {
    for (const f of fs.readdirSync(os.tmpdir())) {
      if (!/^ag-theme-daemon-.*\.pid$/i.test(f)) continue;
      const raw = fs.readFileSync(path.join(os.tmpdir(), f), 'utf8').trim().split(/\r?\n/)[0];
      const pid = Number.parseInt(raw, 10);
      if (isPidAlive(pid)) themePids.add(pid);
    }
  } catch {}
  try {
    const gFile = path.join(stateDir, 'patch-guardian.pid');
    if (fs.existsSync(gFile)) {
      const pid = Number.parseInt(fs.readFileSync(gFile, 'utf8').trim(), 10);
      if (isPidAlive(pid)) guardianPids.add(pid);
    }
  } catch {}
  if (guardianHealth?.ok && isPidAlive(guardianHealth.pid)) {
    guardianPids.add(guardianHealth.pid);
  }
  return {
    themeDaemonPids: Array.from(themePids),
    patchGuardianPids: Array.from(guardianPids)
  };
}

function checkDaemons(stateDir, guardianHealth) {
  if (process.platform === 'win32') {
    const res = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 10000 }
    );
    let list = [];
    try {
      const parsed = JSON.parse(String(res.stdout || '[]'));
      list = Array.isArray(parsed) ? parsed : [parsed];
    } catch {}
    const findProc = (needle) =>
      list
        .filter((p) => {
          const cmd = String(p?.CommandLine || '');
          return cmd.includes(needle) && !cmd.includes('verify.mjs') && !cmd.includes('setup.mjs');
        })
        .map((p) => p.ProcessId);
    const themeDaemonPids = findProc('antigravity-font-daemon');
    const patchGuardianPids = findProc('antigravity-patch-guardian');
    if (themeDaemonPids.length === 0 || patchGuardianPids.length === 0) {
      const fb = readFallbackDaemonPids(stateDir, guardianHealth);
      return {
        themeDaemonPids: themeDaemonPids.length > 0 ? themeDaemonPids : fb.themeDaemonPids,
        patchGuardianPids: patchGuardianPids.length > 0 ? patchGuardianPids : fb.patchGuardianPids
      };
    }
    return { themeDaemonPids, patchGuardianPids };
  }
  try {
    const ps = execSync('ps -ax -o pid=,command=', { encoding: 'utf8' });
    const lines = ps.split(/\r?\n/);
    const findProc = (needle) =>
      lines
        .filter((l) => l.includes(needle) && !l.includes('verify.mjs'))
        .map((l) => Number.parseInt(l.trim().split(/\s+/)[0], 10))
        .filter(Number.isFinite);
    return {
      themeDaemonPids: findProc('antigravity-font-daemon'),
      patchGuardianPids: findProc('antigravity-patch-guardian')
    };
  } catch {
    return { themeDaemonPids: [], patchGuardianPids: [] };
  }
}

function resolveCdpCandidates() {
  const home = os.homedir();
  const dirs =
    process.platform === 'win32'
      ? [
          path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Antigravity'),
          path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Antigravity - Insiders')
        ]
      : process.platform === 'darwin'
      ? [
          path.join(home, 'Library', 'Application Support', 'Antigravity'),
          path.join(home, 'Library', 'Application Support', 'Antigravity - Insiders')
        ]
      : [
          path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Antigravity'),
          path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Antigravity - Insiders')
        ];

  const ports = new Set();
  for (const dir of dirs) {
    const pf = path.join(dir, 'DevToolsActivePort');
    try {
      if (fs.existsSync(pf)) {
        const port = Number.parseInt(fs.readFileSync(pf, 'utf8').trim().split(/\r?\n/)[0], 10);
        if (Number.isFinite(port) && port > 0) ports.add(port);
      }
    } catch {}
  }
  ports.add(9222);
  ports.add(9223);
  return Array.from(ports);
}

function fetchJson(url, headers = {}) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 1500, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function probeGuardianHealth(stateDir) {
  const sessionFile = path.join(stateDir, '.live-session.json');
  try {
    if (!fs.existsSync(sessionFile)) return { ok: false, reason: '.live-session.json missing' };
    const stamp = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    if (!stamp?.port || !stamp?.token) return { ok: false, reason: 'incomplete live-session.json' };
    const data = await fetchJson(`http://127.0.0.1:${stamp.port}/health`, {
      'X-AG-Context-Token': stamp.token
    });
    if (!data || data.ok !== true) return { ok: false, reason: 'health endpoint unreachable' };
    const routeHits = data.routeHits || {};
    const bannedHits = {
      quota: routeHits['/quota'] || 0,
      accountsOverview: routeHits['/accounts-overview'] || 0
    };
    return {
      ok: true,
      pid: data.pid,
      uptimeSec: data.uptimeSec,
      rssMB: data.rssMB,
      attachedTargets: data.attachedTargets,
      wantZh: typeof data.wantZh === 'boolean' ? data.wantZh : null,
      bundleSig: data.bundleSig || null,
      routeHits,
      bannedRoutesZero: bannedHits.quota === 0 && bannedHits.accountsOverview === 0
    };
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) };
  }
}

function probeWindowsFonts(home) {
  if (process.platform !== 'win32') return null;
  const themeInstall = path.join(home, '.gemini', 'antigravity', 'chuanban-theme-repo', 'install.mjs');
  if (!fs.existsSync(themeInstall)) return null;
  try {
    const res = spawnSync(process.execPath, [themeInstall, 'doctor', '--channel', 'auto', '--json'], {
      cwd: path.dirname(themeInstall),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 18000
    });
    if (res.status !== 0 && !res.stdout) return null;
    const parsed = JSON.parse(String(res.stdout || '{}'));
    const fonts = parsed.fonts || {};
    return {
      allRequiredInstalled: fonts.allRequiredInstalled ?? null,
      sarasaSplitScInstalled: Boolean(fonts.sarasaSplitScInstalled),
      superTtcActive: Boolean(fonts.superTtcActive),
      orphanSuperTtcPendingReboot: Boolean(fonts.orphanSuperTtcPendingReboot),
      superTtcWarning: fonts.superTtcWarning || null,
      unregisteredWarning: fonts.unregisteredWarning || null
    };
  } catch {
    return null;
  }
}

async function inspectLiveCdp() {
  for (const port of resolveCdpCandidates()) {
    const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    if (!Array.isArray(targets)) continue;
    const workbench = targets.find(
      (t) =>
        t?.type === 'page' &&
        t.webSocketDebuggerUrl &&
        /^https:\/\/(?:127\.0\.0\.1|localhost):\d+\//i.test(String(t.url || '')) &&
        !String(t.title || '').includes('Launchpad')
    );
    if (!workbench) continue;

    const ws = new WebSocket(workbench.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });

    let msgId = 1;
    const evalCdp = (expression) =>
      new Promise((resolve, reject) => {
        const id = msgId++;
        const timer = setTimeout(() => {
          ws.removeEventListener('message', handler);
          reject(new Error('CDP evaluation timed out'));
        }, 6000);
        const handler = (ev) => {
          const msg = JSON.parse(String(ev.data));
          if (msg.id !== id) return;
          clearTimeout(timer);
          ws.removeEventListener('message', handler);
          resolve(msg.result?.result?.value ?? null);
        };
        ws.addEventListener('message', handler);
        ws.send(
          JSON.stringify({
            id,
            method: 'Runtime.evaluate',
            params: { expression, awaitPromise: true, returnByValue: true }
          })
        );
      });

    try {
      const nodeSleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const baseState = await evalCdp(`(async () => {
        const host = document.getElementById('ag-context-meter');
        const sr = host?.shadowRoot || null;
        const badge = sr?.getElementById('badge');
        const panel = sr?.getElementById('panel');
        const closeBtn = sr?.getElementById('close');
        let bridgeModules = null;
        const live = window.__AGContextMeterLive || null;
        if (live?.port && live?.token) {
          try {
            const r = await fetch('http://127.0.0.1:' + live.port + '/modules-status', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-AG-Context-Token': live.token },
              body: '{}'
            });
            bridgeModules = await r.json();
          } catch (e) { bridgeModules = { error: String(e) }; }
        }
        if (panel && !panel.hidden && closeBtn) closeBtn.click();
        await Promise.resolve();
        await Promise.resolve();
        const caps = live?.capabilities || {};
        return {
          targetId: ${JSON.stringify(workbench.id)},
          origin: location.origin,
          chuanbanVersion: window.__ag_patch_version || null,
          chuanbanI18nObserver: Boolean(window.__ag_i18n_observer),
          chuanbanTokenAnalyticsReady: typeof window.__ag_on_token_analytics === 'function',
          chuanbanGpuCssApplied: Array.from(document.querySelectorAll('style')).some((s) =>
            String(s.textContent || '').includes('agentStateDot')
          ),
          dshBottomPillHooked: Boolean(
            typeof window.__agMeterPriorityCleanup === 'function' &&
              typeof window.__ag_render_metrics === 'function'
          ),
          workbenchEnhancerHooked:
            (typeof window.__agSuiteWorkbenchCleanup === 'function' &&
              typeof window.__agSuiteOpenOmni === 'function') ||
            Boolean(document.getElementById('ag-prism-overlay-portal') || document.querySelector('.ag-cs-ctx-menu')),
          contextMeterMounted: Boolean(host && sr && badge && panel),
          speedBadgeMounted: Boolean(sr?.getElementById('badge-speed')),
          speedWaitSvgMounted: Boolean(sr?.getElementById('badge-speed-wait-svg')),
          speedTabMounted: Boolean(sr?.getElementById('tab-ctx-speed')),
          buildSig: window.__AGContextMeterBuildSig || null,
          loadedSig: window.__AGContextMeterLoadedSig || null,
          i18nBooted: Boolean(window.__AGY_I18N_BOOTED__),
          livePort: live?.port || null,
          liveVersion: live?.version || null,
          liveCapabilitiesOk: Boolean(
            caps.modules === true &&
              caps.scan === true &&
              caps.omni === true &&
              caps.quota === false &&
              caps.recordCalls === false &&
              caps.launchCli === false &&
              caps.accounts === false
          ),
          bridgeModulesOk: Boolean(bridgeModules?.ok && bridgeModules?.mode === 'cdp-daemon'),
          deletedAbsent: {
            noQuotaBadge: !sr?.getElementById('badge-quota'),
            noQuotaPanel: !sr?.getElementById('panel-quota'),
            noCliBadge: !sr?.getElementById('badge-cli'),
            noTokensBadge: !sr?.getElementById('badge-tokens'),
            noTokensPanel: !sr?.getElementById('panel-tokens'),
            noModelsTab: !sr?.getElementById('tab-ctx-models') && !sr?.getElementById('pane-ctx-models'),
            no256k: !sr?.getElementById('unlock-256k-drawer') && !sr?.getElementById('ctx-compact-card'),
            noEnhance: !sr?.getElementById('enhance-preset-card') && !sr?.getElementById('enhance-prompt-card'),
            noBrandLangCard: !sr?.getElementById('client-brand-lang-card'),
            noProxy: !sr?.getElementById('proxy-notun-drawer'),
            noColorDrawer: !sr?.getElementById('btn-toggle-colors') && !sr?.getElementById('btn-panel-palette')
          },
          hasPanelButtons: Boolean(host && badge && panel && closeBtn)
        };
      })()`);

      let openZ = null, closedZ = null, rectH = null, maxH = null;
      if (baseState?.hasPanelButtons) {
        await nodeSleep(60);
        const opened = await evalCdp(`(async () => {
          const host = document.getElementById('ag-context-meter');
          const sr = host?.shadowRoot;
          const badge = sr?.getElementById('badge');
          const panel = sr?.getElementById('panel');
          if (!panel || !badge) return null;
          badge.click();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          return {
            openZ: getComputedStyle(host).zIndex,
            rectH: Math.round(panel.getBoundingClientRect().height),
            maxH: getComputedStyle(panel).maxHeight
          };
        })()`);
        openZ = opened?.openZ ?? null;
        rectH = opened?.rectH ?? null;
        maxH = opened?.maxH ?? null;
        await nodeSleep(60);
        closedZ = await evalCdp(`(async () => {
          const host = document.getElementById('ag-context-meter');
          const closeBtn = host?.shadowRoot?.getElementById('close');
          closeBtn?.click();
          await Promise.resolve();
          await Promise.resolve();
          return getComputedStyle(host).zIndex;
        })()`);
      }

      const { hasPanelButtons, ...rest } = baseState || {};
      const state = {
        ...rest,
        openZ,
        closedZ,
        panelHeight: rectH,
        panelMaxHeight: maxH
      };
      return { found: true, cdpPort: port, state };
    } finally {
      try { ws.close(); } catch {}
    }
  }
  return { found: false, reason: 'Antigravity CDP window not reachable' };
}

async function main() {
  const home = os.homedir();
  const stateDir = resolveStateDir();
  const viewerDir = resolveViewerRepoDir(stateDir);
  const guardianScript = path.join(home, '.gemini', 'antigravity', 'scripts', 'antigravity-patch-guardian.mjs');
  const themeConfig = path.join(home, '.gemini', 'antigravity', 'theme-patch', 'user', 'config.json');
  const themeCustomJs = path.join(home, '.gemini', 'antigravity', 'theme-patch', 'user', 'custom.js');
  const themeCustomCss = path.join(home, '.gemini', 'antigravity', 'theme-patch', 'user', 'custom.css');
  const modulesFile = path.join(stateDir, 'modules.json');

  let cleanAsar = null;
  if (viewerDir) {
    try {
      const { findAsarPath } = require(path.join(viewerDir, 'asar-engine.js'));
      const asarPath = findAsarPath();
      const headerProbe = fs.readFileSync(asarPath);
      cleanAsar = !headerProbe.includes('__AGContextMeter');
    } catch {
      cleanAsar = null;
    }
  }

  let modulesJson = null;
  try { modulesJson = JSON.parse(fs.readFileSync(modulesFile, 'utf8')); } catch {}
  let effectiveModules = null;
  if (viewerDir) {
    try {
      const { loadModulesConfig } = require(path.join(viewerDir, 'modules-config.js'));
      effectiveModules = loadModulesConfig()?.modules || null;
    } catch {}
  }
  let themeCfg = null;
  try { themeCfg = JSON.parse(fs.readFileSync(themeConfig, 'utf8')); } catch {}

  const guardianHealth = await probeGuardianHealth(stateDir);
  const daemons = checkDaemons(stateDir, guardianHealth);
  const windowsFonts = probeWindowsFonts(home);
  const goMemLimit = getGoMemLimitStatus();
  const cdp = SKIP_CDP ? { skipped: true } : await inspectLiveCdp();

  const themeConfigAdapted = Boolean(
    themeCfg &&
      themeCfg.modules?.i18n === true &&
      themeCfg.modules?.metrics === true &&
      themeCfg.modules?.tokenAnalytics !== false &&
      themeCfg.modules?.coldBootHealer !== false &&
      themeCfg.modules?.zoomShortcuts !== false &&
      themeCfg.modules?.cdpAutoRelaunch !== false &&
      themeCfg.modules?.customCss !== false &&
      themeCfg.modules?.customJs !== false
  );

  const chineseDisabledInDiskAndRuntime = Boolean(
    modulesJson?.modules?.chinese?.enabled === false &&
      String(modulesJson?.modules?.chinese?.language || '').toLowerCase() === 'en' &&
      (effectiveModules ? effectiveModules.chinese?.enabled === false && effectiveModules.chinese?.language === 'en' : true) &&
      guardianHealth.wantZh !== true
  );

  const superTtcOk = ALLOW_SUPER_TTC || !(windowsFonts && windowsFonts.superTtcActive === true);

  const staticOk =
    Boolean(viewerDir) &&
    cleanAsar !== false &&
    fs.existsSync(guardianScript) &&
    themeConfigAdapted &&
    fs.existsSync(themeCustomJs) &&
    fs.existsSync(themeCustomCss) &&
    Boolean(
      modulesJson?.modules?.meter?.enabled !== false &&
        chineseDisabledInDiskAndRuntime &&
        modulesJson?.modules?.proxy?.enabled === false
    ) &&
    superTtcOk &&
    daemons.themeDaemonPids.length > 0 &&
    daemons.patchGuardianPids.length > 0 &&
    Boolean(guardianHealth.ok && guardianHealth.bannedRoutesZero);

  const deletedOk = Boolean(
    cdp.state?.deletedAbsent &&
      Object.values(cdp.state.deletedAbsent).every((v) => v === true)
  );

  const liveOk =
    SKIP_CDP ||
    !cdp.found ||
    Boolean(
      cdp.state?.chuanbanVersion &&
        cdp.state?.chuanbanI18nObserver === true &&
        cdp.state?.chuanbanTokenAnalyticsReady === true &&
        cdp.state?.chuanbanGpuCssApplied === true &&
        cdp.state?.dshBottomPillHooked === true &&
        cdp.state?.workbenchEnhancerHooked === true &&
        cdp.state?.contextMeterMounted === true &&
        cdp.state?.speedBadgeMounted === true &&
        cdp.state?.speedWaitSvgMounted === true &&
        cdp.state?.speedTabMounted === true &&
        cdp.state?.i18nBooted === false &&
        cdp.state?.liveCapabilitiesOk === true &&
        cdp.state?.bridgeModulesOk === true &&
        cdp.state?.openZ === '2147483500' &&
        cdp.state?.closedZ === '20' &&
        (cdp.state?.panelHeight == null || cdp.state.panelHeight <= 580) &&
        deletedOk
    );

  const remediations = [];
  if (!chineseDisabledInDiskAndRuntime) {
    remediations.push(
      'ContextViewer chinese module is still active or language is not "en"; re-run `node scripts/setup.mjs` to set modules.chinese.enabled=false and modules.chinese.language="en" and restart AntigravityPatchGuardian.'
    );
  }
  if (!superTtcOk) {
    remediations.push(
      'Active 791MB Sarasa-SuperTTC.ttc detected on Windows (causes DirectWrite stalls); run `node scripts/setup.mjs` (auto-downloads Windows-Sarasa-Split-SC-TTF and retires SuperTTC) or pass `--fonts-from <split-ttf-dir> --retire-super-ttc`.'
    );
  }
  if (!SKIP_CDP && cdp.found && cdp.state?.i18nBooted === true) {
    remediations.push(
      'Legacy ContextViewer i18n observer is still alive in the open window (window.__AGY_I18N_BOOTED__ === true); reload Antigravity window (Ctrl+Shift+R) or restart Antigravity once.'
    );
  }

  const report = {
    ok: staticOk && liveOk,
    viewerDir,
    guardianScriptExists: fs.existsSync(guardianScript),
    cleanOfficialAsar: cleanAsar,
    themeConfigAdapted,
    themeCustomJsExists: fs.existsSync(themeCustomJs),
    themeCustomCssExists: fs.existsSync(themeCustomCss),
    chineseDisabledInDiskAndRuntime,
    modulesState: modulesJson?.modules || null,
    windowsFonts,
    goMemLimit,
    daemons,
    guardianHealth,
    cdp,
    remediations
  };

  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
