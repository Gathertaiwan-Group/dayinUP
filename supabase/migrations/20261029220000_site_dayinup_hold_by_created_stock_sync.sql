-- NewebPay hardening round 3 (final re-review follow-up). Scope: ONLY schema site_dayinup.
-- 1) Stock holds are measured from orders.date_created, NOT date_modified. newebpay_issue_order_no bumps date_modified on
--    every pay-page load, so "GET /api/newebpay/pay/<id> every 50 min" kept a pending order (and its hold) alive forever.
--    expire_unpaid_holds / checkout_guard (and reservedStockError in src/lib/newebpay/service.ts) now use date_created.
--    The pay page refuses pending orders older than PAY_WINDOW_MINUTES (40) and sends TradeLimit=900 s, so a NewebPay
--    page opened in time closes before the 60-minute expiry; a payment that still lands after the expiry is applied by
--    newebpay_apply (cancelled → processing) and reduces stock once.
-- 2) checkout_guard: failed NewebPay orders count toward the per-ip / per-email unpaid caps (same hold window).
-- 3) orders_sync_stock trigger replaces orders_reduce_stock_on_reopen. Decision = "is stock currently reduced
--    (stock_reduced)" + "does the NEW status hold stock":
--      - new status processing / completed / on-hold, coming from a status that does not hold stock, stock not reduced
--        → reduce once (no availability check; negative stock gets a warning note). Covers cancelled → on-hold →
--        processing, refunded → processing, pending → on-hold, … ; processing → completed never reduces.
--      - new status cancelled / failed / pending with stock reduced → restore once (per line: order_items.meta
--        _reduced_stock, else the line quantity), clear _reduced_stock, stock_reduced := false. A later move back to a
--        stock-holding status (admin, or a NewebPay payment via newebpay_apply) reduces again.
--      - refunded / trash / checkout-draft never move stock (WooCommerce restocks refunds per item, manually).
--    newebpay_apply keeps claiming stock_reduced in the same UPDATE as the status, so the trigger skips its reductions.

-- ---------------------------------------------------------------- 1) expire unpaid holds by creation time
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
       and date_created < v_cutoff
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

-- ---------------------------------------------------------------- 2) checkout guard: creation time, pending + failed
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
     where status in ('pending', 'failed') and payment_method like 'ry\_newebpay%' and date_created >= v_hold and customer_ip = v_ip;
    if n >= p_max_unpaid_ip then return 'unpaid_ip'; end if;
  end if;
  if v_email is not null then
    select count(*) into n from site_dayinup.orders
     where status in ('pending', 'failed') and payment_method like 'ry\_newebpay%' and date_created >= v_hold and lower(billing_email) = v_email;
    if n >= p_max_unpaid_email then return 'unpaid_email'; end if;
  end if;
  insert into site_dayinup.checkout_attempts(ip, email) values (v_ip, v_email);
  return null;
end $$;
revoke all on function site_dayinup.checkout_guard(text, text, int, int, int, int, int, int) from public, anon, authenticated;
grant execute on function site_dayinup.checkout_guard(text, text, int, int, int, int, int, int) to service_role;

-- ---------------------------------------------------------------- 3) status-driven stock sync
create or replace function site_dayinup.orders_sync_stock()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  it record;
  v_reduce boolean := new.status in ('processing', 'completed', 'on-hold');
  v_table text;
  v_tid bigint;
  v_qty int;
  v_old int;
  v_new int;
  v_lines text[] := '{}';
  v_neg text[] := '{}';
  v_from text;
  v_to text;
begin
  for it in select id, name, product_id, variation_id, quantity, meta from site_dayinup.order_items
             where order_id = new.id and item_type = 'line_item' order by id loop
    if v_reduce then
      v_qty := coalesce(it.quantity, 0);
    else
      v_qty := coalesce(nullif(it.meta->>'_reduced_stock', '')::int, it.quantity, 0);
    end if;
    continue when v_qty = 0;
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
    if not v_reduce then v_qty := -v_qty; end if; -- restore = negative reduction
    v_old := null;
    -- no availability check on purpose (the order is already decided); stock may go negative
    if v_table = 'v' then
      update site_dayinup.product_variations
         set stock_quantity = stock_quantity - v_qty,
             stock_status = case when stock_quantity - v_qty <= 0 then (case when backorders <> 'no' then 'onbackorder' else 'outofstock' end)
                                 when v_qty < 0 then 'instock' else stock_status end
       where id = v_tid and stock_quantity is not null
      returning stock_quantity + v_qty, stock_quantity into v_old, v_new;
    else
      update site_dayinup.products
         set stock_quantity = stock_quantity - v_qty,
             stock_status = case when stock_quantity - v_qty <= 0 then (case when backorders <> 'no' then 'onbackorder' else 'outofstock' end)
                                 when v_qty < 0 then 'instock' else stock_status end
       where id = v_tid and stock_quantity is not null
      returning stock_quantity + v_qty, stock_quantity into v_old, v_new;
    end if;
    continue when v_old is null;
    v_lines := v_lines || format('%s (#%s) %s→%s', it.name, v_tid, v_old, v_new);
    if v_reduce and v_new < 0 then v_neg := v_neg || format('「%s」(#%s) 扣除後庫存為 %s', it.name, v_tid, v_new); end if;
    if v_reduce then
      update site_dayinup.order_items set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('_reduced_stock', v_qty) where id = it.id;
    else
      update site_dayinup.order_items set meta = coalesce(meta, '{}'::jsonb) - '_reduced_stock' where id = it.id;
    end if;
  end loop;

  new.stock_reduced := v_reduce;
  v_from := case old.status when 'pending' then '待付款' when 'processing' then '處理中' when 'on-hold' then '保留' when 'completed' then '完成'
            when 'cancelled' then '已取消' when 'refunded' then '已退費' when 'failed' then '失敗' else old.status end;
  v_to := case new.status when 'pending' then '待付款' when 'processing' then '處理中' when 'on-hold' then '保留' when 'completed' then '完成'
            when 'cancelled' then '已取消' when 'failed' then '失敗' else new.status end;
  if array_length(v_lines, 1) > 0 then
    insert into site_dayinup.order_notes(order_id, note, added_by)
    values (new.id, format('訂單由 %s 改為 %s，%s： %s', v_from, v_to, case when v_reduce then '補扣庫存' else '已歸還庫存' end,
                           array_to_string(v_lines, ', ')), 'system');
  end if;
  if array_length(v_neg, 1) > 0 then
    insert into site_dayinup.order_notes(order_id, note, added_by)
    values (new.id, '⚠ 庫存不足：' || array_to_string(v_neg, '；') || '。補扣時未檢查庫存，請確認補貨或調整庫存數量。', 'system');
  end if;
  return new;
end $$;
revoke all on function site_dayinup.orders_sync_stock() from public, anon, authenticated;

drop trigger if exists orders_reduce_stock_on_reopen on site_dayinup.orders;
drop function if exists site_dayinup.orders_reduce_stock_on_reopen();
drop trigger if exists orders_sync_stock on site_dayinup.orders;
create trigger orders_sync_stock
  before update of status on site_dayinup.orders
  for each row
  when (old.status is distinct from new.status and coalesce(new.type, 'shop_order') = 'shop_order' and (
          (new.status in ('processing', 'completed', 'on-hold') and old.status not in ('processing', 'completed', 'on-hold')
             and not old.stock_reduced and not new.stock_reduced)
       or (new.status in ('cancelled', 'failed', 'pending') and old.stock_reduced and new.stock_reduced)))
  execute function site_dayinup.orders_sync_stock();
