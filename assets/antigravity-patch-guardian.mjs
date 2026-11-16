#!/usr/bin/env node
/**
 * Antigravity Context & i18n CDP Daemon (antigravity-patch-guardian.mjs)
 *
 * 对齐船板（chuanban-antigravity-theme-patch）守护架构：
 * 1. 免改盘 app.asar：完全通过 CDP（DevToolsActivePort / fallbackPort）实时探测并注入
 *    ContextMeter（meter-core.js + meter-renderer.js）与 v3.3.4 中文汉化（受 modules.json 控制）。
 * 2. 跨重载 / 跨重启 / 跨版本更新持久化：
 *    - 通过 Page.addScriptToEvaluateOnNewDocument + Page.frameNavigated / loadEventFired / domContentEventFired
 *      保证页面重载、language_server Auto-Restart 换端口、开新窗口、客户端重启及官方更新后自动生效；
 *    - 内置动态多 Origin 回环 HTTP 桥接（替代旧版单端口即退的 live-host.js），自动跟随最新本地服务端口；
 *    - 不主动修改 app.asar，也不解锁 language_server 256K。
 * 3. 零卡顿调度：
 *    - 客户端未运行或端口离线时进入 10s fallback 退避；
 *    - 稳态每 2.5s 仅比对本地源文件 mtime，每 15s 执行一次极轻量布尔探针，不遍历 DOM、不读写网络。
 */

process.noAsar = true;

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function resolveDefaultStateDir() {
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

function resolveViewerRepoDir() {
  const stateDir = resolveDefaultStateDir();
  const candidates = [];
  if (process.env.AG_VIEWER_REPO) candidates.push(process.env.AG_VIEWER_REPO);
  try {
    const pointerFile = path.join(stateDir, 'repo-path.txt');
    if (fs.existsSync(pointerFile)) {
      const saved = fs.readFileSync(pointerFile, 'utf8').trim();
      if (saved) candidates.push(saved);
    }
  } catch {}
  candidates.push(
    path.join(os.homedir(), '.gemini', 'antigravity', 'antigravity-context-viewer'),
    path.join(os.homedir(), 'antigravity-context-viewer'),
    'D:\\antigravity-context-viewer'
  );
  for (const dir of candidates) {
    if (dir && fs.existsSync(path.join(dir, 'meter-renderer.js')) && fs.existsSync(path.join(dir, 'asar-engine.js'))) {
      return path.resolve(dir);
    }
  }
  return path.resolve(candidates[0]);
}

const REPO_DIR = resolveViewerRepoDir();
const SYNC_INTERVAL_MS = 2_500;
const HEARTBEAT_EVERY_TICKS = 6; // 6 * 2.5s = 15s 轻量存活校验
const FALLBACK_BACKOFF_MS = 10_000;
const NAV_DEBOUNCE_MS = 120;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_RECORD_CALLS = 500;
const MAX_LOG_BYTES = 512 * 1024;
const RUN_ONCE = process.argv.includes('--once');

const { getStateDir } = require(path.join(REPO_DIR, 'asar-engine.js'));
const modulesCfgApi = require(path.join(REPO_DIR, 'modules-config.js'));
const { loadModulesConfig, saveModulesConfig } = modulesCfgApi;
const normalizeBrandTitleFn =
  typeof modulesCfgApi.normalizeBrandTitle === 'function'
    ? modulesCfgApi.normalizeBrandTitle
    : (v) => (v === 'hidden' || v === 'translated' ? v : 'english');
const normalizeClientLangFn =
  typeof modulesCfgApi.normalizeClientLanguage === 'function'
    ? modulesCfgApi.normalizeClientLanguage
    : (v, fallbackOn = true) => (v === 'en' ? 'en' : v === 'zh-CN' ? 'zh-CN' : fallbackOn ? 'zh-CN' : 'en');
const { isValidExternalUrl } = require(path.join(REPO_DIR, 'meter-core.js'));
const {
  collect,
  collectTokenHistoryAsync,
  fetchQuotaSnapshotFromHost,
  recordModelCalls,
  getPluginSettings,
  savePluginSettings,
  launchCliSession
} = require(path.join(REPO_DIR, 'meter-collector.js'));

const STATE_DIR = getStateDir();
const PID_FILE = path.join(STATE_DIR, 'patch-guardian.pid');
const LOG_FILE = path.join(STATE_DIR, 'patch-guardian.log');
const LIVE_SESSION_FILE = path.join(STATE_DIR, '.live-session.json');

fs.mkdirSync(STATE_DIR, { recursive: true });

function appendLog(level, message) {
  const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) {
      const old = fs.readFileSync(LOG_FILE, 'utf8');
      fs.writeFileSync(LOG_FILE, old.slice(-Math.floor(MAX_LOG_BYTES / 2)), 'utf8');
    }
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch {}
  if (RUN_ONCE) {
    process.stdout.write(line);
  }
}

function readTextSafe(filePath, fallback = '') {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : fallback;
  } catch {
    return fallback;
  }
}

function getFileMtimeSig(filePath) {
  try {
    const st = fs.statSync(filePath, { throwIfNoEntry: false });
    return st && st.isFile() ? `${st.size}:${Math.trunc(st.mtimeMs)}` : '0:0';
  } catch {
    return '0:0';
  }
}

// ============================================================================
// 1. 单实例 PID 锁（沿用 Windows 命令行校验防止 PID 复用误杀）
// ============================================================================
function isGuardianPidAlive(pid) {
  if (!pid || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (process.platform === 'win32') {
    const res = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`],
      { encoding: 'utf8', windowsHide: true, timeout: 4000 }
    );
    return String(res.stdout || '').includes('antigravity-patch-guardian');
  }
  return true;
}

function acquireSingleInstanceLock() {
  if (RUN_ONCE) return;
  const oldPid = Number.parseInt(readTextSafe(PID_FILE).trim(), 10);
  if (Number.isInteger(oldPid) && isGuardianPidAlive(oldPid)) {
    try {
      process.kill(oldPid, 'SIGTERM');
    } catch {}
  }
  fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
  const cleanup = () => {
    try {
      if (fs.existsSync(PID_FILE) && fs.readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) {
        fs.unlinkSync(PID_FILE);
      }
    } catch {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });
}

// ============================================================================
// 2. 多通道 CDP 端口探测（与船板 daemon.mjs 完全对齐）
// ============================================================================
function resolveChannelEndpoint(channelName) {
  const home = os.homedir();
  const isInsiders = channelName === 'insiders';
  const appDirName = isInsiders ? 'Antigravity - Insiders' : 'Antigravity';
  let portFile;
  if (process.platform === 'darwin') {
    portFile = path.join(home, 'Library', 'Application Support', appDirName, 'DevToolsActivePort');
  } else if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    portFile = path.join(appData, appDirName, 'DevToolsActivePort');
  } else {
    const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    portFile = path.join(xdgConfig, appDirName, 'DevToolsActivePort');
  }

  const dotDir = path.join(home, isInsiders ? '.antigravity-insiders' : '.antigravity');
  const argvPath = path.join(dotDir, 'argv.json');
  let fallbackPort = isInsiders ? 9223 : 9222;
  try {
    if (fs.existsSync(argvPath)) {
      const stripped = fs.readFileSync(argvPath, 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
      const m = stripped.match(/"remote-debugging-port"\s*:\s*(\d+)/);
      if (m && parseInt(m[1], 10) > 0) fallbackPort = parseInt(m[1], 10);
    }
  } catch {}

  const channelInstalled = fs.existsSync(portFile) || fs.existsSync(path.dirname(portFile)) || fs.existsSync(dotDir);
  return { channel: channelName, portFile, fallbackPort, channelInstalled };
}

const CHANNEL_ENDPOINTS = [resolveChannelEndpoint('stable'), resolveChannelEndpoint('insiders')];

function readPort(portFile) {
  try {
    const first = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/)[0];
    const port = Number.parseInt(first, 10);
    return Number.isFinite(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

function fetchTargets(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/json/list', timeout: 450 },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(Array.isArray(parsed) ? parsed : []);
          } catch {
            resolve([]);
          }
        });
      }
    );
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

function isTargetAppPage(target) {
  if (!target || target.type !== 'page' || !target.webSocketDebuggerUrl) return false;
  const url = String(target.url || '');
  if (!/^https:\/\/(?:127\.0\.0\.1|localhost):\d+\//i.test(url)) return false;
  if (String(target.title || '').includes('Launchpad')) return false;
  return true;
}

// ============================================================================
// 3. 内嵌动态回环桥接服务（支持主进程重启/语言服务换端口自动跟随）
// ============================================================================
const LIVE_SECRET = crypto.randomBytes(32).toString('hex');
let livePort = 0;
let liveServer = null;
const activePageOrigins = new Map(); // origin -> { url, updatedAt }
let lastPrimaryOrigin = '';

let cachedSettingsSnapshot = null;
let cachedHistorySnapshot = null;
let historyFetchInFlight = false;

function refreshSnapshotsAsync() {
  try {
    const settingsSnap = getPluginSettings();
    if (settingsSnap && settingsSnap.ok) {
      cachedSettingsSnapshot = settingsSnap;
    }
  } catch {}
  if (!historyFetchInFlight) {
    historyFetchInFlight = true;
    void collectTokenHistoryAsync({ force: false })
      .then((hist) => {
        if (hist && !hist.loading) {
          cachedHistorySnapshot = hist;
        }
      })
      .catch(() => {})
      .finally(() => {
        historyFetchInFlight = false;
      });
  }
}

function writeLiveSessionStamp() {
  if (!livePort) return;
  try {
    const origins = Array.from(activePageOrigins.keys());
    const info = {
      port: livePort,
      token: LIVE_SECRET,
      pid: process.pid,
      origin: origins[0] || lastPrimaryOrigin || '',
      origins,
      mode: 'cdp-daemon',
      startedAt: Date.now()
    };
    const tmp = `${LIVE_SESSION_FILE}.tmp_${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(info), 'utf8');
    fs.renameSync(tmp, LIVE_SESSION_FILE);
  } catch {}
}

function openExternalUrlSafe(targetUrl) {
  return new Promise((resolve) => {
    if (!isValidExternalUrl(targetUrl)) {
      resolve({ ok: false, error: '仅允许打开官方白名单链接（GitHub 仓库或作者署名主页）' });
      return;
    }
    if (process.platform === 'win32') {
      execFile('rundll32.exe', ['url.dll,FileProtocolHandler', targetUrl], { windowsHide: true }, (err) => {
        resolve(err ? { ok: false, error: err.message } : { ok: true });
      });
      return;
    }
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
    execFile(opener, [targetUrl], { windowsHide: true }, (err) => {
      resolve(err ? { ok: false, error: err.message } : { ok: true });
    });
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    let aborted = false;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        aborted = true;
        const err = new Error('请求体积超出限制（最大 1MB）');
        err.statusCode = 413;
        req.destroy();
        reject(err);
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (e) {
        const err = new Error('无效的 JSON 请求体');
        err.statusCode = 400;
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const ALLOWED_BRIDGE_ROUTES = new Set([
  '/scan',
  '/token-history',
  '/quota',
  '/record-calls',
  '/get-settings',
  '/save-settings',
  '/launch-cli',
  '/modules-status',
  '/toggle-module',
  '/open-external'
]);

function startLiveBridgeServer() {
  if (liveServer) return Promise.resolve(livePort);
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const origin = req.headers.origin;
      const originKnown = Boolean(origin && activePageOrigins.has(origin));
      if (!originKnown) {
        res.writeHead(403);
        res.end();
        return;
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
      res.setHeader('Vary', 'Origin');

      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'POST');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-AG-Context-Token');
        res.writeHead(204);
        res.end();
        return;
      }

      if (
        req.method !== 'POST' ||
        !ALLOWED_BRIDGE_ROUTES.has(req.url) ||
        req.headers['x-ag-context-token'] !== LIVE_SECRET
      ) {
        res.writeHead(403);
        res.end();
        return;
      }

      try {
        const request = await readJsonBody(req);
        res.setHeader('Content-Type', 'application/json');

        if (req.url === '/record-calls') {
          const calls = Array.isArray(request.calls) ? request.calls : [];
          if (calls.length > MAX_RECORD_CALLS) {
            res.writeHead(400);
            res.end(JSON.stringify({ ok: false, error: `单次入账记录数超出上限（最多 ${MAX_RECORD_CALLS} 条）` }));
            return;
          }
          const resCall = recordModelCalls(calls);
          if (resCall && typeof resCall === 'object' && resCall.ok === false) {
            res.writeHead(500);
            res.end(JSON.stringify({ ok: false, changed: false, error: resCall.error || '入账落盘失败' }));
            return;
          }
          const changed = resCall && typeof resCall === 'object' ? !!resCall.changed : !!resCall;
          if (changed) refreshSnapshotsAsync();
          res.end(JSON.stringify({ ok: true, changed }));
          return;
        }

        if (req.url === '/get-settings') {
          const result = getPluginSettings(request);
          if (result && result.ok) cachedSettingsSnapshot = result;
          res.end(JSON.stringify(result));
          return;
        }

        if (req.url === '/save-settings') {
          const result = savePluginSettings(request);
          if (result && result.ok) refreshSnapshotsAsync();
          res.end(JSON.stringify(result));
          return;
        }

        if (req.url === '/launch-cli') {
          const result = await launchCliSession(request);
          res.end(JSON.stringify(result));
          return;
        }

        if (req.url === '/token-history') {
          const data = await collectTokenHistoryAsync({ force: request.force === true });
          if (data && !data.loading) cachedHistorySnapshot = data;
          res.end(JSON.stringify({ ok: true, data }));
          return;
        }

        if (req.url === '/quota') {
          const resData =
            typeof fetchQuotaSnapshotFromHost === 'function'
              ? await fetchQuotaSnapshotFromHost({ force: request.force === true })
              : { available: false, error: 'quota_unsupported' };
          const { _raw, ...safeData } = resData || {};
          res.end(JSON.stringify({ ok: true, data: safeData }));
          return;
        }

        if (req.url === '/modules-status') {
          const cfg = loadModulesConfig();
          const chCfg = cfg.modules?.chinese || {};
          const wantZhNow = Boolean(chCfg.enabled && String(chCfg.language || 'zh-CN').toLowerCase() !== 'en');
          const bootZhNow = bootZhState ? Boolean(bootZhState.enabled) : wantZhNow;
          res.end(
            JSON.stringify({
              ok: true,
              mode: 'cdp-daemon',
              data: cfg,
              disk: {
                meter: true,
                meterReady: true,
                chinese: true,
                chineseReady: true,
                proxy: false,
                proxyReady: false
              },
              runtime: {
                injectedAtStartup: false,
                proxyActive: false,
                proxyNeedsRestart: false,
                chineseActive: bootZhNow,
                chineseBootLanguage: bootZhState?.language || (bootZhNow ? 'zh-CN' : 'en'),
                chineseNeedsRestart: !wantZhNow && bootZhNow
              },
              configCorrupted: Boolean(cfg.__configCorrupted),
              configError: cfg.__configError || null,
              corruptedConfigPath: cfg.__corruptedConfigPath || null
            })
          );
          return;
        }

        if (req.url === '/toggle-module') {
          const name = String(request.name || '');
          const cfg = loadModulesConfig();
          if (name !== 'chinese') {
            res.end(JSON.stringify({ ok: false, error: `当前精简模式仅支持切换 chinese 模块: ${name}` }));
            return;
          }
          const extra = request?.opts || {};
          const targetEnable = Boolean(request.enable);
          const nextLang = normalizeClientLangFn(extra.language, targetEnable);
          cfg.modules.chinese = cfg.modules.chinese || {};
          cfg.modules.chinese.language = nextLang;
          cfg.modules.chinese.enabled = nextLang === 'zh-CN';
          if (extra.brandTitle !== undefined) {
            cfg.modules.chinese.brandTitle = normalizeBrandTitleFn(extra.brandTitle);
          }
          cfg.modules.chinese.lastUpdated = new Date().toISOString();
          cfg.modules.proxy = cfg.modules.proxy || {};
          cfg.modules.proxy.enabled = false;
          saveModulesConfig(cfg);
          setTimeout(() => { void sync(); }, 50);

          const wantZhNow = Boolean(cfg.modules.chinese.enabled);
          const bootZhNow = bootZhState ? Boolean(bootZhState.enabled) : wantZhNow;
          const restartRequired = !wantZhNow && bootZhNow;
          res.end(
            JSON.stringify({
              ok: true,
              mode: 'cdp-daemon',
              status: 'config_toggled',
              data: cfg,
              disk: { meter: true, meterReady: true, chinese: true, chineseReady: true, proxy: false, proxyReady: false },
              runtime: {
                injectedAtStartup: false,
                proxyActive: false,
                proxyNeedsRestart: false,
                chineseActive: bootZhNow,
                chineseBootLanguage: bootZhState?.language || (bootZhNow ? 'zh-CN' : 'en'),
                chineseNeedsRestart: restartRequired
              },
              restartRequired,
              message: wantZhNow
                ? '汉化与品牌设置已更新，后台 CDP 守护将在数秒内热同步生效'
                : '汉化已关闭，重载窗口或重启 Antigravity 后恢复官方英文'
            })
          );
          return;
        }

        if (req.url === '/open-external') {
          const result = await openExternalUrlSafe(request.url);
          res.end(JSON.stringify(result));
          return;
        }

        // /scan
        const data = await collect(origin, request.id, { force: request.force === true });
        res.end(JSON.stringify({ ok: true, data }));
      } catch (e) {
        const statusCode = e?.statusCode || 200;
        res.statusCode = statusCode;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: e?.message || String(e) }));
      }
    });

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      liveServer = server;
      livePort = server.address().port;
      writeLiveSessionStamp();
      resolve(livePort);
    });
  });
}

// ============================================================================
// 4. 动态载荷构建与源改动 mtime 热重载（零静态浪费）
// ============================================================================
const WATCHED_FILES = {
  meterCore: path.join(REPO_DIR, 'meter-core.js'),
  meterRenderer: path.join(REPO_DIR, 'meter-renderer.js'),
  zhDict: path.join(REPO_DIR, 'i18n', 'zh-CN.json'),
  zhRuntime: path.join(REPO_DIR, 'i18n', 'i18n-runtime.js'),
  themeI18n: path.join(os.homedir(), '.gemini', 'antigravity', 'theme-patch', 'core', 'i18n.json'),
  modulesCfg: path.join(STATE_DIR, 'modules.json')
};

const SAFE_SHORT_THEME_KEYS = new Set([
  'Swarm', 'Voice', 'Font', 'Remote', 'Sidebar', 'Toolbar', 'Usage', 'Quota',
  'Channels', 'Members', 'Graph', 'Board', 'Filters', 'Themes', 'Shortcuts',
  'Marketplace', 'Skills', 'Plugins', 'Browser', 'Downloads', 'Thumbnails',
  'Connectors', 'Microphone', 'Automations', 'Subagents', 'Worktrees'
]);

function buildMergedZhDictRaw() {
  const viewerRaw = readTextSafe(WATCHED_FILES.zhDict, '{}');
  const themeRaw = readTextSafe(WATCHED_FILES.themeI18n, '');
  if (!themeRaw) return viewerRaw;
  try {
    const baseDict = JSON.parse(viewerRaw);
    const themeDict = JSON.parse(themeRaw);
    const baseExact = baseDict?.exact && typeof baseDict.exact === 'object' ? baseDict.exact : {};
    const mergedExact = {};
    for (const [k, v] of Object.entries(themeDict || {})) {
      if (!k || typeof v !== 'string') continue;
      if (k === 'Antigravity' || k === 'Google Antigravity') continue;
      if (Object.prototype.hasOwnProperty.call(baseExact, k)) continue;
      if (/\s/.test(k) || k.length >= 9 || SAFE_SHORT_THEME_KEYS.has(k)) {
        mergedExact[k] = v;
      }
    }
    return JSON.stringify({
      ...baseDict,
      exact: { ...mergedExact, ...baseExact }
    });
  } catch {
    return viewerRaw;
  }
}

let bootZhState = null;
let cachedFilesSig = '';
let cachedBundleSig = '';
let cachedInjectScript = '';
let cachedWantMeter = true;
let cachedWantZh = true;

function buildCheckExpression() {
  return `(function(){
    var sig = ${JSON.stringify(cachedBundleSig)};
    if (window.__AGContextMeterBuildSig !== sig) return false;
    if (window.__AGContextMeterWaitingBody === sig && document.readyState === 'loading') return true;
    if (${cachedWantZh ? 'true' : 'false'} && !window.__AGY_I18N_BOOTED__) return false;
    if (${cachedWantMeter ? 'true' : 'false'} && (!window.__AGContextMeter || !document.getElementById('ag-context-meter') || window.__AGContextMeterLoadedSig !== sig)) return false;
    return true;
  })()`;
}

function rebuildBundleIfNeeded() {
  const sigInput = Object.values(WATCHED_FILES).map(getFileMtimeSig).join('|') + `|live:${livePort}:${LIVE_SECRET}`;
  if (sigInput === cachedFilesSig && cachedInjectScript) {
    return false;
  }

  let cfg = null;
  try {
    cfg = loadModulesConfig();
  } catch {
    cfg = { modules: { meter: { enabled: true }, chinese: { enabled: true }, proxy: { enabled: false } } };
  }

  const chCfg = cfg?.modules?.chinese || {};
  const zhLanguage = normalizeClientLangFn(chCfg.language, chCfg.enabled !== false);
  const zhBrandTitle = normalizeBrandTitleFn(chCfg.brandTitle);
  const wantMeter = cfg?.modules?.meter?.enabled !== false;
  const wantZh = chCfg.enabled !== false && zhLanguage !== 'en';
  if (!bootZhState) {
    bootZhState = { enabled: wantZh, language: wantZh ? zhLanguage : 'en' };
  } else if (wantZh && !bootZhState.enabled) {
    bootZhState = { enabled: true, language: zhLanguage };
  }

  const meterCoreCode = wantMeter ? readTextSafe(WATCHED_FILES.meterCore, '') : '';
  const meterRendererCode = wantMeter ? readTextSafe(WATCHED_FILES.meterRenderer, '') : '';
  const zhDictRaw = wantZh ? buildMergedZhDictRaw() : '{}';
  const zhRuntimeCode = wantZh ? readTextSafe(WATCHED_FILES.zhRuntime, '') : '';

  const buildHash = crypto
    .createHash('sha256')
    .update(sigInput)
    .update(String(wantMeter))
    .update(String(wantZh))
    .digest('hex')
    .slice(0, 12);

  cachedBundleSig = buildHash;
  cachedWantMeter = Boolean(wantMeter && meterCoreCode && meterRendererCode);
  cachedWantZh = Boolean(wantZh && zhRuntimeCode);

  const initSettings = cachedSettingsSnapshot && cachedSettingsSnapshot.ok ? cachedSettingsSnapshot : null;
  const initHistory = cachedHistorySnapshot && !cachedHistorySnapshot.loading ? cachedHistorySnapshot : null;

  const meterBootBlock = cachedWantMeter
    ? `
    var runMeter = function() {
      try {
        if (window.__AGContextMeterWaitingBody !== SIG &&
            window.__AGContextMeter &&
            document.getElementById('ag-context-meter') &&
            window.__AGContextMeterLoadedSig === SIG) {
          return;
        }
        window.__AGContextMeterWaitingBody = null;
        if (!window.__AGContextMeterSettings && ${JSON.stringify(initSettings)}) {
          window.__AGContextMeterSettings = ${JSON.stringify(initSettings)};
        }
        if (!window.__AGContextMeterHistory && ${JSON.stringify(initHistory)}) {
          window.__AGContextMeterHistory = ${JSON.stringify(initHistory)};
        }
${meterCoreCode}
${meterRendererCode}
        window.__AGContextMeterLoadedSig = SIG;
      } catch (meterErr) {
        console.error('[ContextMeter:CDP] Meter mount error:', meterErr);
      }
    };
    if (document.body) {
      runMeter();
    } else if (window.__AGContextMeterWaitingBody !== SIG) {
      window.__AGContextMeterWaitingBody = SIG;
      var waitBody = function() {
        if (document.body) runMeter();
        else setTimeout(waitBody, 40);
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', waitBody, { once: true });
      } else {
        setTimeout(waitBody, 40);
      }
    }`
    : '';

  const zhConfigObj = {
    enabled: wantZh,
    language: wantZh ? zhLanguage : 'en',
    brandTitle: zhBrandTitle
  };

  const zhBootBlock = cachedWantZh
    ? `
    window.__AGY_I18N_CONFIG__ = ${JSON.stringify(zhConfigObj)};
    if (!window.__AGY_I18N_BOOTED__) {
      try {
        window.__AGY_I18N_BOOTED__ = true;
        var _dictData = ${zhDictRaw.trim() || '{}'};
        window.__AGY_I18N_DATA__ = _dictData;
        globalThis.__AGY_I18N_DATA__ = _dictData;
${zhRuntimeCode}
      } catch (zhErr) {
        window.__AGY_I18N_BOOTED__ = false;
        console.warn('[AGY-i18n:CDP] Init warning:', zhErr);
      }
    }`
    : `window.__AGY_I18N_CONFIG__ = ${JSON.stringify(zhConfigObj)};`;

  cachedInjectScript = `(function(){
  try {
    if (location.protocol !== 'https:' || (location.hostname !== '127.0.0.1' && location.hostname !== 'localhost')) return;
    var SIG = ${JSON.stringify(cachedBundleSig)};
    window.__AGContextMeterBuildSig = SIG;
    window.__AGContextMeterLive = ${JSON.stringify({ port: livePort, token: LIVE_SECRET })};
    ${zhBootBlock}
    ${meterBootBlock}
  } catch (e) {
    console.error('[ContextMeter:CDP] Bootstrap error:', e);
  }
})();`;

  cachedFilesSig = sigInput;
  return true;
}

// ============================================================================
// 5. CDP WebSocket 会话挂载与重载自愈（对齐船板 attachTarget）
// ============================================================================
const attachedTargets = new Map();
const fallbackBackoffUntil = new Map();
let isSyncing = false;
let syncTickCount = 0;

function attachTarget(target, endpoint) {
  const wsUrl = target.webSocketDebuggerUrl;
  if (!wsUrl) return Promise.resolve(false);

  return new Promise((resolveAttach) => {
    let settled = false;
    const finishAttach = (ok) => {
      if (!settled) {
        settled = true;
        resolveAttach(ok);
      }
    };
    const attachTimeout = setTimeout(() => finishAttach(false), 3000);

    try {
      const ws = new WebSocket(wsUrl);
      let msgId = 1;
      let evalScriptId = null;
      let initialAttachDone = false;
      let navDebounceTimer = null;
      const pendingCallbacks = new Map();

      const send = (method, params = {}) =>
        new Promise((resolve) => {
          if (ws.readyState !== WebSocket.OPEN) return resolve(null);
          const id = msgId++;
          const timer = setTimeout(() => {
            pendingCallbacks.delete(id);
            resolve(null);
          }, 3000);
          pendingCallbacks.set(id, (msg) => {
            clearTimeout(timer);
            resolve(msg);
          });
          ws.send(JSON.stringify({ id, method, params }));
        });

      const updateNewDocScript = async () => {
        if (evalScriptId) {
          await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: evalScriptId });
          evalScriptId = null;
        }
        const addRes = await send('Page.addScriptToEvaluateOnNewDocument', { source: cachedInjectScript });
        if (addRes?.result?.identifier) {
          evalScriptId = addRes.result.identifier;
        }
      };

      const inject = async () => {
        const res = await send('Runtime.evaluate', {
          expression: cachedInjectScript,
          returnByValue: true
        });
        if (res?.error) {
          appendLog('ERROR', `CDP inject error on ${target.id} [${endpoint.channel}]: ${res.error.message || JSON.stringify(res.error)}`);
          return false;
        }
        if (res?.result?.exceptionDetails) {
          appendLog(
            'ERROR',
            `CDP inject exception on ${target.id} [${endpoint.channel}]: ${
              res.result.exceptionDetails.exception?.description || res.result.exceptionDetails.text
            }`
          );
          return false;
        }
        appendLog('INFO', `Injected ContextMeter/i18n (sig=${cachedBundleSig}) into ${target.id} [${endpoint.channel}]`);
        return true;
      };

      const checkAndInject = async () => {
        try {
          const checkRes = await send('Runtime.evaluate', {
            expression: buildCheckExpression(),
            returnByValue: true
          });
          if (checkRes?.result?.result?.value !== true) {
            return await inject();
          }
          return true;
        } catch {
          return false;
        }
      };

      ws.addEventListener('open', async () => {
        await send('Page.enable');
        await send('Runtime.enable');
        await updateNewDocScript();
        const ok = await checkAndInject();
        initialAttachDone = true;
        clearTimeout(attachTimeout);
        finishAttach(ok);
      });

      ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          if (msg.id && pendingCallbacks.has(msg.id)) {
            const cb = pendingCallbacks.get(msg.id);
            pendingCallbacks.delete(msg.id);
            cb(msg);
            return;
          }
          if (!initialAttachDone) return;
          if (
            msg.method === 'Page.frameNavigated' ||
            msg.method === 'Page.loadEventFired' ||
            msg.method === 'Page.domContentEventFired'
          ) {
            if (!msg.params?.frame || !msg.params.frame.parentId) {
              if (msg.params?.frame?.url) {
                try {
                  const navOrigin = new URL(msg.params.frame.url).origin;
                  if (/^https:\/\/(?:127\.0\.0\.1|localhost):\d+$/i.test(navOrigin)) {
                    activePageOrigins.set(navOrigin, { url: msg.params.frame.url, updatedAt: Date.now() });
                    lastPrimaryOrigin = navOrigin;
                    writeLiveSessionStamp();
                  }
                } catch {}
              }
              if (navDebounceTimer) clearTimeout(navDebounceTimer);
              navDebounceTimer = setTimeout(() => {
                navDebounceTimer = null;
                void checkAndInject();
              }, NAV_DEBOUNCE_MS);
            }
          }
        } catch {}
      });

      const closeHandler = () => {
        clearTimeout(attachTimeout);
        if (navDebounceTimer) {
          clearTimeout(navDebounceTimer);
          navDebounceTimer = null;
        }
        for (const [, cb] of pendingCallbacks) cb(null);
        pendingCallbacks.clear();
        attachedTargets.delete(target.id);
        finishAttach(false);
      };
      ws.addEventListener('close', closeHandler);
      ws.addEventListener('error', closeHandler);

      attachedTargets.set(target.id, {
        ws,
        updateNewDocScript,
        checkAndInject
      });
    } catch {
      clearTimeout(attachTimeout);
      finishAttach(false);
    }
  });
}

async function sync() {
  if (isSyncing) return;
  isSyncing = true;
  syncTickCount = (syncTickCount + 1) % 6000;
  try {
    const bundleChanged = rebuildBundleIfNeeded();
    const shouldHeartbeatCheck = bundleChanged || syncTickCount % HEARTBEAT_EVERY_TICKS === 1;

    const activeTargetIds = new Set();
    const currentOrigins = new Map();
    const attachPromises = [];
    const probedPorts = new Set();
    const nowMs = Date.now();

    for (const endpoint of CHANNEL_ENDPOINTS) {
      const port = readPort(endpoint.portFile);
      let targets = [];
      if (port && !probedPorts.has(port)) {
        probedPorts.add(port);
        targets = await fetchTargets(port);
      }
      if (
        targets.length === 0 &&
        endpoint.channelInstalled !== false &&
        endpoint.fallbackPort &&
        !probedPorts.has(endpoint.fallbackPort) &&
        (RUN_ONCE || nowMs >= (fallbackBackoffUntil.get(endpoint.fallbackPort) || 0))
      ) {
        probedPorts.add(endpoint.fallbackPort);
        targets = await fetchTargets(endpoint.fallbackPort);
        if (targets.length === 0) {
          fallbackBackoffUntil.set(endpoint.fallbackPort, nowMs + FALLBACK_BACKOFF_MS);
        } else {
          fallbackBackoffUntil.delete(endpoint.fallbackPort);
        }
      }
      if (targets.length === 0) continue;

      const pages = targets.filter(isTargetAppPage);
      for (const page of pages) {
        try {
          const origin = new URL(page.url).origin;
          currentOrigins.set(origin, { url: page.url, updatedAt: nowMs });
          activePageOrigins.set(origin, { url: page.url, updatedAt: nowMs });
          lastPrimaryOrigin = origin;
        } catch {}
      }

      for (const page of pages) {
        activeTargetIds.add(page.id);
        if (!attachedTargets.has(page.id)) {
          attachPromises.push(attachTarget(page, endpoint));
        } else {
          const entry = attachedTargets.get(page.id);
          if (bundleChanged && entry.updateNewDocScript) {
            await entry.updateNewDocScript();
          }
          if (shouldHeartbeatCheck && entry.checkAndInject) {
            await entry.checkAndInject();
          }
        }
      }
    }

    // 清理已关闭页面的旧 origin（保留 30s 防止切换加载瞬间误拒）
    for (const [org, meta] of activePageOrigins.entries()) {
      if (!currentOrigins.has(org) && nowMs - meta.updatedAt > 30_000) {
        activePageOrigins.delete(org);
      }
    }
    if (currentOrigins.size > 0) {
      writeLiveSessionStamp();
    }

    if (attachPromises.length > 0) {
      await Promise.allSettled(attachPromises);
    }

    for (const [id, entry] of attachedTargets.entries()) {
      if (!activeTargetIds.has(id)) {
        try { entry.ws.close(); } catch {}
        attachedTargets.delete(id);
      }
    }
  } catch (err) {
    appendLog('ERROR', `Sync loop exception: ${err?.stack || err?.message || String(err)}`);
  } finally {
    isSyncing = false;
  }
}

async function main() {
  if (!fs.existsSync(WATCHED_FILES.meterRenderer)) {
    appendLog('ERROR', `Missing meter-renderer.js at ${WATCHED_FILES.meterRenderer}`);
    process.exit(1);
  }
  acquireSingleInstanceLock();
  await startLiveBridgeServer();
  refreshSnapshotsAsync();
  rebuildBundleIfNeeded();
  appendLog(
    'INFO',
    `Antigravity Context CDP Daemon started (pid=${process.pid}, mode=${RUN_ONCE ? 'once' : 'daemon'}, livePort=${livePort}, sig=${cachedBundleSig})`
  );

  await sync();
  if (RUN_ONCE) {
    for (const [, entry] of attachedTargets.entries()) {
      try { entry.ws.close(); } catch {}
    }
    try { liveServer?.close(); } catch {}
    return;
  }

  setInterval(() => {
    void sync();
  }, SYNC_INTERVAL_MS);
}

void main();
