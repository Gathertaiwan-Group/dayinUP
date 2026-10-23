/* eslint-disable @typescript-eslint/no-explicit-any */
import "server-only";
import { serviceDb } from "@/lib/supabase";

/** 依 ID 取媒體縮圖資訊（欄位預覽用） */
export async function mediaMap(ids: unknown[]) {
  const list = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!list.length) return {} as Record<number, { id: number; url: string; title?: string }>;
  const { data } = await serviceDb().from("media").select("id,public_url,title").in("id", list);
  return Object.fromEntries((data || []).map((m) => [m.id, { id: m.id, url: m.public_url || "", title: m.title || "" }])) as Record<number, { id: number; url: string; title?: string }>;
}

export async function allTerms(taxonomies?: string[]) {
  let q = serviceDb().from("terms").select("id,name,taxonomy,slug,parent_id,count,path").order("taxonomy").order("menu_order").order("name");
  if (taxonomies?.length) q = q.in("taxonomy", taxonomies);
  const { data } = await q;
  return (data || []) as { id: number; name: string; taxonomy: string; slug: string; parent_id: number | null; count: number; path: string | null }[];
}

export async function countOf(table: string, filter?: (q: any) => any) {
  let q = serviceDb().from(table).select("*", { count: "exact", head: true });
  if (filter) q = filter(q);
  const { count } = await q;
  return count || 0;
}

export type SP = Record<string, string | string[] | undefined>;
export const sp1 = (sp: SP, k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
