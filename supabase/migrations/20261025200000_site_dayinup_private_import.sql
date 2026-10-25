-- Phase 3: import of private WordPress data (orders, customers, coupons, notes, comments,
-- form submissions, real nav_menu). Schema-only changes; the data itself is loaded by
-- scripts/data/import-private.py straight from the local DB dump (never committed).
-- Scope: ONLY schema site_dayinup.

-- ---------------------------------------------------------------- menus: keep WP draft items hidden
alter table site_dayinup.menu_items add column if not exists status text not null default 'publish';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'menu_items_status_chk' and conrelid = 'site_dayinup.menu_items'::regclass) then
    alter table site_dayinup.menu_items add constraint menu_items_status_chk check (status in ('publish','draft'));
  end if;
end $$;
drop policy if exists public_read on site_dayinup.menu_items;
create policy public_read on site_dayinup.menu_items for select to anon, authenticated using (status = 'publish');

-- ---------------------------------------------------------------- form submissions: provenance (source plugin, WP id, ...)
alter table site_dayinup.form_submissions add column if not exists meta jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------- customers: lookups used by import / login linking
create index if not exists customers_auth_user_idx on site_dayinup.customers(auth_user_id);
create index if not exists order_notes_created_idx on site_dayinup.order_notes(order_id, created_at);

-- ---------------------------------------------------------------- comments: never expose e-mail / IP / UA to the public API
-- (RLS only filters rows; column privileges keep PII of approved comments private.)
revoke select on site_dayinup.comments from anon, authenticated;
grant select (id, post_id, parent_id, author_name, author_url, content_html, status, comment_type, date)
  on site_dayinup.comments to anon, authenticated;

-- ---------------------------------------------------------------- private tables: re-assert (no policies => service_role only)
do $$
declare t text;
begin
  foreach t in array array['customers','carts','cart_items','coupons','orders','order_items','order_notes',
                           'form_submissions','admins','audit_log'] loop
    execute format('alter table site_dayinup.%I enable row level security', t);
    execute format('revoke all on site_dayinup.%I from anon, authenticated', t);
  end loop;
end $$;
