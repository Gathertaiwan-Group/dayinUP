/* eslint-disable @typescript-eslint/no-explicit-any */
import { getAdmin, adminActor } from "@/lib/admin/guard";
import { audit, listRecords } from "@/lib/admin/service";
import { csvResponse, toCsv } from "@/lib/admin/csv";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await getAdmin();
  if (!a) return new Response("Unauthorized", { status: 401 });
  const sp = new URL(req.url).searchParams;
  const cols = ["id", "status", "date_created", "date_paid", "total", "subtotal", "shipping_total", "discount_total", "currency", "payment_method", "payment_method_title", "transaction_id", "billing_email", "billing", "shipping", "coupon_codes", "customer_id", "customer_note"];
  const addr = ["last_name", "first_name", "company", "phone", "email", "postcode", "state", "city", "address_1", "address_2"];
  const rows: Record<string, any>[] = [];
  for (let offset = 0; ; offset += 500) {
    const r = await listRecords("orders", { q: sp.get("q"), filters: { status: sp.get("status") || undefined, type: "shop_order" }, limit: 500, offset, columns: cols.join(",") });
    rows.push(...r.rows);
    if (r.rows.length < 500) break;
  }
  await audit(await adminActor(a), "export", "orders", null, null, { count: rows.length, status: sp.get("status") || null });
  const head = [...cols.filter((c) => c !== "billing" && c !== "shipping"), ...addr.map((k) => `billing_${k}`), ...addr.filter((k) => k !== "email").map((k) => `shipping_${k}`)];
  const body = rows.map((r) => [
    ...cols.filter((c) => c !== "billing" && c !== "shipping").map((c) => (Array.isArray(r[c]) ? r[c].join(" ") : r[c])),
    ...addr.map((k) => r.billing?.[k]),
    ...addr.filter((k) => k !== "email").map((k) => r.shipping?.[k]),
  ]);
  return csvResponse(`orders-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(head, body));
}
