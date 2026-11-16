/**
 * user/custom.js — 用户/对方 Agent 专属前端扩展钩子
 * 在 core/runtime.js 执行完毕后于独立 try/catch 沙箱中调用。
 * 可直接使用入参 `ctx`（或别名 `boot`）：
 *   ctx.version          - 当前补丁版本与哈希
 *   ctx.preset           - 当前激活的色彩预设 ('high-contrast' | 'claude-desktop-purewhite' | 'vintage-deep')
 *   ctx.config           - 当前合并后的 user/config.json 对象
 *   ctx.modules          - 模块启用状态 (含 i18n, metrics, composerWaxSeal, deadlockHealer, zoomShortcuts, customCss, customJs)
 *   ctx.themeVars        - 当前注入的自定义 CSS 变量表
 *   ctx.dict             - 原型安全的当前汉化词典对象
 *   ctx.metrics          - 最近一次会话实时指标数据 (TPS / TTFT / Ctx / Out)
 *   ctx.syncPreset()     - 手动触发预设状态同步
 *   ctx.ensureMetricsPill(true) - 手动刷新实时指标胶囊布局
 *   ctx.onCleanup(fn)    - 注册热重载/卸载时的清理钩子（避免定时器或 MutationObserver 泄漏）
 *
 * 若此脚本报错，可通过 `node install.mjs verify --safe-mode` 一键绕过排障。
 */

(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

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
    'cli-launch-toast'
  ];
  const DISPLAY_POPUP_IDS = ['update-popover'];
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
  }, 3000);
})();
