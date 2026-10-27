// =============================================================
// Shared cloud-sync helper (v2). Each page calls
//   initCloudSync({ appKey, syncedKeys, syncedPrefixes, onApplied })
// Cloud format (unchanged): table app_state, one row per appKey,
// data = { localStorageKey: parsedValue }.
//
// - A page only writes the keys it changed ("dirty" keys, listed in
//   localStorage under __rowsync_dirty:<appKey>), merged into the row
//   as it is right now. It never replaces the row with its own subset,
//   so po-water (po_water_v1 only) and index (food_v1 only) can't wipe
//   the other keys of the health / food rows.
// - A failed read is never "no cloud data": nothing is pushed, applied
//   or deleted until a read succeeds (retried with backoff).
// - Unpushed local edits win over the pull. Remote values land only on
//   keys that aren't dirty, and a local key is never deleted just
//   because the row lacks it (local-only keys are added to the row).
// - Echoes are compared key-order-independently (jsonb reorders keys)
//   and realtime payloads are held while a push is pending or running.
// - The unload flush runs only when something is dirty and the first
//   pull has finished, and merges into the last known row.
// After remote values land: onApplied() and a window
// 'row-sync-applied' event ({ detail: { appKey, keys } }).
// window.rowSync exposes the same read-merge-write to topbar.js.
// =============================================================
(function () {
  'use strict';
  if (window.rowSync && window.rowSync.version >= 2) return;   // loaded twice
  const SUPABASE_URL = 'https://tkhpmtypznukstsxvpyz.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_5eoJkuCuEKrGLRqs9tV49Q_IgPlf-iK';
  const DIRTY_PREFIX = '__rowsync_dirty:';
  const FLUSHED_PREFIX = '__rowsync_flushed:';
  const KNOWN_PREFIX = '__rowsync_known:';
  const PUSH_DELAY = 250;
  const KEEPALIVE_MAX = 60000;   // fetch keepalive bodies are capped at 64 KB
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  // Raw storage access that bypasses every setItem/removeItem wrapper.
  function rawGet(k) { try { return Storage.prototype.getItem.call(localStorage, k); } catch (e) { return null; } }
  function rawSet(k, v) { try { Storage.prototype.setItem.call(localStorage, k, v); return true; } catch (e) { return false; } }
  function rawRemove(k) { try { Storage.prototype.removeItem.call(localStorage, k); } catch (e) {} }
  function parseRaw(raw) {
    if (raw == null) return undefined;
    try { return JSON.parse(raw); } catch (e) { return raw; }
  }
  function localValue(k) { return parseRaw(rawGet(k)); }

  // JSON with sorted object keys, so equal values compare equal no matter
  // how jsonb ordered them. undefined (= key absent) is '~'.
  function stable(v) {
    if (v === undefined) return '~';
    if (v === null || typeof v !== 'object') {
      const s = JSON.stringify(v);
      return s === undefined ? 'null' : s;
    }
    if (typeof v.toJSON === 'function') return stable(v.toJSON());
    if (Array.isArray(v)) {
      return '[' + v.map((x) => (x === undefined || typeof x === 'function' ? 'null' : stable(x))).join(',') + ']';
    }
    const parts = [];
    for (const k of Object.keys(v).sort()) {
      const x = v[k];
      if (x === undefined || typeof x === 'function' || typeof x === 'symbol') continue;
      parts.push(JSON.stringify(k) + ':' + stable(x));
    }
    return '{' + parts.join(',') + '}';
  }
  // Short fingerprint of stable(v) for the records kept in localStorage.
  function hash(v) {
    const s = stable(v);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36) + '.' + s.length;
  }
  function byteLength(s) {
    try { return new TextEncoder().encode(s).length; } catch (e) { return s.length * 3; }
  }

  // ---- Dirty keys: changed locally, not yet confirmed in the cloud ----
  function getDirty(appKey) {
    try {
      const a = JSON.parse(rawGet(DIRTY_PREFIX + appKey) || '[]');
      return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : [];
    } catch (e) { return []; }
  }
  function setDirty(appKey, list) {
    if (list.length) rawSet(DIRTY_PREFIX + appKey, JSON.stringify(list));
    else rawRemove(DIRTY_PREFIX + appKey);
  }
  function markDirty(appKey, keys) {
    const cur = getDirty(appKey);
    let added = false;
    for (const k of keys) if (cur.indexOf(k) === -1) { cur.push(k); added = true; }
    if (added) setDirty(appKey, cur);
  }
  // pushed = { key: hash of the value the cloud now holds }. A key stays
  // dirty if it was edited again while the push was on its way.
  function settleDirty(appKey, pushed) {
    const cur = getDirty(appKey);
    const next = cur.filter((k) => !hasOwn(pushed, k) || hash(localValue(k)) !== pushed[k]);
    if (next.length !== cur.length) setDirty(appKey, next);
  }
  // Keys this device has seen in the row. A local key the row lacks is pushed
  // only if the row never had it (a new row, or one another page created with
  // its own subset). One it did have was deleted on another device: it isn't
  // pushed back (and, as always, isn't deleted here either). A deleted key
  // stays listed while it still exists locally. null = row never synced here.
  function getKnown(appKey) {
    try {
      const a = JSON.parse(rawGet(KNOWN_PREFIX + appKey));
      return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : null;
    } catch (e) { return null; }
  }
  function setKnown(appKey, data) {
    const old = getKnown(appKey);
    const keys = Object.keys(data);
    if (old) for (const k of old) if (!hasOwn(data, k) && rawGet(k) != null) keys.push(k);
    keys.sort();
    if (!old || stable(keys) !== stable(old.slice().sort())) rawSet(KNOWN_PREFIX + appKey, JSON.stringify(keys));
  }
  // Unload flushes can't be confirmed, so each one leaves a record
  // { key: { v: hash(sent value), b: hash(cloud value it replaced) } }.
  function getFlushed(appKey) {
    try {
      const o = JSON.parse(rawGet(FLUSHED_PREFIX + appKey) || '{}');
      return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    } catch (e) { return {}; }
  }
  function setFlushed(appKey, o) {
    if (Object.keys(o).length) rawSet(FLUSHED_PREFIX + appKey, JSON.stringify(o));
    else rawRemove(FLUSHED_PREFIX + appKey);
  }

  // ---- Supabase: one client per page, shared with topbar.js ----
  let client = null;
  function getClient() {
    if (client) return client;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') return null;
    if (!SUPABASE_URL || !SUPABASE_KEY) return null;
    if (SUPABASE_URL.indexOf('PASTE-') === 0 || SUPABASE_KEY.indexOf('PASTE-') === 0) return null;
    try { client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY); } catch (e) { client = null; }
    return client;
  }
  // { ok: false } on ANY error (supabase-js reports network failures as
  // { data: null, error } without throwing). Never read that as "no row".
  async function readRow(appKey) {
    const supa = getClient();
    if (!supa) return { ok: false };
    try {
      const res = await supa.from('app_state').select('data').eq('key', appKey).maybeSingle();
      if (!res || res.error) return { ok: false };
      const row = res.data;
      const d = row && row.data;
      const data = d && typeof d === 'object' && !Array.isArray(d) ? d : {};
      return { ok: true, exists: !!row, data: data };
    } catch (e) { return { ok: false }; }
  }
  async function writeRow(appKey, data) {
    const supa = getClient();
    if (!supa) return false;
    try {
      const res = await supa.from('app_state').upsert(
        { key: appKey, data: data, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );
      return !!res && !res.error;
    } catch (e) { return false; }
  }

  const instances = {};

  window.initCloudSync = function (config) {
    const appKey = config && config.appKey;
    if (!appKey || instances[appKey]) return;
    const syncedKeys = (config && config.syncedKeys) || [];
    const syncedPrefixes = (config && config.syncedPrefixes) || [];
    const onApplied = config && config.onApplied;

    let suppress = false, started = false, pulled = false, remoteSnap = null;
    let busy = false, again = false, pushTimer = null, held = null;
    let retryTimer = null, retryDelay = 0, lastRun = 0, lastFlushed = null;
    let channel = null, subscribedOnce = false;
    const recent = [];   // hashes of rows this page wrote, newest last (echo detection)

    function matches(k) {
      if (!k) return false;
      k = String(k);
      if (syncedKeys.indexOf(k) !== -1) return true;
      for (let i = 0; i < syncedPrefixes.length; i++) {
        if (k.indexOf(syncedPrefixes[i]) === 0) return true;
      }
      return false;
    }
    function listAllKeys() {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (matches(k)) out.push(k);
      }
      return out;
    }
    function remember(h) {
      recent.push(h);
      if (recent.length > 8) recent.shift();
    }

    // Installed even without Supabase, so edits made offline (or when the
    // CDN didn't load) are still recorded and pushed on a later load.
    const origSet = localStorage.setItem.bind(localStorage);
    const origRemove = localStorage.removeItem.bind(localStorage);
    localStorage.setItem = function (k, v) {
      const prev = rawGet(k);
      origSet(k, v);
      try {
        if (!suppress && matches(k) && prev !== String(v)) { markDirty(appKey, [String(k)]); schedulePush(); }
      } catch (e) {}
    };
    localStorage.removeItem = function (k) {
      const prev = rawGet(k);
      origRemove(k);
      try {
        if (!suppress && matches(k) && prev != null) { markDirty(appKey, [String(k)]); schedulePush(); }
      } catch (e) {}
    };
    // Writes from another document (another tab, or po-water embedded in
    // Health, which doesn't sync itself). A value equal to the last known
    // cloud value is that document applying a pull, not an edit.
    window.addEventListener('storage', (e) => {
      if (!e.key || !matches(e.key) || e.newValue === e.oldValue) return;
      try { if (e.storageArea && e.storageArea !== localStorage) return; } catch (err) {}
      if (remoteSnap && stable(parseRaw(e.newValue)) === stable(remoteSnap[e.key])) return;
      markDirty(appKey, [e.key]);
      schedulePush();
    });

    function notify(keys) {
      if (typeof onApplied === 'function') { try { onApplied(); } catch (e) {} }
      try {
        window.dispatchEvent(new CustomEvent('row-sync-applied', { detail: { appKey: appKey, keys: keys } }));
      } catch (e) {}
    }
    // Writes remote values into keys that aren't dirty. Returns changed keys.
    function applyRemote(remote) {
      if (!remote || typeof remote !== 'object') return [];
      const dirty = getDirty(appKey);
      const changed = [];
      suppress = true;
      try {
        for (const k of Object.keys(remote)) {
          if (!matches(k) || dirty.indexOf(k) !== -1) continue;
          const incoming = remote[k];
          if (incoming === undefined) continue;
          const raw = rawGet(k);
          if (raw != null && stable(parseRaw(raw)) === stable(incoming)) continue;
          // Keep the page's own format for values it stores as plain strings.
          const plain = typeof incoming === 'string' && raw != null && parseRaw(raw) === raw;
          try { origSet(k, plain ? incoming : JSON.stringify(incoming)); changed.push(k); } catch (e) {}
        }
      } finally { suppress = false; }
      if (changed.length) notify(changed);
      return changed;
    }
    function onRemote(data) {
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;
      if (recent.indexOf(hash(data)) !== -1) return;   // echo of our own write, possibly a late one
      if (busy || pushTimer) { held = data; return; }  // re-evaluated after the push
      recent.length = 0;   // a foreign write: older echoes can't arrive after it
      remoteSnap = data;
      if (getKnown(appKey)) setKnown(appKey, data);
      applyRemote(data);
    }
    // A flushed key whose cloud value is neither what we sent nor what it
    // replaced was changed elsewhere after the flush landed: the cloud wins.
    function resolveFlushed(base) {
      const rec = getFlushed(appKey);
      const keys = Object.keys(rec).filter(matches);   // another page may own the rest of the row
      if (!keys.length) return;
      const undirty = [];
      for (const k of keys) {
        const r = rec[k] || {};
        delete rec[k];
        if (hash(localValue(k)) !== r.v) continue;   // edited again since: still ours
        const now = hash(base[k]);
        if (now !== r.v && now !== r.b) undirty.push(k);
      }
      setFlushed(appKey, rec);
      if (undirty.length) setDirty(appKey, getDirty(appKey).filter((k) => undirty.indexOf(k) === -1));
    }

    // One round trip: read the row, apply what isn't dirty, push what is.
    async function syncOnce() {
      const res = await readRow(appKey);
      if (!res.ok) return false;
      const base = res.data;
      resolveFlushed(base);
      applyRemote(base);
      pulled = true;
      remoteSnap = base;
      // Keys this device has but the row never had (a new row, or one another
      // page created with only its own subset) are added. Nothing is deleted.
      const known = getKnown(appKey);
      const missing = listAllKeys().filter((k) => !hasOwn(base, k) && !(known && known.indexOf(k) !== -1));
      if (missing.length) markDirty(appKey, missing);
      setKnown(appKey, base);
      const dirty = getDirty(appKey).filter(matches);
      if (!dirty.length) return true;
      const merged = Object.assign({}, base);
      const pushed = {};
      for (const k of dirty) {
        const v = localValue(k);
        if (v === undefined) delete merged[k]; else merged[k] = v;
        pushed[k] = hash(v);
      }
      if (stable(merged) !== stable(base)) {
        remember(hash(merged));
        if (!(await writeRow(appKey, merged))) return false;
        remoteSnap = merged;
        setKnown(appKey, merged);
        // Something arrived mid-push. It's either older than our write or
        // a newer foreign one; one more read tells which.
        if (held) { held = null; again = true; }
      }
      settleDirty(appKey, pushed);
      return true;
    }
    async function run() {
      if (busy) { again = true; return; }
      if (!getClient()) return;
      clearTimeout(retryTimer); retryTimer = null;
      busy = true; lastRun = Date.now();
      let ok = true;
      try {
        do { again = false; ok = await syncOnce(); } while (ok && again);
      } catch (e) { ok = false; }
      busy = false;
      if (ok) { retryDelay = 0; lastFlushed = null; }
      else {
        retryDelay = Math.min(60000, retryDelay ? retryDelay * 2 : 2000);
        retryTimer = setTimeout(run, retryDelay);
      }
      if (held && !pushTimer) { const h = held; held = null; onRemote(h); }
    }
    function schedulePush() {
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => { pushTimer = null; run(); }, PUSH_DELAY);
    }
    function subscribe() {
      const supa = getClient();
      if (!supa || channel) return;
      try {
        channel = supa.channel('app_state_' + appKey)
          .on('postgres_changes', {
            event: '*', schema: 'public', table: 'app_state', filter: 'key=eq.' + appKey,
          }, (payload) => {
            if (payload && payload.new && payload.new.data) onRemote(payload.new.data);
          })
          .subscribe((status) => {
            if (status !== 'SUBSCRIBED') return;
            if (subscribedOnce) run();   // reconnected: catch up on what was missed
            subscribedOnce = true;
          });
      } catch (e) {}
    }
    function kick() {
      if (!getClient()) return;
      if (!started) { started = true; subscribe(); }
      run();
    }
    // Last-chance push when leaving or backgrounding the page: only with
    // unpushed edits, only after the first pull, merged into the last known row.
    function flush() {
      if (!pulled || !remoteSnap) return;
      const dirty = getDirty(appKey).filter(matches);
      if (!dirty.length) return;
      const merged = Object.assign({}, remoteSnap);
      const rec = getFlushed(appKey);
      for (const k of dirty) {
        const v = localValue(k);
        if (v === undefined) delete merged[k]; else merged[k] = v;
        rec[k] = { v: hash(v), b: hash(remoteSnap[k]) };
      }
      const mergedHash = hash(merged);
      // pagehide, beforeunload and visibilitychange can all fire for one leave.
      if (mergedHash === hash(remoteSnap) || mergedHash === lastFlushed) return;
      const body = JSON.stringify({ key: appKey, data: merged, updated_at: new Date().toISOString() });
      if (byteLength(body) > KEEPALIVE_MAX) return;   // too big for keepalive: the next load pushes it
      try {
        fetch(SUPABASE_URL + '/rest/v1/app_state?on_conflict=key', {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=minimal',
          },
          body: body,
          keepalive: true,
        }).catch(() => {});
      } catch (e) { return; }
      lastFlushed = mergedHash;
      remember(mergedHash);
      setFlushed(appKey, rec);
    }

    instances[appKey] = {
      matches: matches,
      remember: remember,
      wrote: function (data) { remoteSnap = data; },
      kick: kick,
    };
    kick();
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
      else if (Date.now() - lastRun > 5000) kick();
    });
    window.addEventListener('pageshow', (e) => { if (e.persisted) kick(); });
    window.addEventListener('online', kick);
  };

  // ---- For topbar.js (and any page that writes another page's row) ----
  window.rowSync = {
    version: 2,
    stable: stable,
    hash: hash,
    // True when a sync instance on this page already syncs this key.
    handles: function (appKey, key) {
      const inst = instances[appKey];
      return !!(inst && inst.matches(key));
    },
    isDirty: function (appKey, key) { return getDirty(appKey).indexOf(key) !== -1; },
    markDirty: function (appKey, keys) { markDirty(appKey, keys); },
    // { ok, exists, data }; ok is false on any error.
    read: function (appKey) { return readRow(appKey); },
    // Read the row, merge `partial` into it ({ key: value }, undefined
    // deletes; or a function (rowDataCopy) => partial | null), upsert.
    // Resolves false and writes nothing if the read fails. Clears the
    // dirty mark of every key whose local value equals what was pushed.
    mergePush: async function (appKey, partial) {
      if (!appKey) return false;
      const res = await readRow(appKey);
      if (!res.ok) return false;
      const base = res.data;
      let part = partial;
      if (typeof partial === 'function') {
        try { part = partial(Object.assign({}, base)); } catch (e) { return false; }
      }
      if (!part || typeof part !== 'object') return false;
      const merged = Object.assign({}, base);
      const pushed = {};
      for (const k of Object.keys(part)) {
        if (part[k] === undefined) delete merged[k]; else merged[k] = part[k];
        pushed[k] = hash(part[k]);
      }
      if (stable(merged) !== stable(base)) {
        const inst = instances[appKey];
        if (inst) inst.remember(hash(merged));
        if (!(await writeRow(appKey, merged))) return false;
        if (inst) inst.wrote(merged);
      }
      if (res.exists || stable(merged) !== stable(base)) setKnown(appKey, merged);
      settleDirty(appKey, pushed);
      return true;
    },
  };
})();
