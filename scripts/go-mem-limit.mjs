#!/usr/bin/env node
/**
 * Cross-platform user-level GOMEMLIMIT helper for antigravity-chuanban-context-suite.
 *
 * Safety boundaries:
 * - Only manages the standard OS user-level GOMEMLIMIT environment variable (Go 1.19+ soft memory limit).
 * - Never modifies Antigravity binaries/app.asar or force-kills running processes.
 * - Strict preset allowlist prevents injection; changes apply after restarting Antigravity and are 1-command reversible.
 *
 * Usage:
 *   node scripts/go-mem-limit.mjs --status
 *   node scripts/go-mem-limit.mjs --set 2GiB
 *   node scripts/go-mem-limit.mjs --unset
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ALLOWED_PRESETS = Object.freeze(['1536MiB', '2GiB', '2500MiB', '3GiB', '4GiB']);
export const RECOMMENDED_VALUE = '2GiB';
const VALUE_RE = /^(?:1536MiB|2GiB|2500MiB|3GiB|4GiB)$/;
const WIN_REG_KEY = 'HKCU\\Environment';
const MAC_LABEL = 'com.antigravity-suite.gomemlimit';

export function isValidGoMemLimit(raw) {
  return typeof raw === 'string' && VALUE_RE.test(raw.trim());
}

function getMacPlistPath(home = os.homedir()) {
  return path.join(home, 'Library', 'LaunchAgents', `${MAC_LABEL}.plist`);
}

function getLinuxEnvFilePath(home = os.homedir()) {
  const xdg = process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME.trim()
    ? process.env.XDG_CONFIG_HOME.trim()
    : path.join(home, '.config');
  return path.join(xdg, 'environment.d', '90-ag-suite-gomemlimit.conf');
}

function writeAtomicPrivate(targetPath, text) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${targetPath}.tmp.${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, targetPath);
}

function parseRegValue(stdout) {
  const re = /^\s*GOMEMLIMIT\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/im;
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const m = re.exec(line);
    if (m && m[1]) return m[1].trim();
  }
  return '';
}

export function getGoMemLimitStatus() {
  const processValue = String(process.env.GOMEMLIMIT || '').trim();
  let configuredValue = '';
  let source = 'none';

  if (process.platform === 'win32') {
    const res = spawnSync('reg.exe', ['query', WIN_REG_KEY, '/v', 'GOMEMLIMIT'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000
    });
    if (res.status === 0) {
      configuredValue = parseRegValue(res.stdout);
      if (configuredValue) source = 'hkcu-environment';
    }
  } else if (process.platform === 'darwin') {
    const res = spawnSync('/bin/launchctl', ['getenv', 'GOMEMLIMIT'], { encoding: 'utf8', timeout: 4000 });
    if (res.status === 0 && String(res.stdout || '').trim()) {
      configuredValue = String(res.stdout).trim();
      source = 'launchctl';
    } else {
      const plist = getMacPlistPath();
      if (fs.existsSync(plist)) {
        const xml = fs.readFileSync(plist, 'utf8');
        const m = /<string>GOMEMLIMIT<\/string>\s*<string>([^<]+)<\/string>/i.exec(xml);
        if (m && m[1]) {
          configuredValue = m[1].trim();
          source = 'launchagent-plist';
        }
      }
    }
  } else {
    const envFile = getLinuxEnvFilePath();
    if (fs.existsSync(envFile)) {
      const m = /^\s*GOMEMLIMIT\s*=\s*([^\s#]+)\s*$/m.exec(fs.readFileSync(envFile, 'utf8'));
      if (m && m[1]) {
        configuredValue = m[1].trim();
        source = 'systemd-environment-d';
      }
    }
  }

  return {
    ok: true,
    platform: process.platform,
    configured: Boolean(configuredValue),
    configuredValue: configuredValue || null,
    processValue: processValue || null,
    source,
    restartRequired: Boolean(configuredValue && configuredValue !== processValue),
    recommendedValue: RECOMMENDED_VALUE,
    allowedPresets: [...ALLOWED_PRESETS]
  };
}

export function setGoMemLimit(rawValue) {
  const val = String(rawValue || '').trim();
  if (!isValidGoMemLimit(val)) {
    return {
      ok: false,
      error: `Invalid GOMEMLIMIT value "${val}". Allowed presets: ${ALLOWED_PRESETS.join(', ')}`
    };
  }

  if (process.platform === 'win32') {
    // setx writes HKCU\Environment and broadcasts WM_SETTINGCHANGE natively without PowerShell/WMI
    const res = spawnSync('setx.exe', ['GOMEMLIMIT', val], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8000
    });
    if (res.status !== 0) {
      return { ok: false, error: (res.stderr || res.stdout || `setx failed (${res.status})`).trim() };
    }
  } else if (process.platform === 'darwin') {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${MAC_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/launchctl</string>
    <string>setenv</string>
    <string>GOMEMLIMIT</string>
    <string>${val}</string>
  </array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
`;
    writeAtomicPrivate(getMacPlistPath(), plist);
    spawnSync('/bin/launchctl', ['setenv', 'GOMEMLIMIT', val], { timeout: 4000 });
  } else {
    writeAtomicPrivate(getLinuxEnvFilePath(), `GOMEMLIMIT=${val}\n`);
  }

  return {
    ...getGoMemLimitStatus(),
    action: 'set',
    note: 'Restart Antigravity once so Go language_server inherits the updated GOMEMLIMIT.'
  };
}

export function unsetGoMemLimit() {
  if (process.platform === 'win32') {
    const res = spawnSync('reg.exe', ['delete', WIN_REG_KEY, '/v', 'GOMEMLIMIT', '/f'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000
    });
    if (res.status !== 0 && !/unable to find|not found|找不到/i.test(`${res.stderr}${res.stdout}`)) {
      return { ok: false, error: (res.stderr || res.stdout || `reg delete failed (${res.status})`).trim() };
    }
  } else if (process.platform === 'darwin') {
    const plist = getMacPlistPath();
    if (fs.existsSync(plist)) fs.unlinkSync(plist);
    spawnSync('/bin/launchctl', ['unsetenv', 'GOMEMLIMIT'], { timeout: 4000 });
  } else {
    const envFile = getLinuxEnvFilePath();
    if (fs.existsSync(envFile)) fs.unlinkSync(envFile);
  }

  return {
    ...getGoMemLimitStatus(),
    action: 'unset',
    note: 'GOMEMLIMIT removed from user environment; restart Antigravity to restore default Go GC behavior.'
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const setIdx = args.indexOf('--set');
  let out;
  if (setIdx !== -1 && args[setIdx + 1]) {
    out = setGoMemLimit(args[setIdx + 1]);
  } else if (args.includes('--unset')) {
    out = unsetGoMemLimit();
  } else {
    out = getGoMemLimitStatus();
  }
  console.log(JSON.stringify(out, null, 2));
  if (!out.ok) process.exit(1);
}
