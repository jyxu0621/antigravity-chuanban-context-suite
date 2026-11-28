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
const SYNC_INTERVAL_MS = 5_000;
const HEARTBEAT_EVERY_TICKS = 6; // 6 * 5s = 30s 轻量存活校验（页面重载由 CDP WebSocket 事件实时推送）
const FALLBACK_BACKOFF_MS = 10_000;
const NAV_DEBOUNCE_MS = 120;
const CDP_CMD_TIMEOUT_MS = 8_000;
const ATTACH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_RECORD_CALLS = 500;
const MAX_LOG_BYTES = 512 * 1024;
const RUN_ONCE = process.argv.includes('--once');
const ENSURE_MODE = process.argv.includes('--ensure');

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
const collectorApi = require(path.join(REPO_DIR, 'meter-collector.js'));
const {
  collect,
  collectTokenHistoryAsync,
  collectSessionTimelineAsync,
  fetchQuotaSnapshotFromHost,
  recordModelCalls,
  recordModelCallsAsync,
  getPluginSettings,
  savePluginSettings,
  launchCliSession
} = collectorApi;

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
// 1. 单实例 PID 锁与 --ensure 极速健康探针（沿用 Windows 命令行校验防止 PID 复用误杀）
// ============================================================================
function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {}
}

function probeLiveDaemonHealth(port, token, expectedPid) {
  if (!port || !token || !expectedPid) return Promise.resolve(false);
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port,
        path: '/health',
        headers: { 'X-AG-Context-Token': token },
        timeout: 600
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve(false);
          try {
            const parsed = JSON.parse(data);
            resolve(Boolean(parsed?.ok && parsed?.pid === expectedPid && parsed?.mode === 'cdp-daemon'));
          } catch {
            resolve(false);
          }
        });
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function isGuardianPidAlive(pid) {
  if (!pid || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
  } catch (err) {
    if (!err || err.code !== 'EPERM') return false;
  }
  if (process.platform === 'win32') {
    const tl = spawnSync('tasklist', ['/FI', `PID eq ${Number(pid)}`, '/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000
    });
    if (tl.status === 0 && !String(tl.stdout || '').toLowerCase().includes('node.exe')) {
      return false;
    }
    const res = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(pid)}" -ErrorAction SilentlyContinue).CommandLine`],
      { encoding: 'utf8', windowsHide: true, timeout: 4000 }
    );
    const out = String(res.stdout || '');
    if (out.includes('antigravity-patch-guardian')) return true;
    if (out.trim().length > 0) return false;
    // WMI 超时或空输出且 tasklist 已确认是 node.exe 时保守判定存活（仅在非强制替换路径）
    return tl.status === 0 && res.status !== 0;
  }
  return true;
}

async function isHealthyDaemonRunningForEnsure() {
  const oldPid = Number.parseInt(readTextSafe(PID_FILE).trim(), 10);
  if (!Number.isInteger(oldPid) || oldPid <= 0 || oldPid === process.pid) return false;

  try {
    const rawLive = readTextSafe(LIVE_SESSION_FILE, '');
    if (rawLive) {
      const liveInfo = JSON.parse(rawLive);
      if (liveInfo?.pid === oldPid && liveInfo?.port > 0 && liveInfo?.token) {
        const healthy = await probeLiveDaemonHealth(liveInfo.port, liveInfo.token, oldPid);
        if (healthy) return true;
      }
    }
  } catch {}

  // 若旧进程刚启动不到 6 秒尚未写完 .live-session.json，回退检查 PID 存活避免并发重入
  try {
    const st = fs.statSync(PID_FILE, { throwIfNoEntry: false });
    if (st && Date.now() - st.mtimeMs < 6_000 && isGuardianPidAlive(oldPid)) {
      return true;
    }
  } catch {}

  return false;
}

function acquireSingleInstanceLock() {
  if (RUN_ONCE) return;
  const oldPid = Number.parseInt(readTextSafe(PID_FILE).trim(), 10);
  if (Number.isInteger(oldPid) && isGuardianPidAlive(oldPid)) {
    try {
      process.kill(oldPid, 'SIGTERM');
      const deadline = Date.now() + 600;
      while (Date.now() < deadline) {
        try {
          process.kill(oldPid, 0);
          sleepSync(50);
        } catch {
          break;
        }
      }
    } catch {}
  }
  fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
  let cleaned = false;
  const cleanup = (reason = 'exit') => {
    if (cleaned) return;
    cleaned = true;
    try {
      if (fs.existsSync(PID_FILE) && fs.readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) {
        fs.unlinkSync(PID_FILE);
      }
    } catch {}
    if (reason !== 'exit') {
      appendLog('INFO', `Daemon stopping (pid=${process.pid}, reason=${reason})`);
    }
  };
  process.on('exit', (code) => {
    cleanup('exit');
    if (code !== 0) {
      appendLog('WARN', `Daemon process exit (pid=${process.pid}, code=${code})`);
    }
  });
  process.on('beforeExit', (code) => {
    appendLog('WARN', `Daemon beforeExit (pid=${process.pid}, code=${code})`);
  });
  process.on('SIGINT', () => { cleanup('SIGINT'); process.exit(0); });
  process.on('SIGTERM', () => { cleanup('SIGTERM'); process.exit(0); });
  process.on('SIGBREAK', () => { cleanup('SIGBREAK'); process.exit(0); });
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
  return { channel: channelName, portFile, dotDir, fallbackPort, channelInstalled };
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

const HISTORY_CACHE_TTL_MS = 180_000;
const HISTORY_DIRTY_COOLDOWN_MS = 30_000;
const SCAN_CACHE_TTL_MS = 45_000;
const SCAN_CACHE_MAX_ENTRIES = 4;
let cachedSettingsSnapshot = null;
let cachedHistorySnapshot = null;
let cachedHistoryAt = 0;
let historyDirty = false;
let historyFetchPromise = null;
const scanCache = new Map(); // `${origin}|${id}` -> { data, at }
const scanInFlight = new Map(); // `${origin}|${id}` -> Promise<object>
let lastHighMemLogAt = 0;

function setBoundedScanCache(key, data) {
  if (scanCache.has(key)) scanCache.delete(key);
  scanCache.set(key, { data, at: Date.now() });
  while (scanCache.size > SCAN_CACHE_MAX_ENTRIES) {
    const oldest = scanCache.keys().next().value;
    if (oldest !== undefined) scanCache.delete(oldest);
    else break;
  }
}

function getScanCoalesced(origin, id, { force = false } = {}) {
  const key = `${origin}|${id || ''}`;
  const now = Date.now();
  if (!force) {
    const cached = scanCache.get(key);
    if (cached && now - cached.at < SCAN_CACHE_TTL_MS) {
      return Promise.resolve(cached.data);
    }
    const existing = scanInFlight.get(key);
    if (existing) {
      return existing;
    }
  }
  const p = Promise.resolve(collect(origin, id, { force: Boolean(force), supersedePrevious: true }))
    .then((rawData) => {
      const clean = stripHeavyScanPayload(rawData);
      if (clean && !clean.abortedStale) {
        setBoundedScanCache(key, clean);
      }
      return clean;
    })
    .finally(() => {
      if (scanInFlight.get(key) === p) {
        scanInFlight.delete(key);
      }
    });
  scanInFlight.set(key, p);
  return p;
}

function stripHeavyScanPayload(data) {
  if (!data || typeof data !== 'object') return data;
  const session = data.session;
  if (!session || !Array.isArray(session.attachments)) return data;
  let stripped = false;
  const cleanAttachments = session.attachments.map((att) => {
    if (att && typeof att === 'object' && 'inlineData' in att) {
      stripped = true;
      const { inlineData, ...rest } = att;
      return rest;
    }
    return att;
  });
  if (!stripped) return data;
  return {
    ...data,
    session: {
      ...session,
      attachments: cleanAttachments
    }
  };
}

function getTokenHistoryCoalesced({ force = false } = {}) {
  const now = Date.now();
  const age = now - cachedHistoryAt;
  if (
    !force &&
    cachedHistorySnapshot &&
    age < HISTORY_CACHE_TTL_MS &&
    (!historyDirty || age < HISTORY_DIRTY_COOLDOWN_MS)
  ) {
    return Promise.resolve(cachedHistorySnapshot);
  }
  if (historyFetchPromise) {
    return historyFetchPromise;
  }
  const shouldForceCollector = Boolean(force || historyDirty);
  const p = Promise.resolve(collectTokenHistoryAsync({ force: shouldForceCollector }))
    .then((hist) => {
      if (hist && !hist.loading) {
        cachedHistorySnapshot = hist;
        cachedHistoryAt = Date.now();
        historyDirty = false;
      }
      return hist;
    })
    .finally(() => {
      if (historyFetchPromise === p) {
        historyFetchPromise = null;
      }
    });
  historyFetchPromise = p;
  return p;
}

function refreshSettingsSnapshot() {
  try {
    const settingsSnap = getPluginSettings();
    if (settingsSnap && settingsSnap.ok) {
      cachedSettingsSnapshot = settingsSnap;
    }
  } catch {}
}

function refreshSnapshotsAsync({ includeHistory = false } = {}) {
  refreshSettingsSnapshot();
  if (includeHistory) {
    void getTokenHistoryCoalesced({ force: false }).catch(() => {});
  }
}

let lastWrittenStampKey = '';

function writeLiveSessionStamp(force = false) {
  if (!livePort) return;
  try {
    const origins = Array.from(activePageOrigins.keys());
    const primaryOrigin = origins[0] || lastPrimaryOrigin || '';
    const stampKey = `${livePort}|${process.pid}|${primaryOrigin}|${origins.join(',')}`;
    if (!force && stampKey === lastWrittenStampKey && fs.existsSync(LIVE_SESSION_FILE)) {
      return;
    }
    const info = {
      port: livePort,
      token: LIVE_SECRET,
      pid: process.pid,
      origin: primaryOrigin,
      origins,
      mode: 'cdp-daemon',
      startedAt: Date.now()
    };
    const tmp = `${LIVE_SESSION_FILE}.tmp_${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(info), 'utf8');
    fs.renameSync(tmp, LIVE_SESSION_FILE);
    lastWrittenStampKey = stampKey;
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
  '/session-timeline',
  '/quota',
  '/accounts-overview',
  '/accounts-action',
  '/record-calls',
  '/get-settings',
  '/save-settings',
  '/launch-cli',
  '/modules-status',
  '/toggle-module',
  '/open-external',
  '/omni-stat'
]);
const routeHits = {};

// ============================================================================
// Omni 超大文件只读流式检视台（127.0.0.1 HTTP 206 Range + 单文件 HMAC 子令牌）
// ============================================================================
const OMNI_TOKEN_TTL_MS = 10 * 60 * 1000;
const OMNI_MAX_TOKENS = 64;
const omniTokenStore = new Map(); // token -> { realPath, mime, kind, expiresAt }

const OMNI_MIME_MAP = {
  '.mp4': ['video/mp4', 'video'],
  '.m4v': ['video/mp4', 'video'],
  '.webm': ['video/webm', 'video'],
  '.mov': ['video/quicktime', 'video'],
  '.mkv': ['video/x-matroska', 'video'],
  '.mp3': ['audio/mpeg', 'audio'],
  '.wav': ['audio/wav', 'audio'],
  '.ogg': ['audio/ogg', 'audio'],
  '.m4a': ['audio/mp4', 'audio'],
  '.flac': ['audio/flac', 'audio'],
  '.png': ['image/png', 'image'],
  '.jpg': ['image/jpeg', 'image'],
  '.jpeg': ['image/jpeg', 'image'],
  '.webp': ['image/webp', 'image'],
  '.gif': ['image/gif', 'image'],
  '.avif': ['image/avif', 'image'],
  '.svg': ['image/svg+xml', 'image'],
  '.ico': ['image/x-icon', 'image'],
  '.pdf': ['application/pdf', 'pdf'],
  '.csv': ['text/csv; charset=utf-8', 'table'],
  '.tsv': ['text/tab-separated-values; charset=utf-8', 'table'],
  '.jsonl': ['application/x-ndjson; charset=utf-8', 'table'],
  '.ndjson': ['application/x-ndjson; charset=utf-8', 'table'],
  '.ttf': ['font/ttf', 'font'],
  '.otf': ['font/otf', 'font'],
  '.woff2': ['font/woff2', 'font'],
  '.woff': ['font/woff', 'font'],
  '.html': ['text/html; charset=utf-8', 'html'],
  '.htm': ['text/html; charset=utf-8', 'html']
};

const OMNI_SENSITIVE_PATH_RE =
  /(?:^|[\\/])(?:\.ssh|\.aws|\.gnupg|\.kube|id_rsa|id_ed25519|id_ecdsa|\.npmrc|\.netrc|\.pypirc|\.git-credentials|cookies|login data|local state|state\.vscdb|shadow|passwd|sam)(?:$|[\\/\.])/i;
const OMNI_SENSITIVE_ENV_RE = /(?:^|[\\/])\.env(?:\.[a-z0-9_-]+)?$/i;
const OMNI_WIN_RESERVED_RE = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;

function resolveOmniMime(ext) {
  const hit = OMNI_MIME_MAP[ext];
  if (hit) return { mime: hit[0], kind: hit[1] };
  return { mime: 'text/plain; charset=utf-8', kind: 'text' };
}

function validateOmniLocalPath(rawInput) {
  if (typeof rawInput !== 'string') return { ok: false, error: '路径无效' };
  let p = rawInput.trim();
  if (!p || p.includes('\0') || p.length > 1024) return { ok: false, error: '路径格式非法' };
  if (/^file:\/\//i.test(p)) {
    try {
      const u = new URL(p);
      p = decodeURIComponent(u.pathname);
      if (process.platform === 'win32' && /^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
    } catch {
      return { ok: false, error: 'file:// URI 解析失败' };
    }
  }
  // 剥离尾部行号锚点 (#L123 或 :123:45)
  p = p.replace(/#L\d+(?:-L?\d+)?$/i, '').replace(/:\d+(?::\d+)?$/, '');
  if (p.startsWith('\\\\') || p.startsWith('//')) return { ok: false, error: '出于安全策略拒绝 UNC/网络共享路径' };
  if (OMNI_WIN_RESERVED_RE.test(path.basename(p))) return { ok: false, error: '拒绝系统设备名路径' };

  let realPath;
  try {
    realPath = fs.realpathSync(p);
  } catch {
    return { ok: false, error: '文件不存在或无读取权限' };
  }
  if (realPath.startsWith('\\\\') || realPath.startsWith('//')) {
    return { ok: false, error: '解析后命中受限网络路径' };
  }
  if (OMNI_SENSITIVE_PATH_RE.test(realPath) || OMNI_SENSITIVE_ENV_RE.test(realPath)) {
    return { ok: false, error: '命中敏感凭据保护策略，已拒绝预览' };
  }
  let stat;
  try {
    stat = fs.statSync(realPath);
  } catch {
    return { ok: false, error: '无法读取文件状态' };
  }
  if (!stat.isFile()) return { ok: false, error: '仅支持预览普通文件' };
  const ext = path.extname(realPath).toLowerCase();
  const { mime, kind } = resolveOmniMime(ext);
  return { ok: true, realPath, name: path.basename(realPath), ext, size: stat.size, mtimeMs: stat.mtimeMs, mime, kind };
}

function issueOmniToken(entry) {
  const now = Date.now();
  for (const [k, v] of omniTokenStore.entries()) {
    if (v.expiresAt <= now) omniTokenStore.delete(k);
  }
  while (omniTokenStore.size >= OMNI_MAX_TOKENS) {
    const oldest = omniTokenStore.keys().next().value;
    if (oldest) omniTokenStore.delete(oldest);
    else break;
  }
  const nonce = crypto.randomBytes(12).toString('hex');
  const sig = crypto
    .createHmac('sha256', LIVE_SECRET)
    .update(`${nonce}|${entry.realPath}|${now}`)
    .digest('hex')
    .slice(0, 24);
  const token = `${nonce}.${sig}`;
  omniTokenStore.set(token, {
    realPath: entry.realPath,
    mime: entry.mime,
    kind: entry.kind,
    expiresAt: now + OMNI_TOKEN_TTL_MS
  });
  return token;
}

function handleOmniStreamRequest(req, res) {
  const reqUrl = new URL(req.url, `http://127.0.0.1:${livePort || 1}`);
  const token = reqUrl.searchParams.get('t') || '';
  const origin = req.headers.origin;
  if (origin && activePageOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range,Accept-Ranges,Content-Length');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    res.writeHead(204);
    res.end();
    return;
  }
  const grant = omniTokenStore.get(token);
  if (!grant || grant.expiresAt <= Date.now()) {
    if (grant) omniTokenStore.delete(token);
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Expired or invalid stream token');
    return;
  }
  let stat;
  try {
    stat = fs.statSync(grant.realPath);
    if (!stat.isFile()) throw new Error('not file');
  } catch {
    res.writeHead(404);
    res.end();
    return;
  }

  const total = stat.size;
  const baseHeaders = {
    'Content-Type': grant.mime,
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store'
  };
  if (grant.kind === 'html') {
    baseHeaders['Content-Security-Policy'] = 'sandbox';
  }

  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const m = /^bytes=(\d*)-(\d*)$/i.exec(String(rangeHeader).trim());
    if (!m) {
      res.writeHead(416, { ...baseHeaders, 'Content-Range': `bytes */${total}` });
      res.end();
      return;
    }
    let start = m[1] ? Number.parseInt(m[1], 10) : 0;
    let end = m[2] ? Number.parseInt(m[2], 10) : total - 1;
    if (!m[1] && m[2]) {
      const suffix = Number.parseInt(m[2], 10);
      start = Math.max(0, total - suffix);
      end = total - 1;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= total || end < start) {
      res.writeHead(416, { ...baseHeaders, 'Content-Range': `bytes */${total}` });
      res.end();
      return;
    }
    end = Math.min(end, total - 1);
    const chunkLen = end - start + 1;
    res.writeHead(206, {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': String(chunkLen)
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = fs.createReadStream(grant.realPath, { start, end });
    stream.on('error', () => {
      try { res.destroy(); } catch {}
    });
    stream.pipe(res);
    return;
  }

  res.writeHead(200, { ...baseHeaders, 'Content-Length': String(total) });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = fs.createReadStream(grant.realPath);
  stream.on('error', () => {
    try { res.destroy(); } catch {}
  });
  stream.pipe(res);
}

function startLiveBridgeServer() {
  if (liveServer) return Promise.resolve(livePort);
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        if (req.headers['x-ag-context-token'] !== LIVE_SECRET) {
          res.writeHead(403);
          res.end();
          return;
        }
        const mem = process.memoryUsage();
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            ok: true,
            pid: process.pid,
            mode: 'cdp-daemon',
            uptimeSec: Math.round(process.uptime()),
            rssMB: Math.round(mem.rss / 1048576),
            attachedTargets: attachedTargets.size,
            wantZh: cachedWantZh,
            bundleSig: cachedBundleSig || null,
            routeHits
          })
        );
        return;
      }

      if ((req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') && req.url && req.url.startsWith('/omni-stream?')) {
        handleOmniStreamRequest(req, res);
        return;
      }

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
        routeHits[req.url] = (routeHits[req.url] || 0) + 1;
        const request = await readJsonBody(req);
        res.setHeader('Content-Type', 'application/json');

        if (req.url === '/omni-stat') {
          const info = validateOmniLocalPath(request?.path || '');
          if (!info.ok) {
            res.end(JSON.stringify(info));
            return;
          }
          const streamToken = issueOmniToken(info);
          res.end(
            JSON.stringify({
              ok: true,
              name: info.name,
              realPath: info.realPath,
              ext: info.ext,
              size: info.size,
              mtimeMs: info.mtimeMs,
              mime: info.mime,
              kind: info.kind,
              streamUrl: `http://127.0.0.1:${livePort}/omni-stream?t=${encodeURIComponent(streamToken)}`
            })
          );
          return;
        }

        if (req.url === '/record-calls') {
          // 精简无累计 Token 热力图模式下跳过 35MB pricing_ledger_v1.json 重写，彻底根除后台磁盘与内存风暴
          res.end(JSON.stringify({ ok: true, changed: false, skipped: 'slim_mode' }));
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
          if (result && result.ok) {
            refreshSettingsSnapshot();
            historyDirty = true;
            cachedHistoryAt = 0;
          }
          res.end(JSON.stringify(result));
          return;
        }

        if (req.url === '/launch-cli') {
          const result = await launchCliSession(request);
          res.end(JSON.stringify(result));
          return;
        }

        if (req.url === '/token-history') {
          const data = await getTokenHistoryCoalesced({ force: request.force === true });
          res.end(JSON.stringify({ ok: true, data }));
          return;
        }

        if (req.url === '/session-timeline') {
          const viewerVer = readViewerVersion();
          const opts = request?.options && typeof request.options === 'object' ? request.options : request;
          const safeOpts = {
            origin,
            force: opts?.force === true,
            ...(Array.isArray(opts?.liveSteps) ? { liveSteps: opts.liveSteps } : {}),
            ...(Array.isArray(opts?.liveCalls) ? { liveCalls: opts.liveCalls } : {}),
            ...(Array.isArray(opts?.cascadeModelConfigs) ? { cascadeModelConfigs: opts.cascadeModelConfigs } : {}),
            ...(opts?.userStatus && typeof opts.userStatus === 'object' ? { userStatus: opts.userStatus } : {})
          };
          const data =
            typeof collectSessionTimelineAsync === 'function'
              ? await collectSessionTimelineAsync(request?.id || '', safeOpts)
              : null;
          res.end(
            JSON.stringify({
              ok: true,
              data: {
                ...(data || {}),
                backendVersion: viewerVer,
                backendSource: 'live-host'
              }
            })
          );
          return;
        }

        if (req.url === '/quota') {
          const resData =
            typeof fetchQuotaSnapshotFromHost === 'function'
              ? await fetchQuotaSnapshotFromHost({
                  force: request.force === true,
                  origin,
                  backendSource: 'live-host',
                  currentModel: request.currentModel || null,
                  browsePoolKey: request.browsePoolKey || null
                })
              : { available: false, error: 'quota_unsupported' };
          const { _raw, ...safeData } = resData || {};
          let accountSyncResult = null;
          try {
            const accountsModPath = path.join(REPO_DIR, 'meter-accounts.js');
            if (fs.existsSync(accountsModPath)) {
              const { getSharedAccountsManager } = require(accountsModPath);
              const mgr = getSharedAccountsManager({ origin });
              const email = resData?.planStatus?.email || (await mgr.detectCurrentActiveAccount())?.email || null;
              if (email && resData?.snapshot) {
                mgr.syncActiveHostQuotaSnapshot(resData, email);
                const ov = mgr.getOverviewState();
                if (ov.autoSwitch?.enabled && !resData.error) {
                  accountSyncResult = await mgr.evaluateAutoSwitch({
                    activeEmail: email,
                    activeSnapshot: resData.snapshot,
                    syncState: 'fresh',
                    isGenerating: Boolean(request?.isGenerating)
                  });
                }
              }
            }
          } catch {}
          res.end(JSON.stringify({ ok: true, data: safeData, accountSyncResult }));
          return;
        }

        if (req.url === '/accounts-overview') {
          const accountsModPath = path.join(REPO_DIR, 'meter-accounts.js');
          if (!fs.existsSync(accountsModPath)) {
            res.end(JSON.stringify({ ok: false, error: 'accounts_unsupported' }));
            return;
          }
          const { getSharedAccountsManager } = require(accountsModPath);
          const mgr = getSharedAccountsManager({ origin });
          await mgr.detectCurrentActiveAccount();
          res.end(JSON.stringify(mgr.getOverviewState()));
          return;
        }

        if (req.url === '/accounts-action') {
          const accountsModPath = path.join(REPO_DIR, 'meter-accounts.js');
          if (!fs.existsSync(accountsModPath)) {
            res.end(JSON.stringify({ ok: false, error: 'accounts_unsupported' }));
            return;
          }
          const { getSharedAccountsManager, dispatchAccountsAction } = require(accountsModPath);
          const mgr = getSharedAccountsManager({ origin });
          const outRes = await dispatchAccountsAction(mgr, request || {});
          res.end(JSON.stringify(outRes));
          return;
        }

        if (req.url === '/modules-status') {
          const cfg = loadModulesConfig();
          const chCfg = cfg.modules?.chinese || {};
          const wantZhNow = Boolean(chCfg.enabled && String(chCfg.language || 'zh-CN').toLowerCase() !== 'en');
          const bootZhNow = bootZhState ? Boolean(bootZhState.enabled) : wantZhNow;
          const viewerVer = readViewerVersion();
          res.end(
            JSON.stringify({
              ok: true,
              mode: 'cdp-daemon',
              collectorVersion: viewerVer,
              backendVersion: viewerVer,
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
          const viewerVer = readViewerVersion();
          res.end(
            JSON.stringify({
              ok: true,
              mode: 'cdp-daemon',
              status: 'config_toggled',
              collectorVersion: viewerVer,
              backendVersion: viewerVer,
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
        const viewerVer = readViewerVersion();
        const data = await getScanCoalesced(origin, request.id, { force: request.force === true });
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              ...(data || {}),
              backendVersion: viewerVer,
              backendSource: 'live-host'
            }
          })
        );
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
  viewerPackage: path.join(REPO_DIR, 'package.json'),
  meterCore: path.join(REPO_DIR, 'meter-core.js'),
  meterRenderer: path.join(REPO_DIR, 'meter-renderer.js'),
  zhDict: path.join(REPO_DIR, 'i18n', 'zh-CN.json'),
  zhRuntime: path.join(REPO_DIR, 'i18n', 'i18n-runtime.js'),
  themeI18n: path.join(os.homedir(), '.gemini', 'antigravity', 'theme-patch', 'core', 'i18n.json'),
  themeUserConfig: path.join(os.homedir(), '.gemini', 'antigravity', 'theme-patch', 'user', 'config.json'),
  modulesCfg: path.join(STATE_DIR, 'modules.json')
};

function isChuanbanI18nActive() {
  if (process.env.AG_FORCE_VIEWER_I18N === '1') return false;
  try {
    const raw = readTextSafe(WATCHED_FILES.themeUserConfig, '');
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return parsed?.enabled !== false && parsed?.modules?.i18n === true;
  } catch {
    return false;
  }
}

function readViewerVersion() {
  try {
    const raw = readTextSafe(WATCHED_FILES.viewerPackage, '');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.version === 'string' && parsed.version.trim()) {
        return parsed.version.trim();
      }
    }
  } catch {}
  return '0.8.7';
}

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

const HOST_FP_CHECK_EXPR = `Boolean(
  (window.__APP_CONFIG__ && window.__APP_CONFIG__.productName === 'antigravity') ||
  (window.electronNative && (
    typeof window.electronNative.setTitleBarOverlay === 'function' ||
    typeof window.electronNative.getZoomLevel === 'function' ||
    window.electronNative.wcvBrowser
  ))
)`;

function buildCheckExpression() {
  return `(function(){
    if (!(${HOST_FP_CHECK_EXPR})) return true;
    var sig = ${JSON.stringify(cachedBundleSig)};
    if (window.__AGContextMeterBuildSig !== sig) return false;
    if (!window.__AGContextMeterLive || window.__AGContextMeterLive.port !== ${livePort} || window.__AGContextMeterLive.token !== ${JSON.stringify(LIVE_SECRET)}) return false;
    if (window.__AGContextMeterWaitingBody === sig && document.readyState === 'loading') return true;
    if (${cachedWantZh ? 'true' : 'false'} && !window.__AGY_I18N_BOOTED__) return false;
    if (${cachedWantMeter ? 'true' : 'false'}) {
      if (!window.__AGContextMeter || window.__AGContextMeterLoadedSig !== sig) return false;
      if (document.readyState !== 'loading' && document.body && !document.getElementById('ag-context-meter')) return false;
    }
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
    cfg = { modules: { meter: { enabled: true }, chinese: { enabled: false, language: 'en' }, proxy: { enabled: false } } };
  }

  const chCfg = cfg?.modules?.chinese || {};
  const zhLanguage = normalizeClientLangFn(chCfg.language, chCfg.enabled === true);
  const zhBrandTitle = normalizeBrandTitleFn(chCfg.brandTitle);
  const wantMeter = cfg?.modules?.meter?.enabled !== false;
  const chuanbanOwnsI18n = isChuanbanI18nActive();
  const rawWantZh = chCfg.enabled === true && zhLanguage !== 'en';
  const wantZh = chuanbanOwnsI18n ? false : rawWantZh;
  if (chuanbanOwnsI18n && rawWantZh) {
    appendLog('INFO', 'Chuanban i18n is active; suppressing duplicate ContextViewer i18n-runtime.js injection.');
  }
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

  const liveBridgeMeta = {
    port: livePort,
    token: LIVE_SECRET,
    mode: 'cdp-daemon',
    version: readViewerVersion(),
    pid: process.pid,
    capabilities: {
      quota: false,
      scan: true,
      tokenHistory: true,
      recordCalls: false,
      settings: true,
      launchCli: false,
      modules: true,
      omni: true,
      accounts: false,
      checkUpdate: false,
      applyUpdate: false,
      contextUnlock: false,
      enhance: false
    }
  };

  cachedInjectScript = `(function(){
  try {
    if (location.protocol !== 'https:' || (location.hostname !== '127.0.0.1' && location.hostname !== 'localhost')) return;
    if (!(${HOST_FP_CHECK_EXPR})) return;
    var SIG = ${JSON.stringify(cachedBundleSig)};
    window.__AGContextMeterBuildSig = SIG;
    window.__AGContextMeterLive = ${JSON.stringify(liveBridgeMeta)};
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
    const attachTimeout = setTimeout(() => finishAttach(false), ATTACH_TIMEOUT_MS);

    try {
      const ws = new WebSocket(wsUrl);
      const createdAt = Date.now();
      let msgId = 1;
      let evalScriptId = null;
      let initialAttachDone = false;
      let navDebounceTimer = null;
      let injectInFlight = false;
      let injectQueued = false;
      const pendingCallbacks = new Map();

      const send = (method, params = {}) =>
        new Promise((resolve) => {
          if (ws.readyState !== WebSocket.OPEN) return resolve(null);
          const id = msgId++;
          const timer = setTimeout(() => {
            pendingCallbacks.delete(id);
            resolve(null);
          }, CDP_CMD_TIMEOUT_MS);
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
        if (!res) {
          appendLog('WARN', `CDP inject timed out or closed on ${target.id} [${endpoint.channel}]`);
          return false;
        }
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
        if (injectInFlight) {
          injectQueued = true;
          return true;
        }
        injectInFlight = true;
        try {
          let lastOk = true;
          do {
            injectQueued = false;
            const checkRes = await send('Runtime.evaluate', {
              expression: buildCheckExpression(),
              returnByValue: true
            });
            if (!checkRes) {
              lastOk = false;
            } else if (checkRes?.result?.result?.value !== true) {
              lastOk = await inject();
            } else {
              lastOk = true;
            }
          } while (injectQueued && ws.readyState === WebSocket.OPEN);
          return lastOk;
        } catch {
          return false;
        } finally {
          injectInFlight = false;
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
        createdAt,
        isInitialAttachDone: () => initialAttachDone,
        hasNewDocScript: () => Boolean(evalScriptId),
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
      const channelInstalledNow =
        fs.existsSync(endpoint.portFile) ||
        fs.existsSync(path.dirname(endpoint.portFile)) ||
        (endpoint.dotDir && fs.existsSync(endpoint.dotDir));
      const port = readPort(endpoint.portFile);
      let targets = [];
      if (port && !probedPorts.has(port)) {
        probedPorts.add(port);
        targets = await fetchTargets(port);
        if (targets.length > 0 && endpoint.fallbackPort) {
          fallbackBackoffUntil.delete(endpoint.fallbackPort);
        }
      }
      if (
        targets.length === 0 &&
        channelInstalledNow &&
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
        const existing = attachedTargets.get(page.id);
        const staleWs =
          existing &&
          (existing.ws.readyState === WebSocket.CLOSED ||
            existing.ws.readyState === WebSocket.CLOSING ||
            (!existing.isInitialAttachDone() && nowMs - existing.createdAt > 15_000));
        if (staleWs) {
          try { existing.ws.close(); } catch {}
          attachedTargets.delete(page.id);
        }
        if (!attachedTargets.has(page.id)) {
          attachPromises.push(attachTarget(page, endpoint));
        } else {
          const entry = attachedTargets.get(page.id);
          if ((bundleChanged || (entry.isInitialAttachDone() && !entry.hasNewDocScript())) && entry.updateNewDocScript) {
            await entry.updateNewDocScript();
          }
          if (shouldHeartbeatCheck && entry.isInitialAttachDone() && entry.checkAndInject) {
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
    } else if (scanCache.size > 0) {
      scanCache.clear();
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

    if (shouldHeartbeatCheck && nowMs - lastHighMemLogAt > 300_000) {
      const rssMB = Math.round(process.memoryUsage().rss / 1048576);
      if (rssMB >= 700) {
        lastHighMemLogAt = nowMs;
        appendLog('WARN', `High daemon memory watermark: rss=${rssMB}MB, scanCache=${scanCache.size}, targets=${attachedTargets.size}`);
      }
    }
  } catch (err) {
    appendLog('ERROR', `Sync loop exception: ${err?.stack || err?.message || String(err)}`);
  } finally {
    isSyncing = false;
  }
}

let daemonReady = false;

process.on('uncaughtException', (err) => {
  appendLog('ERROR', `Uncaught exception: ${err?.stack || err?.message || String(err)}`);
  if (!daemonReady) process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason && typeof reason === 'object' && 'stack' in reason ? reason.stack : String(reason);
  appendLog('ERROR', `Unhandled rejection: ${msg}`);
});

async function main() {
  if (!fs.existsSync(WATCHED_FILES.meterRenderer)) {
    appendLog('ERROR', `Missing meter-renderer.js at ${WATCHED_FILES.meterRenderer}`);
    process.exit(1);
  }
  if (ENSURE_MODE && !RUN_ONCE) {
    if (await isHealthyDaemonRunningForEnsure()) {
      process.exit(0);
    }
  }
  acquireSingleInstanceLock();
  await startLiveBridgeServer();
  refreshSettingsSnapshot();
  rebuildBundleIfNeeded();
  daemonReady = true;
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

main().catch((err) => {
  appendLog('ERROR', `Fatal daemon error: ${err?.stack || err?.message || String(err)}`);
  process.exit(1);
});
