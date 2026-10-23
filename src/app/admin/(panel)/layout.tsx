import { Suspense } from "react";
import { requireAdmin } from "@/lib/admin/guard";
import { publishDue } from "@/lib/schedule";
import { logoutAction } from "../actions";
import { Nav } from "./Nav";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  await publishDue();
  return (
    <div className="adm-wrap">
      <aside className="adm-side">
        <a className="adm-brand" href="/admin/">DayinUP</a>
        <Suspense fallback={null}>
          <Nav />
        </Suspense>
      </aside>
      <main className="adm-main">
        <div className="adm-top">
          <span>
            <a href="/" target="_blank" rel="noreferrer">檢視網站 ↗</a>
          </span>
          <span className="adm-row">
            {admin.email}（{admin.role}）
            <form action={logoutAction}>
              <button className="adm-btn sm" type="submit">登出</button>
            </form>
          </span>
        </div>
        {children}
      </main>
    </div>
  );
}
