#!/usr/bin/env node
/**
 * Safe offline storage audit & move-only archiver for Antigravity user data.
 *
 * Safety boundaries:
 * - Read-only stat for conversations/*.db (NEVER opens SQLite handles or modifies live DBs).
 * - Never touches Cookies, Local Storage, IndexedDB, Preferences, or active today's brain artifacts.
 * - Archive mode is strictly MOVE-ONLY with manifest.json for 100% lossless --restore.
 * - Refuses symlinks to prevent traversal outside ~/.gemini/antigravity.
 *
 * Usage:
 *   node scripts/storage-maintenance.mjs --status
 *   node scripts/storage-maintenance.mjs --archive [--older-than-days 3] [--dry-run]
 *   node scripts/storage-maintenance.mjs --list
 *   node scripts/storage-maintenance.mjs --restore <batch-id>
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGoMemLimitStatus } from './go-mem-limit.mjs';

const HOME = os.homedir();
const AG_ROOT = path.join(HOME, '.gemini', 'antigravity');
const BRAIN_DIR = path.join(AG_ROOT, 'brain');
const CONV_DIR = path.join(AG_ROOT, 'conversations');
const ARCHIVE_ROOT = path.join(AG_ROOT, 'backups', 'suite-archive');

const APPDATA_AG =
  process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'), 'Antigravity')
    : process.platform === 'darwin'
    ? path.join(HOME, 'Library', 'Application Support', 'Antigravity')
    : path.join(process.env.XDG_CONFIG_HOME || path.join(HOME, '.config'), 'Antigravity');

const WARN_BRAIN_MB = 1500;
const WARN_CONV_MB = 1536;
const WARN_CACHE_MB = 512;

function toMB(bytes) {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

function safeStatDir(dirPath) {
  let bytes = 0;
  let files = 0;
  let newestMs = 0;
  if (!fs.existsSync(dirPath)) return { bytes: 0, files: 0, newestMs: 0 };
  const stack = [dirPath];
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.isSymbolicLink()) continue;
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (ent.isFile()) {
        try {
          const st = fs.lstatSync(full);
          if (st.isSymbolicLink()) continue;
          bytes += st.size;
          files += 1;
          if (st.mtimeMs > newestMs) newestMs = st.mtimeMs;
        } catch {}
      }
    }
  }
  return { bytes, files, newestMs };
}

function isInsideDir(parent, candidate) {
  const rel = path.relative(path.resolve(parent), path.resolve(candidate));
  return Boolean(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function collectArchivableCandidates(olderThanDays) {
  const cutoffMs = Date.now() - Math.max(1, olderThanDays) * 86400 * 1000;
  const candidates = [];

  if (fs.existsSync(BRAIN_DIR)) {
    for (const ent of fs.readdirSync(BRAIN_DIR, { withFileTypes: true })) {
      if (!ent.isDirectory() || ent.isSymbolicLink()) continue;
      const convBrainDir = path.join(BRAIN_DIR, ent.name);
      const subTargets = [
        { rel: path.join('.system_generated', 'logs'), kind: 'brain-logs' },
        { rel: path.join('.system_generated', 'steps'), kind: 'brain-steps' },
        { rel: path.join('.system_generated', 'tasks'), kind: 'brain-tasks' },
        { rel: 'browser_sandbox', kind: 'browser-sandbox' }
      ];
      for (const sub of subTargets) {
        const abs = path.join(convBrainDir, sub.rel);
        if (!fs.existsSync(abs)) continue;
        try {
          if (fs.lstatSync(abs).isSymbolicLink()) continue;
        } catch {
          continue;
        }
        const info = safeStatDir(abs);
        if (info.bytes > 0 && info.newestMs > 0 && info.newestMs < cutoffMs) {
          candidates.push({
            kind: sub.kind,
            source: abs,
            relFromAgRoot: path.relative(AG_ROOT, abs),
            bytes: info.bytes,
            files: info.files,
            lastModified: new Date(info.newestMs).toISOString()
          });
        }
      }
    }
  }

  // Orphan pricing ledger .bak / .tmp files at AG_ROOT (never touches live pricing_ledger_v1.json)
  if (fs.existsSync(AG_ROOT)) {
    for (const ent of fs.readdirSync(AG_ROOT, { withFileTypes: true })) {
      if (!ent.isFile() || ent.isSymbolicLink()) continue;
      if (!/^pricing_ledger_v1.*\.(bak|tmp)/i.test(ent.name)) continue;
      const abs = path.join(AG_ROOT, ent.name);
      try {
        const st = fs.lstatSync(abs);
        if (st.mtimeMs < cutoffMs) {
          candidates.push({
            kind: 'orphan-ledger-backup',
            source: abs,
            relFromAgRoot: path.relative(AG_ROOT, abs),
            bytes: st.size,
            files: 1,
            lastModified: new Date(st.mtimeMs).toISOString()
          });
        }
      } catch {}
    }
  }

  candidates.sort((a, b) => b.bytes - a.bytes);
  return candidates;
}

function scanChromiumCaches() {
  const cacheDirs = ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache'];
  let totalBytes = 0;
  const breakdown = {};
  for (const name of cacheDirs) {
    const info = safeStatDir(path.join(APPDATA_AG, name));
    if (info.bytes > 0) {
      breakdown[name] = toMB(info.bytes);
      totalBytes += info.bytes;
    }
  }
  const partitionsDir = path.join(APPDATA_AG, 'Partitions');
  if (fs.existsSync(partitionsDir)) {
    let partCacheBytes = 0;
    try {
      for (const ent of fs.readdirSync(partitionsDir, { withFileTypes: true })) {
        if (!ent.isDirectory() || ent.isSymbolicLink()) continue;
        for (const name of cacheDirs) {
          partCacheBytes += safeStatDir(path.join(partitionsDir, ent.name, name)).bytes;
        }
      }
    } catch {}
    if (partCacheBytes > 0) {
      breakdown['Partitions/*/Cache'] = toMB(partCacheBytes);
      totalBytes += partCacheBytes;
    }
  }
  return { totalMB: toMB(totalBytes), breakdown };
}

function runStatus(olderThanDays = 3) {
  const convStat = safeStatDir(CONV_DIR);
  const brainStat = safeStatDir(BRAIN_DIR);
  const archiveStat = safeStatDir(ARCHIVE_ROOT);
  const caches = scanChromiumCaches();
  const candidates = collectArchivableCandidates(olderThanDays);
  const reclaimableBytes = candidates.reduce((s, c) => s + c.bytes, 0);
  const goMem = getGoMemLimitStatus();

  const recommendations = [];
  if (toMB(reclaimableBytes) >= 200) {
    recommendations.push(
      `Found ${toMB(reclaimableBytes)} MB of stale brain logs/sandbox/backups older than ${olderThanDays}d; run: node scripts/storage-maintenance.mjs --archive --older-than-days ${olderThanDays}`
    );
  }
  if (toMB(convStat.bytes) >= WARN_CONV_MB) {
    recommendations.push(
      `conversations/ is ${toMB(convStat.bytes)} MB (>= ${WARN_CONV_MB} MB); consider cleaning old unused conversations inside Antigravity.`
    );
  }
  if (caches.totalMB >= WARN_CACHE_MB) {
    recommendations.push(
      `Antigravity Chromium caches are ${caches.totalMB} MB (>= ${WARN_CACHE_MB} MB); safe to clear Cache/GPUCache/Code Cache when Antigravity is closed.`
    );
  }
  if (!goMem.configured) {
    recommendations.push(
      `User-level GOMEMLIMIT is not configured; recommended: node scripts/go-mem-limit.mjs --set ${goMem.recommendedValue}`
    );
  }

  return {
    ok: true,
    mode: 'status',
    paths: {
      antigravityDataRoot: AG_ROOT,
      conversationsDir: CONV_DIR,
      brainDir: BRAIN_DIR,
      archiveRoot: ARCHIVE_ROOT
    },
    sizesMB: {
      conversations: toMB(convStat.bytes),
      brain: toMB(brainStat.bytes),
      chromiumCaches: caches.totalMB,
      existingArchives: toMB(archiveStat.bytes),
      archivableOlderThanDays: toMB(reclaimableBytes)
    },
    counts: {
      conversationFiles: convStat.files,
      brainFiles: brainStat.files,
      archivableEntries: candidates.length
    },
    chromiumCacheBreakdownMB: caches.breakdown,
    goMemLimit: goMem,
    healthy: toMB(brainStat.bytes) < WARN_BRAIN_MB && toMB(convStat.bytes) < WARN_CONV_MB && caches.totalMB < WARN_CACHE_MB,
    recommendations
  };
}

function moveSafe(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try {
    fs.renameSync(src, dst);
  } catch (err) {
    if (err && err.code === 'EXDEV') {
      fs.cpSync(src, dst, { recursive: true, preserveTimestamps: true });
      fs.rmSync(src, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}

function runArchive(olderThanDays, dryRun) {
  const candidates = collectArchivableCandidates(olderThanDays);
  const totalBytes = candidates.reduce((s, c) => s + c.bytes, 0);
  if (dryRun || candidates.length === 0) {
    return {
      ok: true,
      mode: dryRun ? 'archive-dry-run' : 'archive',
      olderThanDays,
      movedCount: 0,
      candidateCount: candidates.length,
      reclaimableMB: toMB(totalBytes),
      topCandidates: candidates.slice(0, 15).map((c) => ({
        kind: c.kind,
        rel: c.relFromAgRoot,
        sizeMB: toMB(c.bytes),
        lastModified: c.lastModified
      }))
    };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const batchId = `batch-${stamp}`;
  const batchDir = path.join(ARCHIVE_ROOT, batchId);
  const payloadDir = path.join(batchDir, 'payload');
  fs.mkdirSync(payloadDir, { recursive: true });

  const moved = [];
  const skipped = [];
  for (const item of candidates) {
    if (!isInsideDir(AG_ROOT, item.source)) {
      skipped.push({ rel: item.relFromAgRoot, reason: 'outside_root' });
      continue;
    }
    const dest = path.join(payloadDir, item.relFromAgRoot);
    try {
      moveSafe(item.source, dest);
      moved.push({
        kind: item.kind,
        source: item.source,
        relFromAgRoot: item.relFromAgRoot,
        bytes: item.bytes,
        files: item.files
      });
    } catch (err) {
      skipped.push({ rel: item.relFromAgRoot, reason: err?.code || err?.message || 'move_failed' });
    }
  }

  const manifest = {
    batchId,
    createdAt: new Date().toISOString(),
    olderThanDays,
    movedCount: moved.length,
    movedBytes: moved.reduce((s, m) => s + m.bytes, 0),
    moved,
    skipped
  };
  fs.writeFileSync(path.join(batchDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  return {
    ok: true,
    mode: 'archive',
    batchId,
    batchDir,
    movedCount: moved.length,
    movedMB: toMB(manifest.movedBytes),
    skippedCount: skipped.length,
    restoreCommand: `node scripts/storage-maintenance.mjs --restore ${batchId}`
  };
}

function runList() {
  if (!fs.existsSync(ARCHIVE_ROOT)) return { ok: true, mode: 'list', batches: [] };
  const batches = [];
  for (const ent of fs.readdirSync(ARCHIVE_ROOT, { withFileTypes: true })) {
    if (!ent.isDirectory() || ent.isSymbolicLink()) continue;
    const mPath = path.join(ARCHIVE_ROOT, ent.name, 'manifest.json');
    if (!fs.existsSync(mPath)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(mPath, 'utf8'));
      batches.push({
        batchId: m.batchId || ent.name,
        createdAt: m.createdAt,
        movedCount: m.movedCount,
        movedMB: toMB(m.movedBytes || 0)
      });
    } catch {}
  }
  batches.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return { ok: true, mode: 'list', batches };
}

function runRestore(batchId) {
  if (!batchId || !/^batch-[0-9T-]+$/i.test(batchId)) {
    return { ok: false, error: `Invalid batch id: ${batchId}` };
  }
  const batchDir = path.join(ARCHIVE_ROOT, batchId);
  const manifestPath = path.join(batchDir, 'manifest.json');
  const payloadDir = path.join(batchDir, 'payload');
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, error: `Archive batch not found: ${batchId}` };
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  let restored = 0;
  const conflicts = [];
  for (const item of manifest.moved || []) {
    const src = path.join(payloadDir, item.relFromAgRoot);
    const dst = path.join(AG_ROOT, item.relFromAgRoot);
    if (!isInsideDir(AG_ROOT, dst) || !fs.existsSync(src)) continue;
    if (fs.existsSync(dst)) {
      conflicts.push(item.relFromAgRoot);
      continue;
    }
    moveSafe(src, dst);
    restored += 1;
  }
  return { ok: conflicts.length === 0, mode: 'restore', batchId, restoredCount: restored, conflicts };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const daysIdx = args.indexOf('--older-than-days');
  const olderThanDays = daysIdx !== -1 && Number.isFinite(Number(args[daysIdx + 1])) ? Number(args[daysIdx + 1]) : 3;
  const dryRun = args.includes('--dry-run');
  const restoreIdx = args.indexOf('--restore');

  let result;
  if (restoreIdx !== -1) {
    result = runRestore(args[restoreIdx + 1]);
  } else if (args.includes('--list')) {
    result = runList();
  } else if (args.includes('--archive')) {
    result = runArchive(olderThanDays, dryRun);
  } else {
    result = runStatus(olderThanDays);
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}
