# Khalis Bazar Khata

Two khatas in one small web app:

- **PARC Display Khata**: every order you hand over to PARC, priced at the PARC price
  (display price − 5%), and every payment you make to PARC. Press **Calculate** to see the
  total, enter the amount you paid, and the khata shows the remaining (baqi) or **NIL**.
- **Profit & Loss**: every order with its sale, PARC cost, delivery charge and other costs.
  View it by order, by product, daily, weekly or monthly, for any period.

Also: **Orders** (Shopify orders come in with **Sync Shopify**; WhatsApp or phone orders are added with **New order**),
**Price list** (every Khalis Bazar product with the PARC display price you set),
**Ctrl + F** jumps to the search box, CSV export, print, and backup/restore.

## What it costs: Rs 0

| Job | Free service | Free limit (2026) |
|---|---|---|
| Website at `khata.kkhalisbazarpk.com` | **Cloudflare Pages** | unlimited visits, free SSL |
| Database + login + Shopify sync | **Supabase** (free plan) | 500 MB database (tens of thousands of orders), 500,000 sync calls a month |
| Subdomain | your **Namecheap** domain | one CNAME record |

Two things to know about the Supabase free plan:

1. **It pauses after 7 days with nobody using it.** Your data is kept. If it pauses, log in at
   supabase.com and press **Restore project**. Opening the khata at least once a week avoids it.
2. **There are no automatic backups.** In the khata, use **Settings → Download backup** once a month.

## Try it on this computer first

From the `shopify` folder:

```bash
python -m http.server 5173 --directory khata/site
```

Open http://localhost:5173. Until Supabase is connected it runs in **local mode**: everything
is saved only in that browser, and Sync Shopify is off.

## Put it online (about 30 minutes, once)

### 1. Create the Supabase project
1. Go to https://supabase.com and sign up (free).
2. **New project** → name `khalis-bazar-khata` → choose a strong database password and keep it safe →
   region **South Asia (Mumbai)** → **Create**.

### 2. Create the tables
1. In the project: **SQL Editor → New query**.
2. Open `khata/supabase/schema.sql` from this folder, copy all of it, and paste it in.
3. On the last line, replace `YOUR-EMAIL@gmail.com` with the email you will log in with.
4. Press **Run**. It should say *Success*.

Only emails in the `khata_users` table can open the khata. To give a partner access, run
`insert into khata_users (email) values ('their@email.com');` in the SQL Editor.

### 3. Login settings
1. **Authentication → URL Configuration**: Site URL = `https://khata.kkhalisbazarpk.com`.
2. **Authentication → Sign In / Providers → Email**: keep it on. If you don't want the confirmation
   email step, turn off **Confirm email**.
3. After step 8 (your first login), turn **off "Allow new users to sign up"** in the same place.

### 4. Shopify sync function
1. **Edge Functions → Deploy a new function → Via Editor**.
2. Name it exactly `shopify-sync`.
3. Replace the example code with everything in `khata/supabase/functions/shopify-sync/index.ts` → **Deploy**.
4. **Edge Functions → Secrets** → add:
   - `SHOPIFY_STORE` = `j2mjsd-w2.myshopify.com`
   - `SHOPIFY_TOKEN` = the `SHOPIFY_TOKEN` value from `reference/.env`

The token stays inside Supabase and never reaches the browser, and the function only reads
orders and products. The function also refuses anyone who is not signed in and listed in `khata_users`.
(That token can also edit the store, so never paste it anywhere else.)

### 5. Connect the app to Supabase
1. **Project Settings → API Keys**: copy the **Project URL** and the **publishable** key
   (or the legacy **anon** key).
2. Paste them into `khata/site/js/config.js`:
   ```js
   supabaseUrl: 'https://xxxxxxxx.supabase.co',
   supabaseKey: 'sb_publishable_…',
   ```
   This key is meant to be public. The data is protected by the login + the rules from step 2.

### 6. Publish on Cloudflare Pages
1. Sign up at https://dash.cloudflare.com (free).
2. **Workers & Pages → Create → Pages → Upload assets**.
3. Project name `khalis-khata` → upload the **`khata/site`** folder (only that folder) → **Deploy**.
4. It opens at `https://khalis-khata.pages.dev`. Check that you see the sign-in page.

To update the app later: same project → **Create new deployment** → upload `khata/site` again.

### 7. The subdomain khata.kkhalisbazarpk.com
1. In the Cloudflare Pages project: **Custom domains → Set up a custom domain** →
   `khata.kkhalisbazarpk.com` → it shows a CNAME target like `khalis-khata.pages.dev`.
2. Namecheap → **Domain List → kkhalisbazarpk.com → Manage → Advanced DNS → Add New Record**:
   - Type **CNAME Record**, Host **`khata`**, Value **`khalis-khata.pages.dev`**, TTL Automatic → ✓ save.
3. Don't change the existing records (the Shopify store and the email records need them).
4. After 5–30 minutes Cloudflare shows the domain as **Active** with SSL.

### 8. First sign-in
1. Open https://khata.kkhalisbazarpk.com → **First time? Create the owner login** → use the email from step 2.
2. Confirm the email if Supabase sends one, then sign in.
3. Turn off sign-ups (step 3.3).
4. Press **Sync Shopify**: all Shopify orders and current prices come in.
5. If you tried local mode first and want to keep that data: in the local version use
   **Settings → Download backup**, then in the online version **Settings → Restore backup**.

## How the numbers work

- **PARC price** = display price × (1 − 5%). Change the 5% on the Price list page or in Settings.
- When an order is added, each product's sale price and PARC price are **saved with the order**,
  so later price changes don't rewrite old orders. (In an order, **Use current price list** updates it.)
- **PARC khata**: orders ticked "Handed over to PARC" are added at their PARC amount; payments
  are subtracted. Balance 0 = **NIL**. Returned and cancelled orders are not counted.
- **Profit** = sale (without GST) − PARC cost − delivery − other costs.
  Returned orders: no sale and no PARC cost, but their delivery and other costs count as a loss.
- **By product** view: each order's delivery and other costs are shared across its products by sale value.
- Delivery suggestions use your courier rates: Within city 167 · Same zone 270 · Other zone 315
  (change them in Settings).

## Files

- `site/`: the web app (plain HTML/CSS/JavaScript, no build step). `js/calc.js` has all the khata maths.
- `site/js/seed-products.js`: the starting price list (live products + PATCO display prices).
  Regenerate with `node scripts/khata-products.mjs`.
- `supabase/schema.sql`: the tables and access rules.
- `supabase/functions/shopify-sync/index.ts`: reads orders and products from Shopify for Sync.
