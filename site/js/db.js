// Storage for the khata. Two backends with the same interface:
//  - local:    this browser's localStorage (used until Supabase is configured in config.js)
//  - supabase: the free online Postgres database, protected by login + row-level security
// Interface: load() → {products, orders, items, payments, settings}; put(table, rows); remove(table, ids)

const TABLES = {
  products: 'khata_products',
  orders: 'khata_orders',
  items: 'khata_items',
  payments: 'khata_payments',
  settings: 'khata_settings',
};

// Only these columns are ever written, so UI-only fields never reach the database.
const COLUMNS = {
  products: ['id', 'handle', 'title', 'variant', 'store_price', 'display_price', 'active', 'position', 'updated_at'],
  orders: ['id', 'order_no', 'date', 'customer', 'city', 'status', 'source', 'shopify_id', 'delivery', 'other_cost',
    'cost_override', 'in_parc', 'note', 'created_at', 'updated_at'],
  items: ['id', 'order_id', 'product_id', 'title', 'variant', 'qty', 'price', 'parc_cost', 'position'],
  payments: ['id', 'date', 'amount', 'method', 'note', 'created_at', 'updated_at'],
  settings: ['id', 'data', 'updated_at'],
};
const NUMERIC = new Set(['store_price', 'display_price', 'delivery', 'other_cost', 'cost_override', 'qty', 'price', 'parc_cost', 'amount']);

export function clean(table, row) {
  const out = {};
  for (const c of COLUMNS[table]) if (row[c] !== undefined) out[c] = row[c];
  if (COLUMNS[table].includes('updated_at')) out.updated_at = new Date().toISOString();
  return out;
}

// Postgres numeric can arrive as a string; the app always works with numbers (or null).
function normalize(table, row) {
  const out = { ...row };
  for (const k of Object.keys(out)) {
    if (NUMERIC.has(k) && out[k] !== null && out[k] !== undefined) out[k] = Number(out[k]);
  }
  if (table === 'orders' && out.shopify_id != null) out.shopify_id = Number(out.shopify_id);
  return out;
}

const empty = () => ({ products: [], orders: [], items: [], payments: [], settings: [] });

export async function createDb(config) {
  if (config.supabaseUrl && config.supabaseKey) return supabaseDb(config);
  return localDb();
}

function localDb() {
  const KEY = 'kb-khata-v1';
  let data = empty();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) data = { ...data, ...saved };
  } catch { /* storage blocked or corrupt: start empty */ }

  const persist = () => {
    try { localStorage.setItem(KEY, JSON.stringify(data)); }
    catch { throw new Error('This browser blocked saving (private window or storage full). Download a backup from Settings.'); }
  };

  return {
    mode: 'local',
    async load() {
      const out = {};
      for (const t of Object.keys(TABLES)) out[t] = (data[t] || []).map(r => normalize(t, r));
      return out;
    },
    async put(table, rows) {
      for (const r of [].concat(rows)) {
        const row = clean(table, r);
        const i = data[table].findIndex(x => x.id === row.id);
        if (i >= 0) data[table][i] = { ...data[table][i], ...row };
        else data[table].push(row);
      }
      persist();
    },
    async remove(table, ids) {
      const set = new Set([].concat(ids));
      data[table] = data[table].filter(r => !set.has(r.id));
      if (table === 'orders') data.items = data.items.filter(i => !set.has(i.order_id)); // same as ON DELETE CASCADE
      persist();
    },
    async wipe() { data = empty(); persist(); },
  };
}

async function supabaseDb(config) {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm');
  const sb = createClient(config.supabaseUrl, config.supabaseKey);

  const fail = (error) => { throw new Error(error.message || String(error)); };

  async function fetchAll(table) {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(TABLES[table]).select('*').order('id').range(from, from + 999);
      if (error) fail(error);
      rows.push(...data);
      if (data.length < 1000) break;
    }
    return rows.map(r => normalize(table, r));
  }

  return {
    mode: 'supabase',
    async getUser() {
      const { data } = await sb.auth.getSession();
      return data.session?.user || null;
    },
    onAuthChange(cb) { sb.auth.onAuthStateChange((event, session) => cb(event, session?.user || null)); },
    async signIn(email, password) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) fail(error);
      return data.user;
    },
    async signUp(email, password) {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) fail(error);
      return data; // data.session is null when Supabase asks for email confirmation first
    },
    async signOut() { await sb.auth.signOut(); },
    async isAllowed() {
      const { data, error } = await sb.rpc('is_khata_user');
      if (error) fail(error);
      return data === true;
    },
    async load() {
      const out = {};
      for (const t of Object.keys(TABLES)) out[t] = await fetchAll(t);
      return out;
    },
    async put(table, rows) {
      const list = [].concat(rows).map(r => clean(table, r));
      for (let i = 0; i < list.length; i += 500) {
        const { error } = await sb.from(TABLES[table]).upsert(list.slice(i, i + 500), { onConflict: 'id' });
        if (error) fail(error);
      }
    },
    async remove(table, ids) {
      const list = [].concat(ids);
      for (let i = 0; i < list.length; i += 200) {
        const { error } = await sb.from(TABLES[table]).delete().in('id', list.slice(i, i + 200));
        if (error) fail(error);
      }
    },
    async invoke(name) {
      const { data, error } = await sb.functions.invoke(name, { body: {} });
      if (error) {
        let msg = error.message;
        try { msg = (await error.context.json()).error || msg; } catch { /* not a JSON error body */ }
        throw new Error(msg);
      }
      return data;
    },
  };
}
