import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/admin/guard";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "登入" };

export default async function LoginPage() {
  if (await getAdmin()) redirect("/admin/");
  return (
    <div className="adm-login">
      <h1 className="adm-h1" style={{ justifyContent: "center" }}>DayinUP・後台</h1>
      <div className="adm-card">
        <LoginForm />
      </div>
      <p className="adm-muted" style={{ textAlign: "center" }}>
        <a href="/">← 回到網站</a>
      </p>
    </div>
  );
}
