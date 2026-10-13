// Fill these two values after creating the free Supabase project (README.md, step 2).
// While they are empty the khata runs in "local mode" and saves only in this browser.
// The publishable/anon key is meant to be public: your data stays private because of the
// login + the row-level-security rules in supabase/schema.sql.
export const CONFIG = {
  supabaseUrl: 'https://zxnytcnmaxiwpstthyir.supabase.co',   // e.g. 'https://zxnytcnmaxiwpstthyir.supabase.co'
  supabaseKey: 'sb_publishable_oi7vo9ouchYze1WkRCWH_w_2XuAt-I5',   // Project Settings → API Keys → publishable key (or the legacy "anon" key)
  syncFunction: 'shopify-sync',
};
