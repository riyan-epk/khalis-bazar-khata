// Turns the "shopify-sync" function's reply into khata rows. Pure: returns the rows to save.
// New orders are added; existing orders only move forward in status (never overwriting
// delivery charges, costs, notes or a status you set by hand, except Shopify cancellations).
// Orders listed in settings.ignored_orders (deleted in the khata) are skipped.
import { parcPrice, round2 } from './calc.js';

const RANK = { pending: 0, shipped: 1, delivered: 2 };

export function statusFromShopify(o) {
  if (o.cancelled_at) return 'cancelled';
  if (o.financial_status === 'refunded') return 'returned';
  if (o.financial_status === 'paid' || o.financial_status === 'partially_refunded') return 'delivered';
  if (o.fulfillment_status === 'fulfilled' || o.fulfillment_status === 'partial') return 'shipped';
  return 'pending';
}

export function mergeShopify(state, payload, settings) {
  const now = new Date().toISOString();
  const products = new Map(state.products.map(p => [p.id, p]));
  const out = { products: [], orders: [], items: [], added: 0, updated: 0, productsAdded: 0, pricesChanged: 0 };

  let position = state.products.reduce((m, p) => Math.max(m, p.position || 0), 0);
  for (const v of payload.products || []) {
    const id = `sv_${v.id}`;
    const cur = products.get(id);
    if (!cur) {
      const row = { id, handle: v.handle, title: v.title, variant: v.variant || '', store_price: Number(v.price),
        display_price: null, active: v.active, position: ++position };
      products.set(id, row);
      out.products.push(row);
      out.productsAdded++;
      continue;
    }
    const next = { ...cur, title: v.title, handle: v.handle, store_price: Number(v.price), active: v.active };
    if (v.variant) next.variant = v.variant; // single-size products keep the size label from the seed
    if (next.store_price !== cur.store_price) out.pricesChanged++;
    if (['title', 'handle', 'store_price', 'active', 'variant'].some(k => next[k] !== cur[k])) {
      products.set(id, next);
      out.products.push(next);
    }
  }

  const existing = new Map(state.orders.map(o => [o.id, o]));
  const deleted = new Set((settings?.ignored_orders || []).map(x => x.id));
  for (const o of payload.orders || []) {
    const id = `so_${o.id}`;
    if (deleted.has(id)) continue; // deleted in the khata on purpose: never re-import
    const status = statusFromShopify(o);
    const cur = existing.get(id);
    if (cur) {
      let next = cur.status;
      if (status === 'cancelled' && cur.status !== 'cancelled') next = 'cancelled';
      else if (status === 'returned' && cur.status !== 'returned' && cur.status !== 'cancelled') next = 'returned';
      else if (cur.status in RANK && status in RANK && RANK[status] > RANK[cur.status]) next = status;
      if (next !== cur.status) {
        out.orders.push({ ...cur, status: next, in_parc: next === 'cancelled' ? false : cur.in_parc });
        out.updated++;
      }
      continue;
    }

    const anyQty = o.items.some(li => Number(li.current_quantity) > 0);
    const lines = o.items
      .map(li => ({ ...li, qty: anyQty ? Number(li.current_quantity) : Number(li.quantity) }))
      .filter(li => li.qty > 0);
    out.orders.push({
      id, order_no: o.name, date: o.created_at.slice(0, 10), customer: o.customer || '', city: o.city || '',
      status, source: 'shopify', shopify_id: o.id, delivery: null, other_cost: 0, cost_override: null,
      in_parc: status !== 'cancelled', note: '', created_at: o.created_at || now,
    });
    lines.forEach((li, i) => {
      const p = li.variant_id ? products.get(`sv_${li.variant_id}`) : null;
      out.items.push({
        id: `sl_${li.id}`, order_id: id, product_id: p?.id || null,
        title: p?.title || li.title, variant: p?.variant || li.variant_title || '',
        qty: li.qty, price: round2(Number(li.price) - Number(li.discount || 0) / li.qty),
        parc_cost: parcPrice(p, settings) ?? 0, position: i,
      });
    });
    out.added++;
  }
  return out;
}
