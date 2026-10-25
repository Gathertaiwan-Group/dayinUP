import type { Metadata } from "next";
import "../globals.css";
import "./admin.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "後台 | DayinUP", template: "%s | 後台 | DayinUP" },
  robots: { index: false, follow: false },
};

export default function AdminRoot({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW" suppressHydrationWarning>
      <body>
        <div className="adm-body">{children}</div>
      </body>
    </html>
  );
}
