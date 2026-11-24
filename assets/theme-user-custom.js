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
