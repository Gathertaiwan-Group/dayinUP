"use client";

import { useState } from "react";
import { MediaModal } from "./MediaModal";

type Item = { id: number; url: string; title?: string };

/** 單張圖片欄位（精選圖片、分類圖、Logo）：送出 media.id */
export function MediaPicker({ name, initial }: { name: string; initial?: Item | null }) {
  const [item, setItem] = useState<Item | null>(initial || null);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <input type="hidden" name={name} value={item ? String(item.id) : ""} />
      <div className="adm-row">
        {item ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.url} alt="" style={{ width: 96, height: 96, objectFit: "cover", border: "1px solid #dcdcde", background: "#f0f0f1" }} />
        ) : (
          <span className="adm-muted">未設定</span>
        )}
        <button type="button" className="adm-btn sm" onClick={() => setOpen(true)}>{item ? "更換" : "選擇圖片"}</button>
        {item ? <button type="button" className="adm-btn sm danger" onClick={() => setItem(null)}>移除</button> : null}
        {item ? <span className="adm-muted">#{item.id}</span> : null}
      </div>
      {open ? <MediaModal onClose={() => setOpen(false)} onPick={(s) => s[0] && setItem({ id: s[0].id, url: s[0].url, title: s[0].title })} /> : null}
    </div>
  );
}

/** 商品圖庫（多張、可排序；第一張＝主圖）：送出逗號分隔的 media.id */
export function GalleryPicker({ name, initial }: { name: string; initial: Item[] }) {
  const [items, setItems] = useState<Item[]>(initial);
  const [open, setOpen] = useState(false);
  const move = (i: number, d: number) =>
    setItems((cur) => {
      const a = [...cur];
      const j = i + d;
      if (j < 0 || j >= a.length) return a;
      [a[i], a[j]] = [a[j], a[i]];
      return a;
    });
  return (
    <div>
      <input type="hidden" name={name} value={items.map((i) => i.id).join(",")} />
      <div className="adm-thumbs">
        {items.map((it, i) => (
          <div className="t" key={it.id}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={it.url} alt="" title={`#${it.id}${i === 0 ? "（主圖）" : ""}`} />
            <button type="button" className="adm-btn sm danger x" onClick={() => setItems((c) => c.filter((x) => x.id !== it.id))} aria-label="移除">×</button>
            <div className="mv">
              <button type="button" className="adm-btn sm" onClick={() => move(i, -1)} aria-label="往前">‹</button>
              <span className="adm-muted" style={{ fontSize: 11 }}>{i === 0 ? "主圖" : i + 1}</span>
              <button type="button" className="adm-btn sm" onClick={() => move(i, 1)} aria-label="往後">›</button>
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="adm-btn sm adm-mt" onClick={() => setOpen(true)}>加入圖片</button>
      {open ? (
        <MediaModal
          multiple
          onClose={() => setOpen(false)}
          onPick={(s) => setItems((cur) => [...cur, ...s.filter((x) => !cur.some((c) => c.id === x.id)).map((x) => ({ id: x.id, url: x.url, title: x.title }))])}
        />
      ) : null}
    </div>
  );
}
