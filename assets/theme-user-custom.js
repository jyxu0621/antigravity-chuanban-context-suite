/**
 * user/custom.js — 船板 v6.0.2 + ContextViewer v0.8.10 协同扩展
 * 1. 底部输入框胶囊（DSH Harness 风格）：在 metricsMode="full" 时格式化船板原生 #ag-live-metrics-pill 为
 *    `入 <used>/<limit> (<pct>%) · 出 <out> · <tps> tok/s · 首字 <ttft>`（保留原生悬停详情卡）；
 *    若用户切至 v6.0.2 compact 圆环模式（ag-ctx-ring）则无损透传原生紧凑胶囊
 * 2. 右上角 ContextViewer (#ag-context-meter) 最高层叠与原生 WebContentsView 穿透避让
 *    （弹窗打开时提权至 z-index: 2147483500 并通知 wcvBrowser.setPortalOverlayOpen，关闭时无损恢复）
 */

(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.location && window.location.protocol === 'plugin:') return;

  // 防御性清理可能残留的旧版自定义顶栏元素
  for (const staleId of ['ag-topbar-telemetry', 'ag-topbar-telemetry-popover', 'ag-topbar-telemetry-style']) {
    try {
      const node = document.getElementById(staleId);
      if (node) node.remove();
    } catch {}
  }

  // =========================================================================
  // 1. 底部胶囊 DSH Harness 风格格式化（纯事件驱动，零额外轮询）
  // =========================================================================
  function parseMetricsPayload(payload) {
    if (!payload || !payload.hasData) return null;
    const inlineHtml = String(payload.__agRawInlineHtml || payload.inlineHtml || '');
    const tmp = document.createElement('div');
    tmp.innerHTML = inlineHtml;
    const plain = (tmp.textContent || '').replace(/\s+/g, ' ').trim();

    const tpsMatch = plain.match(/(\d+(?:\.\d+)?)\s*tok\/s/i);
    const ttftMatch = plain.match(/\b(TTFT|Hold)\s+([0-9.]+s)/i);
    const ctxMatch = plain.match(/Ctx\s+([0-9.]+[kKmM]?)\s*\/\s*([0-9.]+[kKmM]?)\s*\((\d+)%\)/i);
    const outMatch = plain.match(/\bOut\s+([0-9.]+[kKmM]?)/i);
    const subMatch = plain.match(/(\+\d+\s*sub)/i);

    let ctxClass = 'ag-ctx-ok';
    if (inlineHtml.includes('ag-ctx-crit')) ctxClass = 'ag-ctx-crit';
    else if (inlineHtml.includes('ag-ctx-warn')) ctxClass = 'ag-ctx-warn';

    const pct = ctxMatch ? Math.max(0, Math.min(100, parseInt(ctxMatch[3], 10) || 0)) : null;
    return {
      tps: tpsMatch ? tpsMatch[1] : null,
      ttftKind: ttftMatch ? ttftMatch[1] : null,
      ttftVal: ttftMatch ? ttftMatch[2] : null,
      ctxUsed: ctxMatch ? ctxMatch[1] : null,
      ctxLimit: ctxMatch ? ctxMatch[2] : null,
      ctxPct: pct,
      ctxClass,
      outTok: outMatch ? outMatch[1] : null,
      subBadge: subMatch ? subMatch[1] : null
    };
  }

  function buildDshBottomInlineHtml(parsed, fallbackHtml) {
    if (!parsed || (!parsed.ctxUsed && !parsed.tps && !parsed.outTok)) return fallbackHtml || '';
    const parts = [];
    if (parsed.ctxUsed && parsed.ctxLimit && parsed.ctxPct !== null) {
      parts.push(
        `<span>入 ${parsed.ctxUsed}/${parsed.ctxLimit} <span class="${parsed.ctxClass}">(${parsed.ctxPct}%)</span></span>`
      );
    }
    if (parsed.outTok) {
      parts.push(`<span>出 ${parsed.outTok}</span>`);
    }
    if (parsed.tps) {
      parts.push(`<span>${parsed.tps} tok/s</span>`);
    }
    if (parsed.ttftVal) {
      const lbl = parsed.ttftKind && parsed.ttftKind.toLowerCase() === 'hold' ? '等待' : '首字';
      parts.push(`<span>${lbl} ${parsed.ttftVal}</span>`);
    }
    if (parsed.subBadge) {
      parts.push(`<span class="ag-sub-badge">${parsed.subBadge}</span>`);
    }
    return parts.join('<span class="ag-sep">·</span>');
  }

  function transformPayloadForBottom(payload) {
    if (!payload || !payload.hasData || !payload.inlineHtml) return payload;
    if (payload.__agDshFormatted) return payload;
    // 兼容船板 v6.0.0+ compact 紧凑圆环模式：含 ag-ctx-ring 且不含 Ctx 时直接透传原生紧凑胶囊
    if (String(payload.inlineHtml).includes('ag-ctx-ring') && !/\bCtx\b/i.test(String(payload.inlineHtml))) {
      return payload;
    }
    const parsed = parseMetricsPayload(payload);
    if (!parsed) return payload;
    return Object.assign({}, payload, {
      __agDshFormatted: true,
      __agRawInlineHtml: payload.inlineHtml,
      inlineHtml: buildDshBottomInlineHtml(parsed, payload.inlineHtml)
    });
  }

  const origRenderMetrics = typeof window.__ag_render_metrics === 'function' ? window.__ag_render_metrics : null;
  const wrappedRenderMetrics = function (payload) {
    const transformed = transformPayloadForBottom(payload);
    if (origRenderMetrics) {
      origRenderMetrics.call(this, transformed);
    }
  };
  if (origRenderMetrics) {
    window.__ag_render_metrics = wrappedRenderMetrics;
  }

  function refreshExistingBottomPills() {
    try {
      const byId = window.__ag_metrics_by_id;
      if (byId && typeof byId === 'object') {
        for (const k of Object.keys(byId)) {
          if (byId[k] && byId[k].hasData && !byId[k].__agDshFormatted) {
            byId[k] = transformPayloadForBottom(byId[k]);
          }
        }
      }
      if (window.__ag_last_metrics && window.__ag_last_metrics.hasData && !window.__ag_last_metrics.__agDshFormatted) {
        window.__ag_last_metrics = transformPayloadForBottom(window.__ag_last_metrics);
      }
      document.querySelectorAll('#ag-live-metrics-pill, .ag-live-metrics-pill').forEach((pill) => {
        const cid = String(pill.getAttribute('data-ag-cascade-id') || '').trim().toLowerCase();
        const textEl = pill.querySelector('.ag-live-metrics-text, #ag-live-metrics-text') || pill;
        const p = (byId && cid && byId[cid]) || null;
        if (p && p.hasData && p.inlineHtml && textEl && textEl.innerHTML !== p.inlineHtml) {
          textEl.innerHTML = p.inlineHtml;
        }
      });
    } catch {}
  }

  refreshExistingBottomPills();

  // =========================================================================
  // 2. ContextViewer (#ag-context-meter) 弹窗最高层叠与原生浏览器视图穿透避让
  // =========================================================================
  try {
    if (typeof window.__agMeterPriorityCleanup === 'function') {
      window.__agMeterPriorityCleanup();
    }
  } catch {}

  const METER_ID = 'ag-context-meter';
  const HIDDEN_POPUP_IDS = [
    'panel',
    'panel-tokens',
    'panel-quota',
    'overflow-menu',
    'color-picker-popover',
    'cli-launch-toast',
    'global-restart-modal',
    'account-remove-modal'
  ];
  const DISPLAY_POPUP_IDS = ['update-popover', 'valid-end-popover'];
  const VISIBLE_ATTR_POPUP_IDS = ['context-tooltip'];
  const ALL_POPUP_IDS = [
    ...HIDDEN_POPUP_IDS,
    ...DISPLAY_POPUP_IDS,
    ...VISIBLE_ATTR_POPUP_IDS
  ];

  let disposed = false;
  let boundMeter = null;
  let shadowObserver = null;
  let hostParentObserver = null;
  let attachTimer = null;
  let reconnectTimer = null;
  let elevated = false;
  let savedAncestors = [];
  let savedMeterOpaqueClass = false;
  let portalClaimed = false;
  let unsubZOrder = null;
  let reassertTimestamps = [];

  function isElementVisiblePopup(el, id) {
    if (!el || !el.isConnected) return false;
    if (VISIBLE_ATTR_POPUP_IDS.includes(id)) {
      return el.getAttribute('data-visible') === 'true';
    }
    if (DISPLAY_POPUP_IDS.includes(id)) {
      if (el.hidden) return false;
      const inlineDisplay = el.style.display;
      return Boolean(inlineDisplay ? inlineDisplay !== 'none' : getComputedStyle(el).display !== 'none');
    }
    return !el.hasAttribute('hidden') && el.style.display !== 'none';
  }

  function isAnyPopupOpen(meter) {
    const sr = meter?.shadowRoot;
    if (!sr) return false;
    for (const id of ALL_POPUP_IDS) {
      if (isElementVisiblePopup(sr.getElementById(id), id)) return true;
    }
    return false;
  }

  function createsStackingContext(el, cs) {
    if (el === boundMeter) return true;
    if (cs.zIndex !== 'auto') return true;
    if (cs.containerType && cs.containerType !== 'normal') return true;
    if (cs.isolation && cs.isolation !== 'auto') return true;
    if (cs.transform && cs.transform !== 'none') return true;
    if (cs.filter && cs.filter !== 'none') return true;
    if (cs.backdropFilter && cs.backdropFilter !== 'none') return true;
    if (cs.opacity && cs.opacity !== '1') return true;
    if (cs.perspective && cs.perspective !== 'none') return true;
    if (cs.contain && cs.contain !== 'none' && cs.contain !== 'style') return true;
    return false;
  }

  function restoreAncestors() {
    for (let i = savedAncestors.length - 1; i >= 0; i--) {
      const item = savedAncestors[i];
      if (!item.el?.style) continue;
      if (!item.posVal) {
        item.el.style.removeProperty('position');
      } else {
        item.el.style.setProperty('position', item.posVal, item.posPri || '');
      }
      if (item.clearZOnRestore || !item.zVal) {
        item.el.style.removeProperty('z-index');
      } else {
        item.el.style.setProperty('z-index', item.zVal, item.zPri || '');
      }
    }
    savedAncestors = [];
    if (boundMeter && !savedMeterOpaqueClass) {
      boundMeter.classList.remove('browser-hole-opaque');
    }
    savedMeterOpaqueClass = false;
  }

  function elevateAncestors(meter) {
    restoreAncestors();
    const list = [];
    let cur = meter;
    let depth = 0;
    while (cur && cur.nodeType === 1 && cur !== document.body && cur !== document.documentElement) {
      const cs = getComputedStyle(cur);
      if (createsStackingContext(cur, cs)) {
        const inlineZ = cur.style.getPropertyValue('z-index');
        const inlineZPri = cur.style.getPropertyPriority('z-index');
        const isZ0Sheet = cur.classList?.contains('z-0') && inlineZ === '40';
        list.push({
          el: cur,
          posVal: cur.style.getPropertyValue('position'),
          posPri: cur.style.getPropertyPriority('position'),
          zVal: inlineZ,
          zPri: inlineZPri,
          clearZOnRestore: cur === meter ? !inlineZ : isZ0Sheet
        });
        if (cs.position === 'static') {
          cur.style.setProperty('position', 'relative', 'important');
        }
        cur.style.setProperty('z-index', String(2147483500 - depth * 10), 'important');
        depth += 1;
      }
      cur = cur.parentElement;
    }
    savedAncestors = list;
    savedMeterOpaqueClass = meter.classList.contains('browser-hole-opaque');
    meter.classList.add('browser-hole-opaque');
  }

  function hasHostReactPortalOpen() {
    return Boolean(
      document.querySelector(
        '[data-radix-portal] [role="dialog"], [data-radix-portal] [role="menu"], [data-radix-popper-content-wrapper]'
      )
    );
  }

  function syncNativeBrowserLayer(active) {
    const wcv = window.electronNative?.wcvBrowser;
    if (!wcv || typeof wcv.setPortalOverlayOpen !== 'function') return;

    if (active) {
      portalClaimed = true;
      void Promise.resolve(wcv.setPortalOverlayOpen(true)).catch(() => {});
      if (!unsubZOrder && typeof wcv.onZOrderChanged === 'function') {
        try {
          unsubZOrder = wcv.onZOrderChanged((payload) => {
            if (disposed || !elevated || !payload || payload.zOrder !== 1) return;
            const now = Date.now();
            reassertTimestamps = reassertTimestamps.filter((ts) => now - ts < 1000);
            if (reassertTimestamps.length >= 6) return;
            reassertTimestamps.push(now);
            queueMicrotask(() => {
              if (!disposed && elevated) {
                void Promise.resolve(wcv.setPortalOverlayOpen(true)).catch(() => {});
              }
            });
          });
        } catch {}
      }
      return;
    }

    if (unsubZOrder) {
      try {
        unsubZOrder();
      } catch {}
      unsubZOrder = null;
    }
    reassertTimestamps = [];
    if (portalClaimed) {
      portalClaimed = false;
      if (!hasHostReactPortalOpen()) {
        void Promise.resolve(wcv.setPortalOverlayOpen(false)).catch(() => {});
      }
    }
  }

  function syncPriority() {
    if (disposed) return;
    if (!boundMeter || !boundMeter.isConnected) {
      if (elevated) {
        elevated = false;
        restoreAncestors();
        syncNativeBrowserLayer(false);
      }
      return;
    }
    const shouldElevate = isAnyPopupOpen(boundMeter);
    if (shouldElevate && elevated && boundMeter.style.getPropertyValue('z-index') !== '2147483500') {
      elevateAncestors(boundMeter);
      return;
    }
    if (shouldElevate === elevated) return;
    elevated = shouldElevate;
    if (shouldElevate) {
      elevateAncestors(boundMeter);
      syncNativeBrowserLayer(true);
    } else {
      restoreAncestors();
      syncNativeBrowserLayer(false);
    }
  }

  function detachMeter() {
    if (hostParentObserver) {
      try {
        hostParentObserver.disconnect();
      } catch {}
      hostParentObserver = null;
    }
    if (shadowObserver) {
      try {
        shadowObserver.disconnect();
      } catch {}
      shadowObserver = null;
    }
    if (elevated) {
      elevated = false;
      restoreAncestors();
      syncNativeBrowserLayer(false);
    }
    boundMeter = null;
  }

  function observeHostParent(meter) {
    if (hostParentObserver) {
      try {
        hostParentObserver.disconnect();
      } catch {}
      hostParentObserver = null;
    }
    const parent = meter?.parentElement;
    if (!parent) return;
    const pObs = new MutationObserver(() => {
      if (disposed) return;
      if (!boundMeter || !boundMeter.isConnected || document.getElementById(METER_ID) !== boundMeter) {
        ensureBound();
      }
    });
    pObs.observe(parent, { childList: true });
    hostParentObserver = pObs;
  }

  function bindMeter(meter) {
    if (disposed || !meter || !meter.shadowRoot || meter === boundMeter) return false;
    detachMeter();
    boundMeter = meter;
    observeHostParent(meter);
    const obs = new MutationObserver(() => {
      syncPriority();
    });
    for (const id of ALL_POPUP_IDS) {
      const target = meter.shadowRoot.getElementById(id);
      if (target) {
        obs.observe(target, {
          attributes: true,
          attributeFilter: ['hidden', 'style', 'data-visible']
        });
      }
    }
    shadowObserver = obs;
    syncPriority();
    return true;
  }

  function scheduleBindAttempt(delayMs) {
    if (disposed || attachTimer) return;
    attachTimer = setTimeout(() => {
      attachTimer = null;
      if (disposed) return;
      const meter = document.getElementById(METER_ID);
      if (!bindMeter(meter)) {
        scheduleBindAttempt(Math.min(Math.round(delayMs * 1.5), 2500));
      }
    }, delayMs);
  }

  function ensureBound() {
    if (disposed) return;
    const liveMeter = document.getElementById(METER_ID);
    if (boundMeter && boundMeter.isConnected && boundMeter.shadowRoot && (!liveMeter || liveMeter === boundMeter)) {
      return;
    }
    if (!bindMeter(liveMeter)) {
      if (boundMeter && !boundMeter.isConnected) detachMeter();
      scheduleBindAttempt(250);
    }
  }

  function onDocInteraction(ev) {
    if (disposed) return;
    const target = ev?.target;
    if (target && target.id === METER_ID) {
      ensureBound();
      queueMicrotask(syncPriority);
    }
  }

  function cleanup() {
    if (disposed) return;
    disposed = true;
    if (origRenderMetrics && window.__ag_render_metrics === wrappedRenderMetrics) {
      window.__ag_render_metrics = origRenderMetrics;
    }
    if (attachTimer) {
      clearTimeout(attachTimer);
      attachTimer = null;
    }
    if (reconnectTimer) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
    }
    document.removeEventListener('pointerdown', onDocInteraction, true);
    document.removeEventListener('click', onDocInteraction, true);
    detachMeter();
    if (window.__agMeterPriorityCleanup === cleanup) {
      delete window.__agMeterPriorityCleanup;
    }
  }

  window.__agMeterPriorityCleanup = cleanup;
  if (typeof ctx !== 'undefined' && typeof ctx?.onCleanup === 'function') {
    ctx.onCleanup(cleanup);
  } else if (typeof boot !== 'undefined' && typeof boot?.onCleanup === 'function') {
    boot.onCleanup(cleanup);
  }

  document.addEventListener('pointerdown', onDocInteraction, true);
  document.addEventListener('click', onDocInteraction, true);
  ensureBound();
  reconnectTimer = setInterval(() => {
    if (!boundMeter || !boundMeter.isConnected) ensureBound();
  }, 15000);
})();

// =========================================================================
// 3. 工作台高频效率增强 + 裸链接/路径高亮 + Omni 超大文件流式检视台
//    （净室纯 DOM API · 零 innerHTML · 零轮询 · 与船板 v6.0.7 右键菜单无缝协同零冲突）
//    3A. Alt+↑ / Alt+↓ 对话轮次跳转（非编辑焦点生效）
//    3B. 长代码块（>= 48 行）手动折叠/展开（绝不自动截断，流式生成期自动避让）
//    3C. CSS.highlights 零 DOM 篡改裸链接/裸本地路径高亮 + Ctrl/Cmd+点击直达
//    3D. 船板右键菜单无缝协同增强（Omni 流式预览 / @引用 / 裸链接 / 紧凑斜杠指令栏）
//    3E. Omni 超大文件流式检视台（206 Range 视频/音频/图片缩放/PDF/CSV表格/字体/分片文本）
// =========================================================================
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.location && window.location.protocol === 'plugin:') return;

  try {
    if (typeof window.__agSuiteWorkbenchCleanup === 'function') {
      window.__agSuiteWorkbenchCleanup();
    }
  } catch {}

  // 共存礼让：若检测到第三方工作台菜单/增强插件已接管，自动礼让跳过
  if (document.getElementById('ag-prism-overlay-portal') || document.querySelector('.ag-cs-ctx-menu')) {
    return;
  }

  const CONV_SEL = '[data-testid="conversation-view"]';
  const TURN_SEL = '[data-testid="user-input-step"]';
  const INPUT_BOX_SEL = '[data-testid="agent-input-box"]';
  const STREAMING_SEL = '[data-testid="input-cancel-button"]';
  const CHUANBAN_MENU_ID = 'ag-custom-context-menu';
  const EDITABLE_SEL =
    'input, textarea, select, [contenteditable="true"], [role="textbox"], .monaco-editor, .cm-editor';
  const MIN_FOLD_LINES = 48;
  const BARE_LINK_HL_NAME = 'ag-suite-bare-link';
  const BARE_TOKEN_RE =
    /(?:https?:\/\/[^\s<>"'`)\]}，。；！？、]+|(?:[A-Za-z]:\\|\/(?:Users|home|opt|etc|var|tmp|mnt|Volumes)\/)[^\s<>"'`)\]}，。；！？、]*\.[A-Za-z0-9]{1,10}(?:#L\d+(?:-L?\d+)?)?)/g;
  const WIN_PATH_RE = /^[A-Za-z]:[\\/]/;
  const POSIX_PATH_RE = /^\/(?:Users|home|opt|etc|var|tmp|mnt|Volumes)\//;
  const SLASH_ITEMS = ['/compact', '/plan', '/grill-me', '/learn', '/goal'];

  let disposed = false;
  let scanTimer = null;
  let toastTimer = null;
  let convObserver = null;
  let observedConv = null;
  let bodyMenuObserver = null;
  let lastRightClickCtx = null;
  let fallbackMenu = null;
  let omniModal = null;
  let omniPortalClaimed = false;
  let omniLoadedFont = null;
  let toastEl = null;

  function markOwned(el) {
    if (!el || !el.setAttribute) return el;
    el.setAttribute('data-ag-plugin-ui', '1');
    el.setAttribute('data-ag-suite-owned', '1');
    el.setAttribute('data-ag-no-i18n', '1');
    el.setAttribute('translate', 'no');
    return el;
  }

  function isEditableTarget(node) {
    if (!node || node.nodeType !== 1) return false;
    return Boolean(node.closest && node.closest(EDITABLE_SEL));
  }

  function showToast(text) {
    if (disposed || !document.body) return;
    if (!toastEl || !toastEl.isConnected) {
      toastEl = markOwned(document.createElement('div'));
      toastEl.className = 'ag-suite-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.setAttribute('data-open', '1');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastTimer = null;
      if (toastEl) toastEl.removeAttribute('data-open');
    }, 1400);
  }

  function copyToClipboard(text) {
    if (!text) return;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        void navigator.clipboard.writeText(text).catch(() => {});
      }
      showToast('已复制');
    } catch {}
  }

  function openExternalUrl(url) {
    if (!url || !/^https?:\/\//i.test(url)) return;
    const live = window.__AGContextMeterLive;
    if (live && live.port && live.token) {
      void fetch(`http://127.0.0.1:${live.port}/open-external`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-AG-Context-Token': live.token },
        body: JSON.stringify({ url })
      }).catch(() => {});
      return;
    }
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {}
  }

  function fillComposerText(snippet, toastMsg) {
    const box = document.querySelector(INPUT_BOX_SEL);
    const editable =
      (box && box.querySelector('[contenteditable="true"]')) ||
      document.querySelector('[contenteditable="true"][role="combobox"]');
    if (!editable) {
      showToast('未找到输入框');
      return;
    }
    editable.focus();
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editable);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      const current = (editable.textContent || '').trim();
      const prefix = current ? (current.endsWith(' ') ? '' : ' ') : '';
      const ok =
        typeof document.execCommand === 'function' &&
        document.execCommand('insertText', false, `${prefix}${snippet} `);
      if (!ok) {
        editable.textContent = current ? `${current} ${snippet} ` : `${snippet} `;
        editable.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } catch {
      editable.textContent = `${snippet} `;
      editable.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (toastMsg) showToast(toastMsg);
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function cleanTrailingPunct(token) {
    let s = String(token || '').trim();
    while (s.length > 4 && /[.,;:!?)'"`]$/.test(s)) {
      if (s.endsWith(')') && (s.match(/\(/g) || []).length >= (s.match(/\)/g) || []).length) break;
      s = s.slice(0, -1);
    }
    return s;
  }

  function extractTokenAtPoint(clientX, clientY) {
    let textNode = null;
    let offset = 0;
    try {
      if (typeof document.caretPositionFromPoint === 'function') {
        const pos = document.caretPositionFromPoint(clientX, clientY);
        if (pos && pos.offsetNode && pos.offsetNode.nodeType === 3) {
          textNode = pos.offsetNode;
          offset = pos.offset;
        }
      } else if (typeof document.caretRangeFromPoint === 'function') {
        const range = document.caretRangeFromPoint(clientX, clientY);
        if (range && range.startContainer && range.startContainer.nodeType === 3) {
          textNode = range.startContainer;
          offset = range.startOffset;
        }
      }
    } catch {}
    if (!textNode || !textNode.nodeValue) return null;
    const text = textNode.nodeValue;
    BARE_TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = BARE_TOKEN_RE.exec(text)) !== null) {
      const cleaned = cleanTrailingPunct(m[0]);
      const start = m.index;
      const end = start + cleaned.length;
      if (offset >= start && offset <= end) {
        if (/^https?:\/\//i.test(cleaned)) {
          return { kind: 'url', value: cleaned };
        }
        if (WIN_PATH_RE.test(cleaned) || POSIX_PATH_RE.test(cleaned)) {
          return { kind: 'file', value: cleaned };
        }
      }
    }
    return null;
  }

  function resolveFilePathFromElement(target) {
    if (!target || target.nodeType !== 1) return null;
    const link = target.closest('a[href^="file:"], [data-uri^="file:"]');
    if (link) {
      const raw = link.getAttribute('href') || link.getAttribute('data-uri') || '';
      if (raw) {
        try {
          const u = new URL(raw);
          let p = decodeURIComponent(u.pathname);
          if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
          return p;
        } catch {
          return raw;
        }
      }
    }
    const pill = target.closest('.inline-pill, [data-testid="doc-row-title"]');
    if (pill) {
      const title = (pill.getAttribute('title') || pill.getAttribute('data-path') || pill.textContent || '').trim();
      if (WIN_PATH_RE.test(title) || POSIX_PATH_RE.test(title)) return cleanTrailingPunct(title);
    }
    return null;
  }

  // --- 3A. Alt+↑ / Alt+↓ 上下轮次跳转 ---
  function getTurns() {
    const conv = document.querySelector(CONV_SEL);
    if (!conv) return [];
    return Array.from(conv.querySelectorAll(TURN_SEL));
  }

  function jumpTurn(direction) {
    const turns = getTurns();
    if (turns.length === 0) return false;
    const viewport = document.querySelector('[data-testid="autoscroll-viewport"]');
    const vpTop = viewport ? viewport.getBoundingClientRect().top : 64;

    let currentIdx = -1;
    for (let i = 0; i < turns.length; i++) {
      if (turns[i].getBoundingClientRect().top <= vpTop + 48) currentIdx = i;
    }

    let nextIdx;
    if (direction < 0) {
      if (currentIdx <= 0) nextIdx = 0;
      else nextIdx = turns[currentIdx].getBoundingClientRect().top < vpTop - 24 ? currentIdx : currentIdx - 1;
    } else {
      nextIdx = currentIdx < turns.length - 1 ? currentIdx + 1 : turns.length - 1;
    }

    const target = turns[nextIdx];
    if (!target) return false;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const bubble = target.querySelector('[data-testid="user-message-bubble"]') || target;
    bubble.classList.remove('ag-suite-turn-flash');
    void bubble.offsetWidth;
    bubble.classList.add('ag-suite-turn-flash');
    setTimeout(() => {
      try {
        bubble.classList.remove('ag-suite-turn-flash');
      } catch {}
    }, 900);
    showToast(`轮次 ${nextIdx + 1} / ${turns.length}`);
    return true;
  }

  // --- 3B. 长代码块（>= 48 行）手动折叠 + 3C. CSS.highlights 裸链接/路径零 DOM 高亮 ---
  function enhanceCodeBlocksAndBareLinks() {
    if (disposed) return;
    if (document.querySelector(STREAMING_SEL)) return;
    const conv = document.querySelector(CONV_SEL);
    if (!conv) return;

    // 3B: 长代码块折叠
    const pres = conv.querySelectorAll('pre');
    for (let i = 0; i < pres.length; i++) {
      const pre = pres[i];
      if (!pre || !pre.parentElement || pre.dataset.agSuiteFoldInit === '1') continue;
      if (pre.closest('.monaco-editor, .cm-editor, #ag-context-meter, #ag-suite-omni-modal')) continue;
      const text = pre.textContent || '';
      if (text.length < 400) continue;
      let lines = 1;
      for (let j = 0; j < text.length; j++) {
        if (text.charCodeAt(j) === 10) lines += 1;
      }
      if (lines < MIN_FOLD_LINES) continue;

      pre.dataset.agSuiteFoldInit = '1';
      const bar = markOwned(document.createElement('div'));
      bar.className = 'ag-suite-code-bar';

      const meta = markOwned(document.createElement('span'));
      meta.className = 'ag-suite-code-meta';
      meta.textContent = `长代码块 · ${lines} 行`;

      const btn = markOwned(document.createElement('button'));
      btn.type = 'button';
      btn.className = 'ag-suite-code-btn';
      btn.textContent = '收起';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const collapsed = pre.classList.toggle('ag-suite-code-collapsed');
        btn.textContent = collapsed ? `展开 (${lines} 行)` : '收起';
        if (collapsed && bar.getBoundingClientRect().top < 56) {
          bar.scrollIntoView({ behavior: 'auto', block: 'nearest' });
        }
      });

      bar.appendChild(meta);
      bar.appendChild(btn);
      pre.parentElement.insertBefore(bar, pre);
    }

    // 3C: CSS.highlights 零 DOM 篡改裸链接/裸本地路径高亮
    if (typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function') {
      try {
        const ranges = [];
        const walker = document.createTreeWalker(conv, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            const v = node.nodeValue;
            if (!v || v.length < 8) return NodeFilter.FILTER_REJECT;
            if (!v.includes('://') && !v.includes(':\\') && !v.includes('/Users/') && !v.includes('/home/')) {
              return NodeFilter.FILTER_REJECT;
            }
            const p = node.parentElement;
            if (!p || p.closest('a, pre, button, input, textarea, [contenteditable="true"], [data-ag-plugin-ui]')) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        });
        let cur;
        while ((cur = walker.nextNode()) && ranges.length < 250) {
          const text = cur.nodeValue || '';
          BARE_TOKEN_RE.lastIndex = 0;
          let m;
          while ((m = BARE_TOKEN_RE.exec(text)) !== null && ranges.length < 250) {
            const cleaned = cleanTrailingPunct(m[0]);
            if (cleaned.length < 8) continue;
            const r = new Range();
            r.setStart(cur, m.index);
            r.setEnd(cur, m.index + cleaned.length);
            ranges.push(r);
          }
        }
        if (ranges.length > 0) {
          CSS.highlights.set(BARE_LINK_HL_NAME, new Highlight(...ranges));
        } else {
          CSS.highlights.delete(BARE_LINK_HL_NAME);
        }
      } catch {}
    }
  }

  function scheduleScan() {
    if (disposed) return;
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scanTimer = null;
      enhanceCodeBlocksAndBareLinks();
    }, 450);
  }

  function bindConversationObserver() {
    if (disposed) return;
    const conv = document.querySelector(CONV_SEL);
    if (!conv) {
      if (convObserver) {
        try { convObserver.disconnect(); } catch {}
        convObserver = null;
        observedConv = null;
      }
      return;
    }
    if (conv === observedConv && convObserver) return;
    if (convObserver) {
      try { convObserver.disconnect(); } catch {}
    }
    observedConv = conv;
    convObserver = new MutationObserver((mutations) => {
      if (disposed) return;
      for (let i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes && mutations[i].addedNodes.length > 0) {
          scheduleScan();
          break;
        }
      }
    });
    convObserver.observe(conv, { childList: true, subtree: true });
    scheduleScan();
  }

  // --- 3E. Omni 超大文件流式检视台（纯 DOM API · 206 Range） ---
  function closeOmniModal() {
    if (omniLoadedFont) {
      try { document.fonts.delete(omniLoadedFont); } catch {}
      omniLoadedFont = null;
    }
    if (omniModal) {
      try {
        omniModal.querySelectorAll('video, audio').forEach((m) => {
          try { m.pause(); m.removeAttribute('src'); m.load(); } catch {}
        });
        omniModal.remove();
      } catch {}
      omniModal = null;
    }
    if (omniPortalClaimed) {
      omniPortalClaimed = false;
      const wcv = window.electronNative?.wcvBrowser;
      if (wcv && typeof wcv.setPortalOverlayOpen === 'function') {
        void Promise.resolve(wcv.setPortalOverlayOpen(false)).catch(() => {});
      }
    }
  }

  function parseCsvRows(text, delim) {
    const rows = [];
    let row = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < text.length && rows.length < 300; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"' && text[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delim) {
        row.push(cur);
        cur = '';
      } else if (ch === '\r') {
        continue;
      } else if (ch === '\n') {
        row.push(cur);
        if (row.some((c) => c.length > 0)) rows.push(row);
        row = [];
        cur = '';
      } else {
        cur += ch;
      }
    }
    if (cur.length > 0 || row.length > 0) {
      row.push(cur);
      rows.push(row);
    }
    return rows;
  }

  async function renderOmniBody(bodyEl, meta) {
    bodyEl.replaceChildren();

    if (meta.kind === 'video') {
      const wrap = markOwned(document.createElement('div'));
      wrap.className = 'ag-suite-omni-media-wrap';
      const video = markOwned(document.createElement('video'));
      video.className = 'ag-suite-omni-video';
      video.controls = true;
      video.preload = 'metadata';
      video.src = meta.streamUrl;

      const rateBar = markOwned(document.createElement('div'));
      rateBar.className = 'ag-suite-omni-subbar';
      for (const r of [0.5, 1, 1.5, 2]) {
        const b = markOwned(document.createElement('button'));
        b.type = 'button';
        b.className = 'ag-suite-omni-chip' + (r === 1 ? ' is-active' : '');
        b.textContent = `${r}x`;
        b.addEventListener('click', () => {
          video.playbackRate = r;
          rateBar.querySelectorAll('.ag-suite-omni-chip').forEach((n) => n.classList.toggle('is-active', n === b));
        });
        rateBar.appendChild(b);
      }
      wrap.appendChild(video);
      wrap.appendChild(rateBar);
      bodyEl.appendChild(wrap);
      return;
    }

    if (meta.kind === 'audio') {
      const wrap = markOwned(document.createElement('div'));
      wrap.className = 'ag-suite-omni-media-wrap';
      const audio = markOwned(document.createElement('audio'));
      audio.className = 'ag-suite-omni-audio';
      audio.controls = true;
      audio.preload = 'metadata';
      audio.src = meta.streamUrl;
      wrap.appendChild(audio);
      bodyEl.appendChild(wrap);
      return;
    }

    if (meta.kind === 'image') {
      let scale = 1;
      const stage = markOwned(document.createElement('div'));
      stage.className = 'ag-suite-omni-img-stage';
      const img = markOwned(document.createElement('img'));
      img.className = 'ag-suite-omni-img';
      img.alt = meta.name;
      img.src = meta.streamUrl;

      const zoomBar = markOwned(document.createElement('div'));
      zoomBar.className = 'ag-suite-omni-subbar';
      const zoomLabel = markOwned(document.createElement('span'));
      zoomLabel.textContent = '100%';
      const applyScale = (next) => {
        scale = Math.max(0.25, Math.min(4, Math.round(next * 100) / 100));
        img.style.transform = `scale(${scale})`;
        zoomLabel.textContent = `${Math.round(scale * 100)}%`;
      };
      for (const [lbl, fn] of [
        ['-', () => applyScale(scale - 0.25)],
        ['1:1', () => applyScale(1)],
        ['+', () => applyScale(scale + 0.25)]
      ]) {
        const b = markOwned(document.createElement('button'));
        b.type = 'button';
        b.className = 'ag-suite-omni-chip';
        b.textContent = lbl;
        b.addEventListener('click', fn);
        zoomBar.appendChild(b);
      }
      zoomBar.appendChild(zoomLabel);
      stage.addEventListener(
        'wheel',
        (ev) => {
          if (!ev.ctrlKey) return;
          ev.preventDefault();
          applyScale(scale + (ev.deltaY < 0 ? 0.15 : -0.15));
        },
        { passive: false }
      );
      stage.appendChild(img);
      bodyEl.appendChild(stage);
      bodyEl.appendChild(zoomBar);
      return;
    }

    if (meta.kind === 'pdf' || meta.kind === 'html') {
      const iframe = markOwned(document.createElement('iframe'));
      iframe.className = 'ag-suite-omni-frame';
      if (meta.kind === 'html') iframe.setAttribute('sandbox', '');
      iframe.src = meta.streamUrl;
      bodyEl.appendChild(iframe);
      return;
    }

    if (meta.kind === 'font') {
      const family = `AgSuiteOmniFont_${Date.now()}`;
      const wrap = markOwned(document.createElement('div'));
      wrap.className = 'ag-suite-omni-font-wrap';
      const status = markOwned(document.createElement('div'));
      status.textContent = '正在加载字体样张...';
      wrap.appendChild(status);
      bodyEl.appendChild(wrap);
      try {
        const ff = new FontFace(family, `url(${meta.streamUrl})`);
        await ff.load();
        document.fonts.add(ff);
        omniLoadedFont = ff;
        wrap.replaceChildren();
        for (const sz of [14, 18, 26, 36]) {
          const sample = markOwned(document.createElement('div'));
          sample.className = 'ag-suite-omni-font-sample';
          sample.style.fontFamily = `"${family}", sans-serif`;
          sample.style.fontSize = `${sz}px`;
          sample.textContent = `${sz}px · 永和九年岁在癸丑 The quick brown fox jumps over 0123456789 != =>`;
          wrap.appendChild(sample);
        }
      } catch (err) {
        status.textContent = `字体加载失败: ${err?.message || err}`;
      }
      return;
    }

    // table (CSV/TSV/JSONL) 或超大文本：基于 HTTP 206 Range 分片读取，绝不卡死主线程
    const CHUNK = 262144; // 256 KB
    if (meta.kind === 'table') {
      const resp = await fetch(meta.streamUrl, { headers: { Range: `bytes=0-${CHUNK - 1}` } });
      const raw = await resp.text();
      let rows = [];
      if (meta.ext === '.jsonl' || meta.ext === '.ndjson') {
        const objs = raw
          .split(/\r?\n/)
          .filter((l) => l.trim())
          .slice(0, 200)
          .map((l) => {
            try { return JSON.parse(l); } catch { return { raw: l }; }
          });
        const cols = Array.from(new Set(objs.flatMap((o) => (o && typeof o === 'object' ? Object.keys(o) : ['value'])))).slice(0, 24);
        rows.push(cols);
        for (const o of objs) {
          rows.push(cols.map((k) => {
            const v = o && typeof o === 'object' ? o[k] : o;
            return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
          }));
        }
      } else {
        rows = parseCsvRows(raw, meta.ext === '.tsv' ? '\t' : ',');
      }

      const filterInput = markOwned(document.createElement('input'));
      filterInput.type = 'search';
      filterInput.className = 'ag-suite-omni-search';
      filterInput.placeholder = `筛选前 ${Math.max(0, rows.length - 1)} 行（已流式读取前 ${formatBytes(Math.min(meta.size, CHUNK))}）...`;

      const tableWrap = markOwned(document.createElement('div'));
      tableWrap.className = 'ag-suite-omni-table-wrap';
      const table = markOwned(document.createElement('table'));
      table.className = 'ag-suite-omni-table';
      const thead = markOwned(document.createElement('thead'));
      const tbody = markOwned(document.createElement('tbody'));

      const headers = rows[0] || [];
      const htr = markOwned(document.createElement('tr'));
      for (const h of headers) {
        const th = markOwned(document.createElement('th'));
        th.textContent = h;
        htr.appendChild(th);
      }
      thead.appendChild(htr);

      const dataRows = rows.slice(1);
      const renderRows = (q) => {
        tbody.replaceChildren();
        const needle = String(q || '').trim().toLowerCase();
        for (const r of dataRows) {
          if (needle && !r.some((c) => String(c).toLowerCase().includes(needle))) continue;
          const tr = markOwned(document.createElement('tr'));
          for (let ci = 0; ci < headers.length; ci++) {
            const td = markOwned(document.createElement('td'));
            td.textContent = r[ci] ?? '';
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
        }
      };
      renderRows('');
      filterInput.addEventListener('input', () => renderRows(filterInput.value));
      table.appendChild(thead);
      table.appendChild(tbody);
      tableWrap.appendChild(table);
      bodyEl.appendChild(filterInput);
      bodyEl.appendChild(tableWrap);
      return;
    }

    // 超大纯文本 / 代码 / 日志分片阅读器
    let loadedBytes = 0;
    const pre = markOwned(document.createElement('pre'));
    pre.className = 'ag-suite-omni-text';
    const foot = markOwned(document.createElement('div'));
    foot.className = 'ag-suite-omni-subbar';
    const progressLbl = markOwned(document.createElement('span'));
    const loadMoreBtn = markOwned(document.createElement('button'));
    loadMoreBtn.type = 'button';
    loadMoreBtn.className = 'ag-suite-omni-chip';
    loadMoreBtn.textContent = '加载下一片 (+256 KB)';

    const loadNextChunk = async () => {
      if (loadedBytes >= meta.size) return;
      const end = Math.min(meta.size - 1, loadedBytes + CHUNK - 1);
      const resp = await fetch(meta.streamUrl, { headers: { Range: `bytes=${loadedBytes}-${end}` } });
      const text = await resp.text();
      pre.appendChild(document.createTextNode(text));
      loadedBytes = end + 1;
      progressLbl.textContent = `已加载 ${formatBytes(loadedBytes)} / ${formatBytes(meta.size)}`;
      loadMoreBtn.hidden = loadedBytes >= meta.size;
    };

    loadMoreBtn.addEventListener('click', () => { void loadNextChunk(); });
    foot.appendChild(progressLbl);
    foot.appendChild(loadMoreBtn);
    bodyEl.appendChild(pre);
    bodyEl.appendChild(foot);
    await loadNextChunk();
  }

  async function openOmniViewer(rawPath) {
    const live = window.__AGContextMeterLive;
    if (!live || !live.port || !live.token) {
      showToast('本地流式网关未就绪');
      return;
    }
    let meta;
    try {
      const resp = await fetch(`http://127.0.0.1:${live.port}/omni-stat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-AG-Context-Token': live.token },
        body: JSON.stringify({ path: rawPath })
      });
      meta = await resp.json();
    } catch (err) {
      showToast(`Omni 网关请求失败: ${err?.message || err}`);
      return;
    }
    if (!meta || !meta.ok) {
      showToast(meta?.error || '无法预览该文件');
      return;
    }

    closeOmniModal();
    const wcv = window.electronNative?.wcvBrowser;
    if (wcv && typeof wcv.setPortalOverlayOpen === 'function') {
      omniPortalClaimed = true;
      void Promise.resolve(wcv.setPortalOverlayOpen(true)).catch(() => {});
    }

    const backdrop = markOwned(document.createElement('div'));
    backdrop.id = 'ag-suite-omni-modal';
    backdrop.className = 'ag-suite-omni-backdrop browser-hole-opaque';
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeOmniModal();
    });

    const dialog = markOwned(document.createElement('div'));
    dialog.className = 'ag-suite-omni-dialog';
    dialog.setAttribute('role', 'dialog');

    const head = markOwned(document.createElement('div'));
    head.className = 'ag-suite-omni-head';

    const titleWrap = markOwned(document.createElement('div'));
    titleWrap.className = 'ag-suite-omni-title-wrap';
    const titleEl = markOwned(document.createElement('span'));
    titleEl.className = 'ag-suite-omni-title';
    titleEl.textContent = meta.name;
    const badgeEl = markOwned(document.createElement('span'));
    badgeEl.className = 'ag-suite-omni-badge';
    badgeEl.textContent = `${meta.kind.toUpperCase()} · ${formatBytes(meta.size)}`;
    titleWrap.appendChild(titleEl);
    titleWrap.appendChild(badgeEl);

    const actions = markOwned(document.createElement('div'));
    actions.className = 'ag-suite-omni-actions';
    const copyBtn = markOwned(document.createElement('button'));
    copyBtn.type = 'button';
    copyBtn.className = 'ag-suite-omni-chip';
    copyBtn.textContent = '复制路径';
    copyBtn.addEventListener('click', () => copyToClipboard(meta.realPath));

    const refBtn = markOwned(document.createElement('button'));
    refBtn.type = 'button';
    refBtn.className = 'ag-suite-omni-chip';
    refBtn.textContent = '@引用';
    refBtn.addEventListener('click', () => {
      closeOmniModal();
      fillComposerText(`@${meta.realPath}`, '已填入 @引用');
    });

    const closeBtn = markOwned(document.createElement('button'));
    closeBtn.type = 'button';
    closeBtn.className = 'ag-suite-omni-chip';
    closeBtn.textContent = '关闭 (Esc)';
    closeBtn.addEventListener('click', closeOmniModal);

    actions.appendChild(copyBtn);
    actions.appendChild(refBtn);
    actions.appendChild(closeBtn);
    head.appendChild(titleWrap);
    head.appendChild(actions);

    const bodyEl = markOwned(document.createElement('div'));
    bodyEl.className = 'ag-suite-omni-body';

    dialog.appendChild(head);
    dialog.appendChild(bodyEl);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    omniModal = backdrop;

    await renderOmniBody(bodyEl, meta);
  }

  // --- 3D. 与船板 v6.0.7 右键菜单无缝协同增强 + 兜底轻量菜单 ---
  function closeFallbackMenu() {
    if (fallbackMenu) {
      try { fallbackMenu.remove(); } catch {}
      fallbackMenu = null;
    }
  }

  function dismissChuanbanMenu() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    closeFallbackMenu();
  }

  function makeMenuButton(label, hint, onSelect) {
    const btn = markOwned(document.createElement('button'));
    btn.type = 'button';
    btn.className = 'ag-suite-ctx-item';
    const l = markOwned(document.createElement('span'));
    l.className = 'ag-suite-ctx-lbl';
    l.textContent = label;
    btn.appendChild(l);
    if (hint) {
      const h = markOwned(document.createElement('span'));
      h.className = 'ag-suite-ctx-hint';
      h.textContent = hint;
      btn.appendChild(h);
    }
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dismissChuanbanMenu();
      onSelect();
    });
    return btn;
  }

  function buildExtensionFragment(ctxInfo) {
    const frag = document.createDocumentFragment();
    let hasItems = false;

    const addSep = () => {
      const sep = markOwned(document.createElement('div'));
      sep.className = 'ag-suite-ctx-sep';
      frag.appendChild(sep);
    };

    if (ctxInfo.filePath) {
      addSep();
      hasItems = true;
      frag.appendChild(
        makeMenuButton('⚡ Omni 流式预览', '', () => {
          void openOmniViewer(ctxInfo.filePath);
        })
      );
      frag.appendChild(
        makeMenuButton('📎 作为 @引用 填入', '', () => {
          fillComposerText(`@${ctxInfo.filePath}`, '已填入 @引用');
        })
      );
      if (ctxInfo.fromBareText) {
        frag.appendChild(
          makeMenuButton('📋 复制裸路径', '', () => copyToClipboard(ctxInfo.filePath))
        );
      }
    } else if (ctxInfo.bareUrl) {
      addSep();
      hasItems = true;
      frag.appendChild(
        makeMenuButton('🌐 打开裸链接', '', () => openExternalUrl(ctxInfo.bareUrl))
      );
      frag.appendChild(
        makeMenuButton('🔗 复制裸链接', '', () => copyToClipboard(ctxInfo.bareUrl))
      );
    }

    if (ctxInfo.inConv && !ctxInfo.isEditable && !ctxInfo.hasSelection) {
      addSep();
      hasItems = true;
      const chipRow = markOwned(document.createElement('div'));
      chipRow.className = 'ag-suite-ctx-chip-row';
      for (const cmd of SLASH_ITEMS) {
        const chip = markOwned(document.createElement('button'));
        chip.type = 'button';
        chip.className = 'ag-suite-ctx-chip';
        chip.textContent = cmd;
        chip.addEventListener('mousedown', (e) => e.preventDefault());
        chip.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          dismissChuanbanMenu();
          fillComposerText(cmd, `已填入 ${cmd}（按 Enter 发送）`);
        });
        chipRow.appendChild(chip);
      }
      frag.appendChild(chipRow);

      const navRow = markOwned(document.createElement('div'));
      navRow.className = 'ag-suite-ctx-chip-row';
      for (const [lbl, fn] of [
        ['↑ 上一轮', () => jumpTurn(-1)],
        ['↓ 下一轮', () => jumpTurn(1)],
        ['↓ 底部', () => {
          const vp = document.querySelector('[data-testid="autoscroll-viewport"]');
          if (vp) vp.scrollTo({ top: vp.scrollHeight, behavior: 'smooth' });
        }]
      ]) {
        const nb = markOwned(document.createElement('button'));
        nb.type = 'button';
        nb.className = 'ag-suite-ctx-chip';
        nb.textContent = lbl;
        nb.addEventListener('mousedown', (e) => e.preventDefault());
        nb.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          dismissChuanbanMenu();
          fn();
        });
        navRow.appendChild(nb);
      }
      frag.appendChild(navRow);
    }

    return hasItems ? frag : null;
  }

  function computeRightClickCtx(target, clientX, clientY) {
    if (!target || target.nodeType !== 1) return null;
    if (target.closest(`#${CHUANBAN_MENU_ID}, #ag-context-meter, #ag-suite-omni-modal`)) return null;
    const inConv = Boolean(target.closest(CONV_SEL));
    const isEditable = isEditableTarget(target);
    const hasSelection = String(window.getSelection ? window.getSelection().toString() : '').trim().length > 0;
    const elemFile = resolveFilePathFromElement(target);
    const bareToken = !elemFile && !target.closest('a[href]') ? extractTokenAtPoint(clientX, clientY) : null;
    const ctxInfo = {
      inConv,
      isEditable,
      hasSelection,
      filePath: elemFile || (bareToken && bareToken.kind === 'file' ? bareToken.value : null),
      fromBareText: Boolean(!elemFile && bareToken && bareToken.kind === 'file'),
      bareUrl: bareToken && bareToken.kind === 'url' ? bareToken.value : null,
      clientX,
      clientY,
      ts: Date.now()
    };
    if (!ctxInfo.filePath && !ctxInfo.bareUrl && !(ctxInfo.inConv && !ctxInfo.isEditable && !ctxInfo.hasSelection)) {
      return null;
    }
    return ctxInfo;
  }

  function enhanceChuanbanMenuNode(chuanbanMenu) {
    if (disposed || !chuanbanMenu || !chuanbanMenu.isConnected) return;
    if (chuanbanMenu.querySelector('[data-ag-suite-ext="1"]')) return;

    let ctxInfo =
      lastRightClickCtx && Date.now() - lastRightClickCtx.ts < 800 ? lastRightClickCtx : null;
    if (!ctxInfo) {
      // 兼容键盘菜单键或合成 contextmenu：根据菜单左上角坐标反查底层命中元素
      const r = chuanbanMenu.getBoundingClientRect();
      const px = Math.max(4, Math.min(window.innerWidth - 4, Math.round(r.left)));
      const py = Math.max(4, Math.min(window.innerHeight - 4, Math.round(r.top)));
      const stack = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(px, py) : [];
      const under = stack.find((el) => el && !el.closest(`#${CHUANBAN_MENU_ID}`));
      ctxInfo = computeRightClickCtx(under, px, py);
    }
    if (!ctxInfo) return;

    const frag = buildExtensionFragment(ctxInfo);
    if (!frag) return;
    const holder = markOwned(document.createElement('div'));
    holder.setAttribute('data-ag-suite-ext', '1');
    holder.appendChild(frag);
    chuanbanMenu.appendChild(holder);
    const rect = chuanbanMenu.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 8) {
      chuanbanMenu.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`;
    }
  }

  function onRightPointerDown(ev) {
    if (disposed || ev.button !== 2 || ev.shiftKey) return;
    const target = ev.target && ev.target.nodeType === 1 ? ev.target : ev.target?.parentElement;
    lastRightClickCtx = computeRightClickCtx(target, ev.clientX, ev.clientY);
  }

  function onContextMenuFallback(ev) {
    if (disposed || ev.shiftKey) return;
    closeFallbackMenu();
    const target = ev.target && ev.target.nodeType === 1 ? ev.target : ev.target?.parentElement;
    const ctxInfo = computeRightClickCtx(target, ev.clientX, ev.clientY);
    if (ctxInfo) lastRightClickCtx = ctxInfo;
    // 仅当船板原生菜单未启用且命中裸路径/裸链接时，弹出轻量兜底菜单
    if (!window.__ag_core_context_menu_active && ctxInfo && (ctxInfo.filePath || ctxInfo.bareUrl)) {
      ev.preventDefault();
      const frag = buildExtensionFragment(ctxInfo);
      if (!frag) return;
      const menu = markOwned(document.createElement('div'));
      menu.className = 'ag-suite-ctx-menu';
      menu.setAttribute('role', 'menu');
      menu.appendChild(frag);
      document.body.appendChild(menu);
      const rect = menu.getBoundingClientRect();
      menu.style.left = `${Math.min(ev.clientX, Math.max(8, window.innerWidth - rect.width - 10))}px`;
      menu.style.top = `${Math.min(ev.clientY, Math.max(8, window.innerHeight - rect.height - 10))}px`;
      fallbackMenu = menu;
    }
  }

  function bindBodyMenuObserver() {
    if (disposed || !document.body || bodyMenuObserver) return;
    bodyMenuObserver = new MutationObserver((mutations) => {
      if (disposed) return;
      for (let i = 0; i < mutations.length; i++) {
        const added = mutations[i].addedNodes;
        for (let j = 0; j < added.length; j++) {
          const n = added[j];
          if (n && n.nodeType === 1 && n.id === CHUANBAN_MENU_ID) {
            enhanceChuanbanMenuNode(n);
            return;
          }
        }
      }
    });
    // 仅观察 body 直接子节点（非 subtree），极低开销
    bodyMenuObserver.observe(document.body, { childList: true });
  }

  function onCtrlClickBareLink(ev) {
    if (disposed || !(ev.ctrlKey || ev.metaKey) || ev.button !== 0) return;
    const target = ev.target && ev.target.nodeType === 1 ? ev.target : ev.target?.parentElement;
    if (!target || !target.closest(CONV_SEL)) return;
    if (target.closest('a[href], button, [role="button"], input, textarea, [contenteditable="true"]')) return;
    const token = extractTokenAtPoint(ev.clientX, ev.clientY);
    if (!token) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (token.kind === 'url') {
      openExternalUrl(token.value);
    } else if (token.kind === 'file') {
      void openOmniViewer(token.value);
    }
  }

  function onKeyDown(ev) {
    if (disposed) return;
    if (ev.key === 'Escape') {
      if (omniModal) {
        ev.preventDefault();
        closeOmniModal();
        return;
      }
      if (fallbackMenu) {
        closeFallbackMenu();
        return;
      }
    }
    if (!ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
    if (isEditableTarget(document.activeElement) || isEditableTarget(ev.target)) return;
    if (jumpTurn(ev.key === 'ArrowUp' ? -1 : 1)) {
      ev.preventDefault();
    }
  }

  function onGlobalPointerDown(ev) {
    if (fallbackMenu && !fallbackMenu.contains(ev.target)) {
      closeFallbackMenu();
    }
  }

  function onRouteOrClickCheck() {
    if (disposed) return;
    if (!observedConv || !observedConv.isConnected) {
      bindConversationObserver();
    }
  }

  function cleanupWorkbench() {
    if (disposed) return;
    disposed = true;
    closeFallbackMenu();
    closeOmniModal();
    if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    if (convObserver) {
      try { convObserver.disconnect(); } catch {}
      convObserver = null;
    }
    if (bodyMenuObserver) {
      try { bodyMenuObserver.disconnect(); } catch {}
      bodyMenuObserver = null;
    }
    observedConv = null;
    lastRightClickCtx = null;
    try {
      if (typeof CSS !== 'undefined' && CSS.highlights) CSS.highlights.delete(BARE_LINK_HL_NAME);
    } catch {}
    if (toastEl) {
      try { toastEl.remove(); } catch {}
      toastEl = null;
    }
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('pointerdown', onRightPointerDown, true);
    window.removeEventListener('contextmenu', onContextMenuFallback, true);
    document.removeEventListener('click', onCtrlClickBareLink, true);
    document.removeEventListener('pointerdown', onGlobalPointerDown, true);
    document.removeEventListener('click', onRouteOrClickCheck, true);
    window.removeEventListener('blur', closeFallbackMenu);
    if (window.__agSuiteWorkbenchCleanup === cleanupWorkbench) {
      delete window.__agSuiteWorkbenchCleanup;
    }
    if (window.__agSuiteOpenOmni === openOmniViewer) {
      delete window.__agSuiteOpenOmni;
    }
  }

  window.__agSuiteWorkbenchCleanup = cleanupWorkbench;
  window.__agSuiteOpenOmni = openOmniViewer;
  if (typeof ctx !== 'undefined' && typeof ctx?.onCleanup === 'function') {
    ctx.onCleanup(cleanupWorkbench);
  } else if (typeof boot !== 'undefined' && typeof boot?.onCleanup === 'function') {
    boot.onCleanup(cleanupWorkbench);
  }

  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('pointerdown', onRightPointerDown, true);
  window.addEventListener('contextmenu', onContextMenuFallback, true);
  document.addEventListener('click', onCtrlClickBareLink, true);
  document.addEventListener('pointerdown', onGlobalPointerDown, true);
  document.addEventListener('click', onRouteOrClickCheck, true);
  window.addEventListener('blur', closeFallbackMenu);
  bindBodyMenuObserver();
  bindConversationObserver();
})();
