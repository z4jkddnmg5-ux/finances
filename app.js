/* Finances — private finance PWA. Data comes from data.json (local) or data.enc.json (AES-GCM). */
'use strict';
(() => {
const $ = s => document.querySelector(s);
let DATA = null, ENC = null, FROM_CACHE = false;
const state = {nwMode: 'cash', inv: {q: '', sort: 'v'}, trust: {q: '', sort: 'v', all: false}, spend: {p: 'last'}, acct: {q: ''}};
const scrollPos = {};
let lastHash = null, internalNav = 0;

/* ---------------- formatting ---------------- */
const NF = {}; const nf = d => NF[d] || (NF[d] = new Intl.NumberFormat('en-US', {minimumFractionDigits: d, maximumFractionDigits: d}));
function money(v, d = 2, sign = false) {
  if (v == null || isNaN(v)) return '—';
  if (Math.abs(v) < 0.5 * Math.pow(10, -d)) v = 0;
  const pre = sign ? (v > 0 ? '+' : v < 0 ? '−' : '') : (v < 0 ? '−' : '');
  return pre + '$' + nf(d).format(Math.abs(v));
}
const m0 = (v, s) => money(v, 0, s);
function pct(v, d = 1, sign = true) { if (v == null || isNaN(v)) return '—'; return (sign ? (v > 0 ? '+' : v < 0 ? '−' : '') : '') + nf(d).format(Math.abs(v)) + '%'; }
function kfmt(v) { const a = Math.abs(v); const s = a >= 1e6 ? (a / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + 'M' : a >= 1e3 ? Math.round(a / 1e3) + 'K' : Math.round(a) + ''; return (v < 0 ? '−' : '') + '$' + s; }
const cls = v => v > 0 ? 'pos' : v < 0 ? 'neg' : 'flat';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
function D(iso) { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
const fd = (iso, o = {month: 'short', day: 'numeric'}) => D(iso).toLocaleDateString('en-US', o);
const fdw = iso => fd(iso, {weekday: 'short', month: 'short', day: 'numeric'});
const fdy = iso => fd(iso, {month: 'short', day: 'numeric', year: 'numeric'});
const ft = iso => new Date(iso).toLocaleTimeString('en-US', {timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit'}) + ' ET';
const fdt = iso => new Date(iso).toLocaleString('en-US', {timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}) + ' ET';
const etDay = iso => new Date(iso).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const todayET = () => new Date().toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const fym = (ym, o = {month: 'short', year: 'numeric'}) => D(ym + '-01').toLocaleDateString('en-US', o);
const units = u => u == null ? '' : (Math.round(u * 1000) / 1000).toLocaleString('en-US', {maximumFractionDigits: 3});

/* ---------------- charts (SVG) ---------------- */
function spark(vals, color = '#8fd6f6', w = 84, h = 28) {
  vals = vals.filter(v => v != null);
  if (vals.length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${h}"><line x1="2" y1="${h / 2}" x2="${w - 2}" y2="${h / 2}" stroke="${color}" stroke-opacity=".35" stroke-width="1.5"/></svg>`;
  const mn = Math.min(...vals), mx = Math.max(...vals), r = mx - mn || 1;
  const pts = vals.map((v, i) => `${(2 + i * (w - 4) / (vals.length - 1)).toFixed(1)},${(h - 3 - (v - mn) / r * (h - 6)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}
function donut(parts, size = 132, thick = 20) {
  const tot = parts.reduce((s, p) => s + Math.max(0, p[1]), 0) || 1, r = size / 2 - thick / 2, c = 2 * Math.PI * r; let off = 0;
  let out = `<svg viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#2a2c31" stroke-width="${thick}"/>`;
  for (const [l, v, col] of parts) { if (v <= 0) continue; const L = c * v / tot;
    out += `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="${thick}" stroke-dasharray="${L.toFixed(2)} ${(c - L).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"><title>${esc(l)}</title></circle>`; off += L; }
  return out + '</svg>';
}
function legendList(parts) {
  const tot = parts.reduce((s, p) => s + Math.max(0, p[1]), 0) || 1;
  return parts.filter(p => p[1] > 0).map(([l, v, c]) => `<div class="lg"><span class="dot" style="background:${c}"></span>${esc(l)}<span class="r num">${m0(v)} <span class="muted">${pct(v / tot * 100, 1, false)}</span></span></div>`).join('');
}
function axisTicks(min, max, n = 4) {
  const span = max - min || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => x >= raw);
  const out = []; for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(v); return out;
}
function nwChart(pts, mode) {
  const W = 640, H = 240, L = 50, R = 10, T = 12, B = 34, n = pts.length;
  const seg = p => mode === 'cash' ? [[p.cash, '#3d8fd1']] : [[p.cash, '#3d8fd1'], [p.inv, '#8fd6f6'], [p.manual, '#6c6fe6']];
  const tops = pts.map(p => seg(p).reduce((s, x) => s + (x[0] || 0), 0));
  const nw = pts.map((p, i) => tops[i] - (p.liab || 0));
  let mx = Math.max(...tops, ...nw, 1) * 1.08, mn = Math.min(0, ...pts.map(p => -(p.liab || 0)), ...nw);
  mn = mn < 0 ? mn * 1.15 : 0;
  const ticks = axisTicks(mn, mx); mx = Math.max(mx, ticks[ticks.length - 1]); mn = Math.min(mn, ticks[0]);
  const y = v => T + (mx - v) / (mx - mn) * (H - T - B), cw = (W - L - R) / n, bw = Math.min(42, cw * 0.58);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Net worth history">`;
  for (const t of ticks) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${kfmt(t)}</text>`;
  pts.forEach((p, i) => {
    const cx = L + cw * i + cw / 2, op = p.est ? 0.55 : 1; let base = 0;
    for (const [v, col] of seg(p)) { if (!v) continue; s += `<rect x="${cx - bw / 2}" y="${y(base + v)}" width="${bw}" height="${Math.max(0, y(base) - y(base + v))}" fill="${col}" opacity="${op}" rx="2"><title>${esc(p.label)} ${m0(v)}</title></rect>`; base += v; }
    if (p.liab) s += `<rect x="${cx - bw / 2}" y="${y(0)}" width="${bw}" height="${Math.max(1, y(-p.liab) - y(0))}" fill="#e5575b" opacity="${op}" rx="2"><title>Liabilities ${m0(p.liab)}</title></rect>`;
    s += `<text class="axis" x="${cx}" y="${H - 18}" text-anchor="middle">${esc(p.label)}</text>${p.est ? `<text class="axis s" x="${cx}" y="${H - 6}" text-anchor="middle">est.</text>` : ''}`;
  });
  s += `<polyline fill="none" stroke="#fff" stroke-width="2" points="${nw.map((v, i) => `${L + cw * i + cw / 2},${y(v)}`).join(' ')}"/>`;
  nw.forEach((v, i) => s += `<circle cx="${L + cw * i + cw / 2}" cy="${y(v)}" r="3.2" fill="#fff"><title>${esc(pts[i].label)}: ${m0(v)}</title></circle>`);
  return s + '</svg>';
}
function lineChart(series, color = '#3d8fd1', H = 180) {
  if (series.length < 2) return '<div class="muted small">Not enough history for a chart yet.</div>';
  const W = 640, L = 54, R = 10, T = 10, B = 26, vals = series.map(x => x[1]);
  let mn = Math.min(...vals), mx = Math.max(...vals); if (mx === mn) { mx += 1; mn -= 1; }
  const ticks = axisTicks(mn, mx, 3); mn = Math.min(mn, ticks[0]); mx = Math.max(mx, ticks[ticks.length - 1]);
  const x = i => L + i * (W - L - R) / (series.length - 1), y = v => T + (mx - v) / (mx - mn) * (H - T - B);
  const pts = series.map((p, i) => `${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}">`;
  for (const t of ticks) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${kfmt(t)}</text>`;
  s += `<polygon points="${x(0)},${y(mn)} ${pts} ${x(series.length - 1)},${y(mn)}" fill="${color}" opacity=".12"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;
  const lab = [0, Math.floor((series.length - 1) / 2), series.length - 1];
  lab.forEach((i, k) => s += `<text class="axis" x="${x(i)}" y="${H - 6}" text-anchor="${k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}">${esc(series[i][0].length > 10 ? fdt(series[i][0]) : fd(series[i][0]))}</text>`);
  return s + '</svg>';
}
function flowChart(fl) {
  const W = 640, H = 200, L = 50, R = 8, T = 10, B = 26, n = fl.length; if (!n) return '';
  let mx = Math.max(1, ...fl.map(f => Math.max(f.income, f.spend))); const ticks = axisTicks(0, mx, 3); mx = Math.max(mx, ticks[ticks.length - 1]);
  const y = v => T + (mx - v) / mx * (H - T - B), cw = (W - L - R) / n, bw = Math.min(22, cw * 0.32);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}">`;
  for (const t of ticks) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${kfmt(t)}</text>`;
  fl.forEach((f, i) => { const cx = L + cw * i + cw / 2;
    s += `<rect x="${cx - bw - 1}" y="${y(f.income)}" width="${bw}" height="${y(0) - y(f.income)}" fill="#3ecf8e" rx="2"><title>Income ${m0(f.income)}</title></rect>`;
    s += `<rect x="${cx + 1}" y="${y(Math.max(0, f.spend))}" width="${bw}" height="${y(0) - y(Math.max(0, f.spend))}" fill="#ef6461" rx="2"><title>Spending ${m0(f.spend)}</title></rect>`;
    s += `<text class="axis" x="${cx}" y="${H - 8}" text-anchor="middle">${esc(fym(f.m, {month: 'short'}))}</text>`; });
  return s + '</svg>';
}

/* ---------------- shared bits ---------------- */
const card = (inner, extra = '') => `<div class="card ${extra}">${inner}</div>`;
const sec = t => `<div class="sec">${t}</div>`;
function trackerTable(rows, baseline) {
  if (!rows.length && !baseline) return '<div class="muted small">No snapshots yet.</div>';
  const out = []; let prev = baseline ? baseline.v : null;
  for (const r of rows) { const d = prev != null ? r.v - prev : null;
    out.push(`<div class="row"><div class="main1"><div class="t1">${fdw(etDay(r.t))} · ${esc(r.slot === 'ad hoc' ? 'Ad hoc' : r.slot)}</div><div class="t2">ran ${ft(r.t)}</div></div><div class="amt"><div>${money(r.v)}</div><div class="t2 ${cls(d)}">${d == null ? '—' : money(d, 2, true) + (prev ? ' · ' + pct(d / prev * 100, 2) : '')}</div></div></div>`); prev = r.v; }
  out.reverse();
  if (baseline) out.push(`<div class="row" style="background:#16171a"><div class="main1"><div class="t1">${fdw(baseline.d)} · Statement</div><div class="t2">baseline</div></div><div class="amt"><div>${money(baseline.v)}</div><div class="t2">—</div></div></div>`);
  return `<div class="list" style="margin:0 -16px">${out.join('')}</div>`;
}
function todaySlots(rows) {
  const day = todayET(), dow = D(day).getDay();
  const want = ['Open 9:30 AM', 'Midday 12:30 PM', 'Close 4:00 PM'];
  const chips = want.map(w => { const r = rows.filter(x => etDay(x.t) === day && x.slot === w).pop();
    const [hh, mm] = {Open: [9, 30], Midday: [12, 30], Close: [16, 0]}[w.split(' ')[0]];
    const now = new Date().toLocaleTimeString('en-GB', {timeZone: 'America/New_York', hour12: false}).split(':').map(Number);
    const past = now[0] * 60 + now[1] > hh * 60 + mm + 60;
    return `<div><span>${w.split(' ')[0]} · ${w.split(' ').slice(1).join(' ')}</span><b>${r ? m0(r.v) : '—'}</b><i>${r ? ft(r.t) : (dow === 0 || dow === 6 ? 'weekend' : past ? 'no run today' : 'scheduled')}</i></div>`; }).join('');
  const last = rows[rows.length - 1];
  return `<div class="kpis">${chips}<div><span>Latest run</span><b>${last ? m0(last.v) : '—'}</b><i>${last ? esc(last.slot === 'ad hoc' ? 'Ad hoc' : last.slot) + ' · ' + fdt(last.t) : ''}</i></div></div>`;
}
function holdingRow(h, trust) {
  const sub = trust ? `${h.u != null ? units(h.u) + ' × ' + money(h.p) : ''}${h.priced !== 'market' ? ' · statement value' : ''}`
                    : `${units(h.u)} × ${money(h.p)}${h.flag ? ' · ⚑' : ''}`;
  const right2 = trust ? (h.priced === 'market' ? `<span class="${cls(h.v - h.sv)}">${money(h.v - h.sv, 0, true)} vs stmt</span>` : `<span class="muted">${pct(h.w, 2, false)}</span>`)
                       : `<span class="${cls(h.dp)}">${pct(h.dp, 2)}</span> · ${pct(h.w, 1, false)}`;
  const badge = h.conf === 'medium' ? ' <span class="tag warn">medium</span>' : h.conf === 'unmapped' ? ' <span class="tag bad">unmapped</span>' : '';
  const t1 = h.t ? `<b>${esc(h.t)}</b>${badge} <span class="muted">${esc(h.n)}</span>` : `<b>${esc(h.n)}</b>${badge}`;
  return `<div class="row"><div class="main1"><div class="t1">${t1}</div><div class="t2">${sub}</div></div><div class="amt"><div>${money(h.v)}</div><div class="t2">${right2}</div></div></div>`;
}
function sortHoldings(list, key) {
  const f = {v: (a, b) => (b.v || 0) - (a.v || 0), dp: (a, b) => (b.dp ?? -1e9) - (a.dp ?? -1e9), dpa: (a, b) => (a.dp ?? 1e9) - (b.dp ?? 1e9), dc: (a, b) => (b.dc ?? -1e12) - (a.dc ?? -1e12),
    t: (a, b) => (a.t || '~').localeCompare(b.t || '~'), n: (a, b) => a.n.localeCompare(b.n), chg: (a, b) => ((b.v - b.sv) || 0) - ((a.v - a.sv) || 0)}[key] || ((a, b) => b.v - a.v);
  return list.slice().sort(f);
}
const filt = (list, q) => { q = q.trim().toLowerCase(); return q ? list.filter(h => (h.t || '').toLowerCase().includes(q) || h.n.toLowerCase().includes(q)) : list; };

/* ---------------- screens ---------------- */
const SCREENS = {};

SCREENS.overview = () => {
  const o = DATA.overview, sp = DATA.spending, pay = DATA.pay, b = DATA.bills;
  const chg = o.prev_change != null ? `<span class="${cls(o.prev_change)}">${money(o.prev_change, 2, true)} (${pct(o.prev_pct, 2)})</span> <span class="muted">since ${fdt(o.prev_time)}</span>` : '<span class="muted">First snapshot</span>';
  const c30 = o.cash_change_30 != null ? `<div class="chg">Cash minus cards <span class="${cls(o.cash_change_30)}">${money(o.cash_change_30, 0, true)}</span> <span class="muted">vs 30 days ago (est.)</span></div>` : '';
  const up = (pay.upcoming || [])[0];
  const billsLeft = b.upcoming.reduce((s, r) => s + (r.fixed ? r.typical : r.last_amt), 0);
  const tiles = `<div class="tiles">
    <a class="tile" href="#/spending"><span>Spent this month</span><b>${m0(sp.tot[0])}</b><i>${fd(sp.cur + '-01', {month: 'short'})} 1–${D(sp.today).getDate()}</i></a>
    <a class="tile" href="#/pay"><span>Next payday</span><b>${up ? fd(up.pay, {weekday: 'short', month: 'short', day: 'numeric'}) : '—'}</b><i>${up ? (up.est ? '~' + m0(up.est) + ' est.' : '') + (up.status ? ' · due' : '') : 'no pattern'}</i></a>
    <a class="tile" href="#/bills"><span>Bills left (${fd(sp.today, {month: 'short'})})</span><b>~${m0(billsLeft)}</b><i>${b.upcoming.length} expected</i></a></div>`;
  const parts = (p, tot) => `<div class="sbar">${p.map(([k, v, c]) => `<span style="flex:${(v / tot).toFixed(4)};background:${c}"></span>`).join('')}</div>` + p.map(([k, v, c]) => `<div class="lg"><span class="dot" style="background:${c}"></span>${esc(k)}<span class="r num">${m0(v)} <span class="muted">${pct(v / tot * 100, 0, false)}</span></span></div>`).join('');
  const summary = card(`<h3>Summary</h3>
    <div class="lg"><b>Assets</b><span class="r num b">${money(o.assets)}</span></div>${parts(o.asset_parts, o.assets)}
    <div class="lg" style="margin-top:14px"><b>Liabilities</b><span class="r num b">${money(o.liabilities)}</span></div>${o.liab_parts.length ? parts(o.liab_parts, o.liabilities) : '<div class="muted small">None</div>'}
    ${o.trust != null ? `<div class="lg" style="margin-top:14px"><b>Not in net worth</b></div><a class="lg" href="#/trust"><span class="dot" style="background:#c9a227"></span>Trust <span class="tag excl">separate</span><span class="r num">${m0(o.trust)} ›</span></a>` : ''}`);
  const alerts = DATA.alerts.length ? `<div class="card flush"><div class="ghead">Alerts &amp; notes</div><div class="list">${DATA.alerts.map(a => `<a class="alert ${a.lvl}" href="${esc(a.link || '#/overview')}"><span class="ic"></span><span>${esc(a.text)}</span></a>`).join('')}</div></div>` : '';
  return `<div class="cols"><div>
    ${card(`<div class="hero"><div class="lbl">Net worth</div><div class="val">${money(o.net_worth)}</div><div class="chg">${chg}</div>${c30}</div>
      <div class="ctrl" style="margin:12px 0 4px"><div class="toggle"><button data-act="nw" data-v="cash" class="${state.nwMode === 'cash' ? 'on' : ''}">Cash history</button><button data-act="nw" data-v="all" class="${state.nwMode === 'all' ? 'on' : ''}">All assets</button></div></div>
      <div id="nwc">${nwChart(o.chart, state.nwMode)}</div>
      <div class="legend"><span><i class="dot" style="background:#3d8fd1"></i>Cash</span>${state.nwMode === 'all' ? '<span><i class="dot" style="background:#8fd6f6"></i>Investments</span><span><i class="dot" style="background:#6c6fe6"></i>Real estate</span>' : ''}<span><i class="dot" style="background:#e5575b"></i>Liabilities</span><span><i class="dot" style="background:#fff"></i>Net</span></div>
      <div class="muted tiny" style="margin-top:6px">Month-end values before ${fd(o.history[0] ? etDay(o.history[0].t) : sp.today)} are <b>estimated from transactions</b> (faded bars, “est.”) by walking back from today’s balances; history starts ${fdy(o.tx_start)}. Investments and Home appear from their first snapshot.</div>`)}
    ${tiles}
    ${alerts}
  </div><div>${summary}
    ${card(`<h3>Upcoming bills</h3>${b.upcoming.slice(0, 6).map(r => `<div class="lg"><span class="dot" style="background:#f2c64c"></span>${fdw(r.next)} · ${esc(r.name)}<span class="r num">~${money(r.fixed ? r.typical : r.last_amt)}</span></div>`).join('') || '<div class="muted small">Nothing else expected this month.</div>'}<div style="margin-top:8px"><a class="btn" href="#/bills">All bills ›</a></div>`)}
  </div></div>
  <div class="foot">${DATA.meta.notes.map(esc).join('<br>')}<br>Sources: ${esc(DATA.meta.sources.join(', '))}; quotes ${DATA.meta.quotes_at ? fdt(DATA.meta.quotes_at) : '—'}; balances ${fdt(DATA.meta.balances_at)}.${ENC ? '<br><a class="btn" data-act="lock" href="#/overview" style="margin-top:8px">Lock &amp; forget this device</a>' : ''}</div>`;
};

SCREENS.accounts = (rest) => {
  if (rest[0]) return accountDetail(rest[0]);
  const groups = DATA.accounts.map(g => {
    const rows = g.accounts.map(a => {
      const href = a.link || `#/accounts/${encodeURIComponent(a.id)}`;
      const sp = a.spark.map(x => x[1]);
      return `<a class="row" href="${href}"><div class="main1"><div class="t1">${esc(a.name)}${a.manual ? ' <span class="tag">manual</span>' : ''}</div><div class="t2">${esc(a.sub)}</div></div>${spark(sp.slice(-90), g.color)}<div class="amt"><div>${money(a.bal)}</div><div class="t2">${a.updated ? (a.manual ? 'as of ' + fd(a.updated) : (a.updated.length > 10 ? ft(a.updated) : fd(a.updated))) : ''}</div></div><span class="chev">›</span></a>`;
    }).join('') || `<div class="row muted small">${esc(g.note || 'None')}</div>`;
    return `<div class="card flush"><div class="ghead"><span class="dot" style="background:${g.color}"></span>${esc(g.name)}<span class="r num">${money(g.total)}</span></div><div class="list">${rows}${g.note && g.accounts.length ? `<div class="row muted small">${esc(g.note)}</div>` : ''}</div></div>`;
  });
  const t = DATA.trust;
  const trust = t ? `<div class="card flush"><div class="ghead"><span class="dot" style="background:#c9a227"></span>Trust <span class="tag excl">not in net worth</span><span class="r num">${money(t.value)}</span></div><a class="row" href="#/trust"><div class="main1"><div class="t1">${esc(t.label)}</div><div class="t2">Statement CSV · equities repriced</div></div>${spark([t.statement_total, ...t.tracker.map(x => x.v)], '#c9a227')}<div class="amt"><div>${money(t.value)}</div><div class="t2">${DATA.meta.quotes_at ? ft(DATA.meta.quotes_at) : ''}</div></div><span class="chev">›</span></a></div>` : '';
  const half = Math.ceil(groups.length / 2);
  return `<div class="cols2"><div>${groups.slice(0, half).join('')}</div><div>${groups.slice(half).join('')}${trust}</div></div>
    <div class="foot">Balances fetched ${fdt(DATA.meta.balances_at)} · bank syncs: ${DATA.meta.connections.map(c => esc(c.name) + ' ' + (c.synced ? fdt(c.synced) : '—')).join(' · ')}</div>`;
};

function findAccount(id) { for (const g of DATA.accounts) for (const a of g.accounts) if (a.id === id) return [a, g]; return [null, null]; }
function accountDetail(id) {
  const [a, g] = findAccount(id);
  if (!a) return card('<div class="empty">Account not found.</div>');
  if (state.acct.id !== id) state.acct = {id, q: ''};
  setTitle(a.name);
  if (a.manual) return card(`<div class="hero"><div class="lbl">${esc(g.name)}</div><div class="val">${money(a.bal)}</div><div class="chg muted">${esc(a.sub)} · as of ${fdy(a.as_of)}</div></div><p class="muted small">Manual estimate — edit <code>manual.json</code> to change it. Not synced from any institution.</p>`);
  const isCard = a.kind === 'card';
  const series = a.spark;
  const head = card(`<div class="hero"><div class="lbl">${esc(g.name)} · ${esc(a.sub)}</div><div class="val">${money(a.bal)}</div>
    <div class="chg muted">${a.available != null ? (isCard ? 'Available credit ' : 'Available ') + money(a.available) + ' · ' : ''}${a.updated ? 'Synced ' + fdt(a.updated) : ''}</div></div>
    <div style="margin-top:10px">${lineChart(series, g.color)}</div>
    <div class="muted tiny">${isCard ? 'Balance owed' : 'Balance'} reconstructed daily from transactions${a.history_from ? ' since ' + fdy(a.history_from) : ''} (estimate).${a.n_pending ? ` ${a.n_pending} pending transaction(s) not yet in the balance history.` : ''}</div>`);
  return head + card(`<h3>Recent transactions <span class="r muted small">${a.txns.length} of ${a.n_txns || a.txns.length}</span></h3>
    <div class="ctrl"><input type="search" id="acctq" placeholder="Search transactions" value="${esc(state.acct.q)}" data-acct="${esc(id)}"></div>
    <div id="acctlist" class="list" style="margin:0 -16px -14px">${txList(a.txns, state.acct.q)}</div>`);
}
function txList(txns, q) {
  q = (q || '').trim().toLowerCase();
  const list = q ? txns.filter(t => (t.n || '').toLowerCase().includes(q) || (t.raw || '').toLowerCase().includes(q) || (t.c || '').toLowerCase().includes(q)) : txns;
  if (!list.length) return '<div class="empty">No matching transactions.</div>';
  let out = '', day = null;
  for (const t of list) {
    if (t.d !== day) { day = t.d; out += `<div class="dayhead">${fd(t.d, {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'})}</div>`; }
    out += `<div class="row"><div class="main1"><div class="t1">${esc(t.n)}${t.p ? ' <span class="tag warn">pending</span>' : ''}</div><div class="t2">${esc(t.c)}</div></div><div class="amt ${t.a > 0 ? 'pos' : ''}">${money(t.a, 2, t.a > 0)}</div></div>`;
  }
  return out;
}

SCREENS.investments = () => {
  const I = DATA.investments;
  if (!I.accounts.length) return card('<div class="empty">No investment accounts.</div>');
  return I.accounts.map(a => {
    const flags = a.holdings.filter(h => h.flag);
    return card(`<div class="hero"><div class="lbl">${esc(a.name)} · ${esc(a.institution)} · manual holdings <span class="tag good">in net worth</span></div><div class="val">${money(a.value)}</div>
        <div class="chg"><span class="${cls(a.day)}">${money(a.day, 2, true)} (${pct(a.day / (a.value - a.day) * 100, 2)})</span> <span class="muted">today · quotes ${DATA.meta.quotes_at ? fdt(DATA.meta.quotes_at) : '—'}</span></div></div>
        ${a.completeness ? `<div class="warnbox">⚠ ${esc(a.completeness)}</div>` : ''}
        <div class="muted tiny">Units from ${esc(a.source)}. Priced with market quotes each run (mutual funds = last daily NAV). Cost basis not available.${a.unpriced.length ? ' Unpriced (excluded): ' + esc(a.unpriced.join(', ')) : ' All holdings priced.'}</div>`)
    + `<div class="cols2">` + card(`<h3>Allocation</h3><div class="donut-wrap">${donut(a.alloc)}<div class="lgs">${legendList(a.alloc)}</div></div>`)
    + card(`<h3>Daily tracker <span class="r muted small">weekdays · ET</span></h3>${todaySlots(a.tracker)}<div style="margin-top:10px">${trackerTable(a.tracker)}</div><div class="muted tiny">Δ vs previous run. History builds with each scheduled run (9:30 AM open, 12:30 PM midday, 4:00 PM close).</div>`) + `</div>`
    + card(`<h3>Holdings <span class="r muted small" id="invcount"></span></h3>
        <div class="ctrl"><input type="search" id="invq" placeholder="Search ticker or name" value="${esc(state.inv.q)}">
        <select id="invsort"><option value="v">Value</option><option value="dp">Day % ↓</option><option value="dpa">Day % ↑</option><option value="dc">Day $</option><option value="t">Ticker</option><option value="n">Name</option></select></div>
        <div id="invlist" class="list" style="margin:0 -16px" data-acct="${esc(a.id)}"></div>
        ${flags.length ? `<div class="muted tiny" style="margin-top:10px">⚑ ${flags.map(h => esc(h.t + ': ' + h.flag)).join('<br>⚑ ')}</div>` : ''}`);
  }).join('') + (I.plaid_linked ? '' : card(`<div class="muted small"><b>No brokerage linked in Finance (Plaid).</b> ${esc(I.not_linked_note)}</div>`));
};
function renderInvList() {
  const el = $('#invlist'); if (!el) return;
  const a = DATA.investments.accounts.find(x => x.id === el.dataset.acct);
  const list = sortHoldings(filt(a.holdings, state.inv.q), state.inv.sort);
  el.innerHTML = list.map(h => holdingRow(h, false)).join('') || '<div class="empty">No matches.</div>';
  $('#invcount').textContent = `${list.length} of ${a.holdings.length}`;
  $('#invsort').value = state.inv.sort;
}

SCREENS.trust = () => {
  const t = DATA.trust;
  if (!t) return card('<div class="empty">No trust statement uploaded.</div>');
  const vs = t.value - t.statement_total, prev = t.tracker.length >= 2 ? t.tracker[t.tracker.length - 2].v : null;
  const med = t.positions.filter(p => p.conf === 'medium'), unm = t.positions.filter(p => p.conf === 'unmapped');
  return `<div class="note"><b>Not included in net worth.</b> ${esc(t.note)}</div>`
    + card(`<div class="hero"><div class="lbl">${esc(t.label)} <span class="tag excl">not in net worth</span></div><div class="val">${money(t.value)}</div>
       <div class="chg"><span class="${cls(vs)}">${money(vs, 2, true)} (${pct(vs / t.statement_total * 100, 2)})</span> <span class="muted">vs statement ${fd(t.statement_date, {month: 'numeric', day: 'numeric', year: 'numeric'})}</span>${prev != null ? ` · <span class="${cls(t.value - prev)}">${money(t.value - prev, 2, true)}</span> <span class="muted">vs prior run</span>` : ''}</div></div>
       <div class="kpis" style="margin-top:12px"><div><span>Statement (baseline)</span><b>${m0(t.statement_total)}</b><i>${fdy(t.statement_date)}</i></div><div><span>Repriced now</span><b>${m0(t.value)}</b><i>${DATA.meta.quotes_at ? fdt(DATA.meta.quotes_at) : ''}</i></div>
       <div><span>Positions</span><b>${t.n_positions}</b><i>${t.n_market} repriced with quotes</i></div><div><span>At statement value</span><b>${t.n_positions - t.n_market}</b><i>bonds, cash, ${t.n_unmapped} unmapped</i></div></div>`)
    + `<div class="cols2">` + card(`<h3>Allocation</h3><div class="donut-wrap">${donut(t.alloc)}<div class="lgs">${legendList(t.alloc)}</div></div>`)
    + card(`<h3>Daily tracker <span class="r muted small">weekdays · ET</span></h3>${todaySlots(t.tracker)}<div style="margin-top:10px">${trackerTable(t.tracker, {d: t.statement_date, v: t.statement_total})}</div><div class="muted tiny">Statement prices are the ${esc(t.pricing_day.slice(5).replace('-', '/'))} closes. Bonds &amp; cash are priced as of statement ${fd(t.statement_date, {month: 'numeric', day: 'numeric'})}.</div>`) + `</div>`
    + card(`<h3>Top 10 positions</h3><div class="list" style="margin:0 -16px -14px">${sortHoldings(t.positions, 'v').slice(0, 10).map(h => holdingRow(h, true)).join('')}</div>`)
    + card(`<h3>All holdings <span class="r muted small" id="trcount"></span></h3>
       <div class="ctrl"><input type="search" id="trq" placeholder="Search ticker or description" value="${esc(state.trust.q)}">
       <select id="trsort"><option value="v">Value</option><option value="chg">Change vs statement</option><option value="t">Ticker</option><option value="n">Description</option></select></div>
       <div id="trlist" class="list" style="margin:0 -16px"></div><div id="trmore"></div>
       <div class="muted tiny" style="margin-top:10px">Tickers verified against each security’s ${esc(t.pricing_day)} close (${t.n_high} within 1%). <span class="tag warn">medium</span> ADR priced from ordinary × ratio or 1–3% match: ${esc(med.map(p => p.n).join(', '))}. <span class="tag bad">unmapped</span> kept at statement value: ${esc(unm.map(p => p.n).join(', '))}.</div>`);
};
function renderTrustList() {
  const el = $('#trlist'); if (!el) return;
  const all = sortHoldings(filt(DATA.trust.positions, state.trust.q), state.trust.sort);
  const show = state.trust.all || state.trust.q ? all : all.slice(0, 40);
  el.innerHTML = show.map(h => holdingRow(h, true)).join('') || '<div class="empty">No matches.</div>';
  $('#trmore').innerHTML = show.length < all.length ? `<div style="padding:10px 0 0"><button class="btn" data-act="trall">Show all ${all.length}</button></div>` : '';
  $('#trcount').textContent = `${all.length} of ${DATA.trust.positions.length}`;
  $('#trsort').value = state.trust.sort;
}

SCREENS.bills = () => {
  const b = DATA.bills, amt = r => r.fixed ? r.typical : r.last_amt;
  const left = b.upcoming.reduce((s, r) => s + amt(r), 0), paid = b.paid.reduce((s, r) => s + r.last_amt, 0);
  const row = (r, right, sub) => `<div class="row"><div class="main1"><div class="t1">${esc(r.name)}${r.new ? ' <span class="tag">new</span>' : ''}</div><div class="t2">${sub}</div></div><div class="amt">${right}</div></div>`;
  return `<div class="kpis" style="margin-bottom:14px"><div><span>Recurring per month</span><b>${money(b.total)}</b><i>${b.items.length} bills &amp; subscriptions</i></div>
      <div><span>Still expected this month</span><b>~${money(left)}</b><i>${b.upcoming.length} items</i></div><div><span>Already paid this month</span><b>${money(paid)}</b><i>${b.paid.length} items</i></div>
      <div><span>History used</span><b>${fd(b.history_from, {month: 'short', year: 'numeric'})}+</b><i>bank; cards from link date</i></div></div>`
    + `<div class="cols2">` + card(`<h3>Upcoming this month</h3><div class="list" style="margin:0 -16px -14px">${b.upcoming.map(r => row(r, `<div>~${money(amt(r))}</div><div class="t2">${r.fixed ? 'fixed' : 'last amount'}</div>`, `${fdw(r.next)} · ${esc(r.cat)}`)).join('') || '<div class="empty">Nothing else expected this month.</div>'}</div>`)
    + card(`<h3>Paid this month</h3><div class="list" style="margin:0 -16px -14px">${b.paid.map(r => row(r, `<div class="pos">✓ ${money(r.last_amt)}</div>`, `${fdw(r.last)} · ${esc(r.cat)}`)).join('') || '<div class="empty">None yet.</div>'}</div>`) + `</div>`
    + card(`<h3>All recurring <span class="r muted small">per month</span></h3><div class="list" style="margin:0 -16px -14px">${b.items.map(r => row(r, `<div><b>${money(r.monthly)}</b></div><div class="t2">${r.fixed ? money(r.typical) : money(r.min, 0) + '–' + money(r.max, 0)}</div>`,
        `${esc(r.freq)} · next ~${fd(r.next)} · ${esc(r.source)} · seen ${esc(r.months)}`)).join('')}<div class="row"><div class="main1"><b>Total recurring per month</b></div><div class="amt"><b>${money(b.total)}</b></div></div></div>`)
    + card(`<details><summary>How bills are detected</summary><p class="muted small">Outgoing transactions from checking, money market and both credit cards are grouped by a normalized merchant name. A group counts as monthly if it appears in ≥3 calendar months and ≥60% of months since it first appeared, at most ~2× per month, and has a steady amount (≤20% variation) or is a bill-type category (loans, utilities, insurance, childcare, subscriptions). Newer bill-type charges count once two charges are 25–38 days apart (“new”). Bills every ~2–3 months (sewer, trash) are included with a per-month equivalent. No charge in 45 days = treated as cancelled. Card payments, own-account transfers, ATM and brokerage moves are excluded. “Per month” = usual amount for fixed bills, or the average monthly total when amounts vary.</p></details>`);
};

SCREENS.spending = (rest) => {
  const s = DATA.spending;
  if (rest[0] === 'cat' || rest[0] === 'm') return spendDrill(rest[0], rest[1]);
  const p = state.spend.p, idx = {cur: 'cur', last: 'last', avg: 'avg'}[p];
  const lm = fym(s.last, {month: 'long'}), am = `${fym(s.avg_months[5], {month: 'short'})}–${fym(s.avg_months[0], {month: 'short'})}`;
  const big = s.ledger.filter(r => r[5]);
  const exTot = ym => s.ledger.filter(r => r[0].slice(0, 7) === ym && !r[5]).reduce((x, r) => x + r[2], 0);
  const exAvg = s.avg_months.reduce((x, m) => x + exTot(m), 0) / 6;
  const rows = s.rows.filter(r => Math.abs(r.cur) + Math.abs(r.last) + Math.abs(r.avg) > 0.5).slice().sort((a, b) => b[idx] - a[idx]);
  const mx = Math.max(1, ...rows.map(r => Math.max(r.cur, r.last, r.avg)));
  const inPeriod = r => p === 'avg' ? s.avg_months.includes(r[0].slice(0, 7)) : r[0].slice(0, 7) === (p === 'cur' ? s.cur : s.last);
  const merch = {};
  for (const r of s.ledger) if (inPeriod(r)) { const k = r[4]; (merch[k] = merch[k] || {n: k, a: 0, c: 0, cat: r[1]}); merch[k].a += r[2]; merch[k].c++; }
  const div = p === 'avg' ? 6 : 1;
  const top = Object.values(merch).sort((a, b) => b.a - a.a).slice(0, 15);
  const plabel = {cur: `This month (${fd(s.cur + '-01', {month: 'short'})} 1–${D(s.today).getDate()})`, last: lm, avg: `6-mo avg (${am})`}[p];
  return `<div class="kpis" style="margin-bottom:14px">
      <div><span>This month (${fd(s.cur + '-01', {month: 'short'})} 1–${D(s.today).getDate()})</span><b>${m0(s.tot[0])}</b><i>${m0(exTot(s.cur))} excl. one-offs ≥$10K</i></div>
      <div><span>${lm}</span><b>${m0(s.tot[1])}</b><i>${m0(exTot(s.last))} excl. one-offs</i></div>
      <div><span>6-month avg (${am})</span><b>${m0(s.tot[2])}</b><i>${m0(exAvg)} excl. one-offs</i></div>
      <div><span>Pace this month</span><b>${s.day_frac ? m0(s.tot[0] / s.day_frac) : '—'}</b><i>straight-line</i></div></div>
    <div class="ctrl"><div class="toggle"><button data-act="sp" data-v="cur" class="${p === 'cur' ? 'on' : ''}">This month</button><button data-act="sp" data-v="last" class="${p === 'last' ? 'on' : ''}">${fym(s.last, {month: 'short'})}</button><button data-act="sp" data-v="avg" class="${p === 'avg' ? 'on' : ''}">6-mo avg</button></div></div>
    <div class="cols2">` + card(`<h3>Categories <span class="r muted small">${esc(plabel)}</span></h3><div class="list" style="margin:0 -16px -14px">${rows.map(r => {
        const d = r.last - r.avg;
        return `<a class="row" href="#/spending/cat/${encodeURIComponent(r.cat)}"><div class="main1"><div class="t1">${esc(r.cat)}</div><div class="hbar"><span style="width:${(Math.max(0, r[idx]) / mx * 100).toFixed(1)}%"></span><i style="left:${(Math.max(0, r.avg) / mx * 100).toFixed(1)}%"></i></div><div class="t2">This mo ${m0(r.cur)} · ${fym(s.last, {month: 'short'})} ${m0(r.last)} · avg ${m0(r.avg)}</div></div><div class="amt"><div>${m0(r[idx])}</div><div class="t2 ${cls(-d)}">${m0(d, true)} vs avg</div></div><span class="chev">›</span></a>`; }).join('')}
        <div class="row"><div class="main1"><b>Total</b><div class="t2">bar = selected period · tick = 6-mo avg</div></div><div class="amt"><b>${m0(s.tot[{cur: 0, last: 1, avg: 2}[p]])}</b></div></div></div>`)
    + card(`<h3>Top merchants <span class="r muted small">${esc(plabel)}</span></h3><div class="list" style="margin:0 -16px -14px">${top.map(m => `<a class="row" href="#/spending/m/${encodeURIComponent(m.n)}"><div class="main1"><div class="t1">${esc(m.n)}</div><div class="t2">${esc(m.cat)} · ${m.c} txn${m.c > 1 ? 's' : ''}${div > 1 ? ' in 6 mo' : ''}</div></div><div class="amt">${m0(m.a / div)}${div > 1 ? '<div class="t2">/mo</div>' : ''}</div><span class="chev">›</span></a>`).join('') || '<div class="empty">No spending in this period.</div>'}</div>`) + `</div>`
    + card(`<h3>Cash flow <span class="r legend" style="margin:0"><span><i class="dot" style="background:#3ecf8e"></i>Income</span><span><i class="dot" style="background:#ef6461"></i>Spending</span></span></h3>${flowChart(s.flows)}
      <div class="scroll"><table class="tbl"><thead><tr><th>Month</th><th class="num">Income</th><th class="num">Spending</th><th class="num">Net</th><th class="num">To invest.</th></tr></thead><tbody>${s.flows.slice().reverse().map(f => `<tr><td>${fym(f.m)}${f.m === s.cur ? ' (MTD)' : ''}</td><td class="num pos">${m0(f.income)}</td><td class="num neg">${m0(f.spend)}</td><td class="num ${cls(f.income - f.spend)}">${m0(f.income - f.spend, true)}</td><td class="num muted">${f.invest ? m0(f.invest) : '—'}</td></tr>`).join('')}</tbody></table></div>`)
    + card(`<h3>By account</h3><div class="scroll"><table class="tbl"><thead><tr><th>Account</th><th class="num">This mo</th><th class="num">${fym(s.last, {month: 'short'})}</th><th class="num">6-mo avg</th></tr></thead><tbody>${s.by_source.map(r => `<tr><td>${esc(r.src)}</td><td class="num">${m0(r.cur)}</td><td class="num">${m0(r.last)}</td><td class="num">${m0(r.avg)}</td></tr>`).join('')}</tbody></table></div>
      <div class="muted tiny" style="margin-top:8px">Checking + money market + both credit cards, posted only. Card payments, own-account and brokerage transfers excluded (no double counting); refunds and statement credits reduce their category. One-offs ≥$10K: ${esc(s.one_offs.map(o => `${fd(o.d)} ${o.n} ${m0(o.a)}`).join('; ') || 'none')}. Coverage: ${esc(s.coverage.map(c => `${c.src} from ${fdy(c.from)}`).join('; '))} — averages before those dates are partial.</div>`);
};
function spendDrill(kind, key) {
  const s = DATA.spending, rows = s.ledger.filter(r => (kind === 'cat' ? r[1] : r[4]) === key).sort((a, b) => b[0].localeCompare(a[0]));
  setTitle(key);
  const byM = {}; for (const r of rows) byM[r[0].slice(0, 7)] = (byM[r[0].slice(0, 7)] || 0) + r[2];
  const months = [s.cur, ...s.avg_months];
  let out = card(`<div class="hero"><div class="lbl">${kind === 'cat' ? 'Category' : 'Merchant'}</div><div class="val" style="font-size:28px">${esc(key)}</div></div>
    <div class="scroll" style="margin-top:8px"><table class="tbl"><thead><tr>${months.map(m => `<th class="num">${fym(m, {month: 'short'})}</th>`).join('')}</tr></thead><tbody><tr>${months.map(m => `<td class="num">${m0(byM[m] || 0)}</td>`).join('')}</tr></tbody></table></div>`);
  let list = '', mon = null;
  for (const r of rows) {
    const m = r[0].slice(0, 7);
    if (m !== mon) { mon = m; list += `<div class="dayhead">${fym(m, {month: 'long', year: 'numeric'})}<span class="r" style="float:right">${m0(byM[m])}</span></div>`; }
    list += `<div class="row"><div class="main1"><div class="t1">${esc(kind === 'cat' ? r[4] : r[1])}${r[5] ? ' <span class="tag warn">one-off</span>' : ''}</div><div class="t2">${fdw(r[0])} · ${esc(r[3])}</div></div><div class="amt ${r[2] < 0 ? 'pos' : ''}">${r[2] < 0 ? money(-r[2], 2, true) : money(r[2])}</div></div>`;
  }
  return out + card(`<h3>Transactions <span class="r muted small">${rows.length}</span></h3><div class="list" style="margin:0 -16px -14px">${list || '<div class="empty">None in the last 7 months.</div>'}</div>`);
}

SCREENS.pay = () => {
  const p = DATA.pay;
  if (!p.checks.length) return card(`<div class="empty"><b>No ${esc(p.employer)} paycheck deposits found.</b><br>Searched linked bank accounts for descriptors containing ${esc(p.searched.match.join(' / '))} with ${esc(p.searched.payroll_words.join(' / '))}.</div>`);
  const last = p.checks[p.checks.length - 1], up = p.upcoming || [], wd = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][p.weekday];
  const tiers = Object.entries(p.tier_med || {}).sort().map(([k, v]) => `${k} ≈ ${money(v)}`).join(' · ');
  const next = up[0];
  const statusTag = u => u.status === 'due' ? '<span class="tag warn">due — not posted yet</span>' : u.status === 'late' ? '<span class="tag bad">late?</span>' : '';
  return `<div class="kpis" style="margin-bottom:14px">
      <div><span>Last paycheck</span><b>${money(last.a)}</b><i>${fdw(last.d)} (payday ${fd(last.pay)})</i></div>
      <div><span>Next payday</span><b>${next ? fdw(next.pay) : '—'}</b><i>${next ? 'deposit ~' + fdw(next.dep) + (next.est ? ' · ~' + m0(next.est) + ' est.' : '') : ''}</i></div>
      <div><span>Average net / check</span><b>${money(p.avg)}</b><i>${p.checks.length} checks</i></div>
      <div><span>YTD ${D(last.d).getFullYear()}</span><b>${money(p.ytd)}</b><i>since ${fd(p.checks[0].d)} (history starts ${fd(p.history_from)})</i></div></div>`
    + (next && next.status ? `<div class="warnbox">⚠ ${esc(p.employer)} paycheck for ${fdw(next.pay)} was expected ~${fdw(next.dep)} and isn’t in the data yet (last bank sync ${p.sync ? fdt(p.sync) : '—'}).</div>` : '')
    + card(`<h3>Pattern</h3><div class="small"><b>${esc(p.cadence)}</b> on ${wd}s (gaps between pay dates: ${p.gaps.join(', ')} days; 13/15-day gaps are holiday shifts). Deposits land ~${p.lead} day(s) before payday. ${esc(tiers)}${p.month_last_rule ? ' — the large check is always the last payday of the month.' : ''}</div>
      <div class="muted tiny" style="margin-top:6px">Expected amounts are estimates (median of past checks of the same type). Missing scheduled paydays: ${p.missing.length ? esc(p.missing.map(fd).join(', ')) : 'none'}.</div>`)
    + `<div class="cols2">` + card(`<h3>Upcoming paydays</h3><div class="list" style="margin:0 -16px -14px">${up.map(u => `<div class="row"><div class="main1"><div class="t1">${fd(u.pay, {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'})} ${statusTag(u)}</div><div class="t2">deposit ~${fdw(u.dep)}${u.tier ? ' · ' + esc(u.tier.toLowerCase()) : ''}</div></div><div class="amt">${u.est ? '~' + money(u.est, 0) : '—'}<div class="t2">est.</div></div></div>`).join('')}</div>
        <div class="muted tiny" style="margin-top:12px">Months with 3 paydays: ${p.three.length ? p.three.map(t => `<b>${fym(t.m, {month: 'long', year: 'numeric'})}</b> (${t.days.map(d => fd(d, {month: 'numeric', day: 'numeric'})).join(', ')})`).join(', ') : 'none in the next 12 months'}.</div>`)
    + card(`<h3>Monthly pay <span class="r muted small">actual · projected</span></h3><div class="list" style="margin:0 -16px -14px">${p.months.map(m => `<div class="row"><div class="main1"><div class="t1">${fym(m.m, {month: 'long', year: 'numeric'})}${m.current ? ' <span class="tag">current</span>' : ''}${m.n >= 3 ? ' <span class="tag good">3 checks</span>' : ''}</div><div class="t2">${m.n} check${m.n === 1 ? '' : 's'}${m.current ? ' + ' + m.n_exp + ' expected' : ''}</div></div><div class="amt"><div>${money(m.actual)}</div>${m.proj != null ? `<div class="t2">projected ${money(m.proj)} est.</div>` : ''}</div></div>`).join('')}</div>`) + `</div>`
    + card(`<h3>Paychecks <span class="r muted small">${p.checks.length}</span></h3><div class="list" style="margin:0 -16px -14px">${p.checks.slice().reverse().map(c => {
        const fl = [c.flag ? `<span class="tag warn">${pct(c.dev, 0)} vs typical ${esc((c.tier || '').toLowerCase())}</span>` : '', c.late ? '<span class="tag bad">late</span>' : '', c.shift ? `<span class="tag">paid ${fd(c.pay, {weekday: 'short'})} (holiday)</span>` : ''].join(' ');
        return `<div class="row"><div class="main1"><div class="t1">${fdw(c.d)} <span class="muted small">payday ${fd(c.pay)}</span> ${fl}</div><div class="t2">${esc(c.tier || '')} · ${esc(c.acct)}</div></div><div class="amt"><b>${money(c.a)}</b></div></div>`; }).join('')}</div>`)
    + (p.other.length ? card(`<details><summary>Other ${esc(p.employer)} deposits (not payroll): ${p.other.length} totaling ${money(p.other.reduce((s, x) => s + x.a, 0))}</summary><div class="list" style="margin:0 -16px">${p.other.slice().reverse().map(o => `<div class="row"><div class="main1"><div class="t1">${fdw(o.d)}</div><div class="t2">${esc(o.raw)}</div></div><div class="amt">${money(o.a)}</div></div>`).join('')}</div><div class="muted tiny">“PAYABLES” deposits — likely expense reimbursements; excluded from paychecks.</div></details>`) : '')
    + `<div class="foot">Matched descriptors containing ${esc(p.searched.match.join(' / '))} with ${esc(p.searched.payroll_words.join(' / '))}. Pay date read from the YYMMDD in the descriptor when present.</div>`;
};

/* ---------------- shell, routing ---------------- */
const NAV = [
  ['overview', 'Overview', '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>'],
  ['accounts', 'Accounts', '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/>'],
  ['investments', 'Invest', '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>', 'Investments'],
  ['trust', 'Trust', '<path d="M3 10l9-6 9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>'],
  ['bills', 'Bills', '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>'],
  ['spending', 'Spending', '<circle cx="12" cy="12" r="9"/><path d="M12 3v9h9"/>'],
  ['pay', 'Pay', '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6.5 9.5h.01M17.5 14.5h.01"/>'],
];
const TITLES = {overview: 'Overview', accounts: 'Accounts', investments: 'Investments', trust: 'Trust', bills: 'Bills', spending: 'Spending', pay: 'Paycheck tracker'};
function setTitle(t) { $('#title').textContent = t; document.title = t + ' · Finances'; }
function buildShell() {
  $('#nav').innerHTML = `<div class="brand"><img src="icons/icon-192.png" alt="">Finances</div>` +
    NAV.map(([id, label, icon, long]) => `<a href="#/${id}" data-r="${id}" aria-label="${long || label}"><svg viewBox="0 0 24 24">${icon}</svg><span class="lbl-s">${window.innerWidth >= 900 ? (long || label) : label}</span></a>`).join('') +
    `<div class="navfoot">Private · ${ENC ? 'encrypted data' : 'local build'}<br>Built ${esc(fdt(DATA.meta.built))}</div>`;
  const m = DATA.meta, sameDay = etDay(m.updated) === todayET();
  $('#upd').innerHTML = `Updated <b>${sameDay ? '' : esc(m.updated_date) + ', '}${esc(ft(m.updated))}</b> • ${esc(m.slot_short)}`;
  const on = () => $('#offline').hidden = navigator.onLine && !FROM_CACHE;
  window.addEventListener('online', on); window.addEventListener('offline', on); on();
}
function parseHash() { const h = location.hash.replace(/^#\/?/, ''); const parts = h.split('/').filter(Boolean).map(decodeURIComponent); return {r: SCREENS[parts[0]] ? parts[0] : 'overview', rest: parts.slice(1)}; }
function render() {
  if (lastHash !== null) scrollPos[lastHash] = window.scrollY;
  const {r, rest} = parseHash();
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.r === r));
  setTitle(TITLES[r]);
  $('#backBtn').hidden = !rest.length;
  let html;
  try { html = SCREENS[r](rest); } catch (e) { console.error(e); html = card(`<div class="empty">Couldn’t render this screen: ${esc(e.message)}</div>`); }
  const v = $('#view'); v.innerHTML = html; v.style.animation = 'none'; void v.offsetWidth; v.style.animation = '';
  if (r === 'investments') renderInvList();
  if (r === 'trust') renderTrustList();
  lastHash = location.hash;
  window.scrollTo(0, scrollPos[location.hash] || 0);
}
function wire() {
  window.addEventListener('hashchange', () => { internalNav++; render(); });
  $('#backBtn').addEventListener('click', () => { if (internalNav > 0 && history.length > 1) history.back(); else location.hash = '#/' + parseHash().r; });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'nw') { state.nwMode = b.dataset.v; render(); }
    else if (act === 'sp') { state.spend.p = b.dataset.v; render(); }
    else if (act === 'trall') { state.trust.all = true; renderTrustList(); }
    else if (act === 'lock') { e.preventDefault(); forgetKey().then(() => location.reload()); }
  });
  document.addEventListener('input', e => {
    const id = e.target.id;
    if (id === 'invq') { state.inv.q = e.target.value; renderInvList(); }
    else if (id === 'trq') { state.trust.q = e.target.value; renderTrustList(); }
    else if (id === 'acctq') { state.acct.q = e.target.value; const [a] = findAccount(e.target.dataset.acct); $('#acctlist').innerHTML = txList(a.txns, state.acct.q); }
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'invsort') { state.inv.sort = e.target.value; renderInvList(); }
    if (e.target.id === 'trsort') { state.trust.sort = e.target.value; renderTrustList(); }
  });
  let w = window.innerWidth >= 900;
  window.addEventListener('resize', () => { const n = window.innerWidth >= 900; if (n !== w) { w = n; buildShell(); render(); } });
}
function start(data) {
  DATA = data;
  $('#boot').hidden = true; $('#lock').hidden = true; $('#app').hidden = false;
  buildShell(); wire();
  if (!location.hash) history.replaceState(null, '', '#/overview');
  render();
  document.documentElement.dataset.ready = '1';
}

/* ---------------- crypto + storage ---------------- */
const te = new TextEncoder(), td = new TextDecoder();
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
function idb() { return new Promise((res, rej) => { const r = indexedDB.open('finances', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function kv(mode, k, v) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('kv', mode === 'get' ? 'readonly' : 'readwrite'), st = tx.objectStore('kv');
  const q = mode === 'get' ? st.get(k) : mode === 'put' ? st.put(v, k) : st.delete(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
const forgetKey = () => kv('del', 'key').catch(() => {});
async function deriveKey(pass, enc) {
  const base = await crypto.subtle.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name: 'PBKDF2', salt: b64(enc.salt), iterations: enc.iter, hash: 'SHA-256'}, base, {name: 'AES-GCM', length: 256}, false, ['decrypt']);
}
async function decrypt(key, enc) {
  const buf = await crypto.subtle.decrypt({name: 'AES-GCM', iv: b64(enc.iv), additionalData: te.encode(enc.aad || '')}, key, b64(enc.ct));
  return JSON.parse(td.decode(buf));
}
async function unlockFlow() {
  if (!window.crypto || !crypto.subtle) return fatal('This page must be opened over HTTPS (or localhost) to decrypt your data.');
  try {
    const saved = await kv('get', 'key');
    if (saved && saved.salt === ENC.salt && saved.iter === ENC.iter) { try { return start(await decrypt(saved.key, ENC)); } catch (e) { await forgetKey(); } }
  } catch (e) { /* IndexedDB unavailable (private mode) */ }
  $('#boot').hidden = true; $('#lock').hidden = false; $('#app').hidden = true;
  setTimeout(() => $('#pass').focus(), 50);
  $('#lockForm').onsubmit = async ev => {
    ev.preventDefault();
    const btn = $('#unlockBtn'), err = $('#lockErr'); err.textContent = ''; btn.disabled = true; btn.textContent = 'Unlocking…';
    try {
      const key = await deriveKey($('#pass').value, ENC);
      const data = await decrypt(key, ENC);
      if ($('#remember').checked) { try { await kv('put', 'key', {key, salt: ENC.salt, iter: ENC.iter, saved: new Date().toISOString()}); } catch (e) { /* ignore */ } }
      else await forgetKey();
      $('#pass').value = '';
      start(data);
    } catch (e) { err.textContent = 'Wrong passphrase — try again.'; btn.disabled = false; btn.textContent = 'Unlock'; $('#pass').select(); }
  };
}
function fatal(msg) { $('#boot').innerHTML = `<img src="icons/icon-192.png" alt="" width="72" height="72"><div class="muted" style="max-width:320px;text-align:center;padding:0 20px">${esc(msg)}</div>`; }
async function getJSON(url) { try { const r = await fetch(url, {cache: 'no-store'}); if (!r.ok) return null; FROM_CACHE = FROM_CACHE || !!r.headers.get('X-From-Cache'); return await r.json(); } catch (e) { return null; } }
async function boot() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  if (location.protocol === 'file:') return fatal('Open this app from a web server (or use dashboard.html for offline viewing).');
  const info = await getJSON('build.json');
  if (!info || info.mode === 'encrypted') {
    ENC = await getJSON('data.enc.json');
    if (ENC && ENC.ct) return unlockFlow();
    ENC = null;
  }
  const d = await getJSON('data.json');
  if (d && d.meta) return start(d);
  fatal('No data found. Run ./refresh.sh to build the app data.');
}
boot();
})();
