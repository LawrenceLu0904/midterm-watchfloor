// Midterm Watchfloor page logic. Data: data/*.json (built by build_site_data.py). Runtime: assets/dash.js. Charts: d3 v7.
(() => {
  'use strict';
  const ET = 'America/New_York';
  const F = {
    time: new Intl.DateTimeFormat('en-US', {timeZone: ET, hour: 'numeric', minute: '2-digit'}),
    hour: new Intl.DateTimeFormat('en-US', {timeZone: ET, hour: 'numeric'}),
    day: new Intl.DateTimeFormat('en-US', {timeZone: ET, weekday: 'short', month: 'short', day: 'numeric'}),
    md: new Intl.DateTimeFormat('en-US', {timeZone: ET, month: 'short', day: 'numeric'}),
    iso: new Intl.DateTimeFormat('en-CA', {timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit'}),
  };
  const D = (t) => new Date(t * 1000);
  const etDate = (t) => F.iso.format(D(t));
  const when = (t) => `${F.md.format(D(t))}, ${F.time.format(D(t))}`;
  const U = (y, m, d, h) => Date.UTC(y, m - 1, d, h) / 1000;
  // ET is UTC-4 until 2 AM on Nov 1, 2026 and UTC-5 after; the window holds no other change.
  const etOff = (t) => (t < U(2026, 11, 1, 6) ? 4 : 5) * 3600;
  const N0 = U(2026, 11, 3, 22), N1 = U(2026, 11, 4, 14);   // per-minute detail window (Reddit, bets)
  const RANGES = {night: [U(2026, 11, 3, 23), U(2026, 11, 4, 13)], week: [U(2026, 11, 1, 4), U(2026, 11, 9, 5)], campaign: [U(2026, 10, 20, 4), U(2026, 11, 12, 5)]};
  const C = {dem: '#3d8bff', rep: '#ff4d5a', ind: '#b48cff', mid: '#4a4f63', idle: '#25303d', none: '#121a24', fg: '#dbe4ee', muted: '#8a9bb0',
    amber: '#f0b44c', house: '#86b6ff', senate: '#e9eef5', social: '#c77dff', bsky: '#5fb3ff'};
  const DATASETS = ['states_geo', 'races', 'race_odds', 'milestones', 'control', 'gas', 'oil', 'weather_state', 'weather_grid', 'turnout_races',
    'turnout_daily', 'streams', 'chat', 'polymarket', 'bets_flow', 'bets_state', 'big_bets', 'reddit_hourly', 'reddit_night', 'bluesky', 'moments',
    'kalshi_cats', 'kalshi_big'];
  const WF = window.WF = {t: U(2026, 11, 4, 3), range: RANGES.night.slice(), rangeKey: 'night', layer: 'races', office: 'Senate', state: null,
    race: 'CONTROLS-2026', moment: null, embedsOn: false, tape: 'market', playing: false, timer: null};

  // ------------------------------------------------------------------ helpers
  const ok = (id) => dash.data(id).status === 'ok';
  const rowsOf = (id) => { const d = dash.data(id); return d.status === 'ok' && Array.isArray(d.data) ? d.data : []; };
  const stat = (id) => dash.data(id).status;
  const cache = new Map();
  function memo(key, deps, build) {
    const ds = deps.map((id) => dash.data(id).data);
    const c = cache.get(key);
    if (c && c.ds.every((x, i) => x === ds[i])) return c.v;
    const v = build(...ds.map((x) => x || []));
    cache.set(key, {ds, v});
    return v;
  }
  function group(arr, key, sortKey) {
    const g = new Map();
    for (const r of arr) { const k = key(r); if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
    if (sortKey) for (const s of g.values()) s.sort((a, b) => (a[sortKey] < b[sortKey] ? -1 : a[sortKey] > b[sortKey] ? 1 : 0));
    return g;
  }
  function lastAt(s, v, k = 't') {
    if (!s || !s.length || s[0][k] > v) return null;
    let lo = 0, hi = s.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (s[m][k] <= v) lo = m; else hi = m - 1; }
    return s[lo];
  }
  function firstIdx(s, v, k = 't') {   // first index with s[i][k] >= v
    let lo = 0, hi = s.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (s[m][k] < v) lo = m + 1; else hi = m; }
    return lo;
  }
  function sumBetween(s, a, b, f) { let x = 0; for (let i = firstIdx(s, a); i < s.length && s[i].t < b; i++) x += f(s[i]); return x; }
  // spread each row's value over the bins its [t, t + r) interval overlaps
  function binSum(rows, a, b, nb, val, defR) {
    const bw = (b - a) / nb, out = new Float64Array(nb);
    for (const d of rows) {
      const r = d.r || defR, s = d.t, e = d.t + r;
      if (e <= a || s >= b) continue;
      const v = val(d);
      if (!v) continue;
      const lo = Math.max(s, a), hi = Math.min(e, b);
      for (let k = Math.floor((lo - a) / bw); k < nb; k++) {
        const bs = a + k * bw, be = bs + bw, ov = Math.min(hi, be) - Math.max(lo, bs);
        if (ov > 0) out[k] += (v * ov) / r;
        if (be >= hi) break;
      }
    }
    return out;
  }
  function ticks(a, b, W) {
    const span = b - a, target = Math.max(3, Math.floor(W / 95));
    const steps = [900, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 172800, 345600, 604800];
    const step = steps.find((s) => span / s <= target) || 604800;
    const out = [];
    if (step < 86400) { for (let t = Math.ceil((a - etOff(a)) / step) * step + etOff(a); t <= b; t += step) out.push(t); }
    else {
      const days = step / 86400;
      let d = new Date(`${etDate(a)}T00:00:00Z`);
      for (let i = 0; i < 400; i++) {
        const t = d.getTime() / 1000 + etOff(d.getTime() / 1000 + 5 * 3600);
        if (t > b) break;
        if (t >= a) out.push(t);
        d = new Date(d.getTime() + days * 86400000);
      }
    }
    return {out, step};
  }
  const tickLabel = (t, step) => (step >= 86400 || (t - etOff(t)) % 86400 === 0 ? F.md.format(D(t)) : F.hour.format(D(t)));
  const median = (xs) => { if (!xs.length) return 0; const s = xs.slice().sort((p, q) => p - q), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const pct1 = (p) => `${(p * 100).toFixed(1)}%`;
  const fmtInt = d3.format(',');
  const fmtVotes = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : `${Math.round(n / 1e3)}K`);
  const fmtN = (x) => (x >= 1e6 ? `${(x / 1e6).toFixed(x >= 1e8 ? 0 : 1)}M` : x >= 1e3 ? `${(x / 1e3).toFixed(x >= 1e4 ? 0 : 1)}K` : x >= 10 || x === 0 ? `${Math.round(x)}` : x.toFixed(x < 1 ? 2 : 1));
  const usd = (x) => (x >= 1e6 ? `$${(x / 1e6).toFixed(x >= 1e7 ? 0 : 1)}M` : x >= 1e3 ? `$${(x / 1e3).toFixed(x >= 1e4 ? 0 : 1)}K` : x >= 1 || x === 0 ? `$${Math.round(x)}` : `$${x.toFixed(2)}`);
  const signed = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(0)}%`;
  const cents = (p) => `${Math.round(p * 100)}¢`;
  const party = (w) => ({D: 'Democrats', R: 'Republicans'}[w] || 'other');
  const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); };

  // ------------------------------------------------------------------ indexes
  const RX = () => memo('races', ['races'], (races) => ({
    byState: group(races, (r) => r.state),
    byId: new Map(races.map((r) => [r.race_id, r])),
    calls: races.filter((r) => r.called_ts && r.winner).sort((a, b) => a.called_ts - b.called_ts),
  }));
  const ODDS = () => memo('odds', ['race_odds'], (o) => group(o, (r) => r.race_id, 't'));
  const CTRL = () => memo('ctrl', ['control'], (c) => group(c, (r) => r.chamber, 't'));
  const GAS = () => memo('gas', ['gas'], (g) => ({
    m: new Map(g.map((r) => [`${r.state}|${r.date}`, r])),
    byState: group(g, (r) => r.state, 'date'),
    ext: d3.extent(g.filter((r) => r.state !== 'US'), (r) => r.price),
  }));
  const OIL = () => memo('oil', ['oil'], (o) => group(o, (r) => r.series, 'date'));
  const WX = () => memo('wx', ['weather_state'], (w) => new Map(w.map((r) => [`${r.state}|${r.date}`, r])));
  const TURN = () => memo('turn', ['turnout_races', 'turnout_daily'], (tr, td) => ({byState: group(tr, (r) => r.state), daily: group(td, (r) => r.race_id, 't')}));
  const CHAT = () => memo('chat', ['chat'], (c) => { const m = new Map(); for (const r of c) m.set(r.t, (m.get(r.t) || 0) + r.messages); return m; });
  const CHATSPAN = () => memo('chatspan', ['chat'], (c) => d3.extent(c, (r) => r.t));
  const NAMES = () => memo('names', ['states_geo'], (g) => new Map(((g && g.features) || []).map((f) => [f.properties.state, f.properties.name])));
  const FLOW = () => memo('flow', ['bets_flow'], (f) => f.slice().sort((a, b) => a.t - b.t));
  const BST = () => memo('bst', ['bets_state'], (b) => ({
    m: new Map(b.map((r) => [`${r.state}|${r.t}`, r])), byState: group(b, (r) => r.state, 't'), max: d3.max(b, (r) => r.usd) || 1e6}));
  const BIG = () => memo('big', ['big_bets'], (b) => b.slice().sort((p, q) => p.t - q.t));
  // Reddit: national subreddits (state 'US') as one series, per minute on election night when that file exists
  const RED_US = () => memo('redus', ['reddit_hourly', 'reddit_night'], (h, n) => {
    const night = n.length > 0;
    const rows = h.filter((r) => r.state === 'US' && !(night && r.t >= N0 && r.t < N1)).map((r) => ({t: r.t, r: 3600, c: r.comments, p: r.posts}));
    for (const r of n) rows.push({t: r.t, r: 60, c: r.comments, p: r.posts});
    return rows.sort((a, b) => a.t - b.t);
  });
  const RED_ST = () => memo('redst', ['reddit_hourly'], (h) => {
    const byState = group(h.filter((r) => r.state !== 'US'), (r) => r.state, 't');
    const usual = new Map(), sub = new Map();
    for (const [st, s] of byState) { usual.set(st, median(s.map((r) => r.comments))); sub.set(st, s[0].sub); }
    return {byState, usual, sub};
  });
  const BSKY = () => memo('bsky', ['bluesky'], (b) => ({all: b.slice().sort((p, q) => p.t - q.t), byState: group(b, (r) => r.state, 't')}));
  const MOMENTS = () => memo('moments', ['moments'], (m) => m.slice().sort((a, b) => a.t - b.t));

  const ctrlRow = (ev) => rowsOf('milestones').find((m) => m.event === ev);
  function raceInfo(id) {
    if (id === 'CONTROLS-2026' || id === 'CONTROLH-2026') {
      const chamber = id === 'CONTROLS-2026' ? 'Senate' : 'House', ms = ctrlRow(id) || {};
      return {race_id: id, label: `${chamber} control`, office: 'Control', state: 'US', chamber, winner: ms.winner || '', called_ts: ms.settled_ts || null, volume: ms.volume || 0};
    }
    return ok('races') ? RX().byId.get(id) || null : null;
  }
  function raceFor(st, office) {
    const list = (RX().byState.get(st) || []).filter((r) => r.office === office);
    return list.find((r) => !r.special) || list[0] || null;
  }
  const primaryRace = (st) => raceFor(st, 'Senate') || raceFor(st, 'Governor');
  function pDem(r, t) {
    if (!r) return null;
    if (r.called_ts && t >= r.called_ts && (r.winner === 'D' || r.winner === 'R')) return {p: r.winner === 'D' ? 1 : 0, settled: true};
    const row = lastAt(ODDS().get(r.race_id), t);
    return row ? {p: row.p_dem, row, settled: false} : null;
  }
  function houseAt(st, t) {
    const hs = (RX().byState.get(st) || []).filter((r) => r.office === 'House');
    let d = 0, rr = 0, o = 0;
    for (const x of hs) if (x.called_ts && x.called_ts <= t) { if (x.winner === 'D') d++; else if (x.winner === 'R') rr++; else o++; }
    return {n: hs.length, d, r: rr, o, open: hs.length - d - rr - o};
  }
  function turnoutAt(st, t) {
    const tr = TURN().byState.get(st) || [];
    const race = tr.find((x) => x.office === 'Senate') || tr.find((x) => x.office === 'Governor');
    if (!race) return null;
    const row = lastAt(TURN().daily.get(race.race_id), t);
    return {race, row, ratio: row && race.baseline_votes ? row.implied_votes / race.baseline_votes : null};
  }
  function socialAt(st, t) {
    if (!ok('reddit_hourly')) return null;
    const S = RED_ST(), row = lastAt(S.byState.get(st), t);
    if (!row || row.t < t - 3600) return {sub: S.sub.get(st), row: null};
    const usual = S.usual.get(st) || 0;
    return {sub: row.sub, row, usual, ratio: usual > 0 ? row.comments / usual : null};
  }
  const bskyAt = (st, t) => (ok('bluesky') ? lastAt(BSKY().byState.get(st), t) : null);

  const partyScale = d3.scaleLinear().domain([0, 0.5, 1]).range([C.rep, C.mid, C.dem]).interpolate(d3.interpolateLab).clamp(true);
  const rainScale = d3.scaleSqrt().domain([0, 25]).range(['#16222e', '#36c5d6']).clamp(true);
  const turnScale = d3.scaleLinear().domain([0.8, 1, 1.2]).range(['#e2734a', '#3a4654', '#46d39a']).interpolate(d3.interpolateLab).clamp(true);
  const socialScale = d3.scaleLog().domain([0.5, 1.4, 4]).range(['#1a2430', '#46405e', '#c77dff']).interpolate(d3.interpolateLab).clamp(true);
  const betsScale = () => d3.scaleLog().domain([1e3, Math.sqrt(1e3 * Math.max(1e4, BST().max)), Math.max(1e4, BST().max)]).range(['#17222e', '#6b5a2a', '#ffd166']).interpolate(d3.interpolateLab).clamp(true);
  const gasScale = () => { const [a, b] = GAS().ext[0] != null ? GAS().ext : [3, 5]; return d3.scaleLinear().domain([a, (a + b) / 2, b]).range(['#1f3446', '#9a7a33', '#ffb347']).interpolate(d3.interpolateLab).clamp(true); };

  function fillFor(st, t) {
    const day = F.md.format(D(t));
    const need = {races: ['races'], bets: ['bets_state'], social: ['reddit_hourly'], gas: ['gas'], rain: ['weather_state'], turnout: ['turnout_races', 'turnout_daily']}[WF.layer];
    if (need.some((id) => stat(id) === 'error')) return {fill: C.none, text: 'This layer\'s data is not available'};
    if (need.some((id) => !ok(id))) return {fill: C.none, text: 'Loading…'};
    if (WF.layer === 'races') {
      if (WF.office === 'House') {
        const h = houseAt(st, t);
        if (!h.n) return {fill: C.none, text: 'No House race in the data'};
        if (h.n === h.open) return {fill: C.idle, text: `${h.n} House seats · none settled yet`};
        return {fill: partyScale(0.5 + (h.d - h.r) / (2 * h.n)), text: `${h.n} House seats · settled D ${h.d}, R ${h.r}${h.o ? `, other ${h.o}` : ''} · ${h.open} open`};
      }
      const r = raceFor(st, WF.office);
      if (!r) return {fill: C.none, text: `No ${WF.office} race in 2026`};
      const x = pDem(r, t);
      if (!x) return {fill: C.idle, text: `${r.label} · no price at this time`};
      if (x.settled) return {fill: x.p ? C.dem : C.rep, text: `${r.label} · settled ${r.winner} at ${when(r.called_ts)}`};
      return {fill: partyScale(x.p), text: `${r.label} · P(D) ${pct1(x.p)}`};
    }
    if (WF.layer === 'bets') {
      const h = Math.floor(t / 3600) * 3600, b = BST().m.get(`${st}|${h}`);
      return b ? {fill: betsScale()(Math.max(1e3, b.usd)), text: `${usd(b.usd)} in ${fmtInt(b.bets)} bets on this state's races, ${F.time.format(D(h))}–${F.time.format(D(h + 3600))}`}
        : {fill: C.none, text: `No bets on this state's races, ${F.time.format(D(h))}–${F.time.format(D(h + 3600))}`};
    }
    if (WF.layer === 'social') {
      const s = socialAt(st, t), bs = bskyAt(st, t);
      const bText = bs && bs.t > t - 600 ? ` · Bluesky: ${bs.posts} top posts in 10 min` : '';
      if (!s || !s.row) return {fill: C.none, text: `${s && s.sub ? `r/${s.sub}: no count for this hour` : 'No subreddit tracked'}${bText}`};
      return {fill: s.ratio == null ? C.idle : socialScale(Math.max(0.5, s.ratio)),
        text: `r/${s.sub}: ${fmtInt(s.row.comments)} comments, ${fmtInt(s.row.posts)} posts this hour${s.ratio != null ? ` (${s.ratio.toFixed(1)}× its usual hour)` : ''}${bText}`};
    }
    if (WF.layer === 'gas') {
      const g = GAS().m.get(`${st}|${etDate(t)}`);
      return g ? {fill: gasScale()(g.price), text: `AAA regular $${g.price.toFixed(3)} on ${day}`} : {fill: C.none, text: `No AAA state market on ${day}`};
    }
    if (WF.layer === 'rain') {
      const w = WX().get(`${st}|${etDate(t)}`);
      return w ? {fill: rainScale(w.prcp_mm), text: `${w.prcp_mm.toFixed(1)} mm average on ${day} · ${Math.round(w.wet_share * 100)}% of ${w.stations} stations had 2.5 mm or more`} : {fill: C.none, text: `No station data for ${day}`};
    }
    const x = turnoutAt(st, t);
    if (!x) return {fill: C.none, text: 'No statewide turnout market'};
    if (!x.row) return {fill: C.idle, text: `${x.race.office} turnout market · not trading yet`};
    const imp = `${x.race.office} turnout market puts 50/50 at ${fmtVotes(x.row.implied_votes)} votes${x.row.flag ? ` (${x.row.flag} its ladder)` : ''}`;
    if (x.ratio == null) return {fill: C.idle, text: `${imp} · no comparison year`};
    return {fill: turnScale(x.ratio), text: `${imp} · ${signed(x.ratio - 1)} vs ${fmtVotes(x.race.baseline_votes)} in ${x.race.baseline_year}`};
  }

  // ------------------------------------------------------------------ state + redraw plumbing
  const CURSOR_DRAWS = ['map', 'feed', 'clock', 'scrub', 'scrub-clock', 'kpi-sen', 'kpi-house', 'kpi-called', 'kpi-bets', 'kpi-reddit', 'kpi-gas',
    'kpi-wti', 'kpi-chat', 'lanes', 'st-races', 'st-spark', 'st-bets', 'st-bets-spark', 'st-social', 'st-gas', 'st-gas-spark', 'st-rain', 'st-turnout',
    'tape', 'tape-sub', 'mkt-vol', 'mkt-head', 'mkt-chart', 'mkt-table', 'kpi-kalshi', 'moments', 'moment-detail'];
  const STATE_DRAWS = ['map', 'st-name', 'st-races', 'st-spark', 'st-bets', 'st-bets-spark', 'st-social', 'st-gas', 'st-gas-spark', 'st-rain', 'st-turnout'];
  const RACE_DRAWS = ['race-select', 'mkt-vol', 'mkt-q', 'mkt-head', 'mkt-chart', 'mkt-table', 'st-races', 'tape', 'tape-sub'];
  const redraw = (names) => names.forEach((n) => dash.draw(n));
  function setT(t) {
    const [a, b] = WF.range;
    WF.t = Math.round(Math.min(b, Math.max(a, t)) / 60) * 60;
    redraw(CURSOR_DRAWS);
  }
  function pick(st, {race = true} = {}) {
    WF.state = st;
    if (race && ok('races')) { const r = primaryRace(st); if (r) WF.race = r.race_id; }
    redraw(STATE_DRAWS); redraw(RACE_DRAWS);
  }
  function pickRace(id) {
    WF.race = id;
    const r = raceInfo(id);
    if (r && r.state && r.state !== 'US' && r.state !== WF.state) { WF.state = r.state; redraw(STATE_DRAWS); }
    redraw(RACE_DRAWS);
  }
  function pickMoment(m) {
    WF.moment = m.id;
    if (m.t < WF.range[0] || m.t > WF.range[1]) { WF.rangeKey = 'night'; WF.range = RANGES.night.slice(); syncUI(); }
    if (m.race_id) WF.race = m.race_id;
    if (m.state && m.state !== 'US') WF.state = m.state;
    redraw(STATE_DRAWS); redraw(RACE_DRAWS);
    setT(m.t);
  }
  const stepSize = () => Math.max(60, Math.round((WF.range[1] - WF.range[0]) / 400 / 60) * 60);

  function syncUI() {
    document.querySelectorAll('.wf [data-layer]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layer === WF.layer)));
    document.querySelectorAll('.wf [data-office]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.office === WF.office)));
    document.querySelectorAll('.wf [data-range]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.range === WF.rangeKey)));
    document.querySelectorAll('.wf [data-tape]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tape === WF.tape)));
    const office = document.getElementById('wf-office');
    if (office) office.hidden = WF.layer !== 'races';
    const want = WF.layer === 'races' ? (WF.office === 'House' ? 'house' : 'races') : WF.layer;
    document.querySelectorAll('.wf [data-legend]').forEach((l) => { l.hidden = l.dataset.legend !== want; });
    document.querySelectorAll('.wf [data-play-btn]').forEach((b) => {
      b.setAttribute('aria-pressed', String(WF.playing));
      b.querySelectorAll('[data-play]').forEach((s) => { s.hidden = (s.dataset.play === 'running') !== WF.playing; });
    });
  }
  function stop() { WF.playing = false; if (WF.timer) clearInterval(WF.timer); WF.timer = null; syncUI(); }
  function play() {
    if (WF.t >= WF.range[1]) WF.t = WF.range[0];
    WF.playing = true; WF.moment = null; syncUI();
    WF.timer = setInterval(() => {
      const next = WF.t + Math.max(60, Math.round((WF.range[1] - WF.range[0]) / 480 / 60) * 60);
      setT(next);
      if (next >= WF.range[1]) stop();
    }, 110);
  }
  document.querySelectorAll('.wf [data-layer]').forEach((b) => b.addEventListener('click', () => {
    WF.layer = b.dataset.layer; syncUI(); redraw(['map', 'leg-gas-min', 'leg-gas-max', 'leg-bets-max']);
  }));
  document.querySelectorAll('.wf [data-office]').forEach((b) => b.addEventListener('click', () => { WF.office = b.dataset.office; syncUI(); dash.draw('map'); }));
  document.querySelectorAll('.wf [data-range]').forEach((b) => b.addEventListener('click', () => {
    WF.rangeKey = b.dataset.range; WF.range = RANGES[WF.rangeKey].slice(); syncUI();
    setT(WF.t < WF.range[0] || WF.t > WF.range[1] ? WF.range[0] : WF.t);
    redraw(['st-spark']);
  }));
  document.querySelectorAll('.wf [data-play-btn]').forEach((b) => b.addEventListener('click', () => (WF.playing ? stop() : play())));
  document.querySelectorAll('.wf [data-tape]').forEach((b) => b.addEventListener('click', () => { WF.tape = b.dataset.tape; syncUI(); redraw(['tape', 'tape-sub']); }));
  const scrub = document.getElementById('wf-scrub');
  scrub.addEventListener('input', () => { if (WF.playing) stop(); WF.moment = null; setT(+scrub.value); });
  document.getElementById('wf-race-select').addEventListener('change', (e) => pickRace(e.target.value));

  dash.onData((id) => {
    if (id === 'races' && !WF.state && ok('races')) {
      const top = rowsOf('races').filter((r) => r.office === 'Senate').sort((a, b) => b.volume - a.volume)[0];
      WF.state = top ? top.state : null;
    }
  });

  // ------------------------------------------------------------------ header and reading strip
  const stamp = (m) => (m && m.settled_ts ? `${F.time.format(D(m.settled_ts))} ET on ${F.md.format(D(m.settled_ts))}` : '—');
  dash.draw('tk-sen-winner', (el) => { const m = ctrlRow('CONTROLS-2026'); el.textContent = m ? `the ${party(m.winner)}` : '—'; });
  dash.draw('tk-house-winner', (el) => { const m = ctrlRow('CONTROLH-2026'); el.textContent = m ? `the ${party(m.winner)}` : '—'; });
  dash.draw('tk-sen-time', (el) => { el.textContent = stamp(ctrlRow('CONTROLS-2026')); });
  dash.draw('tk-house-time', (el) => { el.textContent = stamp(ctrlRow('CONTROLH-2026')); });
  dash.draw('tk-bigbet', (el) => {
    const b = ok('big_bets') && ok('races') ? BIG().reduce((x, y) => (!x || y.usd > x.usd ? y : x), null) : null;
    const r = b && raceInfo(b.race_id);
    if (!b || !r) { el.textContent = ''; return; }
    const won = r.winner ? (r.winner === b.backs ? 'and won' : 'and lost') : '';
    el.textContent = `The largest bet with real doubt in it was ${usd(b.usd)} backing the ${party(b.backs)} in ${r.label} at ${cents(b.price)}, ${when(b.t)}, ${won}.`.replace(', .', '.');
  });

  const clockText = () => `${F.day.format(D(WF.t))} · ${F.time.format(D(WF.t))}`;
  dash.draw('clock', (el) => { el.textContent = clockText(); });
  dash.draw('scrub-clock', (el) => { el.textContent = clockText(); });
  dash.draw('scrub', (el) => { el.min = WF.range[0]; el.max = WF.range[1]; el.value = WF.t; el.setAttribute('aria-valuetext', clockText()); });
  const kpiCtrl = (chamber) => (el) => {
    const r = ok('control') ? lastAt(CTRL().get(chamber), WF.t) : null;
    el.classList.remove('is-d', 'is-r');
    if (!r) { el.textContent = '—'; return; }
    el.textContent = pct1(r.p_dem);
    el.classList.add(r.p_dem >= 0.5 ? 'is-d' : 'is-r');
  };
  dash.draw('kpi-sen', kpiCtrl('Senate'));
  dash.draw('kpi-house', kpiCtrl('House'));
  dash.draw('kpi-called', (el) => { el.textContent = ok('races') ? fmtInt(RX().calls.filter((r) => r.called_ts <= WF.t).length) : '—'; });
  dash.draw('kpi-total', (el) => { el.textContent = ok('races') ? fmtInt(rowsOf('races').length) : '—'; });
  dash.draw('kpi-bets', (el) => {
    if (!ok('bets_flow')) { el.textContent = stat('bets_flow') === 'error' ? 'n/a' : '—'; return; }
    const s = FLOW(), a = WF.t - 3600;
    let d = 0, r = 0, o = 0;
    for (let i = firstIdx(s, a); i < s.length && s[i].t < WF.t; i++) { d += s[i].d; r += s[i].rr; o += s[i].o; }
    const tot = d + r + o;
    el.textContent = usd(tot);
    el.classList.toggle('is-d', tot > 0 && d > r);
    el.classList.toggle('is-r', tot > 0 && r >= d);
    el.title = tot ? `${Math.round((100 * d) / tot)}% backing D, ${Math.round((100 * r) / tot)}% backing R` : '';
  });
  dash.draw('kpi-kalshi', (el) => {
    if (!ok('kalshi_cats')) { el.textContent = stat('kalshi_cats') === 'error' ? 'n/a' : '—'; return; }
    el.textContent = fmtN(binSum(rowsOf('kalshi_cats'), WF.t - 3600, WF.t, 1, (r) => r.n, 3600)[0]);
  });
  dash.draw('kpi-reddit', (el) => {
    if (!ok('reddit_hourly')) { el.textContent = stat('reddit_hourly') === 'error' ? 'n/a' : '—'; return; }
    const s = RED_US(), inNight = ok('reddit_night') && WF.t >= N0 && WF.t < N1;
    const span = inNight ? 600 : 3600, a = inNight ? WF.t - 600 : Math.floor(WF.t / 3600) * 3600;
    const c = sumBetween(s, a, a + span, (r) => r.c);
    el.textContent = `${fmtInt(Math.round(c / (span / 60)))}`;
  });
  dash.draw('kpi-gas', (el) => {
    const g = ok('gas') ? GAS().m.get(`US|${etDate(WF.t)}`) : null;
    el.textContent = g ? `$${g.price.toFixed(3)}` : '—';
  });
  dash.draw('kpi-wti', (el) => {
    const o = ok('oil') ? lastAt(OIL().get('WTI'), etDate(WF.t), 'date') : null;
    el.textContent = o ? `$${o.price.toFixed(2)}` : '—';
  });
  dash.draw('kpi-chat', (el) => {
    const [a, b] = ok('chat') ? CHATSPAN() : [null, null];
    if (a == null || WF.t < a || WF.t > b + 60) { el.textContent = '—'; return; }
    el.textContent = fmtInt(CHAT().get(Math.floor(WF.t / 60) * 60) || 0);
  });
  dash.draw('leg-gas-min', (el) => { el.textContent = ok('gas') && GAS().ext[0] != null ? `$${GAS().ext[0].toFixed(2)}` : '—'; });
  dash.draw('leg-gas-max', (el) => { el.textContent = ok('gas') && GAS().ext[1] != null ? `$${GAS().ext[1].toFixed(2)}` : '—'; });
  dash.draw('leg-bets-max', (el) => { el.textContent = ok('bets_state') ? usd(BST().max) : '—'; });

  // ------------------------------------------------------------------ map
  dash.draw('map', {
    mount(el) {
      const box = d3.select(el);
      const msg = box.append('p').attr('class', 'wf-msg');
      const svg = box.append('svg').attr('class', 'wf-map-svg').attr('role', 'img')
        .attr('aria-label', 'Map of U.S. states colored by the chosen layer at the cursor time');
      const g = {states: svg.append('g'), dots: svg.append('g'), rings: svg.append('g'), labels: svg.append('g').attr('class', 'wf-labels')};
      const tip = box.append('div').attr('class', 'wf-tip').attr('hidden', '');
      return {box, msg, svg, g, tip, tipB: tip.append('b'), tipS: tip.append('span'), w: 0};
    },
    update(el, m) {
      const geo = dash.data('states_geo');
      if (geo.status !== 'ok' || !geo.data || !geo.data.features) {
        m.svg.attr('hidden', ''); m.msg.attr('hidden', null).text(geo.status === 'error' ? 'Failed to load the map.' : 'Loading map…'); return;
      }
      m.msg.attr('hidden', ''); m.svg.attr('hidden', null);
      const feats = geo.data.features;
      const W = Math.max(280, Math.floor(el.clientWidth || 800)), H = Math.round(W * 0.6);
      let resized = false;
      if (m.w !== W) {
        m.w = W; resized = true;
        m.proj = d3.geoAlbersUsa().fitExtent([[8, 8], [W - 8, H - 8]], {type: 'FeatureCollection', features: feats});
        m.path = d3.geoPath(m.proj);
        m.cent = new Map(feats.map((f) => [f.properties.state, m.path.centroid(f)]));
        m.svg.attr('viewBox', `0 0 ${W} ${H}`).attr('height', H);
      }
      const t = WF.t;
      const info = new Map(feats.map((f) => [f.properties.state, fillFor(f.properties.state, t)]));
      m.info = info;
      const showTip = (ev, f) => {
        const [x, y] = d3.pointer(ev, el);
        m.tipB.text(f.properties.name); m.tipS.text(m.info.get(f.properties.state).text);
        m.tip.attr('hidden', null).style('left', `${Math.max(0, Math.min(x + 14, el.clientWidth - 270))}px`).style('top', `${Math.max(0, y - 10)}px`);
      };
      const paths = m.g.states.selectAll('path').data(feats, (f) => f.properties.state).join((en) => en.append('path').attr('class', 'wf-st').attr('tabindex', 0)
        .on('click', (ev, f) => pick(f.properties.state))
        .on('keydown', (ev, f) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(f.properties.state); } }));
      paths.on('pointermove', showTip).on('pointerleave', () => m.tip.attr('hidden', ''));
      if (resized || paths.attr('d') == null) paths.attr('d', m.path);
      paths.style('fill', (f) => info.get(f.properties.state).fill)
        .classed('is-sel', (f) => f.properties.state === WF.state)
        .attr('aria-label', (f) => `${f.properties.name}: ${info.get(f.properties.state).text}`);
      paths.filter('.is-sel').raise();

      const recent = WF.layer === 'races' && ok('races') ? RX().calls.filter((r) => r.office === WF.office && r.called_ts <= t && r.called_ts > t - 1800) : [];
      const okC = (st) => m.cent.get(st) && !isNaN(m.cent.get(st)[0]);
      m.g.rings.selectAll('circle').data(recent.filter((r) => okC(r.state)), (r) => r.race_id).join('circle').attr('class', 'wf-ring')
        .attr('cx', (r, i) => m.cent.get(r.state)[0] + (r.office === 'House' ? ((i % 5) - 2) * 4 : 0))
        .attr('cy', (r) => m.cent.get(r.state)[1]).attr('r', 9)
        .style('stroke', (r) => (r.winner === 'D' ? C.dem : r.winner === 'R' ? C.rep : C.ind));

      const dots = WF.layer === 'rain' && etDate(t) === '2026-11-03' && ok('weather_grid')
        ? rowsOf('weather_grid').map((d) => ({d, p: m.proj([d.lon, d.lat])})).filter((x) => x.p) : [];
      m.g.dots.selectAll('circle').data(dots, (x) => `${x.d.lat},${x.d.lon}`).join('circle')
        .attr('cx', (x) => x.p[0]).attr('cy', (x) => x.p[1]).attr('r', (x) => Math.min(4.2, 0.7 + Math.sqrt(x.d.prcp_mm) * 0.7))
        .style('fill', (x) => rainScale(x.d.prcp_mm)).style('opacity', (x) => (x.d.prcp_mm < 0.5 ? 0.12 : 0.9)).style('pointer-events', 'none');

      const lab = W >= 640 ? feats.filter((f) => okC(f.properties.state)) : [];
      m.g.labels.selectAll('text').data(lab, (f) => f.properties.state).join('text')
        .attr('x', (f) => m.cent.get(f.properties.state)[0]).attr('y', (f) => m.cent.get(f.properties.state)[1] + 3).text((f) => f.properties.state);
    },
  });

  // ------------------------------------------------------------------ list helpers (settlement feed, bet tape, moments)
  function emptyList(ol, text) { d3.select(ol).selectAll('li').data([text], (d) => d).join('li').attr('class', 'wf-feed-empty').text((d) => d); }
  function feedList(ol, items, render) {
    d3.select(ol).selectAll('li').data(items, (d) => d.key).join((en) => {
      const li = en.append('li');
      li.append('span').attr('class', 'wf-feed-t');
      li.append('span').attr('class', 'wf-chip');
      li.append('span').attr('class', 'wf-feed-l');
      li.append('span').attr('class', 'wf-feed-k');
      return li;
    }).each(function (d) { render(d3.select(this), d); });
  }
  const activate = (sel, fn) => sel.on('click', (ev, d) => fn(d)).on('keydown', (ev, d) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); fn(d); } });

  dash.draw('feed', (ol) => {
    if (!ok('races')) { emptyList(ol, stat('races') === 'error' ? 'Failed to load races.' : 'Loading…'); return; }
    const t = WF.t;
    const items = RX().calls.filter((r) => r.called_ts <= t).map((r) => ({key: r.race_id, ts: r.called_ts, kind: r.office, label: r.label, winner: r.winner, state: r.state}));
    for (const m of rowsOf('milestones')) if (m.settled_ts && m.settled_ts <= t) items.push({key: m.event, ts: m.settled_ts, kind: 'Control', label: `${m.chamber} control`, winner: m.winner, state: null});
    items.sort((a, b) => b.ts - a.ts || (a.kind === 'Control' ? -1 : 1));
    const top = items.slice(0, 60);
    if (!top.length) { emptyList(ol, 'No race settled yet at the cursor time. Drag the timeline forward.'); return; }
    feedList(ol, top, (li, d) => {
      li.attr('class', `wf-feed-i${d.kind === 'Control' ? ' is-ctrl' : ''}${d.ts > t - 1800 ? ' is-new' : ''}`).attr('tabindex', d.state ? 0 : null);
      li.select('.wf-feed-t').text(when(d.ts));
      li.select('.wf-chip').attr('class', `wf-chip wf-chip-${(d.winner || 'i').toLowerCase()}`).text(d.winner || '?');
      li.select('.wf-feed-l').text(d.label);
      li.select('.wf-feed-k').text(d.kind);
    });
    activate(d3.select(ol).selectAll('li.wf-feed-i'), (d) => { if (d.state) { pick(d.state, {race: false}); pickRace(d.key); } });
  });

  // ------------------------------------------------------------------ state dossier
  dash.draw('st-name', (el) => { el.textContent = WF.state ? (NAMES().get(WF.state) || WF.state) : '—'; });
  dash.draw('st-races', (ul) => {
    const sel = d3.select(ul);
    if (!ok('races') || !WF.state) { sel.selectAll('li').data(['—'], (d) => d).join('li').text((d) => d); return; }
    const t = WF.t, list = RX().byState.get(WF.state) || [];
    const statewide = list.filter((r) => r.office !== 'House').sort((a, b) => (a.office === b.office ? a.special - b.special : a.office === 'Senate' ? -1 : 1));
    const h = houseAt(WF.state, t);
    const items = statewide.map((r) => ({key: r.race_id, r})).concat(h.n ? [{key: 'house', h}] : []);
    if (!items.length) { sel.selectAll('li').data(['No 2026 race in the data.'], (d) => d).join('li').text((d) => d); return; }
    sel.selectAll('li').data(items, (d) => d.key).join('li').each(function (d) {
      const li = d3.select(this);
      li.selectAll('*').remove();
      if (d.h) {
        const v = li.append('div').attr('class', 'wf-race-btn').style('cursor', 'default');
        v.append('span').attr('class', 'wf-race-l').text('House');
        v.append('span').attr('class', 'wf-race-v').text(`${d.h.n} seats · D ${d.h.d} · R ${d.h.r}${d.h.o ? ` · other ${d.h.o}` : ''} settled · ${d.h.open} open`);
        return;
      }
      const r = d.r, x = pDem(r, t);
      const b = li.append('button').attr('type', 'button').attr('class', `wf-race-btn${r.race_id === WF.race ? ' is-on' : ''}`)
        .attr('aria-pressed', String(r.race_id === WF.race)).on('click', () => pickRace(r.race_id));
      b.append('span').attr('class', 'wf-race-l').text(r.office + (r.special ? ' (special)' : ''));
      const v = b.append('span').attr('class', 'wf-race-v');
      if (x && x.settled) {
        v.append('span').attr('class', `wf-chip wf-chip-${r.winner.toLowerCase()}`).text(r.winner);
        v.append('span').text(`settled ${when(r.called_ts)}`);
      } else if (x) {
        v.append('span').attr('class', 'wf-pbar').append('span').style('width', `${x.p * 100}%`);
        v.append('span').text(`P(D) ${pct1(x.p)}`);
      } else {
        v.append('span').text('no price at this time');
      }
      b.append('span').attr('class', 'wf-race-vol').text(`${fmtInt(r.volume)} contracts traded`);
    });
  });

  function spark(el, cfg) {
    const W = Math.max(200, Math.floor(el.clientWidth || 300)), H = 74, ml = 34, mr = 8, mt = 6, mb = 16;
    const box = d3.select(el);
    let svg = box.select('svg');
    if (svg.empty()) { box.selectAll('*').remove(); svg = box.append('svg').attr('role', 'img'); }
    svg.attr('viewBox', `0 0 ${W} ${H}`).attr('height', H).attr('aria-label', cfg.aria);
    svg.selectAll('*').remove();
    const x = d3.scaleLinear().domain(cfg.xd).range([ml, W - mr]);
    const y = d3.scaleLinear().domain(cfg.yd).range([H - mb, mt]);
    for (const v of cfg.yticks) {
      svg.append('line').attr('x1', ml).attr('x2', W - mr).attr('y1', y(v)).attr('y2', y(v)).style('stroke', v === cfg.ref ? '#3a4a5e' : '#152030').style('stroke-dasharray', v === cfg.ref ? '3 3' : null);
      svg.append('text').attr('x', ml - 4).attr('y', y(v) + 3).attr('text-anchor', 'end').text(cfg.yfmt(v));
    }
    return {svg, x, y, W, H, ml, mr, mt, mb};
  }
  const sparkMsg = (el, text) => { d3.select(el).selectAll('*').remove(); d3.select(el).append('p').attr('class', 'wf-st-line wf-dim').text(text); };
  const cursorRule = (g, t) => { if (t >= g.x.domain()[0] && t <= g.x.domain()[1]) g.svg.append('line').attr('x1', g.x(t)).attr('x2', g.x(t)).attr('y1', g.mt).attr('y2', g.H - g.mb).style('stroke', C.amber).style('stroke-width', 1.5); };

  dash.draw('st-spark', (el) => {
    const r = WF.state && ok('races') ? primaryRace(WF.state) : null;
    const s = r && ok('race_odds') ? ODDS().get(r.race_id) : null;
    if (!s || !s.length) { sparkMsg(el, r ? 'No hourly prices for this race.' : 'No statewide race here.'); return; }
    const [a, b] = WF.range;
    const prev = lastAt(s, a);
    const pts = (prev ? [{...prev, t: a}] : []).concat(s.filter((d) => d.t > a && d.t <= b));
    if (!pts.length) { sparkMsg(el, 'No prices in this window.'); return; }
    if (pts[pts.length - 1].t < b) pts.push({...pts[pts.length - 1], t: Math.min(b, s[s.length - 1].t)});
    const g = spark(el, {xd: [a, b], yd: [0, 1], yticks: [0, 0.5, 1], ref: 0.5, yfmt: (v) => `${v * 100}%`, aria: `${r.label}: chance Democrats win, over the time window`});
    const area = d3.area().x((d) => g.x(d.t)).y0(g.y(0.5)).y1((d) => g.y(d.p_dem)).curve(d3.curveStepAfter);
    const id = `wfclip${Math.random().toString(36).slice(2, 8)}`;
    const defs = g.svg.append('defs');
    defs.append('clipPath').attr('id', `${id}d`).append('rect').attr('x', 0).attr('y', 0).attr('width', g.W).attr('height', g.y(0.5));
    defs.append('clipPath').attr('id', `${id}r`).append('rect').attr('x', 0).attr('y', g.y(0.5)).attr('width', g.W).attr('height', g.H);
    g.svg.append('path').datum(pts).attr('d', area).attr('clip-path', `url(#${id}d)`).style('fill', C.dem).style('opacity', 0.35);
    g.svg.append('path').datum(pts).attr('d', area).attr('clip-path', `url(#${id}r)`).style('fill', C.rep).style('opacity', 0.35);
    g.svg.append('path').datum(pts).attr('d', d3.line().x((d) => g.x(d.t)).y((d) => g.y(d.p_dem)).curve(d3.curveStepAfter)).style('fill', 'none').style('stroke', C.fg).style('stroke-width', 1.4);
    cursorRule(g, WF.t);
    if (r.called_ts && r.called_ts >= a && r.called_ts <= b) g.svg.append('circle').attr('cx', g.x(r.called_ts)).attr('cy', g.y(r.winner === 'D' ? 1 : 0)).attr('r', 3.5).style('fill', r.winner === 'D' ? C.dem : C.rep);
    g.svg.append('text').attr('x', g.ml).attr('y', g.H - 3).text(r.label);
    g.svg.append('text').attr('x', g.W - g.mr).attr('y', g.H - 3).attr('text-anchor', 'end').text(`${F.md.format(D(a))} – ${F.md.format(D(b))}`);
  });

  dash.draw('st-bets', (el) => {
    if (!WF.state) { el.textContent = '—'; return; }
    if (!ok('bets_state')) { el.textContent = stat('bets_state') === 'error' ? 'Bet data is not available.' : 'Loading…'; return; }
    const s = BST().byState.get(WF.state) || [];
    const h = Math.floor(WF.t / 3600) * 3600, row = BST().m.get(`${WF.state}|${h}`);
    const tot = sumBetween(s, RANGES.campaign[0], WF.t, (r) => r.usd);
    const big = ok('big_bets') && ok('races') ? BIG().filter((b) => b.t <= WF.t && (raceInfo(b.race_id) || {}).state === WF.state).reduce((x, y) => (!x || y.usd > x.usd ? y : x), null) : null;
    const br = big && raceInfo(big.race_id);
    el.textContent = `${row ? usd(row.usd) : '$0'} in the hour to ${F.time.format(D(h + 3600))} · ${usd(tot)} since Oct 20${big ? ` · largest so far: ${usd(big.usd)} backing ${big.backs} in ${br.label} at ${cents(big.price)}` : ''}`;
  });
  dash.draw('st-bets-spark', (el) => {
    if (!WF.state || !ok('bets_state')) { d3.select(el).selectAll('*').remove(); return; }
    const s = BST().byState.get(WF.state) || [];
    const [a, b] = WF.range;
    const nb = Math.max(12, Math.min(160, Math.round((b - a) / 3600)));
    const bins = binSum(s, a, b, nb, (r) => r.usd, 3600), mx = d3.max(bins) || 1;
    const g = spark(el, {xd: [a, b], yd: [0, mx], yticks: [0, mx], ref: null, yfmt: (v) => (v ? usd(v) : '0'), aria: `Dollars bet per hour on ${WF.state}'s races over the time window`});
    const bw = (g.W - g.ml - g.mr) / nb;
    bins.forEach((v, k) => { if (v) g.svg.append('rect').attr('x', g.ml + k * bw).attr('width', Math.max(1, bw - 1)).attr('y', g.y(v)).attr('height', g.y(0) - g.y(v)).style('fill', '#ffd166').style('opacity', 0.8); });
    cursorRule(g, WF.t);
    g.svg.append('text').attr('x', g.ml).attr('y', g.H - 3).text(`$ bet per ${nb === Math.round((b - a) / 3600) ? 'hour' : 'bin'}, ${F.md.format(D(a))} – ${F.md.format(D(b))}`);
  });
  dash.draw('st-social', (el) => {
    if (!WF.state) { el.textContent = '—'; return; }
    const parts = [];
    if (!ok('reddit_hourly')) parts.push(stat('reddit_hourly') === 'error' ? 'Reddit counts are not available yet.' : 'Loading Reddit…');
    else {
      const s = socialAt(WF.state, WF.t);
      if (!s || !s.sub) parts.push('No state subreddit tracked.');
      else if (!s.row) parts.push(`r/${s.sub}: no count for this hour.`);
      else parts.push(`r/${s.sub}: ${fmtInt(s.row.comments)} comments and ${fmtInt(s.row.posts)} posts in the hour from ${F.time.format(D(s.row.t))}${s.ratio != null ? `, ${s.ratio.toFixed(1)}× its usual hour (${fmtInt(Math.round(s.usual))})` : ''}.`);
    }
    if (ok('bluesky')) {
      const s = BSKY().byState.get(WF.state) || [];
      const n = sumBetween(s, WF.t - 3600, WF.t, (r) => r.posts), likes = sumBetween(s, WF.t - 3600, WF.t, (r) => r.likes);
      const inWin = s.length && WF.t >= s[0].t && WF.t <= s[s.length - 1].t + 3600;
      parts.push(inWin ? `Bluesky: ${n} top posts about the state's races in the past hour (${fmtInt(likes)} likes).` : 'Bluesky sample covers Nov 3 11 AM – Nov 4 3 PM ET.');
    }
    el.textContent = parts.join(' ');
  });
  dash.draw('st-gas', (el) => {
    const g = WF.state && ok('gas') ? GAS().m.get(`${WF.state}|${etDate(WF.t)}`) : null;
    el.textContent = g ? `$${g.price.toFixed(3)}` : WF.state && ok('gas') ? 'No AAA market that day' : '—';
  });
  dash.draw('st-gas-spark', (el) => {
    if (!ok('gas') || !WF.state) { d3.select(el).selectAll('*').remove(); return; }
    const toT = (ds) => Date.parse(`${ds}T17:00:00Z`) / 1000;
    const us = GAS().byState.get('US') || [], st = GAS().byState.get(WF.state) || [];
    const all = us.concat(st);
    if (!all.length) { d3.select(el).selectAll('*').remove(); return; }
    const [lo, hi] = d3.extent(all, (d) => d.price);
    const pad = Math.max(0.05, (hi - lo) * 0.1);
    const yd = [Math.floor((lo - pad) * 10) / 10, Math.ceil((hi + pad) * 10) / 10];
    const g = spark(el, {xd: [toT('2026-10-01'), toT('2026-11-12')], yd, yticks: [yd[0], yd[1]], ref: null, yfmt: (v) => `$${v.toFixed(1)}`, aria: `AAA regular gas in ${WF.state} and the US, Oct 1 to Nov 12`});
    const line = d3.line().x((d) => g.x(toT(d.date))).y((d) => g.y(d.price));
    g.svg.append('path').datum(us).attr('d', line).style('fill', 'none').style('stroke', C.muted).style('stroke-width', 1.2).style('stroke-dasharray', '3 2');
    if (WF.state !== 'US') g.svg.append('path').datum(st).attr('d', line).style('fill', 'none').style('stroke', '#ffb347').style('stroke-width', 1.6);
    cursorRule(g, toT(etDate(WF.t)));
    g.svg.append('text').attr('x', g.ml).attr('y', g.H - 3).text(`${WF.state} solid · US dashed`);
  });
  dash.draw('st-rain', (el) => {
    const w = WF.state && ok('weather_state') ? WX().get(`${WF.state}|${etDate(WF.t)}`) : null;
    if (!w) { el.textContent = WF.state && ok('weather_state') ? `No station data for ${F.md.format(D(WF.t))} (weather covers Oct 20 – Nov 5).` : '—'; return; }
    el.textContent = `${F.md.format(D(WF.t))}: ${w.prcp_mm.toFixed(2)} mm average rain · ${Math.round(w.wet_share * 100)}% of ${w.stations} stations had 2.5 mm or more${w.tmax_c != null ? ` · average high ${w.tmax_c.toFixed(1)} °C` : ''}`;
  });
  dash.draw('st-turnout', (el) => {
    const x = WF.state && ok('turnout_races') && ok('turnout_daily') ? turnoutAt(WF.state, WF.t) : null;
    if (!x) { el.textContent = WF.state ? 'No statewide turnout market here.' : '—'; return; }
    const r = x.race;
    const head = x.row
      ? `${r.office} turnout: the market puts 50/50 at ${fmtInt(x.row.implied_votes)} votes${x.row.flag ? ` (${x.row.flag} its ladder)` : ''} as of ${F.md.format(D(x.row.t))} 6 PM`
      : `${r.office} turnout market: not trading yet at the cursor`;
    const base = r.baseline_votes ? ` · ${r.baseline_year} midterm Senate total ${fmtInt(r.baseline_votes)}${x.ratio != null ? ` (${signed(x.ratio - 1)})` : ''}` : ' · no comparison year';
    const meta = ` · ${r.strikes} strikes from ${fmtInt(r.strike_min)} to ${fmtInt(r.strike_max)} · ${fmtInt(r.volume)} contracts traded${r.spread_eve != null ? ` · ${Math.round(r.spread_eve * 100)}¢ average spread on election eve` : ''}${r.settled_bucket ? ` · settled: ${r.settled_bucket}` : ''}`;
    el.textContent = head + base + meta;
  });

  // ------------------------------------------------------------------ market card, laid out the way Kalshi shows a market
  const OUT_COLORS = ['#b48cff', '#46d39a', '#ffb347', '#36c5d6', '#ff6bcb'];
  const outColor = (o, i) => (o.party === 'D' ? C.dem : o.party === 'R' ? C.rep : OUT_COLORS[i % OUT_COLORS.length]);
  dash.draw('race-select', (sel) => {
    if (!ok('races')) return;
    if (!sel.options.length) {
      const add = (parent, r) => { const o = document.createElement('option'); o.value = r.race_id; o.textContent = `${r.label}${r.office === 'House' ? ' (House)' : ''}`; parent.append(o); };
      const g0 = document.createElement('optgroup'); g0.label = 'Chamber control';
      ['CONTROLS-2026', 'CONTROLH-2026'].forEach((id) => add(g0, raceInfo(id)));
      sel.append(g0);
      for (const office of ['Senate', 'Governor', 'House']) {
        const g = document.createElement('optgroup'); g.label = `${office} · by volume`;
        rowsOf('races').filter((r) => r.office === office).sort((a, b) => b.volume - a.volume).forEach((r) => add(g, r));
        sel.append(g);
      }
    }
    sel.value = WF.race;
  });
  function raceData(id) {
    const key = `race:${id}`;
    if (stat(key) === 'idle') dash.load(key, `data/race/${encodeURIComponent(id)}.json`);
    return dash.data(key);
  }
  function dayData(id, day) {
    const key = `day:${id}:${day}`;
    if (stat(key) === 'idle') dash.load(key, `data/trades/${encodeURIComponent(id)}/${day}.json`);
    return dash.data(key);
  }
  const MKT = (id) => memo(`mkt:${id}`, [`race:${id}`], () => {
    const raw = dash.data(`race:${id}`).raw || {};
    const outs = raw.outcomes || [], ser = outs.map(() => []);
    for (const [t, i, p, n] of raw.px || []) if (ser[i]) ser[i].push({t, p, n, r: t >= N0 && t < N1 ? 60 : 600});
    return {outs, ser, raw, all: ser.flat().sort((a, b) => a.t - b.t)};
  });
  function chanceAt(mk, i, t, r) {
    const o = mk.outs[i];
    if (r && r.winner && r.called_ts && t >= r.called_ts) return {p: o.party === r.winner ? 1 : 0, settled: true};
    const row = lastAt(mk.ser[i], t);
    return row ? {p: row.p, settled: false} : null;
  }
  const mktState = () => {
    const id = WF.race, r = raceInfo(id), ds = raceData(id);
    return {id, r, ds, mk: ds.status === 'ok' ? MKT(id) : null};
  };
  const notReady = (el, s) => { el.textContent = s.ds.status === 'error' ? `No trades on file for ${s.r ? s.r.label : s.id} between Oct 20 and Nov 12.` : 'Loading…'; };

  dash.draw('mkt-vol', (el) => {
    const r = raceInfo(WF.race);
    if (!r) { el.textContent = ''; return; }
    const parts = [];
    if (r.volume) parts.push(`${usd(r.volume)} vol`);
    if (r.winner && r.called_ts && WF.t >= r.called_ts) parts.push(`Settled: ${party(r.winner)}, ${when(r.called_ts)}`);
    else parts.push('Open at the cursor');
    el.textContent = parts.join(' · ');
  });
  dash.draw('mkt-q', (el) => {
    const s = mktState();
    el.textContent = (s.mk && s.mk.raw.question) || (s.r ? s.r.label : '—');
  });
  dash.draw('mkt-head', (el) => {
    clear(el);
    const s = mktState();
    if (!s.mk) { notReady(el, s); return; }
    const {mk, r} = s, a = WF.range[0];
    const cur = mk.outs.map((o, i) => ({o, i, c: chanceAt(mk, i, WF.t, r), s0: chanceAt(mk, i, Math.max(a, RANGES.campaign[0]), r)}))
      .sort((p, q) => (q.c ? q.c.p : -1) - (p.c ? p.c.p : -1));
    const lead = cur[0];
    if (lead && lead.c) {
      const box = document.createElement('div'); box.className = 'wf-mkt-lead';
      const v = document.createElement('div'); v.className = 'wf-mkt-lead-v';
      v.textContent = `${Math.round(lead.c.p * 100)}%`;
      const small = document.createElement('small'); small.textContent = lead.c.settled ? 'settled' : 'chance'; v.append(small);
      if (lead.s0 && !lead.c.settled) {
        const d = Math.round((lead.c.p - lead.s0.p) * 100);
        if (d) { const ch = document.createElement('span'); ch.className = `wf-chg ${d > 0 ? 'up' : 'down'}`; ch.textContent = `${d > 0 ? '▲' : '▼'} ${Math.abs(d)}`; ch.title = 'Change since the start of the chart window, in points'; v.append(ch); }
      }
      const l = document.createElement('div'); l.className = 'wf-mkt-lead-l'; l.textContent = `${lead.o.label} · at ${F.time.format(D(WF.t))} ET, ${F.md.format(D(WF.t))}`;
      box.append(v, l); el.append(box);
    }
    const keys = document.createElement('div'); keys.className = 'wf-mkt-keys';
    cur.forEach(({o, i, c}) => {
      const k = document.createElement('span'), dot = document.createElement('i'), b = document.createElement('b');
      dot.style.background = outColor(o, i); b.textContent = c ? `${Math.round(c.p * 100)}%` : '—';
      k.append(dot, document.createTextNode(o.label), b); keys.append(k);
    });
    el.append(keys);
  });

  dash.draw('mkt-chart', {
    mount(el) {
      const box = d3.select(el);
      const msg = box.append('p').attr('class', 'wf-msg');
      const svg = box.append('svg').attr('role', 'img');
      const tip = box.append('div').attr('class', 'wf-tip').attr('hidden', '');
      return {msg, svg, tip, tipB: tip.append('b'), tipS: tip.append('span')};
    },
    update(el, m) {
      const s = mktState();
      if (!s.mk) { m.svg.attr('hidden', ''); m.msg.attr('hidden', null).text(s.ds.status === 'error' ? 'No trades on file for this market in the window.' : 'Loading trades…'); return; }
      m.msg.attr('hidden', ''); m.svg.attr('hidden', null);
      const {mk, r} = s, [a, b] = WF.range;
      const W = Math.max(280, Math.floor(el.clientWidth || 700)), ml = 6, mr = 44, PT = 10, PH = 214, VB = 236, VH = 34, H = VB + VH + 24;
      const x = d3.scaleLinear().domain([a, b]).range([ml, W - mr]);
      const y = d3.scaleLinear().domain([0, 1]).range([PH, PT]);
      const svg = m.svg.attr('viewBox', `0 0 ${W} ${H}`).attr('height', H)
        .attr('aria-label', `${r ? r.label : s.id}: chance of each outcome over the chart window, with contracts traded`);
      svg.selectAll('*').remove();
      for (const v of [0, 0.25, 0.5, 0.75, 1]) {
        svg.append('line').attr('x1', ml).attr('x2', W - mr).attr('y1', y(v)).attr('y2', y(v)).style('stroke', '#1c2836').style('stroke-dasharray', '2 4');
        svg.append('text').attr('x', W - mr + 6).attr('y', y(v) + 3.5).text(`${v * 100}%`);
      }
      const settledAt = r && r.winner && r.called_ts ? r.called_ts : null;
      const lines = mk.outs.map((o, i) => {
        const ser = mk.ser[i], prev = lastAt(ser, a);
        const pts = (prev ? [{t: a, p: prev.p}] : []).concat(ser.filter((d) => d.t > a && d.t <= b && (!settledAt || d.t < settledAt)));
        if (settledAt && settledAt > a && settledAt <= b) pts.push({t: settledAt, p: o.party === r.winner ? 1 : 0});
        if (pts.length && pts[pts.length - 1].t < b) pts.push({t: b, p: pts[pts.length - 1].p});
        return {o, i, pts};
      });
      for (const ln of lines.slice().reverse()) {
        if (!ln.pts.length) continue;
        svg.append('path').datum(ln.pts).attr('d', d3.line().x((d) => x(d.t)).y((d) => y(d.p)).curve(d3.curveStepAfter))
          .style('fill', 'none').style('stroke', outColor(ln.o, ln.i)).style('stroke-width', 2).style('stroke-linejoin', 'round');
      }
      // contracts traded, all outcomes, faint bars under the chart
      const nb = Math.max(30, Math.min(200, Math.floor((W - ml - mr) / 5))), bw = (b - a) / nb;
      const vols = binSum(mk.all, a, b, nb, (d) => d.n, 600), vmax = d3.max(vols) || 1;
      const bwPx = Math.max(1, (W - ml - mr) / nb - 1);
      for (let k = 0; k < nb; k++) if (vols[k]) svg.append('rect').attr('x', x(a + k * bw)).attr('width', bwPx).attr('y', VB + VH - (vols[k] / vmax) * VH).attr('height', (vols[k] / vmax) * VH).style('fill', '#3a4a5e');
      const binLabel = bw >= 3600 ? `${Math.round(bw / 3600)} h` : `${Math.max(1, Math.round(bw / 60))} min`;
      svg.append('text').attr('x', W - mr + 6).attr('y', VB + 9).text(fmtN(vmax));
      svg.append('text').attr('x', ml).attr('y', VB + 9).text(`contracts per ${binLabel}`);
      const {out, step} = ticks(a, b, W - ml - mr);
      for (const t of out) svg.append('text').attr('x', x(t)).attr('y', VB + VH + 16).attr('text-anchor', x(t) < ml + 20 ? 'start' : 'middle').text(tickLabel(t, step));
      if (settledAt && settledAt >= a && settledAt <= b) {
        svg.append('line').attr('x1', x(settledAt)).attr('x2', x(settledAt)).attr('y1', PT).attr('y2', VB + VH).style('stroke', '#5d6d82').style('stroke-dasharray', '3 3');
        svg.append('text').attr('x', x(settledAt) + 4).attr('y', (PT + PH) / 2).text('settled');
      }
      // cursor, with each outcome's chance labelled on the right of its dot
      if (WF.t >= a && WF.t <= b) {
        const cx = x(WF.t);
        svg.append('line').attr('x1', cx).attr('x2', cx).attr('y1', PT).attr('y2', VB + VH).style('stroke', C.amber).style('stroke-width', 1.5);
        const marks = mk.outs.map((o, i) => ({o, i, c: chanceAt(mk, i, WF.t, r)})).filter((d) => d.c).sort((p, q) => q.c.p - p.c.p);
        let lastY = -Infinity;
        for (const d of marks) {
          const cy = y(d.c.p), ly = Math.max(cy, lastY + 14); lastY = ly;
          svg.append('circle').attr('cx', cx).attr('cy', cy).attr('r', 4).style('fill', outColor(d.o, d.i)).style('stroke', '#0e151e').style('stroke-width', 2);
          const right = cx < W - mr - 120;
          svg.append('text').attr('x', right ? cx + 8 : cx - 8).attr('y', ly + 4).attr('text-anchor', right ? 'start' : 'end')
            .style('fill', outColor(d.o, d.i)).style('font', '600 11.5px ui-monospace, monospace').style('paint-order', 'stroke').style('stroke', '#0e151e').style('stroke-width', 4).style('stroke-linejoin', 'round').text(`${d.o.label.length > 22 ? d.o.label.slice(0, 21) + '…' : d.o.label} ${Math.round(d.c.p * 100)}%`);
        }
      }
      const hover = svg.append('line').style('stroke', C.fg).style('stroke-opacity', 0.35).style('stroke-dasharray', '2 3').style('display', 'none').style('pointer-events', 'none');
      svg.append('rect').attr('x', ml).attr('y', 0).attr('width', W - ml - mr).attr('height', VB + VH).style('fill', 'transparent').style('cursor', 'crosshair')
        .on('pointermove', (ev) => {
          const [px, py] = d3.pointer(ev, el), t = x.invert(d3.pointer(ev, svg.node())[0]);
          hover.style('display', null).attr('x1', x(t)).attr('x2', x(t)).attr('y1', PT).attr('y2', VB + VH);
          m.tipB.text(`${F.day.format(D(t))} · ${F.time.format(D(t))}`);
          m.tipS.text(mk.outs.map((o, i) => { const c = chanceAt(mk, i, t, r); return `${o.label} ${c ? Math.round(c.p * 100) + '%' : '—'}`; }).join(' · '));
          m.tip.attr('hidden', null).style('left', `${Math.max(0, Math.min(px + 12, el.clientWidth - 270))}px`).style('top', `${Math.max(0, py - 50)}px`);
        })
        .on('pointerleave', () => { hover.style('display', 'none'); m.tip.attr('hidden', ''); })
        .on('click', (ev) => { if (WF.playing) stop(); WF.moment = null; setT(x.invert(d3.pointer(ev, svg.node())[0])); });
    },
  });

  dash.draw('mkt-table', (tb) => {
    clear(tb);
    const s = mktState();
    const row = (cells) => { const tr = document.createElement('tr'); cells.forEach((c) => tr.append(c)); tb.append(tr); };
    const td = (text, cls) => { const e = document.createElement('td'); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    if (!s.mk) { const c = td(null); c.colSpan = 5; notReady(c, s); row([c]); return; }
    const {mk, r} = s;
    mk.outs.map((o, i) => ({o, i, c: chanceAt(mk, i, WF.t, r)})).sort((p, q) => (q.c ? q.c.p : -1) - (p.c ? p.c.p : -1)).forEach(({o, i, c}) => {
      const name = td(null), dot = document.createElement('i'); dot.style.background = outColor(o, i); name.append(dot, document.createTextNode(o.label));
      const chance = td(c ? `${Math.round(c.p * 100)}%` : '—', 'wf-mkt-chance');
      const yes = td(null), no = td(null), ys = document.createElement('span'), ns = document.createElement('span');
      if (c && c.settled) {
        ys.className = `wf-yes ${c.p ? 'wf-won' : 'wf-lost'}`; ys.textContent = c.p ? 'Won' : 'Lost';
        ns.className = `wf-no ${c.p ? 'wf-lost' : 'wf-won'}`; ns.textContent = c.p ? 'Lost' : 'Won';
      } else {
        ys.className = 'wf-yes'; ys.textContent = c ? `Yes ${cents(c.p)}` : 'Yes —';
        ns.className = 'wf-no'; ns.textContent = c ? `No ${cents(1 - c.p)}` : 'No —';
      }
      yes.append(ys); no.append(ns);
      const traded = mk.ser[i].reduce((acc, d) => acc + (d.t <= WF.t ? d.n : 0), 0);
      row([name, chance, yes, no, td(fmtN(traded))]);
    });
  });

  // ------------------------------------------------------------------ trades: every bet in the market, or the biggest bets
  const CATS = [['midterms', 'Midterms', '#f0b44c'], ['politics', 'Politics', '#b48cff'], ['sports', 'Sports', '#46d39a'], ['crypto', 'Crypto', '#ff9f43'],
    ['parlays', 'Parlay', '#ff6bcb'], ['finance', 'Finance', '#5fb3ff'], ['weather', 'Weather', '#36c5d6'], ['other', 'Other', '#6b7a8f']];
  const CAT = Object.fromEntries(CATS.map(([g, label, col]) => [g, {label, col}]));
  const KCATS = () => memo('kcats', ['kalshi_cats'], (rows) => group(rows, (r) => r.g, 't'));
  const KBIG = () => memo('kbig', ['kalshi_big'], (b) => b.slice().sort((p, q) => p.t - q.t));
  dash.draw('tape-sub', (el) => {
    const r = raceInfo(WF.race);
    el.textContent = WF.tape === 'market' ? `Every bet in ${r ? r.label : 'this market'} up to the cursor, newest first. One bet = one order; amber = $10K or more.`
      : WF.tape === 'mid' ? 'The largest midterm bets (priced 3–97¢) up to the cursor, newest first.'
        : 'The largest bets anywhere on Kalshi (priced 3–97¢) up to the cursor. Covers Nov 3 5 PM – Nov 4 9 AM ET.';
  });
  function tapeMarket(ol) {
    const s = mktState();
    if (s.ds.status !== 'ok') { emptyList(ol, s.ds.status === 'error' ? 'No trades on file for this market.' : 'Loading…'); return; }
    const days = (s.mk.raw.days || []).filter((d) => d <= etDate(WF.t));
    if (!days.length) { emptyList(ol, 'No bets in this market yet at the cursor time.'); return; }
    const out = [];
    for (let j = days.length - 1; j >= 0 && out.length < 120 && j >= days.length - 3; j--) {
      const dd = dayData(s.id, days[j]);
      if (dd.status === 'loading' || dd.status === 'idle') { if (!out.length) { emptyList(ol, 'Loading trades…'); return; } break; }
      if (dd.status !== 'ok') continue;
      const rows = dd.data;
      for (let i = rows.length - 1; i >= 0 && out.length < 120; i--) if (rows[i][0] <= WF.t) out.push(rows[i]);
    }
    if (!out.length) { emptyList(ol, 'No bets in this market yet at the cursor time.'); return; }
    feedList(ol, out.map((b) => ({key: `${b[0]}|${b[1]}|${b[2]}|${b[4]}|${b[5]}`, t: b[0], i: b[1], yes: b[2], price: b[3], n: b[4], usd: b[5]})), (li, d) => {
      const o = s.mk.outs[d.i] || {label: '?'};
      li.attr('class', `wf-feed-i wf-trade-i${d.usd >= 10000 ? ' is-big' : ''}`).attr('tabindex', null);
      li.select('.wf-feed-t').text(F.time.format(D(d.t)));
      li.select('.wf-chip').attr('class', `wf-chip ${d.yes ? 'wf-side-yes' : 'wf-side-no'}`).text(d.yes ? 'Yes' : 'No');
      li.select('.wf-feed-l').text(`${o.label} · ${fmtN(d.n)} @ ${cents(d.price)}`).attr('title', `${d.yes ? 'Bought Yes' : 'Bought No'} on ${o.label}: ${fmtInt(Math.round(d.n))} contracts at ${cents(d.price)}, ${when(d.t)}`);
      li.select('.wf-feed-k').attr('class', 'wf-feed-k wf-feed-usd').text(usd(d.usd));
    });
  }
  function tapeMid(ol) {
    if (!ok('big_bets')) { emptyList(ol, stat('big_bets') === 'error' ? 'Bet data is not available.' : 'Loading…'); return; }
    const t = WF.t, s = BIG(), out = [];
    for (let i = firstIdx(s, t + 1) - 1; i >= 0 && out.length < 80; i--) out.push(s[i]);
    if (!out.length) { emptyList(ol, 'No large bets yet at the cursor time.'); return; }
    feedList(ol, out.map((b) => ({...b, key: `${b.race_id}|${b.t}|${b.usd}`})), (li, d) => {
      const r = raceInfo(d.race_id);
      li.attr('class', `wf-feed-i${d.t > t - 1800 ? ' is-new' : ''}${d.race_id === WF.race ? ' is-sel' : ''}`).attr('tabindex', 0);
      li.select('.wf-feed-t').text(when(d.t));
      li.select('.wf-chip').attr('class', `wf-chip wf-chip-${d.backs.toLowerCase()}`).attr('style', null).text(d.backs === 'O' ? '·' : d.backs);
      li.select('.wf-feed-l').text(`${r ? r.label : d.race_id} · backs ${party(d.backs)} @ ${cents(d.price)}`);
      li.select('.wf-feed-k').attr('class', 'wf-feed-k wf-feed-usd').text(usd(d.usd));
    });
    activate(d3.select(ol).selectAll('li.wf-feed-i'), (d) => pickRace(d.race_id));
  }
  function tapeAll(ol) {
    if (!ok('kalshi_big')) { emptyList(ol, stat('kalshi_big') === 'error' ? 'Whole-exchange data is not available yet.' : 'Loading…'); return; }
    const t = WF.t, s = KBIG(), out = [];
    for (let i = firstIdx(s, t + 1) - 1; i >= 0 && out.length < 80; i--) out.push(s[i]);
    if (!out.length) { emptyList(ol, t < N0 ? 'Whole-exchange bets start Nov 3 at 5 PM ET. Move the cursor there.' : 'No large bets yet at the cursor time.'); return; }
    feedList(ol, out.map((b) => ({...b, key: `${b.ticker}|${b.t}|${b.usd}`})), (li, d) => {
      const c = CAT[d.g] || CAT.other;
      li.attr('class', `wf-feed-i${d.t > t - 600 ? ' is-new' : ''}`).attr('tabindex', d.race_id ? 0 : null);
      li.select('.wf-feed-t').text(F.time.format(D(d.t)));
      li.select('.wf-chip').attr('class', 'wf-chip').style('background', c.col).text(c.label);
      const r = d.race_id ? raceInfo(d.race_id) : null, sfx = d.ticker.split('-').pop();
      const what = r ? `${r.label} · ${d.outcome || ({D: 'Democratic', R: 'Republican'}[sfx] || sfx)}` : d.title ? `${d.title}${d.outcome && !d.title.includes(d.outcome) ? ` · ${d.outcome}` : ''}` : d.ticker;
      li.select('.wf-feed-l').text(`${d.side} @ ${cents(d.price)} · ${what}`).attr('title', `${d.side} at ${cents(d.price)}: ${what} (${d.ticker})`);
      li.select('.wf-feed-k').attr('class', 'wf-feed-k wf-feed-usd').text(usd(d.usd));
    });
    activate(d3.select(ol).selectAll('li.wf-feed-i'), (d) => { if (d.race_id) pickRace(d.race_id); });
  }
  dash.draw('tape', (ol) => (WF.tape === 'market' ? tapeMarket(ol) : WF.tape === 'all' ? tapeAll(ol) : tapeMid(ol)));

  // ------------------------------------------------------------------ key moments
  const KIND = {control: 'Control', call: 'Call', swing: 'Swing', bet: 'Big bet'};
  function currentMoment() {
    const ms = MOMENTS();
    if (WF.moment) return ms.find((m) => m.id === WF.moment) || null;
    return lastAt(ms, WF.t);
  }
  dash.draw('moments', (ol) => {
    if (!ok('moments')) { emptyList(ol, stat('moments') === 'error' ? 'Key moments are not available.' : 'Loading…'); return; }
    const cur = currentMoment();
    feedList(ol, MOMENTS().map((m) => ({...m, key: m.id})), (li, d) => {
      li.attr('class', `wf-feed-i wf-mom-i${cur && cur.id === d.id ? ' is-sel' : ''}${d.t > WF.t ? ' wf-dim' : ''}`).attr('tabindex', 0)
        .attr('aria-current', cur && cur.id === d.id ? 'true' : null);
      li.select('.wf-feed-t').text(F.time.format(D(d.t)));
      li.select('.wf-chip').attr('class', 'wf-chip wf-chip-k').text(KIND[d.kind] || d.kind);
      li.select('.wf-feed-l').text(d.title).attr('title', d.title);
      li.select('.wf-feed-k').remove();
    });
    activate(d3.select(ol).selectAll('li.wf-feed-i'), (d) => { if (WF.playing) stop(); pickMoment(d); });
  });
  function loadScript(src, id) {
    const old = document.getElementById(id);
    if (old) old.remove();
    const s = document.createElement('script');
    s.id = id; s.async = true; s.src = src; s.charset = 'utf-8';
    document.body.append(s);
  }
  function renderEmbeds(box, posts) {
    clear(box);
    for (const p of posts) {
      const card = document.createElement('div'); card.className = 'wf-embed';
      const bq = document.createElement('blockquote');
      const a = document.createElement('a'); a.href = p.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      if (p.platform === 'bluesky') {
        bq.className = 'bluesky-embed';
        bq.setAttribute('data-bluesky-uri', p.uri);
        bq.setAttribute('data-bluesky-embed-color-mode', 'dark');
        a.textContent = `View this post on Bluesky (${when(p.t)}, ${fmtInt(p.likes)} likes)`;
      } else {
        bq.className = 'reddit-embed-bq';
        bq.setAttribute('data-embed-theme', 'dark');
        bq.setAttribute('data-embed-height', '360');
        a.textContent = `View this post on Reddit, r/${p.sub} (${when(p.t)})`;
      }
      bq.append(a); card.append(bq); box.append(card);
    }
    if (posts.some((p) => p.platform === 'bluesky')) {
      if (window.bluesky && typeof window.bluesky.scan === 'function') window.bluesky.scan();
      else loadScript('https://embed.bsky.app/static/embed.js', 'wf-bsky-embed');
    }
    if (posts.some((p) => p.platform === 'reddit')) loadScript('https://embed.reddit.com/widgets.js', 'wf-reddit-embed');
  }
  dash.draw('moment-detail', {
    mount(el) {
      const title = document.createElement('p'); title.className = 'wf-mom-title';
      const meta = document.createElement('p'); meta.className = 'wf-mom-meta';
      const actions = document.createElement('div'); actions.className = 'wf-mom-actions';
      const show = document.createElement('button'); show.type = 'button'; show.className = 'wf-btn wf-btn-solid';
      const hide = document.createElement('button'); hide.type = 'button'; hide.className = 'wf-btn'; hide.textContent = 'Hide posts';
      const open = document.createElement('button'); open.type = 'button'; open.className = 'wf-btn'; open.textContent = 'Open the market';
      actions.append(show, hide, open);
      const embeds = document.createElement('div'); embeds.className = 'wf-embeds';
      const note = document.createElement('p'); note.className = 'wf-embed-note';
      note.textContent = 'Posts load from Bluesky and Reddit when you choose to show them, and those sites may set cookies. Bluesky posts are from accounts with 25,000+ followers.';
      el.append(title, meta, actions, embeds, note);
      const m = {title, meta, show, hide, open, embeds, note, shownId: null};
      show.addEventListener('click', () => { WF.embedsOn = true; m.shownId = null; dash.draw('moment-detail'); });
      hide.addEventListener('click', () => { WF.embedsOn = false; m.shownId = null; clear(embeds); dash.draw('moment-detail'); });
      open.addEventListener('click', () => { const c = currentMoment(); if (c && c.race_id) { WF.tape = 'market'; syncUI(); pickRace(c.race_id); document.getElementById('wf-race-select').scrollIntoView({behavior: 'smooth', block: 'start'}); } });
      return m;
    },
    update(el, m) {
      const c = ok('moments') ? currentMoment() : null;
      if (!c) {
        m.title.textContent = ok('moments') ? 'No key moment yet at the cursor time.' : '—';
        m.meta.textContent = ''; m.show.hidden = m.hide.hidden = m.open.hidden = true; clear(m.embeds); m.shownId = null; return;
      }
      m.title.textContent = c.title;
      const n = c.posts.length, nb = c.posts.filter((p) => p.platform === 'bluesky').length;
      m.meta.textContent = `${F.day.format(D(c.t))}, ${F.time.format(D(c.t))} ET · ${KIND[c.kind] || c.kind}${WF.moment ? '' : ' · latest moment before the cursor'}`
        + ` · ${n ? `${nb} Bluesky and ${n - nb} Reddit posts from 10 minutes before to 30 minutes after` : 'no matching public posts found'}`;
      m.open.hidden = !c.race_id;
      m.show.hidden = !n || WF.embedsOn;
      m.show.textContent = `Show ${n} post${n === 1 ? '' : 's'}`;
      m.hide.hidden = !n || !WF.embedsOn;
      if (!WF.embedsOn || !n) { if (m.shownId) { clear(m.embeds); m.shownId = null; } return; }
      if (m.shownId !== c.id) { m.shownId = c.id; renderEmbeds(m.embeds, c.posts); }
    },
  });

  // ------------------------------------------------------------------ time lanes
  const AXIS = 22, TOP = 14;
  const LANES = [['ctrl', 34], ['settled', 34], ['kalshi', 68], ['bets', 34], ['big', 34], ['streams', 34], ['chat', 34], ['reddit', 34], ['bsky', 34], ['poly', 34], ['gas', 34]];
  const LY = {};
  let PLOT_H = 0;
  for (const [k, h] of LANES) { LY[k] = {y: TOP + PLOT_H, h}; PLOT_H += h; }

  dash.draw('lanes', {
    mount(el) {
      const box = d3.select(el);
      const svg = box.append('svg').attr('class', 'wf-lanes-svg').attr('role', 'img').attr('tabindex', 0)
        .attr('aria-label', 'Timeline lanes: chamber-control odds, race settlements, all Kalshi volume by category, midterm bets, streams, live chat, Reddit, Bluesky, Polymarket, gas and oil. Amber diamonds are key moments; the amber line is the cursor. Drag or use arrow keys to move it.');
      const base = svg.append('g'), marks = svg.append('g'), axis = svg.append('g').attr('class', 'wf-axis');
      const hover = svg.append('line').attr('class', 'wf-hover').style('display', 'none').style('pointer-events', 'none');
      const cursor = svg.append('g').attr('class', 'wf-cursor').style('pointer-events', 'none');
      cursor.append('line'); cursor.append('rect').attr('height', 15).attr('y', TOP + PLOT_H + 4); cursor.append('text').attr('y', TOP + PLOT_H + 15);
      const tip = box.append('div').attr('class', 'wf-tip').attr('hidden', '');
      const m = {box, svg, base, marks, axis, hover, cursor, tip, tipB: tip.append('b'), tipS: tip.append('span'), key: ''};
      let dragging = false;
      const tAt = (ev) => m.x.invert(d3.pointer(ev, svg.node())[0]);
      svg.on('pointerdown', (ev) => {
        if (ev.target.classList && ev.target.classList.contains('wf-mom-mark')) return;
        dragging = true; svg.node().setPointerCapture?.(ev.pointerId); if (WF.playing) stop(); WF.moment = null; setT(tAt(ev));
      })
        .on('pointerup pointercancel', () => { dragging = false; })
        .on('pointermove', (ev) => {
          if (!m.x) return;
          if (dragging) { setT(tAt(ev)); return; }
          const t = Math.round(tAt(ev) / 60) * 60, [px, py] = d3.pointer(ev, el);
          m.hover.style('display', null).attr('x1', m.x(t)).attr('x2', m.x(t));
          const sen = ok('control') ? lastAt(CTRL().get('Senate'), t) : null, hou = ok('control') ? lastAt(CTRL().get('House'), t) : null;
          const called = ok('races') ? RX().calls.filter((r) => r.called_ts <= t).length : 0;
          const kal = ok('kalshi_cats') ? binSum(rowsOf('kalshi_cats'), t, t + 60, 1, (r) => r.n, 3600)[0] : null;
          m.tipB.text(`${F.day.format(D(t))} · ${F.time.format(D(t))}`);
          m.tipS.text(`Senate P(D) ${sen ? pct1(sen.p_dem) : '—'} · House P(D) ${hou ? pct1(hou.p_dem) : '—'} · ${fmtInt(called)} races settled${kal != null ? ` · ${fmtN(kal)} contracts/min on all of Kalshi` : ''}`);
          m.tip.attr('hidden', null).style('left', `${Math.max(0, Math.min(px + 12, el.clientWidth - 270))}px`).style('top', `${Math.max(0, py - 54)}px`);
        })
        .on('pointerleave', () => { m.hover.style('display', 'none'); m.tip.attr('hidden', ''); })
        .on('keydown', (ev) => {
          const big = ev.shiftKey ? 10 : 1;
          if (ev.key === 'ArrowRight') { ev.preventDefault(); WF.moment = null; setT(WF.t + stepSize() * big); }
          else if (ev.key === 'ArrowLeft') { ev.preventDefault(); WF.moment = null; setT(WF.t - stepSize() * big); }
          else if (ev.key === 'Home') { ev.preventDefault(); setT(WF.range[0]); }
          else if (ev.key === 'End') { ev.preventDefault(); setT(WF.range[1]); }
          else if (ev.key === ' ') { ev.preventDefault(); WF.playing ? stop() : play(); }
        });
      return m;
    },
    update(el, m) {
      const W = Math.max(240, Math.floor(el.clientWidth || 600)), H = TOP + PLOT_H + AXIS;
      const [a, b] = WF.range;
      const key = `${W}|${a}|${b}|${DATASETS.map((i) => `${stat(i)}:${rowsOf(i).length}`).join(',')}`;
      m.x = d3.scaleLinear().domain([a, b]).range([0, W]);
      m.svg.attr('viewBox', `0 0 ${W} ${H}`).attr('height', H);
      m.hover.attr('y1', TOP).attr('y2', TOP + PLOT_H);
      if (key !== m.key) { m.key = key; drawLanes(m, W, a, b); }
      const cur = ok('moments') ? currentMoment() : null;
      const ms = ok('moments') ? MOMENTS().filter((d) => d.t >= a && d.t <= b) : [];
      m.marks.selectAll('path').data(ms, (d) => d.id).join((en) => en.append('path').attr('class', 'wf-mom-mark').attr('tabindex', 0).attr('role', 'button')
        .on('click', (ev, d) => { ev.stopPropagation(); if (WF.playing) stop(); pickMoment(d); })
        .on('keydown', (ev, d) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); pickMoment(d); } }))
        .attr('d', (d) => `M${m.x(d.t)},2 l5,5 l-5,5 l-5,-5 z`).classed('is-sel', (d) => cur && cur.id === d.id)
        .attr('aria-label', (d) => `${F.time.format(D(d.t))}: ${d.title}`);
      const x = m.x(WF.t), label = F.time.format(D(WF.t));
      m.cursor.select('line').attr('x1', x).attr('x2', x).attr('y1', TOP).attr('y2', TOP + PLOT_H);
      const tw = label.length * 6.6 + 10, tx = Math.min(Math.max(0, x - tw / 2), W - tw);
      m.cursor.select('rect').attr('x', tx).attr('width', tw);
      m.cursor.select('text').attr('x', tx + 5).text(label);
    },
  });

  function drawLanes(m, W, a, b) {
    const g = m.base; g.selectAll('*').remove();
    const x = m.x, ly = (k) => LY[k].y, lh = (k) => LY[k].h;
    for (const [k] of LANES) g.append('line').attr('class', 'wf-lane-sep').attr('x1', 0).attr('x2', W).attr('y1', ly(k) + 0.5).attr('y2', ly(k) + 0.5);
    g.append('line').attr('class', 'wf-lane-sep').attr('x1', 0).attr('x2', W).attr('y1', TOP + PLOT_H + 0.5).attr('y2', TOP + PLOT_H + 0.5);
    if (ok('moments')) for (const d of MOMENTS()) if (d.t >= a && d.t <= b) g.append('line').attr('class', 'wf-mom-rule').attr('x1', x(d.t)).attr('x2', x(d.t)).attr('y1', 12).attr('y2', TOP + PLOT_H);
    const yIn = (k, lo, hi) => d3.scaleLinear().domain([lo, hi]).range([ly(k) + lh(k) - 4, ly(k) + 5]);
    const note = (k, text, col = C.muted, dy = 0) => g.append('text').attr('x', W - 4).attr('y', ly(k) + 11 + dy).attr('text-anchor', 'end').style('fill', col).style('font', '500 9.5px ui-monospace, monospace').text(text);
    const missing = (k, id) => { if (stat(id) === 'error') note(k, 'not available yet', C.muted); return !ok(id); };
    const nb = Math.max(30, Math.min(220, Math.floor(W / 5))), bw = (b - a) / nb, bwPx = Math.max(1, W / nb - 1);
    const binLabel = bw >= 3600 ? `${Math.round(bw / 3600)} h` : `${Math.max(1, Math.round(bw / 60))} min`;
    const xs = (k) => x(a + k * bw);
    const pad = (vals) => { const arr = Array.from(vals); arr.push(arr[arr.length - 1] || 0); return arr; };   // so the last bin has width
    const area = (k, vals, col, label) => {
      const mx = d3.max(vals) || 0, y = yIn(k, 0, mx || 1);
      g.append('path').datum(pad(vals)).attr('d', d3.area().x((v, i) => xs(i)).y0(ly(k) + lh(k) - 4).y1((v) => y(v)).curve(d3.curveStepAfter)).style('fill', col).style('opacity', 0.6);
      note(k, label(mx));
    };

    if (!missing('ctrl', 'control')) {
      const y0 = yIn('ctrl', 0, 1);
      g.append('line').attr('x1', 0).attr('x2', W).attr('y1', y0(0.5)).attr('y2', y0(0.5)).style('stroke', '#2b3a4d').style('stroke-dasharray', '2 3');
      for (const [ch, col] of [['House', C.house], ['Senate', C.senate]]) {
        const s = CTRL().get(ch) || [], prev = lastAt(s, a);
        const pts = (prev ? [{...prev, t: a}] : []).concat(s.filter((d) => d.t > a && d.t <= b));
        if (!pts.length) continue;
        if (pts[pts.length - 1].t < b) pts.push({...pts[pts.length - 1], t: b});
        g.append('path').datum(pts).attr('d', d3.line().x((d) => x(d.t)).y((d) => y0(d.p_dem)).curve(d3.curveStepAfter)).style('fill', 'none').style('stroke', col).style('stroke-width', 1.4);
        g.append('text').attr('x', W - 4).attr('y', y0(pts[pts.length - 1].p_dem) + (ch === 'House' ? 11 : -3)).attr('text-anchor', 'end').style('fill', col).style('font', '600 9.5px ui-monospace, monospace').text(ch);
      }
    }
    if (!missing('settled', 'races')) {
      const bins = Array.from({length: nb}, () => ({d: 0, r: 0}));
      for (const r of RX().calls) if (r.called_ts >= a && r.called_ts < b) { const k = Math.min(nb - 1, Math.floor((r.called_ts - a) / bw)); if (r.winner === 'D') bins[k].d++; else bins[k].r++; }
      const maxB = d3.max(bins, (q) => q.d + q.r) || 1, y1 = d3.scaleSqrt().domain([0, maxB]).range([0, lh('settled') - 8]);
      bins.forEach((q, k) => {
        const base = ly('settled') + lh('settled') - 3;
        if (q.r) g.append('rect').attr('x', xs(k)).attr('width', bwPx).attr('y', base - y1(q.r)).attr('height', y1(q.r)).style('fill', C.rep);
        if (q.d) g.append('rect').attr('x', xs(k)).attr('width', bwPx).attr('y', base - y1(q.r + q.d)).attr('height', y1(q.r + q.d) - y1(q.r)).style('fill', C.dem);
      });
      note('settled', `max ${maxB} per ${binLabel}`);
    }
    if (!missing('kalshi', 'kalshi_cats')) {            // all of Kalshi: contracts per minute, stacked by category
      const by = KCATS(), keys = CATS.map((c) => c[0]);
      const cols = keys.map((k) => binSum(by.get(k) || [], a, b, nb, (r) => r.n, 3600).map((v) => v / (bw / 60)));
      const rows = Array.from({length: nb + 1}, (_, i) => Object.fromEntries(keys.map((k, j) => [k, cols[j][Math.min(i, nb - 1)]])));
      const st = d3.stack().keys(keys)(rows), mx = d3.max(rows, (r) => keys.reduce((s, k) => s + r[k], 0)) || 1;
      const y = d3.scaleLinear().domain([0, mx]).range([ly('kalshi') + lh('kalshi') - 3, ly('kalshi') + 6]);
      st.forEach((layer, j) => g.append('path').datum(layer).attr('d', d3.area().x((d, i) => xs(i)).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(d3.curveStepAfter)).style('fill', CATS[j][2]).style('opacity', 0.85));
      if (a < N1 && b > N0) for (const t of [N0, N1]) if (t > a && t < b) g.append('line').attr('x1', x(t)).attr('x2', x(t)).attr('y1', ly('kalshi') + 2).attr('y2', ly('kalshi') + lh('kalshi') - 2).style('stroke', C.fg).style('stroke-opacity', 0.4).style('stroke-dasharray', '1 2');
      note('kalshi', `peak ${fmtN(mx)} contracts/min`);
    }
    if (!missing('bets', 'bets_flow')) {
      const s = FLOW(), dv = binSum(s, a, b, nb, (r) => r.d, 600), rv = binSum(s, a, b, nb, (r) => r.rr, 600);
      const per = bw / 60, mx = Math.max(d3.max(dv) || 0, d3.max(rv) || 0) / per || 1;
      const mid = ly('bets') + lh('bets') / 2, yb = d3.scaleSqrt().domain([0, mx]).range([0, lh('bets') / 2 - 3]);
      for (let k = 0; k < nb; k++) {
        if (dv[k]) g.append('rect').attr('x', xs(k)).attr('width', bwPx).attr('y', mid - yb(dv[k] / per)).attr('height', yb(dv[k] / per)).style('fill', C.dem);
        if (rv[k]) g.append('rect').attr('x', xs(k)).attr('width', bwPx).attr('y', mid).attr('height', yb(rv[k] / per)).style('fill', C.rep);
      }
      note('bets', `peak ${usd(mx)}/min`);
    }
    if (!missing('big', 'big_bets')) {
      const s = BIG().filter((d) => d.t >= a && d.t <= b), rs = d3.scaleSqrt().domain([0, d3.max(s, (d) => d.usd) || 1]).range([1, 7]);
      const cy = ly('big') + lh('big') / 2, col = (d) => (d.backs === 'D' ? C.dem : d.backs === 'R' ? C.rep : C.ind);
      g.append('g').selectAll('circle').data(s).join('circle').attr('cx', (d) => x(d.t)).attr('cy', (d) => cy + (d.backs === 'D' ? -4 : d.backs === 'R' ? 4 : 0)).attr('r', (d) => rs(d.usd))
        .style('fill', col).style('fill-opacity', 0.4).style('stroke', col).style('stroke-width', 0.8);
      note('big', `${fmtInt(s.length)} of the 1,500 largest`);
    }
    if (!missing('streams', 'streams')) {
      const ss = rowsOf('streams').slice().sort((p, q) => (p.lean === q.lean ? p.start - q.start : p.lean < q.lean ? -1 : 1));
      const rowH = (lh('streams') - 8) / Math.max(1, ss.length);
      ss.forEach((s, i) => {
        if (!s.start || s.end < a || s.start > b) return;
        g.append('rect').attr('x', x(Math.max(a, s.start))).attr('width', Math.max(1, x(Math.min(b, s.end)) - x(Math.max(a, s.start))))
          .attr('y', ly('streams') + 4 + i * rowH).attr('height', Math.max(1, rowH - 1)).style('fill', s.lean === 'L' ? '#5c8fe6' : '#e65c66').style('opacity', 0.85);
      });
    }
    if (!missing('chat', 'chat')) area('chat', binSum(rowsOf('chat'), a, b, nb, (r) => r.messages, 60).map((v) => v / (bw / 60)), '#8fa3ff', (mx) => `peak ${fmtInt(Math.round(mx))}/min`);
    if (!missing('reddit', 'reddit_hourly')) area('reddit', binSum(RED_US(), a, b, nb, (r) => r.c, 3600).map((v) => v / (bw / 60)), C.social, (mx) => `peak ${fmtInt(Math.round(mx))}/min · national subs`);
    if (!missing('bsky', 'bluesky')) area('bsky', binSum(BSKY().all, a, b, nb, (r) => r.posts, 600).map((v) => v / (bw / 600)), C.bsky, (mx) => `peak ${fmtInt(Math.round(mx))} per 10 min · sample`);
    if (!missing('poly', 'polymarket')) area('poly', binSum(rowsOf('polymarket'), a, b, nb, (r) => r.comments, 3600).map((v) => v / (bw / 3600)), '#c9a2ff', (mx) => `peak ${fmtInt(Math.round(mx))}/hour`);
    if (ok('gas') && ok('oil')) {
      const toT = (ds) => Date.parse(`${ds}T17:00:00Z`) / 1000;
      [['US gas', GAS().byState.get('US') || [], '#ffb347', null], ['WTI', OIL().get('WTI') || [], C.muted, '3 2']].forEach(([name, s, col, dsh], j) => {
        const prev = lastAt(s, etDate(a), 'date');
        const pts = (prev ? [{...prev, t: a}] : []).concat(s.map((d) => ({...d, t: toT(d.date)})).filter((d) => d.t > a && d.t <= b));
        if (!pts.length) return;
        if (pts[pts.length - 1].t < b) pts.push({...pts[pts.length - 1], t: b});
        const [lo, hi] = d3.extent(pts, (d) => d.price), pd = (hi - lo || 1) * 0.1, y9 = yIn('gas', lo - pd, hi + pd);
        g.append('path').datum(pts).attr('d', d3.line().x((d) => x(d.t)).y((d) => y9(d.price)).curve(d3.curveStepAfter)).style('fill', 'none').style('stroke', col).style('stroke-width', 1.4).style('stroke-dasharray', dsh);
        note('gas', `${name} $${pts[pts.length - 1].price.toFixed(2)}`, col, j * 10);
      });
    }
    m.axis.selectAll('*').remove();
    const {out, step} = ticks(a, b, W), y = TOP + PLOT_H;
    for (const t of out) {
      m.axis.append('line').attr('x1', x(t)).attr('x2', x(t)).attr('y1', y).attr('y2', y + 4);
      m.axis.append('text').attr('x', x(t)).attr('y', y + 15).attr('text-anchor', x(t) < 20 ? 'start' : x(t) > W - 20 ? 'end' : 'middle').text(tickLabel(t, step));
    }
  }

  // ------------------------------------------------------------------ start
  syncUI();
  for (const id of DATASETS) dash.load(id, `data/${id}.json`);
  dash.drawAll();
})();
