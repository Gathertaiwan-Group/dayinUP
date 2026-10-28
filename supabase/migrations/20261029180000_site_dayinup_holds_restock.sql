-- NewebPay hardening round 2. Scope: ONLY schema site_dayinup (+ this site's own pg_cron job).
-- 1) expire_unpaid_holds(): SQL twin of WooCommerce wc_cancel_unpaid_orders() — pending NewebPay checkout orders not
--    modified for hold_stock_minutes (60) become cancelled, releasing their stock hold. Called by the site before every
--    stock check (add to cart / cart qty / checkout) and every 5 minutes by pg_cron job site_dayinup_expire_holds,
--    so holds no longer depend on someone browsing /api/publish-due.
-- 2) stock_reduced backfill from the imported WooCommerce _order_stock_reduced meta (meta.order_stock_reduced = 'yes').
-- 3) orders_reduce_stock_on_reopen trigger: an order moved from cancelled / failed back to processing / completed
--    reduces stock ONCE (guarded by stock_reduced), without checking availability; a note warns when stock goes negative.
--    newebpay_apply sets stock_reduced in the same UPDATE as the status, so it keeps doing its own (single) reduction.

-- ---------------------------------------------------------------- 1) expire unpaid holds
create or replace function site_dayinup.expire_unpaid_holds(p_hold_minutes int default 60)
returns int language plpgsql security invoker set search_path = '' as $$
declare
  v_cutoff timestamptz := now() - make_interval(mins => greatest(coalesce(p_hold_minutes, 60), 1));
  r record;
  n int := 0;
begin
  for r in
    select id from site_dayinup.orders
     where status = 'pending' and created_via = 'checkout' and payment_method like 'ry\_newebpay%'
       and date_modified < v_cutoff
     order by id
     limit 200
     for update skip locked
  loop
    update site_dayinup.orders set status = 'cancelled', date_modified = now()
     where id = r.id and status = 'pending';
    continue when not found;
    n := n + 1;
    insert into site_dayinup.order_notes(order_id, note, added_by)
    values (r.id, '未付款訂單已取消 - 付款期限已過。 訂單狀態由 等待付款中 變更為 已取消.', 'system');
    insert into site_dayinup.audit_log(actor, via, action, entity_type, entity_id, before, after)
    values ('newebpay', 'system', 'unpaid_cancelled', 'orders', r.id::text,
            jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'cancelled', 'hold_stock_minutes', p_hold_minutes));
  end loop;
  return n;
end $$;
revoke all on function site_dayinup.expire_unpaid_holds(int) from public, anon, authenticated;
grant execute on function site_dayinup.expire_unpaid_holds(int) to service_role;

-- ---------------------------------------------------------------- 2) backfill stock_reduced from the WP import
update site_dayinup.orders
   set stock_reduced = true
 where not stock_reduced and meta->>'order_stock_reduced' = 'yes';

-- ---------------------------------------------------------------- 3) reduce stock when a cancelled / failed order is reopened
create or replace function site_dayinup.orders_reduce_stock_on_reopen()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  it record;
  v_table text;
  v_tid bigint;
  v_old int;
  v_new int;
  v_lines text[] := '{}';
  v_neg text[] := '{}';
  v_from text;
  v_to text;
begin
  for it in select id, name, product_id, variation_id, quantity from site_dayinup.order_items
             where order_id = new.id and item_type = 'line_item' order by id loop
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
    -- no availability check on purpose (the order is already decided); stock may go negative
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
    if v_new < 0 then v_neg := v_neg || format('「%s」(#%s) 扣除後庫存為 %s', it.name, v_tid, v_new); end if;
    update site_dayinup.order_items set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('_reduced_stock', it.quantity) where id = it.id;
  end loop;

  new.stock_reduced := true;
  v_from := case old.status when 'cancelled' then '已取消' when 'failed' then '失敗' else old.status end;
  v_to := case new.status when 'processing' then '處理中' when 'completed' then '完成' else new.status end;
  if array_length(v_lines, 1) > 0 then
    insert into site_dayinup.order_notes(order_id, note, added_by)
    values (new.id, format('訂單由 %s 改回 %s，補扣庫存： %s', v_from, v_to, array_to_string(v_lines, ', ')), 'system');
  end if;
  if array_length(v_neg, 1) > 0 then
    insert into site_dayinup.order_notes(order_id, note, added_by)
    values (new.id, '⚠ 庫存不足：' || array_to_string(v_neg, '；') || '。補扣時未檢查庫存，請確認補貨或調整庫存數量。', 'system');
  end if;
  return new;
end $$;
revoke all on function site_dayinup.orders_reduce_stock_on_reopen() from public, anon, authenticated;

drop trigger if exists orders_reduce_stock_on_reopen on site_dayinup.orders;
create trigger orders_reduce_stock_on_reopen
  before update of status on site_dayinup.orders
  for each row
  when (old.status in ('cancelled', 'failed') and new.status in ('processing', 'completed')
        and not old.stock_reduced and not new.stock_reduced
        and coalesce(new.type, 'shop_order') = 'shop_order')
  execute function site_dayinup.orders_reduce_stock_on_reopen();

-- newebpay_apply: claim stock_reduced in the SAME update as the status change (so the trigger above does not fire for
-- NewebPay payments; apply keeps doing its own single reduction). Otherwise identical to 20261029120000.
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
    v_reduce := p_kind <> 'failed' and v_same and o.status = v_to and not o.stock_reduced;
    if not v_reduce then
      return jsonb_build_object('result', case when v_same then 'same' else 'other' end, 'prev_status', o.status, 'status', o.status, 'stock_lines', '[]'::jsonb);
    end if;
  else
    v_zh := case o.status when 'pending' then '等待付款中' when 'processing' then '處理中' when 'on-hold' then '保留'
            when 'completed' then '完成' when 'cancelled' then '已取消' when 'refunded' then '已退費' when 'failed' then '失敗' else o.status end;
    v_reduce := p_kind <> 'failed' and not o.stock_reduced;
    update site_dayinup.orders
       set status = v_to,
           stock_reduced = stock_reduced or v_reduce,
           transaction_id = case when p_kind = 'paid' then p_trade_no else transaction_id end,
           date_paid = case when p_kind = 'paid' then now() else date_paid end,
           meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{newebpay}', coalesce(meta->'newebpay', '{}'::jsonb) || coalesce(p_info, '{}'::jsonb)),
           date_modified = now()
     where id = p_order_id;
    foreach v_note in array coalesce(p_notes, '{}'::text[]) loop
      insert into site_dayinup.order_notes(order_id, note, added_by) values (p_order_id, replace(v_note, '{from}', v_zh), 'system');
    end loop;
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
revoke all on function site_dayinup.newebpay_apply(bigint, text, text, jsonb, text[]) from public, anon, authenticated;
grant execute on function site_dayinup.newebpay_apply(bigint, text, text, jsonb, text[]) to service_role;

-- ---------------------------------------------------------------- 4) pg_cron: release expired holds every 5 minutes
-- Only this site's job is touched: drop a previous job of the same name, then (re)schedule it.
select cron.unschedule(jobid) from cron.job where jobname = 'site_dayinup_expire_holds';
select cron.schedule('site_dayinup_expire_holds', '*/5 * * * *', $cron$select site_dayinup.expire_unpaid_holds(60)$cron$);
