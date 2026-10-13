// Khalis Bazar Khata: PARC Display Khata + Profit & Loss for the Khalis Bazar Shopify store.
import { CONFIG } from './config.js';
import { createDb } from './db.js';
import * as K from './calc.js';
import { SEED_PRODUCTS } from './seed-products.js';
import { mergeShopify } from './shopify.js';

const DEFAULT_SETTINGS = {
  parc_discount: 5,
  delivery_presets: [
    { label: 'Within city', amount: 167 },
    { label: 'Same zone', amount: 270 },
    { label: 'Other zone', amount: 315 },
  ],
  ignored_orders: [], // deleted Shopify orders { id, order_no, date }: Sync Shopify skips them
};
const PAY_METHODS = ['Cash', 'Bank transfer', 'JazzCash', 'Easypaisa', 'Cheque', 'Other'];
const VIEWS = [['parc', 'PARC Display Khata'], ['pnl', 'Profit & Loss'], ['orders', 'Orders'], ['prices', 'Price list']];
const UI_DEFAULTS = {
  view: 'parc', parcPeriod: 'all', pnlPeriod: 'all', from: '', to: '', group: 'order',
  pnlStatus: 'all', ordersStatus: 'all', showDrafts: false, sort: {},
};

const S = {
  db: null, user: null, loginMsg: '',
  products: [], orders: [], items: [], payments: [],
  settings: structuredClone(DEFAULT_SETTINGS),
  search: '', onlyMissing: false, ui: loadUi(), tables: {}, pending: 0, saveError: false,
  selected: new Set(), // order ids ticked on the Orders page
};

/* ---------- helpers ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 });
const num = (v) => nf.format(Math.abs(v) < 0.005 ? 0 : v);
const rs = (v) => `${v < -0.004 ? '−' : ''}Rs ${nf.format(Math.abs(v) < 0.005 ? 0 : Math.abs(v))}`;
const signed = (v) => (Math.abs(v) < 0.005 ? '0' : `${v > 0 ? '+' : '−'}${nf.format(Math.abs(v))}`);
const plClass = (v) => (v > 0.004 ? 'pos' : v < -0.004 ? 'neg' : '');
const plCell = (v) => `<span class="${plClass(v)}">${signed(v)}</span>`;
const pct = (m) => (m == null ? '—' : `${(m * 100).toFixed(1)}%`);
const short = (t) => String(t || '').replace(/^parc\s+/i, '');
const numOrNull = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : Number(v));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const badge = (s) => `<span class="badge ${s}">${K.STATUS_LABEL[s] || esc(s)}</span>`;
const itemsText = (lines) => lines.map(l => `${esc(short(l.title))}${l.variant ? ` ${esc(l.variant)}` : ''} ×${num(l.qty)}`).join(', ');

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  sync: '<path d="M21 12a9 9 0 0 1-15.4 6.4L3 16"/><path d="M3 12a9 9 0 0 1 15.4-6.4L21 8"/><path d="M21 3v5h-5"/><path d="M3 21v-5h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  calc: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h.01M16 19h.01"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
};
const icon = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

function loadUi() {
  try { return { ...UI_DEFAULTS, ...JSON.parse(localStorage.getItem('kb-khata-ui') || '{}') }; }
  catch { return { ...UI_DEFAULTS }; }
}
function saveUi() {
  try { localStorage.setItem('kb-khata-ui', JSON.stringify(S.ui)); } catch { /* preferences are optional */ }
}

function matches(text) {
  const q = S.search.trim().toLowerCase();
  if (!q) return true;
  const t = String(text).toLowerCase();
  return q.split(/\s+/).every(w => t.includes(w));
}
const orderText = (c) => [c.order.order_no, c.order.customer, c.order.city, K.STATUS_LABEL[c.order.status], c.order.note,
  ...c.lines.map(l => `${l.title} ${l.variant}`)].join(' ');

function toast(text, kind = '', ms = 4000) {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.append(box); }
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = text;
  box.append(t);
  setTimeout(() => t.remove(), ms);
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- saving ---------- */

function upsertLocal(list, row) {
  const i = list.findIndex(x => x.id === row.id);
  if (i >= 0) list[i] = row; else list.push(row);
}

async function persist(fn) {
  S.pending++;
  renderStatus();
  try { await fn(); S.saveError = false; }
  catch (e) { S.saveError = true; toast(`Not saved: ${e.message}`, 'error', 8000); }
  finally { S.pending--; renderStatus(); }
}

function saveRows(table, rows) {
  rows = [].concat(rows);
  for (const r of rows) upsertLocal(S[table], r);
  scheduleRender();
  return persist(() => S.db.put(table, rows));
}

function removeRows(table, ids) {
  ids = [].concat(ids);
  const set = new Set(ids);
  S[table] = S[table].filter(r => !set.has(r.id));
  if (table === 'orders') S.items = S.items.filter(i => !set.has(i.order_id));
  scheduleRender();
  return persist(() => S.db.remove(table, ids));
}

function saveSettings() {
  scheduleRender();
  return persist(() => S.db.put('settings', { id: 'main', data: S.settings }));
}

function renderStatus(text) {
  const el = $('#save-status');
  if (!el) return;
  el.classList.toggle('err', S.saveError && !text);
  el.textContent = text
    || (S.pending ? 'Saving…'
      : S.saveError ? 'Not saved: check internet'
        : S.db.mode === 'local' ? 'Saved in this browser' : 'All changes saved');
}

/* ---------- tables ---------- */

function compare(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

// columns: { key, label, cls, cell(row) → html, value(row) → sortable value, csv(row) → plain value }
function table(id, columns, rows, { foot, empty = 'Nothing here yet.', rowAttrs } = {}) {
  const sort = S.ui.sort[id];
  const sortCol = sort && columns.find(c => c.key === sort.key && c.value);
  if (sortCol) rows = [...rows].sort((a, b) => compare(sortCol.value(a), sortCol.value(b)) * sort.dir);
  S.tables[id] = { columns, rows };

  const head = columns.map(c => {
    if (!c.value) return `<th scope="col" class="${c.cls || ''}">${c.label}</th>`;
    const on = sortCol?.key === c.key;
    return `<th scope="col" class="${c.cls || ''}" aria-sort="${on ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}">`
      + `<button type="button" class="th-btn" data-action="sort" data-table="${id}" data-key="${c.key}">${c.label}`
      + `<span class="sort-ind" aria-hidden="true">${on ? (sort.dir > 0 ? '▲' : '▼') : ''}</span></button></th>`;
  }).join('');
  const body = rows.length
    ? rows.map(r => `<tr ${rowAttrs ? rowAttrs(r) : ''}>${columns.map(c => `<td class="${c.cls || ''}">${c.cell(r)}</td>`).join('')}</tr>`).join('')
    : `<tr class="empty"><td colspan="${columns.length}">${S.search ? `Nothing matches “${esc(S.search)}”.` : empty}</td></tr>`;
  const tfoot = foot && rows.length
    ? `<tfoot><tr>${columns.map(c => `<td class="${c.cls || ''}">${foot[c.key] ?? ''}</td>`).join('')}</tr></tfoot>` : '';
  return `<div class="table-wrap"><table id="t-${id}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${tfoot}</table></div>`;
}

function exportCsv(id) {
  const t = S.tables[id];
  if (!t) return;
  const cols = t.columns.filter(c => c.csv);
  const cellText = (v) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [cols.map(c => cellText(c.label.replace(/<[^>]+>/g, ''))).join(',')]
    .concat(t.rows.map(r => cols.map(c => cellText(c.csv(r))).join(',')));
  download(`khalis-bazar-${id}-${K.today()}.csv`, `﻿${lines.join('\r\n')}`, 'text/csv;charset=utf-8');
}

/* ---------- shared controls ---------- */

function seg(label, action, options, current, extra = '') {
  return `<div class="seg" role="group" aria-label="${label}">${options.map(([v, l]) =>
    `<button type="button" data-action="${action}" data-value="${v}" ${extra} aria-pressed="${current === v}">${l}</button>`).join('')}</div>`;
}

function periodControls(key) {
  const cur = S.ui[key];
  return seg('Period', 'period', K.PERIODS, cur, `data-scope="${key}"`)
    + (cur === 'custom'
      ? `<span class="dates"><input type="date" data-change="range" data-key="from" data-fk="from" value="${S.ui.from}" aria-label="From date">`
        + `<span class="muted">to</span><input type="date" data-change="range" data-key="to" data-fk="to" value="${S.ui.to}" aria-label="To date"></span>`
      : '');
}

function periodText(range) {
  if (!range.from && !range.to) return 'All time';
  return `${range.from ? K.fmtDate(range.from) : 'Start'} – ${range.to ? K.fmtDate(range.to) : 'today'}`;
}

function balanceCell(b) {
  const st = K.balanceState(b);
  if (st === 'nil') return '<span class="nil-tag">NIL</span>';
  if (st === 'advance') return `<span title="You paid PARC more than the orders">${num(-b)} adv.</span>`;
  return num(b);
}

/* ---------- PARC Display Khata ---------- */

function viewParc() {
  const range = K.periodRange(S.ui.parcPeriod, S.ui);
  const L = K.parcLedger(S, range);
  const st = K.balanceState(L.closing);
  const owed = Math.max(0, L.opening + L.handed);
  const paidShare = owed > 0 ? Math.min(1, L.paid / owed) : st === 'nil' ? 1 : 0;
  const calcs = K.allOrderCalcs(S);
  const waiting = calcs.filter(c => !c.order.in_parc && ['pending', 'shipped', 'delivered'].includes(c.order.status));
  const noPrice = calcs.filter(c => c.inKhata && c.costMissing);
  const payCount = L.rows.filter(r => r.kind === 'payment').length;

  const rows = (range.from ? [{ kind: 'opening', id: 'opening', balance: L.opening }] : []).concat(
    L.rows.filter(r => matches(r.kind === 'order' ? orderText(r.calc) : `payment paid ${r.payment.method} ${r.payment.note} ${r.payment.amount}`)));

  const columns = [
    { key: 'date', label: 'Date', cls: 'nowrap', cell: r => (r.date ? K.fmtDate(r.date) : ''), csv: r => r.date || '' },
    { key: 'detail', label: 'Detail', cell: r => {
      if (r.kind === 'opening') return `Opening balance <span class="sub">before ${K.fmtDate(range.from)}</span>`;
      if (r.kind === 'payment') return `<button class="link" data-action="edit-payment" data-id="${r.id}">Paid to PARC · ${esc(r.payment.method || 'Payment')}</button>`
        + (r.payment.note ? `<span class="sub">${esc(r.payment.note)}</span>` : '');
      const o = r.calc.order;
      return `<button class="link" data-action="edit-order" data-id="${o.id}">Order ${esc(o.order_no)}</button>`
        + `<span class="sub">${esc([o.customer, o.city].filter(Boolean).join(' · '))}</span>`;
    }, csv: r => (r.kind === 'opening' ? 'Opening balance' : r.kind === 'payment' ? `Payment ${r.payment.method} ${r.payment.note}`.trim() : `Order ${r.calc.order.order_no}`) },
    { key: 'items', label: 'Products', cls: 'items', cell: r => (r.kind === 'order'
      ? itemsText(r.calc.lines) + (r.calc.costMissing ? ' <span class="badge warn">PARC price missing</span>' : '') : ''),
    csv: r => (r.kind === 'order' ? r.calc.lines.map(l => `${l.title} ${l.variant} x${l.qty}`).join('; ') : '') },
    { key: 'debit', label: 'Order amount (Rs)', cls: 'num', cell: r => (r.debit ? num(r.debit) : ''), csv: r => r.debit || '' },
    { key: 'credit', label: 'Paid (Rs)', cls: 'num', cell: r => (r.credit ? num(r.credit) : ''), csv: r => r.credit || '' },
    { key: 'balance', label: 'Balance (Rs)', cls: 'num', cell: r => balanceCell(r.balance), csv: r => r.balance },
  ];

  return `
  <div class="print-only"><h2>PARC Display Khata · Khalis Bazar</h2><p>${periodText(range)} · printed ${K.fmtDate(K.today())}</p></div>
  <div class="page-head">
    <div><h1>PARC Display Khata</h1><p>Every order handed to PARC at the PARC price, and every payment you made to PARC.</p></div>
    <div class="toolbar no-print" style="margin:0">
      <button class="btn primary" data-action="calculate">${icon('calc')} Calculate</button>
      <button class="btn" data-action="add-payment">${icon('cash')} Add payment</button>
    </div>
  </div>
  <section class="kpis" aria-label="Khata summary">
    <div class="hero-card state-${st}">
      <div class="label">${st === 'advance' ? 'Advance paid to PARC' : 'Remaining to pay PARC (baqi)'}${range.from || range.to ? ` · up to ${range.to ? K.fmtDate(range.to) : 'today'}` : ''}</div>
      <div class="hero">${st === 'nil' ? 'NIL' : rs(Math.abs(L.closing))}</div>
      <span class="pill ${st}">${st === 'nil' ? '✓ Khata clear: everything is paid' : st === 'due' ? '● Payment due' : '▲ You paid extra'}</span>
      <div class="meter" role="img" aria-label="Paid ${Math.round(paidShare * 100)} percent"><span style="width:${(paidShare * 100).toFixed(1)}%"></span></div>
      <div class="meter-label">Paid ${rs(L.paid)} of ${rs(owed)}${L.opening ? ` (incl. opening ${rs(L.opening)})` : ''}</div>
    </div>
    <div class="tiles">
      <div class="tile"><div class="label">Orders handed to PARC</div><div class="value">${rs(L.handed)}</div><div class="sub">${plural(L.orderCount, 'order')} · ${periodText(range)}</div></div>
      <div class="tile"><div class="label">Paid to PARC</div><div class="value">${rs(L.paid)}</div><div class="sub">${plural(payCount, 'payment')}</div></div>
    </div>
  </section>
  ${waiting.length ? `<div class="callout"><div><b>${plural(waiting.length, 'order')} not handed to PARC yet</b>, so not counted in this khata.</div>
    <div class="chips">${waiting.map(c => `<span class="chip">${esc(c.order.order_no)} · Rs ${num(c.parcAmount)}
      <button class="btn sm" data-action="handover" data-id="${c.order.id}">Hand over</button></span>`).join('')}</div>
    ${waiting.length > 1 ? '<button class="btn sm" data-action="handover-all">Hand over all</button>' : ''}</div>` : ''}
  ${noPrice.length ? `<div class="callout"><div><b>${plural(noPrice.length, 'order')}</b> ${noPrice.length === 1 ? 'has' : 'have'} products with no PARC price (counted as Rs 0).
    Set the display price in the Price list, then</div><button class="btn sm" data-action="fill-prices">Fill missing prices</button></div>` : ''}
  <div class="toolbar">
    ${periodControls('parcPeriod')}
    <span class="spacer"></span>
    <button class="btn sm" data-action="print">${icon('print')} Print</button>
    <button class="btn sm" data-action="csv" data-table="parc">${icon('download')} CSV</button>
  </div>
  ${table('parc', columns, rows, {
    empty: 'No orders handed to PARC yet. Add an order or press Sync Shopify.',
    rowAttrs: r => `class="${r.kind}"`,
    foot: { detail: `Total · ${plural(L.orderCount, 'order')}, ${plural(payCount, 'payment')}`, debit: num(L.handed), credit: num(L.paid), balance: balanceCell(L.closing) },
  })}
  <p class="note">Order amount = quantity × PARC price (display price − ${num(S.settings.parc_discount)}%), saved when the order was added.
  Returned and cancelled orders are not counted. Untick “PARC khata” on the Orders page for an order PARC did not supply.${S.search ? ' Totals are for the whole period, not just the search.' : ''}</p>`;
}

function openCalculate() {
  const d = openDialog('', { wide: true });
  const draw = () => {
    const L = K.parcLedger(S, {});
    const open = K.openSinceNil(L);
    const P = K.khataProducts(open.rows);
    const st = K.balanceState(L.closing);
    const qty = P.rows.reduce((s, r) => s + r.qty, 0);
    d.innerHTML = `
    <div class="dlg-head"><h2>PARC khata calculation</h2><button type="button" class="icon-btn" data-dlg="close" aria-label="Close">${icon('x')}</button></div>
    <div class="dlg-body">
      <div class="receipt">
        <span>All orders handed to PARC (${L.orderCount})</span><b class="num">${rs(L.handed)}</b>
        <span>Paid to PARC</span><b class="num">− ${rs(L.paid)}</b>
        <span class="rule"></span>
        <span class="big">${st === 'advance' ? 'Advance with PARC' : 'Remaining (baqi)'}</span>
        <span class="big num ${st === 'nil' ? 'pos' : ''}">${st === 'nil' ? 'NIL ✓' : rs(Math.abs(L.closing))}</span>
      </div>
      ${st === 'nil'
        ? '<p class="callout info"><b>Khata is NIL.</b> Everything handed over to PARC has been paid.</p>'
        : `<h3 class="section">Products in the unpaid orders</h3>
      <p class="muted small">${open.clearedOn ? `Orders since the khata was last NIL on ${K.fmtDate(open.clearedOn)}` : 'All orders since the khata started'}:
        ${plural(open.orderCount, 'order')} worth ${rs(open.handed)}${open.paid ? `, ${rs(open.paid)} already paid against them` : ''}.</p>
      <div class="table-wrap" style="max-height:300px"><table>
        <thead><tr><th>Product</th><th>Size</th><th class="num">Qty</th><th class="num">PARC price</th><th class="num">Amount (Rs)</th></tr></thead>
        <tbody>${P.rows.map(r => `<tr><td>${esc(short(r.title))}</td><td>${esc(r.variant)}</td><td class="num">${num(r.qty)}</td><td class="num">${num(r.unit)}</td><td class="num">${num(r.amount)}</td></tr>`).join('')
          || '<tr class="empty"><td colspan="5">No orders.</td></tr>'}
        ${P.adjustments ? `<tr><td colspan="4">Adjustments (orders with an edited PARC amount)</td><td class="num">${signed(P.adjustments)}</td></tr>` : ''}</tbody>
        <tfoot><tr><td colspan="2">Total</td><td class="num">${num(qty)}</td><td></td><td class="num">${num(open.handed)}</td></tr></tfoot>
      </table></div>`}
      <form class="pay-box" id="calc-pay">
        <h3 class="section" style="margin-top:0">Enter amount paid to PARC</h3>
        <div class="form-grid">
          <label class="field">Amount (Rs)<input type="number" name="amount" step="any" min="0" inputmode="decimal" required></label>
          <label class="field">Date<input type="date" name="date" value="${K.today()}" required></label>
          <label class="field">Method<select name="method">${PAY_METHODS.map(m => `<option>${m}</option>`).join('')}</select></label>
          <label class="field">Note<input name="note" placeholder="e.g. cash given at NARC office" autocomplete="off"></label>
        </div>
        <div class="toolbar" style="margin-bottom:0">
          ${st === 'due' ? `<button type="button" class="btn" data-dlg="fill-full" data-amount="${L.closing}">Pay full remaining (${rs(L.closing)})</button>` : ''}
          <span class="spacer"></span><button type="submit" class="btn primary">Save payment</button>
        </div>
      </form>
    </div>
    <div class="dlg-foot"><button type="button" class="btn" data-dlg="close">Done</button></div>`;
  };
  draw();
  d.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dlg]');
    if (!b) return;
    if (b.dataset.dlg === 'close') d.close();
    if (b.dataset.dlg === 'fill-full') { const f = $('#calc-pay', d); f.elements.amount.value = b.dataset.amount; f.elements.amount.focus(); }
  });
  d.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const amount = Number(f.elements.amount.value);
    if (!(amount > 0)) { toast('Enter the amount you paid', 'error'); return; }
    const done = savePayment({ id: uid(), date: f.elements.date.value || K.today(), amount: K.round2(amount),
      method: f.elements.method.value, note: f.elements.note.value.trim(), created_at: new Date().toISOString() });
    draw();
    await done;
  });
}

function savePayment(p) {
  const done = saveRows('payments', p);
  const bal = K.parcLedger(S, {}).closing;
  const st = K.balanceState(bal);
  toast(st === 'nil' ? 'Payment saved. PARC khata is NIL ✓' : st === 'due' ? `Payment saved. Remaining ${rs(bal)}` : `Payment saved. Advance with PARC ${rs(-bal)}`);
  return done;
}

function openPayment(id) {
  const existing = id ? S.payments.find(x => x.id === id) : null;
  const p = existing || { id: uid(), date: K.today(), amount: '', method: 'Cash', note: '', created_at: new Date().toISOString() };
  const bal = K.parcLedger(S, {}).closing;
  const d = openDialog(`<form>
    <div class="dlg-head"><h2>${existing ? 'Edit payment' : 'Payment to PARC'}</h2><button type="button" class="icon-btn" data-dlg="close" aria-label="Close">${icon('x')}</button></div>
    <div class="dlg-body">
      ${existing ? '' : `<p class="muted" style="margin-top:0">Remaining right now: <b>${K.balanceState(bal) === 'nil' ? 'NIL' : rs(bal)}</b></p>`}
      <div class="form-grid">
        <label class="field">Amount (Rs)<input type="number" name="amount" step="any" min="0" inputmode="decimal" required value="${p.amount}"></label>
        <label class="field">Date<input type="date" name="date" required value="${p.date}"></label>
        <label class="field">Method<select name="method">${PAY_METHODS.map(m => `<option ${m === p.method ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <label class="field full">Note<input name="note" value="${esc(p.note)}" autocomplete="off"></label>
      </div>
    </div>
    <div class="dlg-foot">${existing ? '<button type="button" class="btn danger" data-dlg="delete">Delete</button>' : ''}<span class="spacer"></span>
      <button type="button" class="btn" data-dlg="close">Cancel</button><button type="submit" class="btn primary">Save payment</button></div>
  </form>`);
  d.querySelector('[name=amount]').focus();
  d.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dlg]');
    if (!b) return;
    if (b.dataset.dlg === 'close') d.close();
    if (b.dataset.dlg === 'delete' && confirm(`Delete the payment of ${rs(p.amount)} on ${K.fmtDate(p.date)}?`)) {
      d.close(); removeRows('payments', p.id); toast('Payment deleted');
    }
  });
  d.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const amount = Number(f.elements.amount.value);
    if (!(amount > 0)) { toast('Enter the amount you paid', 'error'); return; }
    d.close();
    savePayment({ ...p, amount: K.round2(amount), date: f.elements.date.value, method: f.elements.method.value, note: f.elements.note.value.trim() });
  });
}

/* ---------- Profit & Loss ---------- */

function costInput(c) {
  const o = c.order;
  if (o.status === 'returned') return '<span class="muted" title="Returned: goods go back, no PARC cost">0</span>';
  return `<input type="number" step="any" inputmode="decimal" data-change="order-field" data-field="cost_override" data-id="${o.id}" data-fk="cost:${o.id}"
    value="${o.cost_override ?? ''}" placeholder="${num(c.goodsAuto)}" aria-label="PARC cost for ${esc(o.order_no)}" title="Empty = price list (${num(c.goodsAuto)}). Type to change.">`;
}
function deliveryInput(c) {
  const o = c.order;
  return `<input type="number" step="any" inputmode="decimal" list="dl-presets" data-change="order-field" data-field="delivery" data-id="${o.id}" data-fk="delivery:${o.id}"
    class="${c.deliveryMissing ? 'missing' : ''}" value="${o.delivery ?? ''}" placeholder="enter" aria-label="Delivery charge for ${esc(o.order_no)}">`;
}
function otherInput(c) {
  const o = c.order;
  return `<input type="number" step="any" inputmode="decimal" data-change="order-field" data-field="other_cost" data-id="${o.id}" data-fk="other:${o.id}"
    value="${o.other_cost || ''}" placeholder="0" aria-label="Other cost for ${esc(o.order_no)}">`;
}

const moneyCols = (get = (r) => r) => [
  { key: 'sale', label: 'Sale (Rs)', cls: 'num', value: r => get(r).sale, cell: r => num(get(r).sale), csv: r => get(r).sale },
  { key: 'goods', label: 'PARC cost (Rs)', cls: 'num', value: r => get(r).goods, cell: r => num(get(r).goods), csv: r => get(r).goods },
  { key: 'delivery', label: 'Delivery (Rs)', cls: 'num', value: r => get(r).delivery, cell: r => num(get(r).delivery), csv: r => get(r).delivery },
  { key: 'other', label: 'Other (Rs)', cls: 'num', value: r => get(r).other, cell: r => num(get(r).other), csv: r => get(r).other },
  { key: 'profit', label: 'Profit (Rs)', cls: 'num', value: r => get(r).profit, cell: r => plCell(get(r).profit), csv: r => get(r).profit },
  { key: 'margin', label: 'Margin', cls: 'num', value: r => get(r).margin, cell: r => pct(get(r).margin), csv: r => (get(r).margin == null ? '' : K.round2(get(r).margin * 100)) },
];
const moneyFoot = (t) => ({ sale: num(t.sale), goods: num(t.goods), delivery: num(t.delivery), other: num(t.other), profit: plCell(t.profit), margin: pct(t.margin) });

function viewPnl() {
  const range = K.periodRange(S.ui.pnlPeriod, S.ui);
  const all = K.pnlOrders(S, range, S.ui.pnlStatus);
  const missing = all.filter(c => c.deliveryMissing);
  const calcs = S.onlyMissing ? missing : all;
  const T = K.totals(calcs);
  const group = S.ui.group;
  let body;

  if (group === 'order') {
    const rows = calcs.filter(c => matches(orderText(c)))
      .sort((a, b) => compare(b.order.date, a.order.date) || compare(b.order.order_no, a.order.order_no));
    const columns = [
      { key: 'date', label: 'Date', cls: 'nowrap', value: c => c.order.date, cell: c => K.fmtDate(c.order.date), csv: c => c.order.date },
      { key: 'order', label: 'Order', value: c => c.order.order_no, csv: c => c.order.order_no,
        cell: c => `<button class="link" data-action="edit-order" data-id="${c.order.id}">${esc(c.order.order_no)}</button><span class="sub">${esc([c.order.customer, c.order.city].filter(Boolean).join(' · '))}</span>` },
      { key: 'status', label: 'Status', value: c => c.order.status, cell: c => badge(c.order.status), csv: c => c.order.status },
      { key: 'items', label: 'Products', cls: 'items', cell: c => itemsText(c.lines), csv: c => c.lines.map(l => `${l.title} ${l.variant} x${l.qty}`).join('; ') },
      { key: 'sale', label: 'Sale (Rs)', cls: 'num', value: c => c.sale, cell: c => num(c.sale), csv: c => c.sale },
      { key: 'goods', label: 'PARC cost (Rs)', cls: 'num', value: c => c.goods, cell: costInput, csv: c => c.goods },
      { key: 'delivery', label: 'Delivery (Rs)', cls: 'num', value: c => c.delivery, cell: deliveryInput, csv: c => (c.deliveryMissing ? '' : c.delivery) },
      { key: 'other', label: 'Other cost (Rs)', cls: 'num', value: c => c.other, cell: otherInput, csv: c => c.other },
      { key: 'profit', label: 'Profit (Rs)', cls: 'num', value: c => c.profit, cell: c => plCell(c.profit), csv: c => c.profit },
      { key: 'margin', label: 'Margin', cls: 'num', value: c => c.margin, cell: c => pct(c.margin), csv: c => (c.margin == null ? '' : K.round2(c.margin * 100)) },
    ];
    const t = K.totals(rows);
    body = table('pnl-order', columns, rows, { empty: 'No orders in this period.', foot: { date: 'Total', order: plural(rows.length, 'order'), ...moneyFoot(t) } });
  } else if (group === 'product') {
    const rows = K.groupByProduct(calcs).filter(r => matches(`${r.title} ${r.variant}`));
    const columns = [
      { key: 'title', label: 'Product', value: r => r.title, cell: r => esc(short(r.title)), csv: r => r.title },
      { key: 'variant', label: 'Size', value: r => r.variant, cell: r => esc(r.variant), csv: r => r.variant },
      { key: 'orders', label: 'Orders', cls: 'num', value: r => r.orders, cell: r => r.orders, csv: r => r.orders },
      { key: 'qty', label: 'Qty sold', cls: 'num', value: r => r.qty, csv: r => r.qty,
        cell: r => num(r.qty) + (r.returnedQty ? `<span class="sub">${num(r.returnedQty)} returned</span>` : '') },
      ...moneyCols().slice(0, 2),
      { key: 'costs', label: 'Delivery + other (Rs)', cls: 'num', value: r => r.delivery + r.other, cell: r => num(r.delivery + r.other), csv: r => K.round2(r.delivery + r.other) },
      moneyCols()[4],
      { key: 'unit', label: 'Profit / item', cls: 'num', value: r => (r.qty ? r.profit / r.qty : null), cell: r => (r.qty ? plCell(K.round2(r.profit / r.qty)) : '—'), csv: r => (r.qty ? K.round2(r.profit / r.qty) : '') },
      moneyCols()[5],
    ];
    const t = K.totals(rows.map(r => ({ ...r, orders: 0 })));
    body = table('pnl-product', columns, rows, { empty: 'No products sold in this period.',
      foot: { title: 'Total', qty: num(t.qty), sale: num(t.sale), goods: num(t.goods), costs: num(K.round2(t.delivery + t.other)), profit: plCell(t.profit), margin: pct(t.margin) } });
  } else {
    const rows = K.groupByPeriod(calcs.filter(c => matches(orderText(c))), group);
    const columns = [
      { key: 'key', label: group === 'day' ? 'Day' : group === 'week' ? 'Week (Mon–Sun)' : 'Month', value: r => r.key, cell: r => esc(r.label), csv: r => r.label },
      { key: 'orders', label: 'Orders', cls: 'num', value: r => r.orders, cell: r => r.orders, csv: r => r.orders },
      { key: 'qty', label: 'Items', cls: 'num', value: r => r.qty, cell: r => num(r.qty), csv: r => r.qty },
      ...moneyCols(),
    ];
    const t = K.totals(rows);
    body = table(`pnl-${group}`, columns, rows, { empty: 'No orders in this period.', foot: { key: 'Total', orders: t.orders, qty: num(t.qty), ...moneyFoot(t) } });
  }

  const tableId = group === 'order' ? 'pnl-order' : group === 'product' ? 'pnl-product' : `pnl-${group}`;
  return `
  <div class="print-only"><h2>Profit &amp; Loss · Khalis Bazar</h2><p>${periodText(range)} · printed ${K.fmtDate(K.today())}</p></div>
  <div class="page-head"><div><h1>Profit &amp; Loss</h1><p>Sale − PARC cost − delivery − other costs, for every order.</p></div></div>
  <section class="kpis" aria-label="Profit summary">
    <div class="hero-card">
      <div class="label">${T.profit < 0 ? 'Net loss' : 'Net profit'} · ${periodText(range)}</div>
      <div class="hero ${plClass(T.profit)}">${rs(T.profit)}</div>
      <div class="sub">${pct(T.margin)} margin on ${rs(T.sale)} of sales${missing.length ? ` · before delivery on ${plural(missing.length, 'order')}` : ''}</div>
    </div>
    <div class="tiles">
      <div class="tile"><div class="label">Sales</div><div class="value">${rs(T.sale)}</div><div class="sub">${plural(T.orders, 'order')} · ${num(T.qty)} items</div></div>
      <div class="tile"><div class="label">PARC cost</div><div class="value">${rs(T.goods)}</div><div class="sub">what PARC charges</div></div>
      <div class="tile"><div class="label">Delivery</div><div class="value">${rs(T.delivery)}</div><div class="sub">${missing.length ? `${plural(missing.length, 'order')} not entered` : 'courier charges'}</div></div>
      <div class="tile"><div class="label">Other costs</div><div class="value">${rs(T.other)}</div><div class="sub">packing, returns…</div></div>
    </div>
  </section>
  ${missing.length || S.onlyMissing ? `<div class="callout"><div>${S.onlyMissing
    ? `Showing only the <b>${plural(missing.length, 'order')}</b> with no delivery charge.`
    : `<b>${plural(missing.length, 'order')}</b> ${missing.length === 1 ? 'has' : 'have'} no delivery charge yet, so profit looks higher than it is.`}</div>
    <button class="btn sm" data-action="only-missing" data-value="${S.onlyMissing ? '0' : '1'}">${S.onlyMissing ? 'Show all orders' : 'Show only these'}</button></div>` : ''}
  <div class="toolbar">
    ${periodControls('pnlPeriod')}
    ${seg('Orders', 'pnl-status', K.PNL_STATUS, S.ui.pnlStatus)}
  </div>
  <div class="toolbar">
    ${seg('Group by', 'group', K.GROUPS, group)}
    <span class="spacer"></span>
    <button class="btn sm" data-action="print">${icon('print')} Print</button>
    <button class="btn sm" data-action="csv" data-table="${tableId}">${icon('download')} CSV</button>
  </div>
  ${body}
  <p class="note">${group === 'order' ? 'Type delivery charges straight into the table (suggestions: your courier zone rates). PARC cost fills itself from the price list (grey); type a number to change it for one order. ' : ''}
  Sale is the product price without GST. Returned orders have no sale and no PARC cost, but their delivery and other costs count as a loss. Cancelled orders are left out.
  ${group === 'product' ? 'Each order’s delivery and other costs are shared across its products by sale value.' : ''}</p>`;
}

/* ---------- Orders ---------- */

function viewOrders() {
  const calcs = K.allOrderCalcs(S);
  const counts = Object.fromEntries(K.STATUSES.map(s => [s, calcs.filter(c => c.order.status === s).length]));
  const opts = [['all', `All ${calcs.length}`], ...K.STATUSES.map(s => [s, `${K.STATUS_LABEL[s]} ${counts[s]}`])];
  const rows = calcs.filter(c => (S.ui.ordersStatus === 'all' || c.order.status === S.ui.ordersStatus) && matches(orderText(c)))
    .sort((a, b) => compare(b.order.date, a.order.date) || compare(b.order.order_no, a.order.order_no));
  const picked = rows.filter(c => S.selected.has(c.order.id));
  const allPicked = rows.length > 0 && picked.length === rows.length;
  const ignored = S.settings.ignored_orders || [];
  const columns = [
    { key: 'pick', cls: 'pick',
      label: `<input type="checkbox" data-change="select-all" data-fk="select-all" ${allPicked ? 'checked' : ''} aria-label="Select all orders shown">`,
      cell: c => `<input type="checkbox" data-change="select-order" data-id="${c.order.id}" data-fk="pick:${c.order.id}" ${S.selected.has(c.order.id) ? 'checked' : ''} aria-label="Select order ${esc(c.order.order_no)}">` },
    { key: 'date', label: 'Date', cls: 'nowrap', value: c => c.order.date, cell: c => K.fmtDate(c.order.date), csv: c => c.order.date },
    { key: 'order', label: 'Order', value: c => c.order.order_no, csv: c => c.order.order_no,
      cell: c => `<button class="link" data-action="edit-order" data-id="${c.order.id}">${esc(c.order.order_no)}</button><span class="sub">${c.order.source === 'shopify' ? 'Shopify' : 'Added by hand'}</span>` },
    { key: 'customer', label: 'Customer', value: c => c.order.customer, csv: c => c.order.customer,
      cell: c => `${esc(c.order.customer)}<span class="sub">${esc(c.order.city)}</span>` },
    { key: 'items', label: 'Products', cls: 'items', cell: c => itemsText(c.lines), csv: c => c.lines.map(l => `${l.title} ${l.variant} x${l.qty}`).join('; ') },
    { key: 'sale', label: 'Sale (Rs)', cls: 'num', value: c => c.saleGross, cell: c => num(c.saleGross), csv: c => c.saleGross },
    { key: 'parc', label: 'PARC amount (Rs)', cls: 'num', value: c => c.parcAmount, csv: c => c.parcAmount,
      cell: c => num(c.parcAmount) + (c.costMissing ? '<span class="sub"><span class="badge warn">price missing</span></span>' : '') },
    { key: 'status', label: 'Status', value: c => c.order.status, csv: c => c.order.status,
      cell: c => `<select class="inline" data-change="order-field" data-field="status" data-id="${c.order.id}" data-fk="status:${c.order.id}" aria-label="Status of ${esc(c.order.order_no)}">
        ${K.STATUSES.map(s => `<option value="${s}" ${s === c.order.status ? 'selected' : ''}>${K.STATUS_LABEL[s]}</option>`).join('')}</select>` },
    { key: 'in_parc', label: 'PARC khata', value: c => (c.order.in_parc ? 1 : 0), csv: c => (c.inKhata ? 'yes' : 'no'),
      cell: c => (['returned', 'cancelled'].includes(c.order.status)
        ? '<span class="muted small">not counted</span>'
        : `<label class="check"><input type="checkbox" data-change="order-field" data-field="in_parc" data-id="${c.order.id}" data-fk="parc:${c.order.id}" ${c.order.in_parc ? 'checked' : ''}>
          <span class="small">${c.order.in_parc ? 'Handed over' : 'Not yet'}</span></label>`) },
  ];
  return `
  <div class="page-head"><div><h1>Orders</h1><p>Shopify orders arrive with <b>Sync Shopify</b>. Add WhatsApp or phone orders with <b>New order</b>.</p></div></div>
  <div class="toolbar">
    ${seg('Status', 'orders-status', opts, S.ui.ordersStatus)}
    <span class="spacer"></span>
    ${picked.length ? `<button class="btn sm danger" data-action="delete-selected">${icon('trash')} Delete ${plural(picked.length, 'order')}</button>` : ''}
    <button class="btn sm" data-action="csv" data-table="orders">${icon('download')} CSV</button>
  </div>
  ${table('orders', columns, rows, { empty: 'No orders yet. Press New order or Sync Shopify.' })}
  <p class="note">Tick orders and press Delete to remove ones that did not go through you (for example sold directly).
  A deleted Shopify order does not come back when you press Sync Shopify.</p>
  <p class="note">Status: Pending → Shipped → Delivered (cash received). Use Returned for refused or returned COD parcels and Cancelled for orders that never went out.</p>
  ${ignored.length ? `<div class="callout info"><div><b>Deleted Shopify orders (${ignored.length})</b>: Sync Shopify skips these.
    Press “Bring back” and then Sync Shopify to add one again.</div>
    <div class="chips">${ignored.map(x => `<span class="chip">${esc(x.order_no)}${x.date ? ` · ${K.fmtDate(x.date, { day: 'numeric', month: 'short' })}` : ''}
      <button class="btn sm" data-action="restore-order" data-id="${esc(x.id)}">Bring back</button></span>`).join('')}</div></div>` : ''}`;
}

// Deletes orders (and their products); Shopify ones are remembered so Sync Shopify skips them.
function deleteOrders(ids) {
  const list = S.orders.filter(o => ids.includes(o.id));
  if (!list.length) return;
  const names = list.map(o => o.order_no).join(', ');
  const fromShopify = list.filter(o => o.source === 'shopify' || String(o.id).startsWith('so_'));
  if (!confirm(`Delete ${plural(list.length, 'order')} (${names})?\n\nThey are removed from the PARC khata and Profit & Loss.`
    + (fromShopify.length ? '\nShopify orders will not come back on Sync Shopify (you can bring them back from the Orders page).' : ''))) return false;
  if (fromShopify.length) {
    const known = new Set((S.settings.ignored_orders || []).map(x => x.id));
    S.settings = { ...S.settings, ignored_orders: [
      ...(S.settings.ignored_orders || []),
      ...fromShopify.filter(o => !known.has(o.id)).map(o => ({ id: o.id, order_no: o.order_no, date: o.date })),
    ] };
    saveSettings();
  }
  list.forEach(o => S.selected.delete(o.id));
  removeRows('orders', list.map(o => o.id));
  toast(`${plural(list.length, 'order')} deleted`);
  return true;
}

/* ---------- Price list ---------- */

function viewPrices() {
  const isCustom = (p) => !String(p.id).startsWith('sv_');
  const drafts = S.products.filter(p => !p.active).length;
  const noDisplay = S.products.filter(p => p.active && p.display_price == null).length;
  const rows = S.products
    .filter(p => (S.ui.showDrafts || p.active) && matches(`${p.title} ${p.variant} ${p.handle}`))
    .sort((a, b) => (a.position || 0) - (b.position || 0));
  const columns = [
    { key: 'title', label: 'Product', value: p => p.title, csv: p => p.title,
      cell: p => `${esc(short(p.title))}${!p.active ? ' <span class="badge">Draft</span>' : ''}${isCustom(p) ? ` <span class="badge">Added by hand</span> <button class="link small" data-action="delete-product" data-id="${p.id}">delete</button>` : ''}` },
    { key: 'variant', label: 'Size', value: p => p.variant, cell: p => esc(p.variant), csv: p => p.variant },
    { key: 'store', label: 'Khalis Bazar price (Rs)', cls: 'num', value: p => p.store_price, csv: p => p.store_price,
      cell: p => (isCustom(p)
        ? `<input type="number" step="any" inputmode="decimal" data-change="product-field" data-field="store_price" data-id="${p.id}" data-fk="store:${p.id}" value="${p.store_price ?? ''}" aria-label="Selling price of ${esc(p.title)} ${esc(p.variant)}">`
        : num(p.store_price)) },
    { key: 'display', label: 'PARC display price (Rs)', cls: 'num', value: p => p.display_price, csv: p => p.display_price ?? '',
      cell: p => `<input type="number" step="any" inputmode="decimal" data-change="product-field" data-field="display_price" data-id="${p.id}" data-fk="display:${p.id}"
        class="${p.display_price == null ? 'missing' : ''}" value="${p.display_price ?? ''}" placeholder="set" aria-label="Display price of ${esc(p.title)} ${esc(p.variant)}">` },
    { key: 'parc', label: `PARC price −${num(S.settings.parc_discount)}% (Rs)`, cls: 'num', value: p => K.parcPrice(p, S.settings),
      cell: p => { const v = K.parcPrice(p, S.settings); return v == null ? '—' : num(v); }, csv: p => K.parcPrice(p, S.settings) ?? '' },
    { key: 'gross', label: 'You keep before delivery (Rs)', cls: 'num', value: p => { const v = K.parcPrice(p, S.settings); return v == null ? null : p.store_price - v; },
      cell: p => { const v = K.parcPrice(p, S.settings); return v == null ? '—' : `${plCell(K.round2(p.store_price - v))}<span class="sub">${pct(p.store_price ? (p.store_price - v) / p.store_price : null)}</span>`; },
      csv: p => { const v = K.parcPrice(p, S.settings); return v == null ? '' : K.round2(p.store_price - v); } },
  ];
  return `
  <div class="page-head"><div><h1>Price list</h1><p>Every product and size from Khalis Bazar, with the PARC display price you set.</p></div>
    <button class="btn" data-action="add-product">${icon('plus')} Add product by hand</button></div>
  ${noDisplay ? `<div class="callout"><div><b>${plural(noDisplay, 'product')}</b> ${noDisplay === 1 ? 'has' : 'have'} no display price yet. Orders for them count Rs 0 PARC cost until you set one.</div></div>` : ''}
  <div class="toolbar">
    <label class="check">PARC discount
      <input type="number" step="any" min="0" max="100" style="width:70px;padding:5px 8px;border:1px solid var(--line-strong);border-radius:8px;background:var(--surface)"
        data-change="setting" data-key="parc_discount" data-fk="parc_discount" value="${S.settings.parc_discount}" aria-label="PARC discount percent"> % off the display price</label>
    <label class="check"><input type="checkbox" data-change="show-drafts" ${S.ui.showDrafts ? 'checked' : ''}> Show ${plural(drafts, 'draft product')}</label>
    <span class="spacer"></span>
    <button class="btn sm" data-action="csv" data-table="prices">${icon('download')} CSV</button>
  </div>
  ${table('prices', columns, rows, { empty: 'No products.' })}
  <p class="note">Khalis Bazar price comes from your Shopify store (Sync Shopify keeps it up to date). You set the PARC display price; PARC price = display price − discount.
  A new order takes today’s prices and keeps them, so changing a price here does not change old orders (open an order and press “Use current price list” to update it).</p>`;
}

function openProduct() {
  const d = openDialog(`<form>
    <div class="dlg-head"><h2>Add product by hand</h2><button type="button" class="icon-btn" data-dlg="close" aria-label="Close">${icon('x')}</button></div>
    <div class="dlg-body"><p class="muted" style="margin-top:0">For items you sell outside the Shopify store. Shopify products are added by Sync Shopify.</p>
      <div class="form-grid">
        <label class="field full">Product name<input name="title" required autocomplete="off"></label>
        <label class="field">Size<input name="variant" placeholder="e.g. 1 kg" autocomplete="off"></label>
        <label class="field">Selling price (Rs)<input type="number" step="any" name="store_price" inputmode="decimal"></label>
        <label class="field">PARC display price (Rs)<input type="number" step="any" name="display_price" inputmode="decimal"></label>
      </div></div>
    <div class="dlg-foot"><span class="spacer"></span><button type="button" class="btn" data-dlg="close">Cancel</button><button class="btn primary" type="submit">Add product</button></div>
  </form>`);
  d.querySelector('[name=title]').focus();
  d.addEventListener('click', (e) => { if (e.target.closest('[data-dlg="close"]')) d.close(); });
  d.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target.elements;
    if (!f.title.value.trim()) return;
    const position = S.products.reduce((m, p) => Math.max(m, p.position || 0), 0) + 1;
    d.close();
    saveRows('products', { id: uid(), handle: '', title: f.title.value.trim(), variant: f.variant.value.trim(),
      store_price: numOrNull(f.store_price.value) ?? 0, display_price: numOrNull(f.display_price.value), active: true, position });
    toast('Product added');
  });
}

/* ---------- order dialog ---------- */

const blankLine = () => ({ id: uid(), product_id: null, title: '', variant: '', qty: 1, price: 0, parc_cost: 0 });

function nextOrderNo() {
  const max = S.orders.reduce((m, o) => { const x = /^M-(\d+)$/i.exec(o.order_no); return x ? Math.max(m, Number(x[1])) : m; }, 0);
  return `M-${String(max + 1).padStart(3, '0')}`;
}

function productOptions(line) {
  const known = line.product_id && S.products.some(p => p.id === line.product_id);
  const first = !known && line.title ? `${short(line.title)} ${line.variant || ''} (not in price list)` : 'Choose product…';
  const opt = p => `<option value="${p.id}" ${p.id === line.product_id ? 'selected' : ''}>${esc(short(p.title))}${p.variant ? ` — ${esc(p.variant)}` : ''} · Rs ${num(p.store_price)}</option>`;
  const sorted = [...S.products].sort((a, b) => (a.position || 0) - (b.position || 0));
  const drafts = sorted.filter(p => !p.active);
  return `<option value="">${esc(first)}</option>${sorted.filter(p => p.active).map(opt).join('')}`
    + (drafts.length ? `<optgroup label="Draft products">${drafts.map(opt).join('')}</optgroup>` : '');
}

function openOrder(id) {
  const existing = id ? S.orders.find(o => o.id === id) : null;
  const o = existing ? { ...existing } : {
    id: uid(), order_no: nextOrderNo(), date: K.today(), customer: '', city: '', status: 'pending', source: 'manual',
    shopify_id: null, delivery: null, other_cost: 0, cost_override: null, in_parc: true, note: '', created_at: new Date().toISOString(),
  };
  let lines = existing
    ? S.items.filter(i => i.order_id === o.id).sort((a, b) => (a.position || 0) - (b.position || 0)).map(l => ({ ...l }))
    : [blankLine()];
  if (!lines.length) lines.push(blankLine());

  const d = openDialog(`<form novalidate>
    <div class="dlg-head"><h2>${existing ? `Order ${esc(o.order_no)}` : 'New order'}</h2>
      <button type="button" class="icon-btn" data-dlg="close" aria-label="Close">${icon('x')}</button></div>
    <div class="dlg-body">
      <div class="form-grid">
        <label class="field">Order no.<input name="order_no" required value="${esc(o.order_no)}" autocomplete="off"></label>
        <label class="field">Date<input type="date" name="date" required value="${o.date}"></label>
        <label class="field">Customer<input name="customer" value="${esc(o.customer)}" autocomplete="off"></label>
        <label class="field">City<input name="city" value="${esc(o.city)}" autocomplete="off"></label>
        <label class="field">Status<select name="status">${K.STATUSES.map(s => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${K.STATUS_LABEL[s]}</option>`).join('')}</select></label>
        <label class="check full"><input type="checkbox" name="in_parc" ${o.in_parc ? 'checked' : ''}> Handed over to PARC (counts in the PARC khata)</label>
      </div>
      <h3 class="section">Products</h3>
      <div class="table-wrap" style="box-shadow:none;max-height:none">
        <table class="lines"><thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Sale price</th><th class="num">PARC price</th><th class="num">Amount</th><th><span class="sr-only">Remove</span></th></tr></thead>
        <tbody id="order-lines"></tbody></table>
      </div>
      <div class="toolbar">
        <button type="button" class="btn sm" data-dlg="add-line">${icon('plus')} Add product</button>
        <button type="button" class="btn sm" data-dlg="use-prices" title="Set every PARC price in this order from today's price list">Use current price list</button>
      </div>
      <h3 class="section">Costs</h3>
      <div class="form-grid">
        <div class="field"><label for="f-delivery">Delivery charge (Rs)</label>
          <input id="f-delivery" type="number" step="any" inputmode="decimal" name="delivery" value="${o.delivery ?? ''}" placeholder="Not entered yet">
          <div class="presets">${S.settings.delivery_presets.map(p => `<button type="button" class="btn sm" data-dlg="preset" data-amount="${p.amount}">${esc(p.label)} ${num(p.amount)}</button>`).join('')}</div></div>
        <label class="field">Other cost (Rs)<input type="number" step="any" inputmode="decimal" name="other_cost" value="${o.other_cost || ''}" placeholder="0"><small>Packing, return charges, etc.</small></label>
        <label class="field">PARC amount for this order (Rs)<input type="number" step="any" inputmode="decimal" name="cost_override" value="${o.cost_override ?? ''}" placeholder="Auto from the product prices"><small>Leave empty unless PARC billed a different amount.</small></label>
        <label class="field full">Note<textarea name="note">${esc(o.note)}</textarea></label>
      </div>
      <div class="sumline" id="order-sum" aria-live="polite"></div>
    </div>
    <div class="dlg-foot">${existing ? '<button type="button" class="btn danger" data-dlg="delete">Delete order</button>' : ''}<span class="spacer"></span>
      <button type="button" class="btn" data-dlg="close">Cancel</button><button type="submit" class="btn primary">Save order</button></div>
  </form>`, { wide: true });

  const form = d.querySelector('form');
  const tbody = d.querySelector('#order-lines');
  const cleanLines = () => lines.map(l => ({ ...l, qty: Number(l.qty) || 0, price: Number(l.price) || 0, parc_cost: Number(l.parc_cost) || 0 }));
  const drawSum = () => {
    const f = form.elements;
    const c = K.orderCalc({ status: f.status.value, delivery: numOrNull(f.delivery.value), other_cost: numOrNull(f.other_cost.value),
      cost_override: numOrNull(f.cost_override.value) }, cleanLines());
    d.querySelector('#order-sum').innerHTML = `<span>Sale <b>${rs(c.sale)}</b></span><span>PARC <b>${rs(c.goods)}</b></span>
      <span>Delivery <b>${c.deliveryMissing ? 'not entered' : rs(c.delivery)}</b></span><span>Other <b>${rs(c.other)}</b></span>
      <span>${c.profit < 0 ? 'Loss' : 'Profit'} <b class="${plClass(c.profit)}">${rs(c.profit)}</b></span>`;
    tbody.querySelectorAll('tr').forEach((tr, i) => { if (lines[i]) tr.querySelector('.amt').textContent = num((Number(lines[i].qty) || 0) * (Number(lines[i].price) || 0)); });
  };
  const drawLines = () => {
    tbody.innerHTML = lines.map((l, i) => `<tr data-i="${i}">
      <td><select data-lf="product_id" aria-label="Product ${i + 1}">${productOptions(l)}</select></td>
      <td class="num"><input class="qty" type="number" min="0" step="any" inputmode="decimal" data-lf="qty" value="${l.qty}" aria-label="Quantity"></td>
      <td class="num"><input type="number" step="any" inputmode="decimal" data-lf="price" value="${l.price}" aria-label="Sale price per item"></td>
      <td class="num"><input type="number" step="any" inputmode="decimal" data-lf="parc_cost" value="${l.parc_cost}" aria-label="PARC price per item"></td>
      <td class="num amt"></td>
      <td><button type="button" class="icon-btn" data-dlg="remove-line" data-i="${i}" aria-label="Remove product ${i + 1}">${icon('x')}</button></td></tr>`).join('');
    drawSum();
  };
  drawLines();
  (existing ? form.elements.status : tbody.querySelector('select')).focus();

  d.addEventListener('input', (e) => {
    const tr = e.target.closest('tr[data-i]');
    const lf = e.target.dataset.lf;
    if (tr && lf && lf !== 'product_id') lines[Number(tr.dataset.i)][lf] = e.target.value;
    drawSum();
  });
  d.addEventListener('change', (e) => {
    if (e.target.dataset.lf !== 'product_id') return;
    const i = Number(e.target.closest('tr').dataset.i);
    const p = S.products.find(x => x.id === e.target.value);
    if (!p) return;
    lines[i] = { ...lines[i], product_id: p.id, title: p.title, variant: p.variant, price: p.store_price, parc_cost: K.parcPrice(p, S.settings) ?? 0 };
    drawLines();
    tbody.querySelector(`tr[data-i="${i}"] input[data-lf="qty"]`)?.focus();
  });
  d.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dlg]');
    if (!b) return;
    switch (b.dataset.dlg) {
      case 'close': d.close(); break;
      case 'add-line': lines.push(blankLine()); drawLines(); tbody.querySelector('tr:last-child select')?.focus(); break;
      case 'remove-line': lines.splice(Number(b.dataset.i), 1); if (!lines.length) lines.push(blankLine()); drawLines(); break;
      case 'preset': form.elements.delivery.value = b.dataset.amount; drawSum(); break;
      case 'use-prices': {
        let changed = 0;
        lines = lines.map(l => {
          const v = K.parcPrice(S.products.find(p => p.id === l.product_id), S.settings);
          if (v == null || Number(l.parc_cost) === v) return l;
          changed++;
          return { ...l, parc_cost: v };
        });
        drawLines();
        toast(changed ? `${plural(changed, 'PARC price')} updated. Press Save order to keep them.` : 'PARC prices already match the price list');
        break;
      }
      case 'delete':
        if (deleteOrders([o.id])) d.close();
        break;
      default:
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = form.elements;
    const orderNo = f.order_no.value.trim();
    if (!orderNo || !f.date.value) { toast('Order no. and date are needed', 'error'); return; }
    const keep = cleanLines().filter(l => l.product_id || String(l.title).trim())
      .map((l, i) => ({ ...l, order_id: o.id, position: i }));
    if (!keep.length) { toast('Choose at least one product', 'error'); return; }
    if (S.orders.some(x => x.id !== o.id && x.order_no.toLowerCase() === orderNo.toLowerCase())
      && !confirm(`Another order is already numbered ${orderNo}. Save anyway?`)) return;
    const order = {
      ...o, order_no: orderNo, date: f.date.value, customer: f.customer.value.trim(), city: f.city.value.trim(), status: f.status.value,
      in_parc: f.in_parc.checked, delivery: numOrNull(f.delivery.value), other_cost: numOrNull(f.other_cost.value) ?? 0,
      cost_override: numOrNull(f.cost_override.value), note: f.note.value.trim(),
    };
    const removed = S.items.filter(i => i.order_id === o.id && !keep.some(k => k.id === i.id)).map(i => i.id);
    d.close();
    upsertLocal(S.orders, order);
    S.items = S.items.filter(i => !removed.includes(i.id));
    keep.forEach(k => upsertLocal(S.items, k));
    scheduleRender();
    persist(async () => {
      await S.db.put('orders', order);
      if (removed.length) await S.db.remove('items', removed);
      await S.db.put('items', keep);
    });
    toast(existing ? `Order ${orderNo} saved` : `Order ${orderNo} added`);
  });
}

/* ---------- settings, backup ---------- */

function openSettings() {
  const local = S.db.mode === 'local';
  const d = openDialog(`<form>
    <div class="dlg-head"><h2>Settings</h2><button type="button" class="icon-btn" data-dlg="close" aria-label="Close">${icon('x')}</button></div>
    <div class="dlg-body">
      <div class="form-grid">
        <label class="field">PARC discount on display price (%)<input type="number" step="any" min="0" max="100" name="parc_discount" value="${S.settings.parc_discount}"></label>
      </div>
      <h3 class="section">Delivery charge buttons</h3>
      <div class="form-grid">${S.settings.delivery_presets.map((p, i) => `
        <label class="field">Name<input name="pl${i}" value="${esc(p.label)}"></label>
        <label class="field">Rs<input type="number" step="any" name="pa${i}" value="${p.amount}"></label>`).join('')}</div>
      <h3 class="section">Data</h3>
      <p class="muted small" style="margin-top:0">${local
        ? 'Local mode: saved only in this browser. Download a backup regularly until the online database is connected.'
        : `Online: saved in your Supabase database. Signed in as ${esc(S.user?.email || '')}.`}</p>
      <div class="toolbar">
        <button type="button" class="btn sm" data-dlg="backup">${icon('download')} Download backup</button>
        <label class="btn sm" style="cursor:pointer">Restore backup<input type="file" accept=".json,application/json" hidden data-dlg-file></label>
        ${local ? '<button type="button" class="btn sm danger" data-dlg="wipe">Clear this browser’s khata</button>' : '<button type="button" class="btn sm" data-dlg="signout">Sign out</button>'}
      </div>
    </div>
    <div class="dlg-foot"><span class="spacer"></span><button type="button" class="btn" data-dlg="close">Cancel</button><button class="btn primary" type="submit">Save settings</button></div>
  </form>`);
  d.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-dlg]');
    if (!b) return;
    if (b.dataset.dlg === 'close') d.close();
    if (b.dataset.dlg === 'backup') downloadBackup();
    if (b.dataset.dlg === 'signout') { d.close(); await S.db.signOut(); }
    if (b.dataset.dlg === 'wipe' && confirm('Delete every order, payment and price saved in this browser? Download a backup first if you need it.')) {
      await S.db.wipe(); location.reload();
    }
  });
  d.querySelector('[data-dlg-file]').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'khalis-bazar-khata') throw new Error('This is not a khata backup file');
      const n = (data.orders || []).length;
      if (!confirm(`Restore ${plural(n, 'order')} and ${plural((data.payments || []).length, 'payment')} from ${file.name}? Rows with the same id are replaced.`)) return;
      d.close();
      await restoreBackup(data);
    } catch (err) { toast(`Restore failed: ${err.message}`, 'error', 8000); }
  });
  d.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target.elements;
    S.settings = {
      ...S.settings,
      parc_discount: Number(f.parc_discount.value) || 0,
      delivery_presets: S.settings.delivery_presets.map((p, i) => ({ label: f[`pl${i}`].value.trim() || p.label, amount: Number(f[`pa${i}`].value) || 0 })),
    };
    d.close();
    saveSettings();
    toast('Settings saved');
  });
}

function downloadBackup() {
  const data = { app: 'khalis-bazar-khata', version: 1, exported_at: new Date().toISOString(),
    products: S.products, orders: S.orders, items: S.items, payments: S.payments, settings: [{ id: 'main', data: S.settings }] };
  download(`khalis-bazar-khata-backup-${K.today()}.json`, JSON.stringify(data, null, 1), 'application/json');
}

async function restoreBackup(data) {
  for (const t of ['products', 'orders', 'items', 'payments']) for (const r of data[t] || []) upsertLocal(S[t], r);
  const main = (data.settings || []).find(s => s.id === 'main');
  if (main) S.settings = { ...structuredClone(DEFAULT_SETTINGS), ...main.data };
  render();
  await persist(async () => {
    for (const t of ['products', 'orders', 'items', 'payments']) if (data[t]?.length) await S.db.put(t, data[t]);
    if (main) await S.db.put('settings', { id: 'main', data: S.settings });
  });
  toast('Backup restored');
}

/* ---------- Shopify sync ---------- */

async function syncShopify(btn) {
  if (S.db.mode !== 'supabase') {
    toast('Sync Shopify starts working once the online database is connected (khata/README.md, steps 1–5). Until then add orders with New order.', 'warn', 8000);
    return;
  }
  btn.disabled = true;
  renderStatus('Syncing with Shopify…');
  try { await applyShopify(await S.db.invoke(CONFIG.syncFunction)); }
  catch (e) { toast(`Sync failed: ${e.message}`, 'error', 9000); }
  finally { btn.disabled = false; renderStatus(); }
}

async function applyShopify(payload) {
  const r = mergeShopify(S, payload, S.settings);
  for (const t of ['products', 'orders', 'items']) for (const row of r[t]) upsertLocal(S[t], row);
  render();
  await persist(async () => {
    if (r.products.length) await S.db.put('products', r.products);
    if (r.orders.length) await S.db.put('orders', r.orders);
    if (r.items.length) await S.db.put('items', r.items);
  });
  const parts = [plural(r.added, 'new order')];
  if (r.updated) parts.push(`${r.updated} status ${r.updated === 1 ? 'change' : 'changes'}`);
  if (r.productsAdded) parts.push(plural(r.productsAdded, 'new product'));
  if (r.pricesChanged) parts.push(plural(r.pricesChanged, 'price change'));
  toast(`Synced: ${parts.join(', ')}`);
  return r;
}

/* ---------- dialogs ---------- */

function openDialog(html, { wide } = {}) {
  document.querySelectorAll('dialog.dlg').forEach(x => x.close());
  const d = document.createElement('dialog');
  d.className = `dlg${wide ? ' wide' : ''}`;
  d.innerHTML = html;
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
  return d;
}

/* ---------- actions ---------- */

function handover(ids) {
  const rows = S.orders.filter(o => ids.includes(o.id)).map(o => ({ ...o, in_parc: true }));
  saveRows('orders', rows);
  toast(`${plural(rows.length, 'order')} added to the PARC khata`);
}

function fillMissingPrices() {
  const orders = new Map(S.orders.map(o => [o.id, o]));
  const changed = [];
  for (const it of S.items) {
    const o = orders.get(it.order_id);
    if (!o || o.cost_override != null || Number(it.parc_cost)) continue;
    const v = K.parcPrice(S.products.find(p => p.id === it.product_id), S.settings);
    if (v) changed.push({ ...it, parc_cost: v });
  }
  if (!changed.length) { toast('No price to fill: set the display price in the Price list first', 'warn'); return; }
  saveRows('items', changed);
  toast(`${plural(changed.length, 'product line')} filled from the price list`);
}

const ACTIONS = {
  tab: (el) => { S.ui.view = el.dataset.view; S.onlyMissing = false; S.selected.clear(); saveUi(); render(); window.scrollTo(0, 0); },
  'delete-selected': () => {
    const shown = new Set((S.tables.orders?.rows || []).map(c => c.order.id));
    deleteOrders([...S.selected].filter(id => shown.has(id)));
  },
  'restore-order': (el) => {
    const x = (S.settings.ignored_orders || []).find(o => o.id === el.dataset.id);
    S.settings = { ...S.settings, ignored_orders: (S.settings.ignored_orders || []).filter(o => o.id !== el.dataset.id) };
    saveSettings();
    toast(`${x?.order_no || 'The order'} will come back the next time you press Sync Shopify`);
  },
  sort: (el) => {
    const cur = S.ui.sort[el.dataset.table];
    const dir = cur?.key === el.dataset.key ? (cur.dir === 1 ? -1 : 0) : 1;
    if (dir) S.ui.sort[el.dataset.table] = { key: el.dataset.key, dir }; else delete S.ui.sort[el.dataset.table];
    saveUi(); render();
  },
  period: (el) => {
    S.ui[el.dataset.scope] = el.dataset.value;
    if (el.dataset.value === 'custom' && !S.ui.from) { S.ui.from = K.monthStart(K.today()); S.ui.to = K.today(); }
    saveUi(); render();
  },
  group: (el) => { S.ui.group = el.dataset.value; saveUi(); render(); },
  'pnl-status': (el) => { S.ui.pnlStatus = el.dataset.value; saveUi(); render(); },
  'orders-status': (el) => { S.ui.ordersStatus = el.dataset.value; saveUi(); render(); },
  'only-missing': (el) => { S.onlyMissing = el.dataset.value === '1'; if (S.onlyMissing) S.ui.group = 'order'; render(); },
  'new-order': () => openOrder(null),
  'edit-order': (el) => openOrder(el.dataset.id),
  'add-payment': () => openPayment(null),
  'edit-payment': (el) => openPayment(el.dataset.id),
  calculate: () => openCalculate(),
  print: () => window.print(),
  csv: (el) => exportCsv(el.dataset.table),
  sync: (el) => syncShopify(el),
  settings: () => openSettings(),
  'add-product': () => openProduct(),
  'delete-product': (el) => {
    const p = S.products.find(x => x.id === el.dataset.id);
    if (p && confirm(`Delete ${p.title} ${p.variant}? Old orders keep their saved prices.`)) removeRows('products', p.id);
  },
  handover: (el) => handover([el.dataset.id]),
  'handover-all': () => handover(S.orders.filter(o => !o.in_parc && ['pending', 'shipped', 'delivered'].includes(o.status)).map(o => o.id)),
  'fill-prices': () => fillMissingPrices(),
};

const CHANGES = {
  'order-field': (el) => {
    const o = S.orders.find(x => x.id === el.dataset.id);
    if (!o) return;
    const f = el.dataset.field;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (f === 'delivery' || f === 'cost_override') v = numOrNull(v);
    if (f === 'other_cost') v = numOrNull(v) ?? 0;
    saveRows('orders', { ...o, [f]: v });
  },
  'product-field': (el) => {
    const p = S.products.find(x => x.id === el.dataset.id);
    if (!p) return;
    const f = el.dataset.field;
    const v = numOrNull(el.value);
    saveRows('products', { ...p, [f]: f === 'store_price' ? v ?? 0 : v });
  },
  setting: (el) => { S.settings = { ...S.settings, [el.dataset.key]: Number(el.value) || 0 }; saveSettings(); },
  range: (el) => { S.ui[el.dataset.key] = el.value; saveUi(); scheduleRender(); },
  'show-drafts': (el) => { S.ui.showDrafts = el.checked; saveUi(); scheduleRender(); },
  'select-order': (el) => { if (el.checked) S.selected.add(el.dataset.id); else S.selected.delete(el.dataset.id); scheduleRender(); },
  'select-all': (el) => {
    for (const c of S.tables.orders?.rows || []) { if (el.checked) S.selected.add(c.order.id); else S.selected.delete(c.order.id); }
    scheduleRender();
  },
};

/* ---------- rendering ---------- */

const VIEW_FNS = { parc: viewParc, pnl: viewPnl, orders: viewOrders, prices: viewPrices };

// A timer (not requestAnimationFrame) so a Tab key has already moved focus before the re-render,
// and so background tabs still update.
let pendingRender = 0;
function scheduleRender() {
  if (!pendingRender) pendingRender = setTimeout(() => { pendingRender = 0; render(); }, 0);
}

function render() {
  const main = $('#main');
  if (!main) return;
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-current', t.dataset.view === S.ui.view ? 'page' : 'false'));
  // Keep focus, caret and table scroll across re-renders (inline edits re-render the page).
  const active = document.activeElement;
  const fk = active && main.contains(active) ? active.dataset.fk : null;
  let sel = null;
  try { sel = fk && active.selectionStart != null ? [active.selectionStart, active.selectionEnd] : null; } catch { sel = null; }
  const scrolls = [...main.querySelectorAll('.table-wrap')].map(w => [w.scrollTop, w.scrollLeft]);

  S.tables = {};
  main.innerHTML = (VIEW_FNS[S.ui.view] || viewParc)()
    + `<datalist id="dl-presets">${S.settings.delivery_presets.map(p => `<option value="${p.amount}">${esc(p.label)}</option>`).join('')}</datalist>`;

  main.querySelectorAll('.table-wrap').forEach((w, i) => { if (scrolls[i]) [w.scrollTop, w.scrollLeft] = scrolls[i]; });
  if (fk) {
    const el = main.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
    if (el) { el.focus({ preventScroll: true }); if (sel) try { el.setSelectionRange(...sel); } catch { /* number inputs */ } }
  }
  renderStatus();
}

function renderShell() {
  $('#app').innerHTML = `
  <header class="top">
    <div class="bar">
      <div class="brand"><img src="logo.png" alt="" width="34" height="38"><span><b>Khalis Bazar</b><i>Khata</i></span></div>
      <div class="search" role="search">${icon('search')}
        <input id="search" type="search" placeholder="Search orders, products, customers…" aria-label="Search (Ctrl+F)" autocomplete="off"><kbd>Ctrl F</kbd></div>
      <div class="top-actions">
        <span id="save-status" class="save-status" role="status"></span>
        <button class="btn" data-action="sync" title="Bring new orders and prices from Shopify">${icon('sync')}<span class="txt">Sync Shopify</span></button>
        <button class="btn primary" data-action="new-order" aria-label="New order">${icon('plus')}<span class="txt">New order</span></button>
        <button class="icon-btn" data-action="settings" aria-label="Settings">${icon('gear')}</button>
      </div>
    </div>
    <nav class="tabs" aria-label="Khata sections">${VIEWS.map(([v, l]) => `<button class="tab" data-action="tab" data-view="${v}">${l}</button>`).join('')}</nav>
  </header>
  ${S.db.mode === 'local' ? `<div class="banner"><div><b>Local mode:</b> everything is saved only in this browser on this computer.
    Connect the free online database (khata/README.md) before real use, and keep a backup (Settings → Download backup).</div></div>` : ''}
  <main id="main"></main>`;
  $('#search').addEventListener('input', (e) => { S.search = e.target.value; scheduleRender(); });
}

/* ---------- login & start ---------- */

function showLogin(msg) {
  if (msg !== undefined) S.loginMsg = msg;
  let signup = false;
  $('#app').innerHTML = `<div class="login"><form class="card" novalidate>
    <img src="logo.png" alt="">
    <h1>Khalis Bazar Khata</h1>
    <p id="login-lead">Sign in to open the PARC khata and profit &amp; loss.</p>
    <label class="field">Email<input type="email" name="email" required autocomplete="username"></label>
    <label class="field">Password<input type="password" name="password" required minlength="8" autocomplete="current-password"></label>
    <button class="btn primary" type="submit" style="justify-content:center">Sign in</button>
    <button class="link small" type="button" id="toggle-signup" style="text-align:center">First time? Create the owner login</button>
    <p class="msg ${S.loginMsg ? 'err' : ''}" role="status">${esc(S.loginMsg)}</p>
  </form></div>`;
  const form = $('.login form');
  const msgEl = $('.msg', form);
  const say = (text, err) => { msgEl.textContent = text; msgEl.classList.toggle('err', !!err); };
  $('#toggle-signup').addEventListener('click', () => {
    signup = !signup;
    form.querySelector('[type=submit]').textContent = signup ? 'Create login' : 'Sign in';
    $('#toggle-signup').textContent = signup ? 'I already have a login' : 'First time? Create the owner login';
    $('#login-lead').textContent = signup ? 'Use the email you put in schema.sql (README step 2). Password: 8+ characters.' : 'Sign in to open the PARC khata and profit & loss.';
    form.password.autocomplete = signup ? 'new-password' : 'current-password';
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    const password = form.password.value;
    if (!email || password.length < 8) { say('Enter your email and a password of at least 8 characters.', true); return; }
    say(signup ? 'Creating login…' : 'Signing in…');
    try {
      if (signup) {
        const r = await S.db.signUp(email, password);
        if (!r.session) { say('Login created. Open the confirmation email from Supabase, then sign in here.'); return; }
        S.user = r.user;
      } else {
        S.user = await S.db.signIn(email, password);
      }
      S.loginMsg = '';
      await startApp();
    } catch (err) {
      say(/fetch|network/i.test(err.message)
        ? 'Could not reach the online database. Check the internet, or the address in js/config.js.'
        : err.message, true);
    }
  });
  form.email.focus();
}

async function loadData() {
  const d = await S.db.load();
  S.products = d.products;
  S.orders = d.orders;
  S.items = d.items;
  S.payments = d.payments;
  const main = d.settings.find(s => s.id === 'main');
  S.settings = { ...structuredClone(DEFAULT_SETTINGS), ...(main?.data || {}) };
  if (!S.products.length) {
    S.products = SEED_PRODUCTS.map(p => ({ ...p }));
    await S.db.put('products', S.products);
  }
}

async function startApp() {
  $('#app').innerHTML = '<p class="boot">Loading khata…</p>';
  try {
    if (S.db.mode === 'supabase' && !(await S.db.isAllowed())) {
      const email = S.user?.email;
      S.loginMsg = `${email} is not allowed yet. Add it to the khata_users table (README step 2), then sign in again.`;
      await S.db.signOut();
      showLogin();
      return;
    }
    await loadData();
  } catch (e) {
    $('#app').innerHTML = `<div class="boot"><p>Could not load the khata: ${esc(e.message)}</p><button class="btn" onclick="location.reload()">Try again</button></div>`;
    return;
  }
  renderShell();
  render();
}

async function boot() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (el && ACTIONS[el.dataset.action]) ACTIONS[el.dataset.action](el, e);
  });
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-change]');
    if (el && CHANGES[el.dataset.change]) CHANGES[el.dataset.change](el, e);
  });
  // Ctrl+F jumps to the khata search; pressing it again inside the box opens the browser's own find.
  document.addEventListener('keydown', (e) => {
    const box = $('#search');
    if (!box || document.querySelector('dialog[open]')) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f' && document.activeElement !== box) {
      e.preventDefault();
      box.focus();
      box.select();
    } else if (e.key === 'Escape' && document.activeElement === box && box.value) {
      box.value = '';
      S.search = '';
      render();
    }
  });

  try { S.db = await createDb(CONFIG); }
  catch (e) {
    $('#app').innerHTML = `<p class="boot">Could not reach the online database: ${esc(e.message)}. Check the internet connection and reload.</p>`;
    return;
  }
  if (S.db.mode === 'supabase') {
    S.db.onAuthChange((event) => { if (event === 'SIGNED_OUT') { S.user = null; showLogin(); } });
    S.user = await S.db.getUser();
    if (!S.user) { showLogin(); return; }
  }
  await startApp();
}

// Lets the Shopify import be tested in local mode from the browser console with a saved function reply.
window.khataImportShopify = applyShopify;

boot();
