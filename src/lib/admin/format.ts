// 後台顯示用小工具（伺服器／瀏覽器皆可用）

const TZ_OFFSET = 8 * 3600 * 1000; // Asia/Taipei 無夏令時間

/** ISO → datetime-local 輸入值（台北時間） */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t + TZ_OFFSET).toISOString().slice(0, 16);
}

/** datetime-local（台北時間）→ ISO */
export function fromLocalInput(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = /T\d\d:\d\d$/.test(v) ? `${v}:00+08:00` : v;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return String(iso);
  return new Date(t + TZ_OFFSET).toISOString().slice(0, 16).replace("T", " ");
}

export function fmtMoney(n: unknown): string {
  if (n === null || n === undefined || n === "") return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  return "NT$" + v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function fmtBytes(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "—";
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / 1024 / 1024).toFixed(2)} MB`;
}

export function decodeSlugSafe(s: string | null | undefined): string {
  if (!s) return "";
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function qs(base: Record<string, string | number | null | undefined>, over: Record<string, string | number | null | undefined> = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v !== null && v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}
