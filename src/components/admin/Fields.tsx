import type { Field } from "@/lib/admin/entities";
import { toLocalInput } from "@/lib/admin/format";
import { RichEditor } from "./RichEditor";
import { MediaPicker } from "./MediaPicker";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;
export type FieldCtx = {
  media?: Record<number, { id: number; url: string; title?: string }>;
  terms?: { id: number; name: string; taxonomy: string }[];
};

function valueText(f: Field, v: unknown): string {
  if (v === null || v === undefined) return "";
  if (f.type === "json") return JSON.stringify(v, null, 2);
  if (f.type === "bigints" || f.type === "texts") return Array.isArray(v) ? v.join(", ") : String(v);
  if (f.type === "datetime") return toLocalInput(String(v));
  return String(v);
}

export function FieldInput({ f, row, ctx }: { f: Field; row: Row | null; ctx?: FieldCtx }) {
  const v = row ? row[f.name] : undefined;
  const id = `f_${f.name}`;
  const ro = !!f.readonly;
  let input: React.ReactNode;
  switch (f.type) {
    case "html":
      input = <RichEditor name={f.name} initial={String(v ?? "")} minHeight={f.name === "short_description_html" || f.name === "excerpt_html" ? 140 : 320} />;
      break;
    case "textarea":
      input = <textarea id={id} name={f.name} className="plain" defaultValue={valueText(f, v)} rows={4} readOnly={ro} />;
      break;
    case "json":
      input = <textarea id={id} name={f.name} defaultValue={valueText(f, v ?? (f.name === "conditions" || f.name === "rules" ? [] : {}))} rows={Math.min(16, Math.max(4, valueText(f, v).split("\n").length + 1))} readOnly={ro} />;
      break;
    case "bool":
      input = (
        <label className="adm-check">
          <input type="checkbox" id={id} name={f.name} defaultChecked={!!v} disabled={ro} /> {f.label}
        </label>
      );
      break;
    case "select":
      input = (
        <select id={id} name={f.name} defaultValue={v === null || v === undefined ? "" : String(v)} disabled={ro}>
          {(f.options || []).map((o) => (
            <option key={o} value={o}>
              {o || "（無）"}
            </option>
          ))}
          {v !== null && v !== undefined && !(f.options || []).includes(String(v)) ? <option value={String(v)}>{String(v)}</option> : null}
        </select>
      );
      break;
    case "datetime":
      input = <input type="datetime-local" id={id} name={f.name} defaultValue={valueText(f, v)} readOnly={ro} />;
      break;
    case "number":
    case "money":
      input = <input type="number" id={id} name={f.name} step={f.type === "money" ? "0.01" : "any"} defaultValue={valueText(f, v)} readOnly={ro} />;
      break;
    case "media": {
      const m = v ? ctx?.media?.[Number(v)] : null;
      input = <MediaPicker name={f.name} initial={m || (v ? { id: Number(v), url: "" } : null)} />;
      break;
    }
    case "term":
      input = (
        <select id={id} name={f.name} defaultValue={v ? String(v) : ""}>
          <option value="">（無）</option>
          {(ctx?.terms || [])
            .filter((t) => (f.taxonomy ? t.taxonomy === f.taxonomy : !row?.taxonomy || t.taxonomy === row.taxonomy))
            .filter((t) => !row || t.id !== row.id)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}（{t.taxonomy}）
              </option>
            ))}
        </select>
      );
      break;
    default:
      input = <input type="text" id={id} name={f.name} defaultValue={valueText(f, v)} readOnly={ro} />;
  }
  return (
    <div className="adm-field">
      {f.type !== "bool" ? <label htmlFor={id}>{f.label}</label> : null}
      {input}
      {f.help ? <div className="adm-help">{f.help}</div> : null}
    </div>
  );
}

/** 一組欄位＋隱藏的 __fields 清單（伺服器端只處理有渲染的欄位） */
export function FieldSet({ fields, row, ctx, extraNames = [] }: { fields: Field[]; row: Row | null; ctx?: FieldCtx; extraNames?: string[] }) {
  return (
    <>
      <input type="hidden" name="__fields" value={[...fields.map((f) => f.name), ...extraNames].join(",")} />
      {fields.map((f) => (
        <FieldInput key={f.name} f={f} row={row} ctx={ctx} />
      ))}
    </>
  );
}

export function Flash({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const ok = typeof sp.ok === "string" ? sp.ok : "";
  const err = typeof sp.error === "string" ? sp.error : "";
  return (
    <>
      {ok ? <div className="adm-flash">{ok}</div> : null}
      {err ? <div className="adm-flash err">{err}</div> : null}
    </>
  );
}

export function Badge({ v }: { v: unknown }) {
  const s = v === null || v === undefined ? "—" : String(v);
  return <span className={`adm-badge ${s}`}>{s}</span>;
}

export function Pager({ total, offset, limit, href }: { total: number; offset: number; limit: number; href: (offset: number) => string }) {
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="adm-pager">
      <span>
        共 {total} 筆，第 {page}/{pages} 頁
      </span>
      {offset > 0 ? (
        <a className="adm-btn sm" href={href(Math.max(0, offset - limit))}>
          上一頁
        </a>
      ) : null}
      {offset + limit < total ? (
        <a className="adm-btn sm" href={href(offset + limit)}>
          下一頁
        </a>
      ) : null}
    </div>
  );
}
