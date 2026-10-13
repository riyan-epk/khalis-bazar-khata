-- Khalis Bazar Khata: run this once in Supabase → SQL Editor → New query → Run.
-- Safe to run again (it only creates what is missing).

-- Who may open the khata. Nobody else can read or write anything, even with the public key.
create table if not exists khata_users (email text primary key);
alter table khata_users enable row level security;   -- no policies: only the SQL editor can see or change it

create or replace function is_khata_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from khata_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function is_khata_user() from public, anon;
grant execute on function is_khata_user() to authenticated;

-- Price list: Khalis Bazar variants (id sv_<shopify variant id>) and products added by hand.
create table if not exists khata_products (
  id            text primary key,
  handle        text default '',
  title         text not null,
  variant       text default '',
  store_price   numeric(12,2) default 0,
  display_price numeric(12,2),                  -- PARC display price, set by you
  active        boolean default true,
  position      int default 0,
  updated_at    timestamptz default now()
);

-- Orders (id so_<shopify order id> for Shopify orders, a random id for orders added by hand).
create table if not exists khata_orders (
  id            text primary key,
  order_no      text not null,
  date          date not null,
  customer      text default '',
  city          text default '',
  status        text not null default 'pending'
                check (status in ('pending','shipped','delivered','returned','cancelled')),
  source        text not null default 'manual',
  shopify_id    bigint,
  delivery      numeric(12,2),                  -- null = not entered yet
  other_cost    numeric(12,2) default 0,
  cost_override numeric(12,2),                  -- PARC amount if different from the price list
  tax           numeric(12,2),                  -- GST Shopify added on top (Shopify total = products + tax)
  in_parc       boolean not null default true,  -- handed over to PARC = counts in the PARC khata
  note          text default '',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Added 2026-10-13 for projects created with the first version of this file:
alter table khata_orders add column if not exists tax numeric(12,2);

create table if not exists khata_items (
  id         text primary key,
  order_id   text not null references khata_orders(id) on delete cascade,
  product_id text,
  title      text not null,
  variant    text default '',
  qty        numeric(10,2) not null default 1,
  price      numeric(12,2) not null default 0,  -- sale price per item (without GST)
  parc_cost  numeric(12,2) not null default 0,  -- PARC price per item, saved when the order was added
  position   int default 0
);
create index if not exists khata_items_order_id_idx on khata_items(order_id);

create table if not exists khata_payments (
  id         text primary key,
  date       date not null,
  amount     numeric(12,2) not null,
  method     text default '',
  note       text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists khata_settings (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- Row-level security: only logins listed in khata_users can see or change the khata.
do $$
declare t text;
begin
  foreach t in array array['khata_products','khata_orders','khata_items','khata_payments','khata_settings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists khata_owner on %I', t);
    execute format('create policy khata_owner on %I for all to authenticated using (is_khata_user()) with check (is_khata_user())', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('revoke all on %I from anon', t);
  end loop;
end $$;

-- ▼ Put YOUR login email here (the one you will sign in to the khata with), then run.
--   To let a partner in too, run this line again with their email.
insert into khata_users (email) values ('YOUR-EMAIL@gmail.com') on conflict do nothing;
