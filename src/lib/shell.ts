/* eslint-disable @typescript-eslint/no-explicit-any */
import 'server-only'
import chrome from '@/generated/chrome.json'
import { getMenuItems, getSettings, type Row } from './data'
import { esc } from './html'

const C = chrome as any
const ORIGINAL_LOGO = 'https://ozwftlkgqmewtadypsfi.supabase.co/storage/v1/object/public/site-dayinup/uploads/2025/05/DayinUP-ae075736.webp'
const ORIGINAL_COPYRIGHT = '版權 © 2026 - DayinUP All rights reserved'

function tree(items: Row[]) {
  const top = items.filter((i) => !i.parent_id).sort((a, b) => a.position - b.position)
  const kids = (id: number) => items.filter((i) => i.parent_id === id).sort((a, b) => a.position - b.position)
  return { top, kids }
}

function currentClasses(item: Row, kids: Row[], path: string, ACTIVE: string[]): string[] {
  const cls: string[] = []
  if (item.url === path) {
    cls.push('current-menu-item')
    // WordPress adds the page_item classes when a menu item points at the page being viewed
    if (item.object_type === 'page' && item.object_id) cls.push('page_item', `page-item-${item.object_id}`, 'current_page_item')
  }
  if (kids.some((k) => k.url === path)) {
    cls.push('current-menu-ancestor', 'current-menu-parent')
    if (kids.some((k) => k.url === path && k.object_type === 'page')) cls.push('current_page_parent', 'current_page_ancestor')
  }
  if (ACTIVE.includes(item.url) || kids.some((k) => ACTIVE.includes(k.url))) cls.push('current-product-ancestor', 'current-menu-parent', 'current-product-parent')
  return [...new Set(cls)]
}

export async function buildChrome(path: string, active: string[] = []) {
  const all = (await getMenuItems()).filter((i) => i.menus?.slug === 'main')
  const { top, kids } = tree(all)
  const dd = C.svg.dropdown_desktop || ''
  const dm = C.svg.dropdown_mobile || ''

  const desktop = `<ul id="menu-main" class="menu">${top
    .map((t) => {
      const k = kids(t.id)
      const cls = [t.classes || `menu-item menu-item-${t.id}`, ...currentClasses(t, k, path, active)].join(' ')
      const sub = k.length
        ? `<span class="ct-toggle-dropdown-desktop">${dd}</span></a><button class="ct-toggle-dropdown-desktop-ghost" aria-label="展開下拉選單" aria-haspopup="true" aria-expanded="false"></button> <ul class="sub-menu"> ${k
            .map((c) => `<li id="menu-item-${c.id}" class="${[c.classes || `menu-item menu-item-${c.id}`, ...currentClasses(c, [], path, active)].join(' ')}"><a href="${esc(c.url)}" class="ct-menu-link"${c.target ? ` target="${esc(c.target)}"` : ''}>${esc(c.label)}</a></li>`)
            .join(' ')} </ul> `
        : '</a>'
      return `<li id="menu-item-${t.id}" class="${cls}"><a href="${esc(t.url)}" class="ct-menu-link"${t.target ? ` target="${esc(t.target)}"` : ''}>${esc(t.label)}${sub}</li>`
    })
    .join(' ')}</ul>`

  const mobile = `<ul id="menu-main-1" class="">${top
    .map((t) => {
      const k = kids(t.id)
      const cls = [(t.classes || `menu-item menu-item-${t.id}`).replace(/\s*animated-submenu-block/, ''), ...currentClasses(t, k, path, active)].join(' ')
      if (!k.length) return `<li class="${cls}"><a href="${esc(t.url)}" class="ct-menu-link">${esc(t.label)}</a></li>`
      return `<li class="${cls}"><span class="ct-sub-menu-parent"><a href="${esc(t.url)}" class="ct-menu-link">${esc(t.label)}</a><button class="ct-toggle-dropdown-mobile" aria-label="展開下拉選單" aria-haspopup="true" aria-expanded="false">${dm}</button></span> <ul class="sub-menu"> ${k
        .map((c) => `<li class="${[c.classes || `menu-item menu-item-${c.id}`, ...currentClasses(c, [], path, active)].join(' ')}"><a href="${esc(c.url)}" class="ct-menu-link">${esc(c.label)}</a></li>`)
        .join(' ')} </ul> </li>`
    })
    .join(' ')}</ul>`

  // admin-editable bits of the captured Blocksy chrome: logo (site.logo_url) and footer copyright (footer.copyright)
  let header = String(C.header).replace('<!--MENU:main-->', desktop)
  let footer = String(C.footer)
  let drawerStart = String(C.drawer_start).replace('<!--MENU:mobile-->', mobile)
  try {
    const st = await getSettings()
    const logo = typeof st['site.logo_url'] === 'string' ? st['site.logo_url'] : ''
    if (logo && logo !== ORIGINAL_LOGO && /^https:\/\//.test(logo)) {
      const swap = (h: string) => h.split(ORIGINAL_LOGO).join(esc(logo)).replace(/ srcset="[^"]*"/g, (m) => (m.includes(esc(logo)) ? '' : m))
      header = swap(header)
      drawerStart = swap(drawerStart)
    }
    const copy = typeof st['footer.copyright'] === 'string' ? st['footer.copyright'] : ''
    if (copy && copy !== ORIGINAL_COPYRIGHT) footer = footer.replace(`<p>${ORIGINAL_COPYRIGHT}</p>`, `<p>${esc(copy)}</p>`)
  } catch {
    /* keep captured chrome */
  }
  return { drawerStart, header, footer, drawerEnd: String(C.drawer_end) }
}
