import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { serviceDb } from "@/lib/supabase";
import type { Actor } from "./service";

export type AdminSession = { userId: string; email: string; role: string };

/** 目前登入者是否為本站管理員（site_dayinup.admins） */
export const getAdmin = cache(async (): Promise<AdminSession | null> => {
  const user = await currentUser();
  if (!user) return null;
  const { data } = await serviceDb().from("admins").select("user_id,email,role").eq("user_id", user.id).maybeSingle();
  if (!data) return null;
  return { userId: data.user_id, email: data.email || user.email || "", role: data.role };
});

export async function requireAdmin(): Promise<AdminSession> {
  const a = await getAdmin();
  if (!a) redirect("/admin/login/");
  return a;
}

export async function adminActor(a: AdminSession): Promise<Actor> {
  const h = await headers();
  return {
    type: "admin",
    id: a.userId,
    email: a.email,
    ip: (h.get("x-forwarded-for") || "").split(",")[0].trim() || null,
    ua: h.get("user-agent"),
  };
}
