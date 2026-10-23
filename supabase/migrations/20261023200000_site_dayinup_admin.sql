-- Phase 2 (Admin + MCP). Scope: site_dayinup only.
-- media: content hash for de-duplicated uploads (Gather storage is shared and small)
alter table site_dayinup.media add column if not exists sha1 text;
create index if not exists media_sha1_idx on site_dayinup.media(sha1) where sha1 is not null;

-- audit_log: request origin for admin / MCP writes
alter table site_dayinup.audit_log add column if not exists ip text;
alter table site_dayinup.audit_log add column if not exists user_agent text;
create index if not exists audit_log_via_idx on site_dayinup.audit_log(via, created_at desc);

-- scheduled publishing (WordPress post_status = future): promoted to publish when date <= now()
create index if not exists posts_future_idx on site_dayinup.posts(date) where status = 'future';
create index if not exists products_future_idx on site_dayinup.products(date) where status = 'future';

create index if not exists form_submissions_status_idx on site_dayinup.form_submissions(status);

-- promote due scheduled content (called by the server with service_role)
create or replace function site_dayinup.publish_due()
returns int language plpgsql security invoker set search_path = '' as $$
declare n int := 0; m int := 0;
begin
  update site_dayinup.posts set status = 'publish' where status = 'future' and date <= now();
  get diagnostics n = row_count;
  update site_dayinup.products set status = 'publish' where status = 'future' and date <= now();
  get diagnostics m = row_count;
  if n + m > 0 then
    insert into site_dayinup.audit_log(actor, via, action, entity_type, after)
    values ('system', 'system', 'publish_scheduled', 'posts', jsonb_build_object('posts', n, 'products', m));
  end if;
  return n + m;
end $$;
revoke all on function site_dayinup.publish_due() from public, anon, authenticated;
grant execute on function site_dayinup.publish_due() to service_role;

-- admin-editable settings (defaults = what the old site showed; only inserted when missing)
insert into site_dayinup.settings (key, value, is_public, description) values
  ('contact', '{"email":"dayin.team@gmail.com","line":"https://line.me/R/ti/p/@730wkluo","phone":"","address":""}'::jsonb, true, '聯絡資訊（後台：網站設定）'),
  ('social', '{"facebook":"","instagram":"","youtube":"","line":""}'::jsonb, true, '社群連結（後台：網站設定）'),
  ('tracking.codes', '{"gtag_id":"GT-PZM4W5BH","amplitude_key":"7808d6f18b3194b76773fa8c3ed07a0b","cloudflare_token":"3a49ae5422f84f388d0a7fb7aa849581","hubspot":true,"custom_head_html":""}'::jsonb, true, '前台追蹤碼（root layout 讀取）')
on conflict (key) do nothing;
