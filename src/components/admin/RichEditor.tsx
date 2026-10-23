"use client";

import { useEffect, useRef, useState } from "react";
import { MediaModal } from "./MediaModal";

/** 顯示前移除 script 與 on* 事件屬性（避免在後台執行內容中的腳本） */
function sanitizeForEditing(html: string) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
}

/**
 * 所見即所得編輯器（contentEditable）：段落／標題、粗斜體、清單、對齊、連結、插入媒體庫圖片、HTML 原始碼模式。
 * 舊站內容含 Elementor / GreenShift 標記，未修改時原樣送出原始 HTML，避免瀏覽器正規化改動結構。
 */
export function RichEditor({ name, initial, minHeight = 320 }: { name: string; initial: string; minHeight?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"visual" | "html">("visual");
  const [html, setHtml] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [picker, setPicker] = useState(false);
  const savedRange = useRef<Range | null>(null);

  useEffect(() => {
    if (mode === "visual" && ref.current) ref.current.innerHTML = sanitizeForEditing(html);
    // 只在切換模式時把 HTML 寫回編輯區
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // 記住游標位置（IME／程式輸入不一定觸發 keyup），讓工具列指令作用在正確位置
  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && ref.current && ref.current.contains(sel.anchorNode)) savedRange.current = sel.getRangeAt(0).cloneRange();
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  function sync() {
    if (ref.current) {
      setHtml(ref.current.innerHTML);
      setDirty(true);
    }
  }
  function saveSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && ref.current?.contains(sel.anchorNode)) savedRange.current = sel.getRangeAt(0).cloneRange();
  }
  function restoreSelection() {
    const sel = window.getSelection();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    } else ref.current?.focus();
  }
  function exec(cmd: string, val?: string) {
    if (mode !== "visual") return;
    ref.current?.focus();
    restoreSelection();
    document.execCommand(cmd, false, val);
    saveSelection();
    sync();
  }
  function link() {
    saveSelection();
    const url = window.prompt("連結網址（例如 /product/xxx/ 或 https://…）", "https://");
    if (!url) return;
    exec("createLink", url);
  }
  function insertImages(items: { url: string; title: string; width: number | null; height: number | null }[]) {
    const tags = items
      .map((i) => `<img src="${i.url}" alt="${i.title.replace(/"/g, "&quot;")}"${i.width ? ` width="${i.width}"` : ""}${i.height ? ` height="${i.height}"` : ""} loading="lazy" decoding="async" />`)
      .join("");
    exec("insertHTML", tags);
  }

  const b = (cmd: string, label: React.ReactNode, title: string, val?: string) => (
    <button key={cmd} type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={() => exec(cmd, val)} disabled={mode !== "visual"}>
      {label}
    </button>
  );

  return (
    <div className="adm-rte">
      <input type="hidden" name={name} value={dirty ? html : initial} />
      <div className="bar">
        <select
          aria-label="段落格式"
          defaultValue=""
          disabled={mode !== "visual"}
          onChange={(e) => {
            if (e.target.value) exec("formatBlock", e.target.value);
            e.target.value = "";
          }}
        >
          <option value="">段落格式</option>
          <option value="p">段落</option>
          <option value="h2">標題 2</option>
          <option value="h3">標題 3</option>
          <option value="h4">標題 4</option>
          <option value="blockquote">引言</option>
          <option value="pre">預先格式化</option>
        </select>
        <span className="sp" />
        {b("bold", <b>B</b>, "粗體")}
        {b("italic", <i>I</i>, "斜體")}
        {b("underline", <u>U</u>, "底線")}
        {b("strikeThrough", <s>S</s>, "刪除線")}
        <span className="sp" />
        {b("insertUnorderedList", "• 清單", "項目符號清單")}
        {b("insertOrderedList", "1. 清單", "編號清單")}
        <span className="sp" />
        {b("justifyLeft", "靠左", "靠左對齊")}
        {b("justifyCenter", "置中", "置中")}
        {b("justifyRight", "靠右", "靠右對齊")}
        <span className="sp" />
        <button type="button" title="插入連結" onMouseDown={(e) => e.preventDefault()} onClick={link} disabled={mode !== "visual"}>
          連結
        </button>
        {b("unlink", "移除連結", "移除連結")}
        <button
          type="button"
          title="從媒體庫插入圖片"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            saveSelection();
            setPicker(true);
          }}
          disabled={mode !== "visual"}
        >
          插入圖片
        </button>
        {b("insertHorizontalRule", "分隔線", "水平分隔線")}
        {b("removeFormat", "清除格式", "清除格式")}
        <span className="sp" />
        {b("undo", "↶", "復原")}
        {b("redo", "↷", "重做")}
        <span style={{ flex: 1 }} />
        <button type="button" className={mode === "visual" ? "on" : ""} onClick={() => setMode("visual")}>
          視覺
        </button>
        <button
          type="button"
          className={mode === "html" ? "on" : ""}
          onClick={() => {
            if (mode === "visual" && dirty && ref.current) setHtml(ref.current.innerHTML);
            setMode("html");
          }}
        >
          HTML
        </button>
      </div>
      {mode === "visual" ? (
        <div ref={ref} className="ed" contentEditable suppressContentEditableWarning style={{ minHeight }} onInput={() => {
            sync();
            saveSelection();
          }} onKeyUp={saveSelection} onMouseUp={saveSelection} onBlur={saveSelection} />
      ) : (
        <textarea
          className="src"
          value={html}
          spellCheck={false}
          onChange={(e) => {
            setHtml(e.target.value);
            setDirty(true);
          }}
        />
      )}
      {picker ? <MediaModal multiple onClose={() => setPicker(false)} onPick={(items) => insertImages(items)} /> : null}
    </div>
  );
}
