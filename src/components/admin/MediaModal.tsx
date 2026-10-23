"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pickerMediaAction, uploadInlineAction, type PickerItem } from "@/app/admin/actions";

/** 媒體庫挑選視窗：搜尋、分頁、直接上傳（伺服器端轉 WebP） */
export function MediaModal({ onPick, onClose, multiple = false, imagesOnly = true }: { onPick: (items: PickerItem[]) => void; onClose: () => void; multiple?: boolean; imagesOnly?: boolean }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<PickerItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [sel, setSel] = useState<PickerItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (query: string, off: number) => {
    setBusy(true);
    const r = await pickerMediaAction(query, off);
    setItems(r.items);
    setTotal(r.total);
    setBusy(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(q, offset), 250);
    return () => clearTimeout(t);
  }, [q, offset, load]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setErr("");
    const added: PickerItem[] = [];
    for (const f of Array.from(files)) {
      const fd = new FormData();
      fd.set("file", f);
      const r = await uploadInlineAction(fd);
      if (r.error) setErr(r.error);
      if (r.item) added.push(r.item);
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (added.length) {
      setItems((cur) => [...added, ...cur.filter((c) => !added.some((a) => a.id === c.id))]);
      setSel((cur) => (multiple ? [...cur, ...added] : added.slice(0, 1)));
    }
  }

  function toggle(it: PickerItem) {
    setSel((cur) => (cur.some((c) => c.id === it.id) ? cur.filter((c) => c.id !== it.id) : multiple ? [...cur, it] : [it]));
  }

  const shown = imagesOnly ? items.filter((i) => i.mime.startsWith("image/")) : items;

  return (
    <div className="adm-modal" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <div className="adm-row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
          <b>媒體庫</b>
          <div className="adm-row">
            <input type="search" placeholder="搜尋檔名／標題" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} style={{ width: 220 }} />
            <label className="adm-btn">
              上傳檔案
              <input ref={fileRef} type="file" multiple accept={imagesOnly ? "image/*" : "image/*,application/pdf,video/*"} hidden onChange={(e) => upload(e.target.files)} />
            </label>
            <button type="button" className="adm-btn" onClick={onClose}>關閉</button>
          </div>
        </div>
        {err ? <div className="adm-flash err">{err}</div> : null}
        {busy ? <p className="adm-muted">處理中…</p> : null}
        <div className="adm-media-grid">
          {shown.map((it) => (
            <button type="button" key={it.id} className={sel.some((s) => s.id === it.id) ? "sel" : ""} onClick={() => toggle(it)} title={it.title}>
              <div className="ph" style={it.mime.startsWith("image/") ? { backgroundImage: `url("${it.url}")` } : undefined}>{it.mime.startsWith("image/") ? "" : it.mime}</div>
              <div className="cap">#{it.id} {it.title}</div>
            </button>
          ))}
        </div>
        <div className="adm-pager">
          <span>共 {total} 個</span>
          <button type="button" className="adm-btn sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 60))}>上一頁</button>
          <button type="button" className="adm-btn sm" disabled={offset + 60 >= total} onClick={() => setOffset(offset + 60)}>下一頁</button>
          <button type="button" className="adm-btn pri" disabled={!sel.length} onClick={() => { onPick(sel); onClose(); }}>
            使用選取的 {sel.length || ""} 個
          </button>
        </div>
      </div>
    </div>
  );
}
