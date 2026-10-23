import { getAdmin, adminActor } from "@/lib/admin/guard";
import { serviceDb } from "@/lib/supabase";
import { audit } from "@/lib/admin/service";
import { csvResponse, toCsv } from "@/lib/admin/csv";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await getAdmin();
  if (!a) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const status = new URL(req.url).searchParams.get("status");
  const db = serviceDb();
  const { data: form } = await db.from("forms").select("id,slug,name").eq("id", Number(id)).maybeSingle();
  if (!form) return new Response("Not found", { status: 404 });
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from("form_submissions").select("id,status,data,ip,user_agent,source_url,created_at").eq("form_id", form.id).order("created_at", { ascending: false }).range(from, from + 999);
    if (status) q = q.eq("status", status);
    const { data } = await q;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.data || {})))].filter((k) => !/pass(word)?|pwd/i.test(k));
  const headers = ["id", "created_at", "status", ...keys, "ip", "user_agent", "source_url"];
  await audit(await adminActor(a), "export", "form_submissions", form.id, null, { count: rows.length });
  return csvResponse(
    `form-${form.slug}-${new Date().toISOString().slice(0, 10)}.csv`,
    toCsv(headers, rows.map((r) => [r.id, r.created_at, r.status, ...keys.map((k) => r.data?.[k]), r.ip, r.user_agent, r.source_url])),
  );
}
