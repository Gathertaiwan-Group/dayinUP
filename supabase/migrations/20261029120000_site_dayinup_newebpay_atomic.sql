-- NewebPay hardening (security review follow-up). Scope: ONLY schema site_dayinup.
-- 1) newebpay_issue_order_no: append a MerchantOrderNo to orders.meta.newebpay atomically (row lock), so two concurrent
--    GET /api/newebpay/pay/<id> can no longer overwrite each other's number.
-- 2) newebpay_apply: status change + trade data (meta, transaction_id, date_paid) + stock reduction + order notes in ONE
--    transaction under a row lock. Idempotent: a resend of the same notify is a no-op; a mid-way DB error rolls back
--    everything so NewebPay's retry completes the job.
-- 3) checkout_guard + checkout_attempts: DB-counted rate limit and unpaid-order caps for NewebPay checkouts (stock holds).
-- All functions: security invoker, empty search_path, EXECUTE for service_role only.

-- ---------------------------------------------------------------- 1) MerchantOrderNo
create or replace function site_dayinup.newebpay_issue_order_no(p_order_id bigint, p_merchant_order_no text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  v_meta jsonb;
  v_nos jsonb;
begin
  select meta into v_meta from site_dayinup.orders where id = p_order_id for update;
  if not found then return false; end if;
  v_nos := coalesce(v_meta->'newebpay'->'merchant_order_nos', '[]'::jsonb);
  if jsonb_typeof(v_nos) <> 'array' then v_nos := '[]'::jsonb; end if;
  if not v_nos @> jsonb_build_array(p_merchant_order_no) then v_nos := v_nos || to_jsonb(p_merchant_order_no); end if;
  -- keep the newest 20
  if jsonb_array_length(v_nos) > 20 then
    select coalesce(jsonb_agg(e order by i), '[]'::jsonb) into v_nos
      from jsonb_array_elements(v_nos) with ordinality as t(e, i)
     where i > jsonb_array_length(v_nos) - 20;
  end if;
  update site_dayinup.orders
     set meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{newebpay}',
                 coalesce(meta->'newebpay', '{}'::jsonb)
                 || jsonb_build_object('merchant_order_nos', v_nos, 'last_merchant_order_no', p_merchant_order_no)),
         date_modified = now()
   where id = p_order_id;
  return true;
end $$;

-- ---------------------------------------------------------------- 2) apply a verified NewebPay result
-- p_kind: 'paid' (notify SUCCESS) | 'on-hold' (customer 取號) | 'failed' (notify failure)
-- p_notes: notes written when the change is applied; '{from}' is replaced by the zh label of the locked previous status.
-- Returns {result, prev_status, status, stock_lines}; result = applied | completed | same | other | not_found
create or replace function site_dayinup.newebpay_apply(p_order_id bigint, p_kind text, p_trade_no text, p_info jsonb, p_notes text[])
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  o record;
  it record;
  v_from text[];
  v_to text;
  v_zh text;
  v_same boolean;
  v_reduce boolean;
  v_lines text[] := '{}';
  v_table text;
  v_tid bigint;
  v_old int;
  v_new int;
  v_note text;
begin
  if p_kind = 'paid' then v_from := array['pending','failed','cancelled','on-hold']; v_to := 'processing';
  elsif p_kind = 'on-hold' then v_from := array['pending','failed']; v_to := 'on-hold';
  elsif p_kind = 'failed' then v_from := array['pending']; v_to := 'failed';
  else raise exception 'newebpay_apply: bad kind %', p_kind;
  end if;

  select id, status, stock_reduced, meta into o from site_dayinup.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;

  v_same := p_trade_no is not null and (o.meta->'newebpay'->>'trade_no') = p_trade_no;

  if not (o.status = any(v_from)) then
    -- Already moved on. Same trade + stock never reduced (legacy partial write) → finish the stock step only.
    v_reduce := p_kind <> 'failed' and v_same and o.status = v_to and not o.stock_reduced;
    if not v_reduce then
      return jsonb_build_object('result', case when v_same then 'same' else 'other' end, 'prev_status', o.status, 'status', o.status, 'stock_lines', '[]'::jsonb);
    end if;
  else
    v_zh := case o.status when 'pending' then '等待付款中' when 'processing' then '處理中' when 'on-hold' then '保留'
            when 'completed' then '完成' when 'cancelled' then '已取消' when 'refunded' then '已退費' when 'failed' then '失敗' else o.status end;
    update site_dayinup.orders
       set status = v_to,
           transaction_id = case when p_kind = 'paid' then p_trade_no else transaction_id end,
           date_paid = case when p_kind = 'paid' then now() else date_paid end,
           meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{newebpay}', coalesce(meta->'newebpay', '{}'::jsonb) || coalesce(p_info, '{}'::jsonb)),
           date_modified = now()
     where id = p_order_id;
    foreach v_note in array coalesce(p_notes, '{}'::text[]) loop
      insert into site_dayinup.order_notes(order_id, note, added_by) values (p_order_id, replace(v_note, '{from}', v_zh), 'system');
    end loop;
    v_reduce := p_kind <> 'failed' and not o.stock_reduced;
  end if;

  if v_reduce then
    for it in select id, name, product_id, variation_id, quantity from site_dayinup.order_items
               where order_id = p_order_id and item_type = 'line_item' order by id loop
      continue when coalesce(it.quantity, 0) = 0;
      v_table := null; v_tid := null;
      if it.variation_id is not null then
        select id into v_tid from site_dayinup.product_variations where id = it.variation_id and manage_stock;
        if v_tid is not null then v_table := 'v'; end if;
      end if;
      if v_table is null and it.product_id is not null then
        select id into v_tid from site_dayinup.products where id = it.product_id and manage_stock;
        if v_tid is not null then v_table := 'p'; end if;
      end if;
      continue when v_table is null;
      v_old := null;
      if v_table = 'v' then
        update site_dayinup.product_variations
           set stock_quantity = stock_quantity - it.quantity,
               stock_status = case when stock_quantity - it.quantity <= 0 then (case when backorders <> 'no' then 'onbackorder' else 'outofstock' end) else stock_status end
         where id = v_tid and stock_quantity is not null
        returning stock_quantity + it.quantity, stock_quantity into v_old, v_new;
      else
        update site_dayinup.products
           set stock_quantity = stock_quantity - it.quantity,
               stock_status = case when stock_quantity - it.quantity <= 0 then (case when backorders <> 'no' then 'onbackorder' else 'outofstock' end) else stock_status end
         where id = v_tid and stock_quantity is not null
        returning stock_quantity + it.quantity, stock_quantity into v_old, v_new;
      end if;
      continue when v_old is null;
      v_lines := v_lines || format('%s (#%s) %s→%s', it.name, v_tid, v_old, v_new);
      update site_dayinup.order_items set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('_reduced_stock', it.quantity) where id = it.id;
    end loop;
    update site_dayinup.orders set stock_reduced = true where id = p_order_id;
    if array_length(v_lines, 1) > 0 then
      insert into site_dayinup.order_notes(order_id, note, added_by) values (p_order_id, '庫存量已減少： ' || array_to_string(v_lines, ', '), 'system');
    end if;
  end if;

  return jsonb_build_object(
    'result', case when o.status = any(v_from) then 'applied' else 'completed' end,
    'prev_status', o.status, 'status', v_to, 'stock_lines', to_jsonb(v_lines));
end $$;

-- ---------------------------------------------------------------- 3) checkout abuse guard
create table if not exists site_dayinup.checkout_attempts (
  id         bigint generated by default as identity primary key,
  ip         text,
  email      text,
  created_at timestamptz not null default now()
);
create index if not exists checkout_attempts_ip_idx on site_dayinup.checkout_attempts(ip, created_at);
create index if not exists checkout_attempts_email_idx on site_dayinup.checkout_attempts(email, created_at);
alter table site_dayinup.checkout_attempts enable row level security;
revoke all on site_dayinup.checkout_attempts from anon, authenticated;
grant all on site_dayinup.checkout_attempts to service_role;

-- Returns null when the checkout may proceed, else 'rate_ip' | 'rate_email' | 'unpaid_ip' | 'unpaid_email'.
-- Counts are serialised per ip / email with transaction-scoped advisory locks; the attempt is recorded only when allowed.
create or replace function site_dayinup.checkout_guard(
  p_ip text, p_email text,
  p_window_minutes int default 10, p_max_attempts_ip int default 10, p_max_attempts_email int default 6,
  p_hold_minutes int default 60, p_max_unpaid_ip int default 5, p_max_unpaid_email int default 3)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  v_ip text := nullif(btrim(coalesce(p_ip, '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_since timestamptz := now() - make_interval(mins => p_window_minutes);
  v_hold timestamptz := now() - make_interval(mins => p_hold_minutes);
  n int;
begin
  if v_ip is not null then perform pg_advisory_xact_lock(hashtext('site_dayinup.checkout:ip:' || v_ip)); end if;
  if v_email is not null then perform pg_advisory_xact_lock(hashtext('site_dayinup.checkout:email:' || v_email)); end if;
  delete from site_dayinup.checkout_attempts where created_at < now() - interval '1 day';

  if v_ip is not null then
    select count(*) into n from site_dayinup.checkout_attempts where ip = v_ip and created_at >= v_since;
    if n >= p_max_attempts_ip then return 'rate_ip'; end if;
  end if;
  if v_email is not null then
    select count(*) into n from site_dayinup.checkout_attempts where email = v_email and created_at >= v_since;
    if n >= p_max_attempts_email then return 'rate_email'; end if;
  end if;
  if v_ip is not null then
    select count(*) into n from site_dayinup.orders
     where status = 'pending' and payment_method like 'ry\_newebpay%' and date_modified >= v_hold and customer_ip = v_ip;
    if n >= p_max_unpaid_ip then return 'unpaid_ip'; end if;
  end if;
  if v_email is not null then
    select count(*) into n from site_dayinup.orders
     where status = 'pending' and payment_method like 'ry\_newebpay%' and date_modified >= v_hold and lower(billing_email) = v_email;
    if n >= p_max_unpaid_email then return 'unpaid_email'; end if;
  end if;
  insert into site_dayinup.checkout_attempts(ip, email) values (v_ip, v_email);
  return null;
end $$;

revoke all on function site_dayinup.newebpay_issue_order_no(bigint, text) from public, anon, authenticated;
revoke all on function site_dayinup.newebpay_apply(bigint, text, text, jsonb, text[]) from public, anon, authenticated;
revoke all on function site_dayinup.checkout_guard(text, text, int, int, int, int, int, int) from public, anon, authenticated;
grant execute on function site_dayinup.newebpay_issue_order_no(bigint, text) to service_role;
grant execute on function site_dayinup.newebpay_apply(bigint, text, text, jsonb, text[]) to service_role;
grant execute on function site_dayinup.checkout_guard(text, text, int, int, int, int, int, int) to service_role;
