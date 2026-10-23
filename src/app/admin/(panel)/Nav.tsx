"use client";

import { usePathname, useSearchParams } from "next/navigation";

const NAV: ({ href: string; label: string; sub?: boolean } | null)[] = [
  { href: "/admin/", label: "控制台" },
  null,
  { href: "/admin/content/?type=post", label: "文章" },
  { href: "/admin/e/terms/?taxonomy=category", label: "文章分類", sub: true },
  { href: "/admin/e/terms/?taxonomy=post_tag", label: "文章標籤", sub: true },
  { href: "/admin/content/?type=page", label: "頁面" },
  { href: "/admin/content/?type=ct_content_block", label: "內容區塊", sub: true },
  { href: "/admin/media/", label: "媒體庫" },
  null,
  { href: "/admin/products/", label: "商品" },
  { href: "/admin/e/terms/?taxonomy=product_cat", label: "商品分類", sub: true },
  { href: "/admin/e/terms/?taxonomy=product_tag", label: "商品標籤", sub: true },
  { href: "/admin/e/terms/?taxonomy=product_brand", label: "品牌", sub: true },
  { href: "/admin/e/attributes/", label: "商品屬性", sub: true },
  { href: "/admin/orders/", label: "訂單" },
  { href: "/admin/e/customers/", label: "顧客" },
  { href: "/admin/e/coupons/", label: "優惠券" },
  { href: "/admin/e/discount_rules/", label: "票種／團報折扣", sub: true },
  null,
  { href: "/admin/menus/", label: "選單" },
  { href: "/admin/forms/", label: "表單提交" },
  { href: "/admin/e/redirects/", label: "轉址管理" },
  { href: "/admin/settings/", label: "網站設定" },
  { href: "/admin/audit/", label: "稽核紀錄" },
  { href: "/admin/e/admins/", label: "管理員", sub: true },
];

export function Nav() {
  const path = usePathname();
  const sp = useSearchParams();
  const cur = path + (sp.get("type") ? `?type=${sp.get("type")}` : sp.get("taxonomy") ? `?taxonomy=${sp.get("taxonomy")}` : "");
  const active = (href: string) => {
    if (href === "/admin/") return path === "/admin/" || path === "/admin";
    const [p, q] = href.split("?");
    if (q) return cur === href;
    return path.startsWith(p) && !(p === "/admin/e/terms/" && false);
  };
  return (
    <nav>
      {NAV.map((n, i) =>
        n ? (
          <a key={n.href} href={n.href} className={`${n.sub ? "adm-sub " : ""}${active(n.href) ? "on" : ""}`}>
            {n.label}
          </a>
        ) : (
          <div key={`s${i}`} className="adm-sep" />
        ),
      )}
    </nav>
  );
}
