// Pure khata calculations: no DOM, no storage. Dates are 'YYYY-MM-DD' strings in Pakistan time.

export const STATUSES = ['pending', 'shipped', 'delivered', 'returned', 'cancelled'];
export const STATUS_LABEL = {
  pending: 'Pending', shipped: 'Shipped', delivered: 'Delivered', returned: 'Returned', cancelled: 'Cancelled',
};

export const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const sum = (list, f) => round2(list.reduce((s, x) => s + (Number(f(x)) || 0), 0));

/* ---------- dates ---------- */

export function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
}
const toDate = (s) => new Date(`${s}T00:00:00Z`);
const toStr = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return toStr(d); };
export const weekStart = (s) => addDays(s, -((toDate(s).getUTCDay() + 6) % 7)); // Monday
export const monthStart = (s) => `${s.slice(0, 7)}-01`;
export const monthEnd = (s) => { const d = toDate(monthStart(s)); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return toStr(d); };

export function fmtDate(s, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!s) return '';
  return toDate(s).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });
}

export const PERIODS = [
  ['all', 'All time'], ['this-week', 'This week'], ['this-month', 'This month'],
  ['last-month', 'Last month'], ['this-year', 'This year'], ['custom', 'Custom'],
];

export function periodRange(preset, custom = {}, now = today()) {
  switch (preset) {
    case 'this-week': return { from: weekStart(now), to: addDays(weekStart(now), 6) };
    case 'this-month': return { from: monthStart(now), to: monthEnd(now) };
    case 'last-month': { const prev = addDays(monthStart(now), -1); return { from: monthStart(prev), to: monthEnd(prev) }; }
    case 'this-year': return { from: `${now.slice(0, 4)}-01-01`, to: `${now.slice(0, 4)}-12-31` };
    case 'custom': return { from: custom.from || '', to: custom.to || '' };
    default: return { from: '', to: '' };
  }
}
export const inRange = (date, { from, to }) => (!from || date >= from) && (!to || date <= to);

/* ---------- prices ---------- */

// What Khalis Bazar pays PARC for one unit: display price minus the PARC discount (5% by default).
export function parcPrice(product, settings) {
  const d = num(product?.display_price);
  if (d == null) return null;
  return round2(d * (1 - (Number(settings?.parc_discount) || 0) / 100));
}

/* ---------- orders ---------- */

export function itemsByOrder(items) {
  const map = new Map();
  for (const it of items) {
    if (!map.has(it.order_id)) map.set(it.order_id, []);
    map.get(it.order_id).push(it);
  }
  for (const list of map.values()) list.sort((a, b) => (a.position || 0) - (b.position || 0));
  return map;
}

// One order's money. Rules:
//  - cancelled: nothing counts anywhere
//  - returned:  no sale and no PARC cost (goods go back); delivery/other costs still count as loss
//  - cost_override (optional) replaces the price-list PARC amount for that order
export function orderCalc(order, lines = []) {
  const qty = sum(lines, l => l.qty);
  const saleGross = sum(lines, l => l.qty * l.price);
  const goodsAuto = sum(lines, l => l.qty * l.parc_cost);
  const override = num(order.cost_override);
  const parcAmount = override ?? goodsAuto;
  const returned = order.status === 'returned';
  const cancelled = order.status === 'cancelled';
  const sale = returned || cancelled ? 0 : saleGross;
  const goods = returned || cancelled ? 0 : parcAmount;
  const delivery = cancelled ? 0 : num(order.delivery) ?? 0;
  const other = cancelled ? 0 : num(order.other_cost) ?? 0;
  const profit = round2(sale - goods - delivery - other);
  return {
    order, lines, qty, saleGross, sale, goodsAuto, parcAmount, goods, delivery, other, profit,
    margin: sale ? profit / sale : null,
    deliveryMissing: !cancelled && num(order.delivery) == null,
    costMissing: override == null && lines.some(l => !Number(l.parc_cost)),
    inKhata: !!order.in_parc && !returned && !cancelled,
  };
}

export function allOrderCalcs(state) {
  const byOrder = itemsByOrder(state.items);
  return state.orders.map(o => orderCalc(o, byOrder.get(o.id) || []));
}

/* ---------- PARC khata ---------- */

export function balanceState(balance) {
  if (Math.abs(balance) < 0.5) return 'nil';
  return balance > 0 ? 'due' : 'advance';
}

// Chronological khata: orders handed to PARC are debits (you owe), payments are credits.
export function parcLedger(state, range = {}) {
  const entries = [];
  for (const c of allOrderCalcs(state)) {
    if (!c.inKhata) continue;
    const o = c.order;
    entries.push({ kind: 'order', id: o.id, date: o.date, debit: c.parcAmount, credit: 0, calc: c,
      sortKey: `${o.date}|0|${o.created_at || ''}|${o.order_no}` });
  }
  for (const p of state.payments) {
    entries.push({ kind: 'payment', id: p.id, date: p.date, debit: 0, credit: round2(p.amount), payment: p,
      sortKey: `${p.date}|1|${p.created_at || ''}` });
  }
  entries.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));

  let balance = 0;
  let opening = 0;
  const rows = [];
  for (const e of entries) {
    balance = round2(balance + e.debit - e.credit);
    e.balance = balance;
    if (range.from && e.date < range.from) { opening = balance; continue; }
    if (range.to && e.date > range.to) continue;
    rows.push(e);
  }
  const handed = sum(rows, r => r.debit);
  const paid = sum(rows, r => r.credit);
  return {
    rows, opening, handed, paid,
    closing: round2(opening + handed - paid),
    orderCount: rows.filter(r => r.kind === 'order').length,
  };
}

// The part of an all-time ledger after the balance last touched NIL: the orders still being paid off.
export function openSinceNil(ledger) {
  let start = 0;
  let clearedOn = null;
  ledger.rows.forEach((r, i) => {
    if (balanceState(r.balance) === 'nil') { start = i + 1; clearedOn = r.date; }
  });
  const rows = ledger.rows.slice(start);
  return {
    rows, clearedOn,
    orderCount: rows.filter(r => r.kind === 'order').length,
    handed: sum(rows, r => r.debit),
    paid: sum(rows, r => r.credit),
  };
}

// Product-wise quantities handed to PARC (for checking against PARC's own bill).
export function khataProducts(ledgerRows) {
  const map = new Map();
  let adjustments = 0;
  for (const r of ledgerRows) {
    if (r.kind !== 'order') continue;
    adjustments += r.calc.parcAmount - r.calc.goodsAuto;
    for (const l of r.calc.lines) {
      const key = l.product_id || `${l.title}|${l.variant}`;
      const row = map.get(key) || { key, title: l.title, variant: l.variant, qty: 0, amount: 0, unit: l.parc_cost };
      row.qty = round2(row.qty + Number(l.qty));
      row.amount = round2(row.amount + l.qty * l.parc_cost);
      row.unit = l.parc_cost;
      map.set(key, row);
    }
  }
  const rows = [...map.values()].sort((a, b) => a.title.localeCompare(b.title) || a.variant.localeCompare(b.variant));
  return { rows, adjustments: round2(adjustments) };
}

/* ---------- profit & loss ---------- */

export const PNL_STATUS = [
  ['all', 'All orders'], ['delivered', 'Delivered'], ['transit', 'Pending & shipped'], ['returned', 'Returned'],
];

export function pnlOrders(state, range, status = 'all', onlyMissingDelivery = false) {
  return allOrderCalcs(state).filter(c => {
    const s = c.order.status;
    if (s === 'cancelled' || !inRange(c.order.date, range)) return false;
    if (status === 'delivered' && s !== 'delivered') return false;
    if (status === 'transit' && s !== 'pending' && s !== 'shipped') return false;
    if (status === 'returned' && s !== 'returned') return false;
    if (onlyMissingDelivery && !c.deliveryMissing) return false;
    return true;
  });
}

export function totals(list) {
  const t = {
    orders: list.reduce((s, x) => s + (x.orders ?? 1), 0),
    qty: sum(list, x => x.qty),
    sale: sum(list, x => x.sale),
    goods: sum(list, x => x.goods),
    delivery: sum(list, x => x.delivery),
    other: sum(list, x => x.other),
    profit: sum(list, x => x.profit),
  };
  t.margin = t.sale ? t.profit / t.sale : null;
  return t;
}

export const GROUPS = [['order', 'By order'], ['product', 'By product'], ['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly']];

function periodKey(date, mode) {
  if (mode === 'day') return { key: date, label: fmtDate(date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) };
  if (mode === 'week') {
    const s = weekStart(date);
    return { key: s, label: `${fmtDate(s, { day: 'numeric', month: 'short' })} – ${fmtDate(addDays(s, 6))}` };
  }
  return { key: date.slice(0, 7), label: fmtDate(monthStart(date), { month: 'long', year: 'numeric' }) };
}

export function groupByPeriod(calcs, mode) {
  const map = new Map();
  for (const c of calcs) {
    const { key, label } = periodKey(c.order.date, mode);
    const g = map.get(key) || { key, label, list: [] };
    g.list.push(c);
    map.set(key, g);
  }
  return [...map.values()]
    .map(g => ({ key: g.key, label: g.label, ...totals(g.list) }))
    .sort((a, b) => (a.key < b.key ? 1 : -1));
}

// Product view: each order's delivery + other costs are shared across its products by sale value.
export function groupByProduct(calcs) {
  const map = new Map();
  for (const c of calcs) {
    const returned = c.order.status === 'returned';
    const costs = c.delivery + c.other;
    const n = c.lines.length || 1;
    for (const l of c.lines) {
      const lineSale = l.qty * l.price;
      const lineAuto = l.qty * l.parc_cost;
      const share = c.saleGross ? lineSale / c.saleGross : 1 / n;
      const goods = c.goods ? (c.goodsAuto ? c.goods * (lineAuto / c.goodsAuto) : c.goods / n) : 0;
      const key = l.product_id || `${l.title}|${l.variant}`;
      const g = map.get(key) || { key, title: l.title, variant: l.variant, qty: 0, returnedQty: 0, sale: 0, goods: 0, delivery: 0, other: 0, orderIds: new Set() };
      if (returned) g.returnedQty += Number(l.qty);
      else g.qty += Number(l.qty);
      g.sale += returned ? 0 : lineSale;
      g.goods += goods;
      g.delivery += c.delivery * share;
      g.other += c.other * share;
      g.orderIds.add(c.order.id);
      map.set(key, g);
    }
  }
  return [...map.values()].map(g => {
    const row = {
      key: g.key, title: g.title, variant: g.variant, orders: g.orderIds.size,
      qty: round2(g.qty), returnedQty: round2(g.returnedQty), sale: round2(g.sale), goods: round2(g.goods),
      delivery: round2(g.delivery), other: round2(g.other),
    };
    row.profit = round2(row.sale - row.goods - row.delivery - row.other);
    row.margin = row.sale ? row.profit / row.sale : null;
    return row;
  }).sort((a, b) => b.profit - a.profit);
}
