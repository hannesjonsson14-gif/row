// =============================================================
// Persistent dashboard top bar + bottom tab bar.
// Drop this on any page with:
//     <script src="topbar.js" defer></script>
// It self-injects HTML + CSS, reads progress from localStorage,
// and renders the water +1 button in the top bar plus the
// Main/Health/Food/Fitness bottom tabs. Skips chrome on finance.html
// and inside iframes (so the water tracker can embed cleanly).
// Layout contract: .topbar is the first child of <body> (sticky, owns
// safe-area-top); .bottombar is fixed (owns safe-area-bottom) and
// body.has-bottombar reserves its height. Pages put their gutter on a
// container, never padding on <body>. Styles use the row-tokens with
// literal fallbacks, so they also work on a page without the tokens.
// Water '+' syncs through sync.js (window.rowSync); see pushWater().
// =============================================================
(function () {
  'use strict';

  // sync.js sits next to this file; gym.html doesn't load it, so '+' loads it on demand.
  const SYNC_SRC = (function () {
    try {
      const src = document.currentScript && document.currentScript.src;
      if (src && /topbar\.js(\?.*)?$/.test(src)) return src.replace(/topbar\.js(\?.*)?$/, 'sync.js');
    } catch (e) {}
    return 'sync.js';
  })();

  // -------- CSS --------
  const FONT = 'var(--font, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif)';
  const MONO = 'var(--font-mono, ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace)';
  const css = `
.topbar, .bottombar, .topbar-toast {
  box-sizing: border-box;
  font: 400 16px/1.2 ${FONT};
  letter-spacing: 0; text-transform: none;
  -webkit-touch-callout: none; -webkit-user-select: none; user-select: none;
}
.topbar *, .bottombar *, .topbar-toast * { box-sizing: border-box; }
.topbar {
  position: sticky; top: 0; z-index: var(--z-chrome, 40);
  display: flex; justify-content: flex-end; align-items: center;
  gap: var(--space-2, 8px);
  min-height: calc(var(--topbar-h, 52px) + env(safe-area-inset-top));
  margin: 0;
  padding: env(safe-area-inset-top) max(var(--gutter, 16px), env(safe-area-inset-right)) 0 max(var(--gutter, 16px), env(safe-area-inset-left));
  background: var(--bg-chrome, rgba(8, 8, 9, 0.78));
  -webkit-backdrop-filter: var(--blur-material, saturate(1.6) blur(20px));
  backdrop-filter: var(--blur-material, saturate(1.6) blur(20px));
  border: 0; border-bottom: 1px solid var(--hairline, rgba(255, 255, 255, 0.06));
  color: var(--text-1, #FAFAFA);
}
.topbar .topbar-water-wrap {
  display: flex; align-items: stretch; flex-shrink: 0;
  height: var(--tap, 44px);
  border-radius: var(--radius-pill, 999px);
  background: var(--surface-2, rgba(255, 255, 255, 0.065));
  overflow: hidden;
}
.topbar .topbar-water-pill {
  display: inline-flex; align-items: center; gap: var(--space-2, 8px);
  margin: 0; padding: 0 10px 0 12px;
  color: var(--text-1, #FAFAFA); text-decoration: none;
  -webkit-tap-highlight-color: transparent;
  transition: background-color var(--dur-fast, 160ms) var(--ease-out, ease-out);
}
.topbar .topbar-water-pill:active { background: var(--surface-3, rgba(255, 255, 255, 0.10)); }
.topbar-pill-ring { display: block; flex-shrink: 0; width: 16px; height: 16px; transform: rotate(-90deg); overflow: visible; }
.topbar-pill-ring circle { fill: none; stroke-width: 2.5; }
.topbar-pill-ring .track { stroke: var(--track, rgba(255, 255, 255, 0.08)); }
.topbar-pill-ring .fill {
  stroke: var(--hue-health, #7DD3FC); stroke-linecap: round;
  transition: stroke-dashoffset var(--dur-progress, 600ms) var(--ease-out, ease-out), stroke var(--dur-fast, 160ms) var(--ease-out, ease-out);
}
.topbar-water-pill.warn .topbar-pill-ring .track { stroke: var(--warning-tint, rgba(242, 192, 99, 0.14)); }
.topbar-water-pill.warn .topbar-pill-ring .fill { stroke: var(--warning, #F2C063); }
.topbar-water-pill.miss .topbar-pill-ring .track { stroke: rgba(255, 107, 107, 0.32); }
.topbar-water-pill.miss .topbar-pill-ring .fill { stroke: var(--negative, #FF6B6B); }
.topbar .topbar-pill-count {
  font: var(--fw-semibold, 600) var(--fs-footnote, 13px)/1 ${MONO};
  font-variant-numeric: tabular-nums; letter-spacing: 0;
  color: var(--text-1, #FAFAFA); white-space: nowrap;
}
.topbar .topbar-water-add {
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  width: var(--tap, 44px); height: 100%; min-width: 0; min-height: 0;
  margin: 0; padding: 0;
  border: 0; border-left: 1px solid var(--hairline, rgba(255, 255, 255, 0.06)); border-radius: 0;
  background: transparent; box-shadow: none;
  color: var(--hue-health, #7DD3FC); font: inherit;
  cursor: pointer; -webkit-appearance: none; appearance: none;
  -webkit-tap-highlight-color: transparent;
  transition: background-color var(--dur-fast, 160ms) var(--ease-out, ease-out);
}
.topbar .topbar-water-add:active { background: var(--surface-3, rgba(255, 255, 255, 0.10)); }
.topbar .topbar-water-add.flash { background: rgba(125, 211, 252, 0.18); }
.topbar .topbar-water-add .topbar-icon { transition: transform var(--dur-instant, 100ms) var(--ease-out, ease-out); }
.topbar .topbar-water-add:active .topbar-icon { transform: scale(0.88); }
.topbar .topbar-finance-btn {
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  width: var(--tap, 44px); height: var(--tap, 44px); margin: 0; padding: 0;
  border: 0; border-radius: var(--radius-pill, 999px);
  background: var(--surface-2, rgba(255, 255, 255, 0.065));
  color: var(--text-2, #B8B6B0); text-decoration: none;
  -webkit-tap-highlight-color: transparent;
  transition: background-color var(--dur-fast, 160ms) var(--ease-out, ease-out), transform var(--dur-instant, 100ms) var(--ease-out, ease-out);
}
.topbar .topbar-finance-btn:active { background: var(--surface-3, rgba(255, 255, 255, 0.10)); transform: scale(0.94); }
.topbar-icon { width: 20px; height: 20px; display: block; flex-shrink: 0; }
.topbar a:focus-visible, .topbar button:focus-visible, .bottombar a:focus-visible, .topbar-toast button:focus-visible {
  outline: 2px solid var(--accent-ring, rgba(125, 211, 252, 0.6)); outline-offset: 2px;
}
.topbar .topbar-water-wrap a:focus-visible, .topbar .topbar-water-wrap button:focus-visible { outline-offset: -2px; }
.bottombar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: var(--z-chrome, 40);
  display: flex; align-items: stretch;
  margin: 0;
  padding: 0 env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  background: var(--bg-chrome, rgba(8, 8, 9, 0.78));
  -webkit-backdrop-filter: var(--blur-material, saturate(1.6) blur(20px));
  backdrop-filter: var(--blur-material, saturate(1.6) blur(20px));
  border: 0; border-top: 1px solid var(--hairline, rgba(255, 255, 255, 0.06));
}
.bottombar .bottombar-tab {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 3px; min-height: var(--tabbar-h, 56px); margin: 0; padding: 0;
  border-radius: 0; text-decoration: none;
  color: var(--text-3, #94918A);
  font: var(--fw-semibold, 600) var(--fs-micro, 11px)/1 ${FONT};
  letter-spacing: 0.01em;
  -webkit-tap-highlight-color: transparent;
  transition: color var(--dur-fast, 160ms) var(--ease-out, ease-out);
}
.bottombar .bottombar-tab span { display: block; line-height: 13px; }
.bottombar-tab-icon {
  width: 24px; height: 24px; display: block; flex-shrink: 0; stroke-width: 1.8;
  transition: transform var(--dur-instant, 100ms) var(--ease-out, ease-out);
}
.bottombar .bottombar-tab.active { color: var(--text-1, #FAFAFA); }
.bottombar .bottombar-tab.active .bottombar-tab-icon { stroke-width: 2.2; }
.bottombar .bottombar-tab:active .bottombar-tab-icon { transform: scale(0.92); }
.topbar-toast {
  position: fixed; left: 50%; bottom: calc(var(--tabbar-h, 56px) + 12px + env(safe-area-inset-bottom));
  z-index: var(--z-toast, 250);
  display: flex; align-items: center; gap: var(--space-4, 16px);
  min-height: 48px; max-width: calc(100vw - 2 * var(--gutter, 16px));
  margin: 0; padding: 0 var(--space-1, 4px) 0 var(--space-4, 16px);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.08)); border-radius: 14px;
  background: rgba(38, 38, 42, 0.92);
  -webkit-backdrop-filter: var(--blur-material, saturate(1.6) blur(20px));
  backdrop-filter: var(--blur-material, saturate(1.6) blur(20px));
  box-shadow: var(--shadow-raised, 0 -1px 0 rgba(255, 255, 255, 0.06), 0 24px 64px rgba(0, 0, 0, 0.60));
  color: var(--text-1, #FAFAFA);
  font: var(--fw-medium, 500) var(--fs-footnote, 13px)/1.3 ${FONT};
  white-space: nowrap;
  opacity: 0; visibility: hidden; transform: translate(-50%, 8px); pointer-events: none;
  transition: transform var(--dur-base, 240ms) var(--ease-out, ease-out), opacity var(--dur-fast, 160ms) var(--ease-out, ease-out), visibility 0s linear var(--dur-base, 240ms);
}
.topbar-toast.in { opacity: 1; visibility: visible; transform: translate(-50%, 0); pointer-events: auto; transition-delay: 0s; }
.topbar-toast .topbar-toast-msg { overflow: hidden; text-overflow: ellipsis; }
.topbar-toast button {
  min-height: var(--tap, 44px); margin: 0; padding: 0 var(--space-3, 12px);
  border: 0; border-radius: 10px; background: none; box-shadow: none;
  color: var(--hue-health, #7DD3FC);
  font: var(--fw-semibold, 600) var(--fs-footnote, 13px)/1 ${FONT};
  cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.topbar-toast button:active { background: var(--surface-3, rgba(255, 255, 255, 0.10)); }
a, button, input, select, textarea, label, [role="button"] { touch-action: manipulation; }
@media (prefers-reduced-motion: reduce) {
  .topbar, .topbar *, .bottombar, .bottombar *, .topbar-toast, .topbar-toast * {
    transition: none !important; animation: none !important;
  }
}
body.has-bottombar {
  padding-bottom: calc(var(--tabbar-h, 56px) + 1px + env(safe-area-inset-bottom)) !important;
}
/* Anchors and scrollIntoView land below the sticky bar, not under it. */
html { scroll-padding-top: calc(var(--topbar-h, 52px) + env(safe-area-inset-top) + 8px); }
/* #water is the pill's own target (health.html#water); the padding above already clears the bar. */
#water { scroll-margin-top: 8px; }
html, body { -webkit-text-size-adjust: 100%; }
@media (max-width: 768px) {
  html { touch-action: pan-y; }
  ::-webkit-scrollbar { width: 0; height: 0; display: none; }
  html, body { scrollbar-width: none; -ms-overflow-style: none; }
}
.modal-bg, .modal, .po-modal-bg, .po-modal, .wt-overlay, .wt-viewer {
  overscroll-behavior: contain;
}
body.topbar-modal-open { overflow: hidden; touch-action: none; }
body.topbar-modal-open .modal, body.topbar-modal-open .po-modal,
body.topbar-modal-open .sheet-body, body.topbar-modal-open .row-sheet-body { touch-action: pan-y; }
`;

  // -------- Icons (inline stroke SVG, inherit currentColor) --------
  function icon(cls, paths) {
    return '<svg class="' + cls + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      paths + '</svg>';
  }
  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-7"/>',
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v12h14V9"/><path d="M10 21v-6h4v6"/>',
    pill: '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
    food: '<path d="M3 2v7a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6a2 2 0 0 0 2 2h3Zm0 0v7"/>',
    dumbbell: '<path d="M6 7v10M18 7v10M3 9.5v5M21 9.5v5M6 12h12"/>'
  };

  const topbarHtml = `
<header class="topbar" id="topbar" aria-label="Quick actions">
  <div class="topbar-water-wrap">
    <a href="health.html#water" class="topbar-water-pill" id="topbarWater" aria-label="Water progress">
      <svg class="topbar-pill-ring" viewBox="0 0 16 16" aria-hidden="true"><circle class="track" cx="8" cy="8" r="6.75"/><circle class="fill" id="topbarWaterRing" cx="8" cy="8" r="6.75"/></svg>
      <span class="topbar-pill-count" id="topbarWaterCount"></span>
    </a>
    <button class="topbar-water-add" id="topbarWaterAdd" aria-label="Log one drink" type="button">${icon('topbar-icon', ICONS.plus)}</button>
  </div>
  <a href="finance.html" class="topbar-finance-btn" id="topbarFinance" aria-label="Finance">
    ${icon('topbar-icon', ICONS.chart)}
  </a>
</header>`;

  const bottombarHtml = `
<nav class="bottombar" id="bottombar" aria-label="Main tabs">
  <a href="index.html" class="bottombar-tab" data-page="main">
    ${icon('bottombar-tab-icon', ICONS.home)}<span>Main</span>
  </a>
  <a href="health.html" class="bottombar-tab" data-page="health">
    ${icon('bottombar-tab-icon', ICONS.pill)}<span>Health</span>
  </a>
  <a href="food.html" class="bottombar-tab" data-page="food">
    ${icon('bottombar-tab-icon', ICONS.food)}<span>Food</span>
  </a>
  <a href="gym.html" class="bottombar-tab" data-page="fitness">
    ${icon('bottombar-tab-icon', ICONS.dumbbell)}<span>Fitness</span>
  </a>
</nav>`;

  const toastHtml = `
<div class="topbar-toast" id="topbarToast" role="status" aria-live="polite">
  <span class="topbar-toast-msg" id="topbarToastMsg"></span>
  <button type="button" id="topbarToastUndo">Undo</button>
</div>`;

  function isFinancePage() {
    const p = (window.location.pathname || '').toLowerCase();
    return p.endsWith('/finance.html') || p.endsWith('finance.html');
  }
  function isEmbedded() {
    try { return window.self !== window.top; } catch (e) { return true; }
  }
  function shouldShowChrome() { return !isFinancePage() && !isEmbedded(); }
  function currentPageKey() {
    const p = (window.location.pathname || '').toLowerCase();
    if (p.endsWith('health.html') || p.endsWith('po-water.html')) return 'health';   // water lives in Health
    if (p.endsWith('food.html')) return 'food';
    if (p.endsWith('gym.html')) return 'fitness';
    return 'main';
  }

  function injectStyleAndHTML() {
    if (document.getElementById('topbar') || document.getElementById('bottombar')) return;
    if (!shouldShowChrome()) return;
    const style = document.createElement('style');
    style.id = 'topbar-style';
    style.textContent = css;
    document.head.appendChild(style);
    const topWrap = document.createElement('div');
    topWrap.innerHTML = topbarHtml.trim();
    const bar = topWrap.firstChild;
    document.body.insertBefore(bar, document.body.firstChild);
    const bottomWrap = document.createElement('div');
    bottomWrap.innerHTML = bottombarHtml.trim() + toastHtml;
    while (bottomWrap.firstChild) {
      const n = bottomWrap.firstChild;
      if (n.nodeType === 1) document.body.appendChild(n); else bottomWrap.removeChild(n);
    }
    const active = currentPageKey();
    document.querySelectorAll('.bottombar-tab').forEach((t) => {
      const isActive = t.getAttribute('data-page') === active;
      t.classList.toggle('active', isActive);
      if (isActive) t.setAttribute('aria-current', 'page');
    });
    document.body.classList.add('has-bottombar');
    // Full-bleed at y=0 even if a page still pads <body> (it shouldn't), so
    // the bar never shifts between tabs.
    try {
      const cs = getComputedStyle(document.body);
      const pt = parseFloat(cs.paddingTop) || 0;
      const pl = parseFloat(cs.paddingLeft) || 0;
      const pr = parseFloat(cs.paddingRight) || 0;
      if (pt) bar.style.marginTop = -pt + 'px';
      if (pl) bar.style.marginLeft = -pl + 'px';
      if (pr) bar.style.marginRight = -pr + 'px';
    } catch (e) {}
  }

  function calendarDateKey() {
    const d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  // -------- Water goal: a copy of po-water.html's normalize(), --------
  // computeTargetMl() and unitVolMl(), with its CONFIG defaults, so the
  // pill always shows the same count as Water Coach, even before Water
  // Coach has ever saved po_water_v1. Keep these in step with po-water.
  const WATER_KEY = 'po_water_v1';
  const WATER_CONFIG = {
    unit: 'bottle', bottleMl: 500, glassMl: 250,
    profile: { weightKg: 75, age: 25, sex: 'm', activityHrsPerWeek: 5 },
    caffeineMgPerDay: 200, defaultSubstances: []
  };
  function readWater() {
    try {
      const s = JSON.parse(localStorage.getItem(WATER_KEY));
      return s && typeof s === 'object' && !Array.isArray(s) ? s : null;
    } catch (e) { return null; }
  }
  function normalizeWater(raw) {
    const s = Object.assign({}, raw || {});
    s.unit = s.unit || WATER_CONFIG.unit || 'bottle';
    s.bottleMl = s.bottleMl || WATER_CONFIG.bottleMl || 500;
    s.glassMl = s.glassMl || WATER_CONFIG.glassMl || 250;
    s.weightUnit = s.weightUnit || 'kg';
    s.profile = Object.assign({}, WATER_CONFIG.profile, s.profile || {});
    s.caffeineMgPerDay = (s.caffeineMgPerDay != null) ? s.caffeineMgPerDay : (WATER_CONFIG.caffeineMgPerDay || 200);
    s.substances = Array.isArray(s.substances) ? s.substances : (WATER_CONFIG.defaultSubstances || []);
    s.logs = (s.logs && typeof s.logs === 'object' && !Array.isArray(s.logs)) ? s.logs : {};
    return s;
  }
  // A day's count as po-water reads it: a positive number, anything else is 0.
  function dayCount(state, k) {
    const n = Number(state.logs[k]);
    return n > 0 && isFinite(n) ? n : 0;
  }
  // po-water's stepUnits(): one tap logs a bottle or a glass; in oz and ml
  // a tap logs a serving (8 oz, or one glass in ml).
  function waterStep(state) {
    if (state.unit === 'oz') return 8;
    if (state.unit === 'ml') return state.glassMl || 250;
    return 1;
  }
  function waterTarget(state) {
    const p = state.profile;
    const wKg = state.weightUnit === 'lb' ? p.weightKg / 2.20462 : p.weightKg;
    const base = wKg * 35;
    const exercise = (p.activityHrsPerWeek || 0) / 7 * 500;
    const caffeine = Math.max(0, (state.caffeineMgPerDay || 0) - 200) * 1.5;
    const subs = (state.substances || []).reduce((sum, x) => {
      const dose = ((x && x.dose != null) ? x.dose : (x && x.defaultDose)) || 0;
      return sum + Math.max(0, dose * ((x && x.mlPerUnit) || 0));
    }, 0);
    let adjust = 0;
    if (p.sex === 'm') adjust += 200;
    if ((p.age || 0) >= 50) adjust += 100;
    const totalMl = base + exercise + caffeine + subs + adjust;
    let unitVol;
    if (state.unit === 'bottle') unitVol = state.bottleMl || 500;
    else if (state.unit === 'glass') unitVol = state.glassMl || 250;
    else if (state.unit === 'oz') unitVol = 30;
    else unitVol = 1;
    const units = Math.max(1, Math.ceil(totalMl / unitVol));   // po-water's targetUnitsOf()
    return isFinite(units) ? units : 0;
  }
  function getWaterProgress() {
    const state = normalizeWater(readWater());
    return { done: dayCount(state, calendarDateKey()), total: waterTarget(state), unit: state.unit, step: waterStep(state) };
  }
  function unitWord(unit, n) {
    if (unit === 'bottle') return n === 1 ? 'bottle' : 'bottles';
    if (unit === 'glass') return n === 1 ? 'glass' : 'glasses';
    if (unit === 'oz') return 'oz';
    return 'ml';
  }
  // Ring: sky while on pace or done. --warning when a serving or more behind
  // Water Coach's pace (its day window: 06:30, done by 21:00, like Main's Day
  // Ring), so the pill and the card agree; --negative when still under half
  // the target after 21:00.
  const PACE_START = 6.5, PACE_DONE = 21;
  function classifyStatus(w) {
    if (!(w.total > 0)) return 'idle';
    if (w.done >= w.total) return 'good';
    const d = new Date();
    const h = d.getHours() + d.getMinutes() / 60;
    if (h >= PACE_DONE && w.done < w.total * 0.5) return 'miss';
    const f = Math.min(1, Math.max(0, (h - PACE_START) / (PACE_DONE - PACE_START)));
    if (Math.floor(w.total * f) - w.done >= w.step) return 'warn';
    return 'ok';
  }
  function setPillStatus(pillEl, status) {
    pillEl.classList.remove('good', 'warn', 'miss');
    if (status === 'good' || status === 'warn' || status === 'miss') pillEl.classList.add(status);
  }
  const RING_C = 2 * Math.PI * 6.75;
  function render() {
    const waterEl = document.getElementById('topbarWater');
    if (!waterEl) return;
    const w = getWaterProgress();
    const countEl = document.getElementById('topbarWaterCount');
    if (countEl) countEl.textContent = w.done + '/' + w.total;
    const ring = document.getElementById('topbarWaterRing');
    if (ring) {
      const p = w.total > 0 ? Math.min(1, w.done / w.total) : 0;
      ring.style.strokeDasharray = RING_C.toFixed(2);
      ring.style.strokeDashoffset = (RING_C * (1 - p)).toFixed(2);
      ring.style.visibility = p > 0 ? 'visible' : 'hidden';
    }
    waterEl.setAttribute('aria-label', 'Water: ' + w.done + ' of ' + w.total + ' ' + unitWord(w.unit, w.total) + ' today');
    const add = document.getElementById('topbarWaterAdd');
    if (add) add.setAttribute('aria-label', w.step > 1 ? 'Log ' + w.step + ' ' + unitWord(w.unit, w.step) : 'Log one ' + unitWord(w.unit, 1));
    setPillStatus(waterEl, classifyStatus(w));
  }

  // -------- Water sync --------
  // po_water_v1 belongs to the cloud 'health' row. On Health and on
  // standalone Water the page's own initCloudSync covers it, so '+' only
  // writes localStorage. Elsewhere '+' marks the key dirty for 'health'
  // (sync.js's __rowsync_dirty format) and merges just po_water_v1 into
  // the row via rowSync.mergePush: read, merge, upsert, and nothing at all
  // if the read fails. A push that fails or is cut off by navigation stays
  // dirty, so the next page retries it and Health's pull can't overwrite it.
  const WATER_ROW = 'health';
  const WATER_DIRTY = '__rowsync_dirty:' + WATER_ROW;
  let syncLoad = null;
  function ensureRowSync() {
    if (window.rowSync && window.rowSync.mergePush) return Promise.resolve(window.rowSync);
    if (!syncLoad) {
      syncLoad = new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = SYNC_SRC;
        s.onload = () => resolve(window.rowSync && window.rowSync.mergePush ? window.rowSync : null);
        s.onerror = () => { syncLoad = null; resolve(null); };
        document.head.appendChild(s);
      });
    }
    return syncLoad;
  }
  function pageSyncsWater() {
    try { return !!(window.rowSync && window.rowSync.handles(WATER_ROW, WATER_KEY)); } catch (e) { return false; }
  }
  function waterDirtyList() {
    try {
      const a = JSON.parse(localStorage.getItem(WATER_DIRTY) || '[]');
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }
  function isWaterDirty() { return waterDirtyList().indexOf(WATER_KEY) !== -1; }
  function markWaterDirty() {
    const list = waterDirtyList();
    if (list.indexOf(WATER_KEY) !== -1) return;
    list.push(WATER_KEY);
    try { Storage.prototype.setItem.call(localStorage, WATER_DIRTY, JSON.stringify(list)); } catch (e) {}
  }
  let waterPushing = false, waterPushAgain = false, waterRetry = null, waterRetryDelay = 0;
  async function pushWater() {
    if (pageSyncsWater() || !isWaterDirty()) return;
    if (waterPushing) { waterPushAgain = true; return; }
    waterPushing = true;
    clearTimeout(waterRetry); waterRetry = null;
    let ok = true;
    try {
      do {
        waterPushAgain = false;
        const rs = await ensureRowSync();
        if (!rs) { ok = false; break; }
        // The partial is built after the read, from the freshest local value.
        ok = await rs.mergePush(WATER_ROW, () => {
          const local = readWater();
          return local ? { [WATER_KEY]: local } : null;
        });
        if (!ok) break;
      } while (waterPushAgain);
    } catch (e) { ok = false; }
    waterPushing = false;
    if (ok) waterRetryDelay = 0;
    else if (isWaterDirty()) {
      waterRetryDelay = Math.min(60000, waterRetryDelay ? waterRetryDelay * 2 : 4000);
      waterRetry = setTimeout(pushWater, waterRetryDelay);
    }
  }
  // Pages without the health sync never pull po_water_v1, so refresh it
  // here (read only) to keep the pill honest about drinks logged on another
  // device. Unpushed taps are pushed instead and win.
  let lastWaterRefresh = 0;
  async function refreshWater() {
    if (!document.getElementById('topbarWater') || pageSyncsWater()) return;
    if (isWaterDirty()) { pushWater(); return; }
    if (Date.now() - lastWaterRefresh < 15000) return;
    lastWaterRefresh = Date.now();
    const rs = await ensureRowSync();
    if (!rs || !rs.read) return;
    const res = await rs.read(WATER_ROW);
    if (!res || !res.ok || !Object.prototype.hasOwnProperty.call(res.data, WATER_KEY)) return;
    if (isWaterDirty() || pageSyncsWater()) return;   // a tap landed meanwhile: it wins
    const remote = res.data[WATER_KEY];
    if (!remote || typeof remote !== 'object') return;
    if (rs.stable(remote) === rs.stable(readWater())) return;
    try { localStorage.setItem(WATER_KEY, JSON.stringify(remote)); } catch (e) { return; }
    render();
  }

  function defaultWaterState() {
    return {
      unit: 'bottle', bottleMl: 500, glassMl: 250, weightUnit: 'kg',
      profile: { weightKg: 75, age: 25, sex: 'm', activityHrsPerWeek: 5 },
      caffeineMgPerDay: 200, substances: [], logs: {}
    };
  }
  // Adds delta (in the current unit) to today's count, like po-water's
  // addToday(). Returns the change actually made (0 at the floor of 0).
  function changeWater(delta) {
    let state = readWater();
    if (!state) state = defaultWaterState();
    if (!state.logs || typeof state.logs !== 'object' || Array.isArray(state.logs)) state.logs = {};
    const k = calendarDateKey();
    const cur = dayCount(state, k);
    const n = Math.max(0, cur + delta);
    if (n === cur) return 0;
    if (n > 0) state.logs[k] = n;
    else delete state.logs[k];
    try { localStorage.setItem(WATER_KEY, JSON.stringify(state)); } catch (e) { return 0; }
    if (!pageSyncsWater()) { markWaterDirty(); pushWater(); }
    render();
    // Same-document listeners (standalone Water Coach, Health) re-read
    // po_water_v1 instead of saving a stale in-memory copy over it.
    try { window.dispatchEvent(new Event('storage')); } catch (e) {}
    return n - cur;
  }

  // -------- Toast: "Logged 2 bottles · Undo" (one at a time, 4 s) --------
  // The pages' own toasts (.row-toast, Food's .toast) sit in the same spot:
  // showing this one hides theirs, and theirs hides this one (startModalLock).
  const PAGE_TOAST_IN = '.row-toast.in, .toast.in';
  let toastTimer = null, toastAmount = 0;
  function hideToast() {
    clearTimeout(toastTimer); toastTimer = null; toastAmount = 0;
    const t = document.getElementById('topbarToast');
    if (t) t.classList.remove('in');
  }
  function showWaterToast() {
    const t = document.getElementById('topbarToast');
    const msg = document.getElementById('topbarToastMsg');
    if (!t || !msg) return;
    document.querySelectorAll(PAGE_TOAST_IN).forEach((el) => { if (el !== t) el.classList.remove('in'); });
    t.classList.add('in');
    msg.textContent = 'Logged ' + toastAmount + ' ' + unitWord(getWaterProgress().unit, toastAmount);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 4000);
  }
  function addWater() {
    const added = changeWater(getWaterProgress().step);
    if (added > 0) { toastAmount += added; showWaterToast(); }
    const btn = document.getElementById('topbarWaterAdd');
    if (btn) { btn.classList.add('flash'); setTimeout(() => btn.classList.remove('flash'), 220); }
  }
  function undoWater() {
    const n = toastAmount;
    hideToast();
    if (n > 0) changeWater(-n);
  }

  function blockGesture(e) { e.preventDefault(); }
  function lockGestures() {
    document.addEventListener('gesturestart', blockGesture, { passive: false });
    document.addEventListener('gesturechange', blockGesture, { passive: false });
    document.addEventListener('gestureend', blockGesture, { passive: false });
    // iOS WebKit only applies :active pressed styles once a touchstart listener exists.
    document.addEventListener('touchstart', function () {}, { passive: true });
    // Block double-tap zoom on plain content only. Controls get
    // touch-action: manipulation (CSS above) instead, so quick repeat
    // taps (e.g. +water twice) still fire their clicks.
    const TAPPABLE = 'a, button, input, select, textarea, label, [role="button"]';
    let lastTouch = 0;
    document.addEventListener('touchend', (e) => {
      const now = Date.now();
      const onControl = e.target && e.target.closest && e.target.closest(TAPPABLE);
      if (!onControl && now - lastTouch <= 300) e.preventDefault();
      lastTouch = now;
    }, { passive: false });
  }
  function startModalLock() {
    const MODAL_SELECTORS = ['.modal-bg', '.po-modal-bg', '.wt-overlay', '.wt-viewer', '.wt-cam', '.water-iframe'];
    function anyOpen() {
      for (const sel of MODAL_SELECTORS) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          if (el.classList.contains('show') || el.classList.contains('is-open')) return true;
        }
      }
      return false;
    }
    function sync() {
      document.body.classList.toggle('topbar-modal-open', anyOpen());
      // A page toast came up while the water toast shows: one at a time.
      if (toastTimer && document.querySelector(PAGE_TOAST_IN)) hideToast();
    }
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
    sync();
  }

  // Tapping the tab you're already on scrolls back to the top (the iOS tab
  // bar convention) instead of reloading the page. At the top it reloads as
  // before. Standalone Water's active tab is Health, so that one navigates.
  function onTabClick(e) {
    const t = e.currentTarget;
    if (!t.classList.contains('active')) return;
    const file = ((window.location.pathname || '').split('/').pop() || 'index.html').toLowerCase();
    if (file !== (t.getAttribute('href') || '').toLowerCase()) return;
    if ((window.scrollY || document.documentElement.scrollTop || 0) < 4) return;
    e.preventDefault();
    let reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (err) {}
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  }

  function boot() {
    injectStyleAndHTML();
    document.querySelectorAll('.bottombar-tab').forEach((t) => t.addEventListener('click', onTabClick));
    const btn = document.getElementById('topbarWaterAdd');
    if (btn) btn.addEventListener('click', (e) => { e.preventDefault(); addWater(); });
    const undo = document.getElementById('topbarToastUndo');
    if (undo) undo.addEventListener('click', (e) => { e.preventDefault(); undoWater(); });
    render();
    lockGestures();
    startModalLock();
    window.addEventListener('storage', render);
    window.addEventListener('row-sync-applied', render);
    window.addEventListener('pageshow', render);
    window.addEventListener('focus', render);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      render();
      refreshWater();
    });
    window.addEventListener('online', () => { lastWaterRefresh = 0; refreshWater(); });
    // After 'load', every page's initCloudSync has run, so pageSyncsWater() is reliable.
    if (document.readyState === 'complete') refreshWater();
    else window.addEventListener('load', refreshWater, { once: true });
    setInterval(render, 30 * 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
