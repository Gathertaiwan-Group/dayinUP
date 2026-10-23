-- Front-end (Next.js) form registry additions. Scope: site_dayinup only.
-- /contact/ was a 404 on the old site; the new site serves a contact form there (submissions -> form_submissions).
insert into site_dayinup.forms (slug, name, source, form_type, method, fields, pages, status)
values (
  'contact', '聯絡我們', 'native', 'contact', 'post',
  '[{"name":"name","type":"text","label":"姓名","required":true},{"name":"email","type":"email","label":"電子郵件","required":true},{"name":"subject","type":"text","label":"主旨","required":false},{"name":"message","type":"textarea","label":"訊息","required":true}]'::jsonb,
  '{/contact/}', 'published'
)
on conflict (slug) do update set fields = excluded.fields, pages = excluded.pages;
