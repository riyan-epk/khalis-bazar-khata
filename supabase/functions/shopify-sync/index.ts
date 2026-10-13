// @ts-nocheck: plain JavaScript; Deno runs it without type checks.
// Supabase Edge Function "shopify-sync" for the Khalis Bazar khata.
// Reads orders + products from Shopify with the Admin API token kept in Supabase secrets,
// so the token never reaches the browser. Only logged-in khata users (khata_users table) may call it.
// Secrets to add in Supabase → Edge Functions → Secrets:
//   SHOPIFY_STORE = j2mjsd-w2.myshopify.com
//   SHOPIFY_TOKEN = Admin API access token (needs read_orders + read_products)
import { createClient } from 'npm:@supabase/supabase-js@2';

const API_VERSION = '2026-07';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function shopifyAll(store, token, path, key) {
  let url = `https://${store}/admin/api/${API_VERSION}/${path}`;
  const out = [];
  while (url) {
    const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': token } });
    if (!res.ok) throw new Error(`Shopify ${res.status}: ${(await res.text()).slice(0, 200)}`);
    out.push(...(await res.json())[key]);
    const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') || '');
    url = next ? next[1] : null;
  }
  return out;
}

// Only the fields the khata needs: no phone numbers, emails or street addresses.
async function loadShopify(store, token) {
  const fields = 'id,name,created_at,cancelled_at,financial_status,fulfillment_status,test,line_items,shipping_address,billing_address,customer';
  const [orders, products] = await Promise.all([
    shopifyAll(store, token, `orders.json?status=any&limit=250&fields=${fields}`, 'orders'),
    shopifyAll(store, token, 'products.json?limit=250&fields=id,title,handle,status,variants', 'products'),
  ]);
  return {
    orders: orders.filter(o => !o.test).map(o => {
      const addr = o.shipping_address || o.billing_address || {};
      const person = [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(' ');
      return {
        id: o.id,
        name: o.name,
        created_at: o.created_at,
        cancelled_at: o.cancelled_at,
        financial_status: o.financial_status,
        fulfillment_status: o.fulfillment_status,
        customer: addr.name || person || '',
        city: addr.city || '',
        items: (o.line_items || []).map(li => ({
          id: li.id,
          variant_id: li.variant_id,
          title: li.title,
          variant_title: li.variant_title,
          quantity: li.quantity,
          current_quantity: li.current_quantity,
          price: li.price,
          discount: (li.discount_allocations || []).reduce((s, d) => s + Number(d.amount || 0), 0),
        })),
      };
    }),
    products: products.flatMap(p => p.variants.map(v => ({
      id: v.id,
      handle: p.handle,
      title: p.title,
      variant: v.title === 'Default Title' ? '' : v.title,
      price: v.price,
      active: p.status === 'active',
    }))),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const apiKey = Deno.env.get('SUPABASE_ANON_KEY') || req.headers.get('apikey') || '';
    const sb = createClient(Deno.env.get('SUPABASE_URL'), apiKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await sb.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
    if (!user) return json({ error: 'Please sign in to the khata first.' }, 401);
    const { data: allowed, error } = await sb.rpc('is_khata_user');
    if (error || allowed !== true) return json({ error: 'This login is not in khata_users.' }, 403);

    const store = Deno.env.get('SHOPIFY_STORE');
    const token = Deno.env.get('SHOPIFY_TOKEN');
    if (!store || !token) return json({ error: 'Add SHOPIFY_STORE and SHOPIFY_TOKEN in Edge Function secrets.' }, 500);
    return json(await loadShopify(store, token));
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});
