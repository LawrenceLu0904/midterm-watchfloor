// Tiny data + drawing runtime for the Watchfloor page (static hosting, no build step).
//   dash.load(id, url)  fetch a JSON file once; {rows:[...]} files expose the rows, others the whole object
//   dash.data(id)       -> {status: 'idle'|'loading'|'ok'|'error', data, raw}
//   dash.draw(name, fn | {mount(el) -> model, update(el, model)})  register and run a drawing for [data-draw=name]
//   dash.draw(name)     re-run one drawing;  dash.drawAll() re-run every drawing on the next frame
//   dash.onData(fn)     called with the id after each load finishes (ok or error)
// Elements inside [hidden] are skipped; they draw when shown and redrawn.
(() => {
  const store = new Map(), draws = new Map(), models = new WeakMap(), subs = [];
  let frame = 0;
  function run(name) {
    const spec = draws.get(name);
    if (!spec) return;
    document.querySelectorAll(`[data-draw="${CSS.escape(name)}"]`).forEach((el) => {
      if (el.closest('[hidden]')) return;
      try {
        if (typeof spec === 'function') { spec(el); return; }
        let m = models.get(el);
        if (!m) { m = spec.mount ? spec.mount(el) || {} : {}; models.set(el, m); }
        if (spec.update) spec.update(el, m);
      } catch (e) { console.error(`draw ${name}:`, e); }
    });
  }
  const dash = {
    data(id) { return store.get(id) || {status: 'idle', data: null, raw: null}; },
    load(id, url) {
      const cur = store.get(id);
      if (cur && (cur.status === 'ok' || cur.status === 'loading')) return;
      store.set(id, {status: 'loading', data: null, raw: null});
      fetch(url)
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then((j) => store.set(id, {status: 'ok', data: Array.isArray(j.rows) ? j.rows : j, raw: j}))
        .catch((e) => { console.warn(`load ${url}:`, e); store.set(id, {status: 'error', data: null, raw: null, error: String(e)}); })
        .finally(() => { subs.forEach((f) => { try { f(id); } catch (e) { console.error(e); } }); dash.drawAll(); });
    },
    draw(name, spec) { if (spec !== undefined) draws.set(name, spec); run(name); },
    drawAll() {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; for (const n of draws.keys()) run(n); });
    },
    onData(fn) { subs.push(fn); },
  };
  let lastW = 0;
  window.addEventListener('resize', () => { if (window.innerWidth !== lastW) { lastW = window.innerWidth; dash.drawAll(); } });
  window.dash = dash;
})();
