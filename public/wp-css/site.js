/* DayinUP front-end behaviours (replaces Blocksy / WooCommerce / Elementor jQuery bundles). */
(function () {
  'use strict'
  var d = document
  var body = d.body
  var $ = function (s, r) { return (r || d).querySelector(s) }
  var $$ = function (s, r) { return Array.prototype.slice.call((r || d).querySelectorAll(s)) }
  function fmt(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }
  function moneyHtml(n) { return '<span class="woocommerce-Price-amount amount"><bdi><span class="woocommerce-Price-currencySymbol" translate="no" dir="auto">&#78;&#84;&#36;</span>' + fmt(n) + '</bdi></span>' }
  function api(url, opts) {
    opts = opts || {}
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {})
    opts.credentials = 'same-origin'
    return fetch(url, opts).then(function (r) { return r.json().catch(function () { return {} }).then(function (j) { j.__status = r.status; return j }) })
  }
  window.dayinup = window.dayinup || {}
  window.dayinup.api = api

  /* ------------------------------------------------------------ panels (offcanvas, search modal, account modal) */
  var openPanel = null
  function showPanel(sel) {
    var p = $(sel)
    if (!p) return
    if (openPanel && openPanel !== p) hidePanel(true)
    p.removeAttribute('inert')
    p.classList.add('active')
    body.setAttribute('data-panel', 'in' + (p.dataset.behaviour && p.dataset.behaviour.indexOf('left') >= 0 ? ':left' : ''))
    d.documentElement.style.overflow = 'hidden'
    openPanel = p
    $$('[aria-controls="' + sel.slice(1) + '"]').forEach(function (b) { b.setAttribute('aria-expanded', 'true') })
    var f = $('input[type=search], input:not([type=hidden])', p)
    if (f && sel !== '#offcanvas') setTimeout(function () { f.focus() }, 50)
  }
  function hidePanel(instant) {
    var p = openPanel
    if (!p) return
    body.setAttribute('data-panel', 'out')
    setTimeout(function () {
      p.classList.remove('active')
      p.setAttribute('inert', '')
      body.removeAttribute('data-panel')
      d.documentElement.style.overflow = ''
    }, instant ? 0 : 250)
    $$('[aria-controls="' + p.id + '"]').forEach(function (b) { b.setAttribute('aria-expanded', 'false') })
    openPanel = null
  }
  d.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target : e.target.parentNode
    var trig = t.closest('[data-toggle-panel]')
    if (trig) { e.preventDefault(); showPanel(trig.getAttribute('data-toggle-panel')); return }
    var acc = t.closest('a[href="#account-modal"]')
    if (acc) {
      if (body.dataset.loggedIn === '1') { location.href = '/my-account/'; e.preventDefault(); return }
      e.preventDefault(); showPanel('#account-modal'); return
    }
    if (t.closest('.ct-toggle-close')) { e.preventDefault(); hidePanel(); return }
    if (openPanel && t === openPanel) { hidePanel(); return }
    if (openPanel && openPanel.id === 'offcanvas' && t.closest('#offcanvas') && !t.closest('.ct-panel-inner')) { hidePanel(); return }
    // mobile submenu toggles
    var mt = t.closest('.ct-toggle-dropdown-mobile')
    if (mt) {
      e.preventDefault()
      var li = mt.closest('li')
      var open = li.classList.toggle('dropdown-active')
      mt.setAttribute('aria-expanded', open ? 'true' : 'false')
      var sub = $('.sub-menu', li)
      if (sub) { sub.style.display = open ? 'block' : ''; }
      return
    }
    // desktop dropdown ghost button (keyboard / touch)
    var gh = t.closest('.ct-toggle-dropdown-desktop-ghost')
    if (gh) { var l2 = gh.closest('li'); l2.classList.toggle('ct-active'); gh.setAttribute('aria-expanded', l2.classList.contains('ct-active')) }
  })
  d.addEventListener('keydown', function (e) { if (e.key === 'Escape') { hidePanel(); closeLightbox() } })

  /* ------------------------------------------------------------ desktop dropdown menus (Blocksy data-interaction=hover) */
  $$('nav[data-id="menu"], nav.menu-container').forEach(function (nav) {
    if (nav.closest('#offcanvas')) return
    // Blocksy's menu script flips data-responsive="no" → "yes" once the menu is measured;
    // while it is "no" the theme CSS keeps every .sub-menu at display:none.
    if (nav.getAttribute('data-responsive') === 'no') nav.setAttribute('data-responsive', 'yes')
    var hoverMode = (nav.getAttribute('data-interaction') || 'hover').indexOf('hover') !== -1
    $$('li.menu-item-has-children, li[class*="animated-submenu"]', nav).forEach(function (li) {
      if (!$('.sub-menu', li)) return
      var timer = null
      var ghost = $('.ct-toggle-dropdown-desktop-ghost', li)
      function setOpen(open) {
        clearTimeout(timer)
        li.classList.toggle('ct-active', open)
        if (ghost) ghost.setAttribute('aria-expanded', open ? 'true' : 'false')
        if (open) {
          // close sibling dropdowns
          var p = li.parentNode
          Array.prototype.forEach.call(p ? p.children : [], function (s) { if (s !== li && s.classList) s.classList.remove('ct-active') })
        }
      }
      if (hoverMode) {
        li.addEventListener('mouseenter', function () { setOpen(true) })
        li.addEventListener('mouseleave', function () { clearTimeout(timer); timer = setTimeout(function () { setOpen(false) }, 120) })
      }
      li.addEventListener('focusin', function () { setOpen(true) })
      li.addEventListener('focusout', function (e) { if (!li.contains(e.relatedTarget)) setOpen(false) })
      // click / tap on the top-level link: first tap opens on touch devices or click-interaction menus
      var a = li.querySelector(':scope > a')
      if (a) a.addEventListener('click', function (e) {
        var touch = window.matchMedia && window.matchMedia('(hover: none)').matches
        if ((!hoverMode || touch) && !li.classList.contains('ct-active')) { e.preventDefault(); setOpen(true) }
      })
    })
  })
  d.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target : null
    $$('nav[data-id="menu"] li.ct-active').forEach(function (li) { if (!t || !li.contains(t)) li.classList.remove('ct-active') })
  })

  /* ------------------------------------------------------------ sticky header (shrink) + back to top */
  $$('.ct-sticky-container').forEach(function (c) {
    var inner = c.firstElementChild
    function measure() { c.style.height = '' ; c.style.height = inner.offsetHeight + 'px' }
    function onScroll() {
      if (!c.offsetParent) return
      var top = c.getBoundingClientRect().top
      var stuck = window.scrollY > 0 && top <= 0
      inner.setAttribute('data-sticky', stuck ? 'yes shrink' : 'shrink')
    }
    measure(); onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', function () { measure(); onScroll() })
  })
  var btt = $('.ct-back-to-top')
  if (btt) {
    var bttScroll = function () {
      var show = window.scrollY > 300
      if (show) { btt.removeAttribute('hidden'); btt.classList.add('ct-show') } else { btt.classList.remove('ct-show') }
    }
    window.addEventListener('scroll', bttScroll, { passive: true }); bttScroll()
    btt.addEventListener('click', function (e) { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }) })
  }
  // floating add-to-cart bar on product pages
  var fb = $('.ct-floating-bar')
  if (fb) {
    var anchor = $('.ct-product-add-to-cart') || $('.summary .price')
    var canvas = fb.closest('.ct-drawer-canvas')
    var fbScroll = function () {
      if (!anchor || !canvas) return
      var r = anchor.getBoundingClientRect()
      var hdr = $$('[data-sticky]').filter(function (x) { return x.offsetParent })[0]
      if (hdr) canvas.style.setProperty('--top-position-override', hdr.getBoundingClientRect().bottom > 0 ? Math.max(0, hdr.getBoundingClientRect().bottom) + 'px' : '0px')
      canvas.setAttribute('data-floating-bar', r.bottom < 0 ? 'yes' : 'no')
    }
    window.addEventListener('scroll', fbScroll, { passive: true }); fbScroll()
  }

  /* ------------------------------------------------------------ Elementor runtime bits */
  $$('.elementor-invisible').forEach(function (el) {
    var s = {}
    try { s = JSON.parse(el.getAttribute('data-settings') || '{}') } catch (e) {}
    el.classList.remove('elementor-invisible')
    var anim = s._animation || s.animation
    if (anim && anim !== 'none') { el.classList.add('animated', anim) }
  })
  $$('.e-con.e-parent').forEach(function (el) { el.classList.add('e-lazyloaded') })
  // Elementor Pro table of contents (rebuilds what Elementor's JS generated)
  $$('.elementor-widget-table-of-contents').forEach(function (w) {
    var s = {}
    try { s = JSON.parse(w.getAttribute('data-settings') || '{}') } catch (e) {}
    var tags = (s.headings_by_tags || ['h2', 'h3']).join(',')
    var container = w.closest('.elementor') || w.closest('.entry-content') || d
    var heads = $$(tags, container).filter(function (h) { return !h.closest('.elementor-widget-table-of-contents') && h.textContent.trim() })
    var bodyEl = $('.elementor-toc__body', w)
    if (!bodyEl || !heads.length) return
    var icon = ''
    if (s.marker_view === 'bullets' && s.icon && s.icon.rendered_tag) {
      var t = d.createElement('textarea'); t.innerHTML = s.icon.rendered_tag; icon = t.value
    }
    var hier = s.hierarchical_view === 'yes'
    var root = d.createElement('ul'); root.className = 'elementor-toc__list-wrapper'
    var stack = [{ level: 0, ul: root }]
    heads.forEach(function (h, i) {
      if (!h.id) h.id = 'elementor-toc__heading-anchor-' + i
      var lvl = parseInt(h.tagName.slice(1), 10)
      if (hier) {
        while (stack.length > 1 && stack[stack.length - 1].level >= lvl) stack.pop()
      }
      var parent = stack[stack.length - 1]
      var li = d.createElement('li'); li.className = 'elementor-toc__list-item'
      li.innerHTML = '<div class="elementor-toc__list-item-text-wrapper">' + (icon || '<i aria-hidden="true" class="fas fa-circle"></i>') + '<a href="#' + h.id + '" class="elementor-toc__list-item-text' + (parent.level === 0 ? ' elementor-toc__top-level' : '') + '">' + h.textContent.trim().replace(/[<>&]/g, '') + '</a></div>'
      parent.ul.appendChild(li)
      if (hier) {
        var sub = d.createElement('ul'); sub.className = 'elementor-toc__list-wrapper'
        li.appendChild(sub)
        stack.push({ level: lvl, ul: sub })
      }
    })
    $$('ul.elementor-toc__list-wrapper', root).forEach(function (u) { if (!u.children.length) u.remove() })
    bodyEl.innerHTML = ''; bodyEl.appendChild(root)
    var spinner = $('.elementor-toc__spinner-container', w); if (spinner) spinner.remove()
    var bp = s.minimized_on === 'mobile' ? 767 : s.minimized_on === 'tablet' ? 1024 : s.minimized_on === 'desktop' ? 99999 : -1
    function setCollapsed(c) {
      w.classList.toggle('elementor-toc--collapsed', c)
      bodyEl.style.display = c ? 'none' : ''
      $$('.elementor-toc__toggle-button--expand', w).forEach(function (b) { b.setAttribute('aria-expanded', c ? 'false' : 'true') })
    }
    if (s.minimize_box === 'yes' && window.innerWidth <= bp) setCollapsed(true)
    $$('.elementor-toc__toggle-button', w).forEach(function (b) {
      b.addEventListener('click', function () { setCollapsed(!w.classList.contains('elementor-toc--collapsed')) })
    })
    $$('a', root).forEach(function (a) { a.addEventListener('click', function () { $$('.elementor-item-active', root).forEach(function (x) { x.classList.remove('elementor-item-active') }); a.classList.add('elementor-item-active') }) })
  })
  // Elementor tabs / accordion / toggle
  $$('.elementor-tabs, .e-n-tabs').forEach(function (tabs) {
    $$('.elementor-tab-title, .e-n-tab-title', tabs).forEach(function (t) {
      t.addEventListener('click', function () {
        var id = t.getAttribute('data-tab') || t.getAttribute('aria-controls')
        $$('.elementor-tab-title, .elementor-tab-content', tabs).forEach(function (x) { x.classList.toggle('elementor-active', x.getAttribute('data-tab') === id); if (x.classList.contains('elementor-tab-content')) x.style.display = x.getAttribute('data-tab') === id ? 'block' : 'none' })
      })
    })
  })
  $$('.elementor-accordion-item .elementor-tab-title, .elementor-toggle-item .elementor-tab-title').forEach(function (t) {
    t.addEventListener('click', function () {
      var c = t.nextElementSibling
      var on = !t.classList.contains('elementor-active')
      t.classList.toggle('elementor-active', on)
      if (c) { c.classList.toggle('elementor-active', on); c.style.display = on ? 'block' : 'none' }
    })
  })
  // lazy iframes (Elementor video widget placeholders)
  $$('.elementor-widget-video[data-settings]').forEach(function (w) {
    if ($('iframe', w)) return
    var s = {}; try { s = JSON.parse(w.getAttribute('data-settings')) } catch (e) {}
    var url = s.youtube_url || s.vimeo_url
    var box = $('.elementor-video', w)
    if (!url || !box) return
    var m = url.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/)
    var src = m ? 'https://www.youtube.com/embed/' + m[1] : url.replace('vimeo.com/', 'player.vimeo.com/video/')
    box.innerHTML = '<iframe class="elementor-video-iframe" allowfullscreen allow="clipboard-write; encrypted-media; picture-in-picture" title="video" src="' + src + '" style="width:100%;aspect-ratio:16/9;border:0"></iframe>'
  })

  /* ------------------------------------------------------------ product page: tabs, gallery, lightbox, quantity, variations */
  $$('.wc-tabs-wrapper').forEach(function (w) {
    var links = $$('.wc-tabs li a', w)
    links.forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault()
        $$('.wc-tabs li', w).forEach(function (li) { li.classList.remove('active') })
        a.parentNode.classList.add('active')
        $$('.wc-tab', w).forEach(function (p) { p.style.display = '#' + p.id === a.getAttribute('href') ? '' : 'none' })
      })
    })
  })
  $$('.flexy-container').forEach(function (fc) {
    var items = $$('.flexy-item', fc)
    var pills = $$('.flexy-pills li', fc)
    var view = $('.flexy-items', fc)
    var i = 0
    if (!items.length || !view) return
    view.style.display = 'flex'; view.style.transition = 'transform .3s ease'
    items.forEach(function (it) { it.style.flex = '0 0 100%'; it.style.maxWidth = '100%' })
    $('.flexy-view', fc).style.overflow = 'hidden'
    function go(n) {
      i = (n + items.length) % items.length
      view.style.transform = 'translateX(' + (-100 * i) + '%)'
      pills.forEach(function (p, k) { p.classList.toggle('active', k === i) })
    }
    pills.forEach(function (p, k) { p.addEventListener('click', function () { go(k) }) })
    var pv = $('.flexy-arrow-prev', fc), nx = $('.flexy-arrow-next', fc)
    if (pv) pv.addEventListener('click', function () { go(i - 1) })
    if (nx) nx.addEventListener('click', function () { go(i + 1) })
    var x0 = null
    view.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX }, { passive: true })
    view.addEventListener('touchend', function (e) { if (x0 === null) return; var dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1)); x0 = null })
  })
  var lb = null, lbItems = [], lbIdx = 0
  function closeLightbox() { if (lb) { lb.remove(); lb = null; d.documentElement.style.overflow = '' } }
  function renderLb() {
    var it = lbItems[lbIdx]
    lb.querySelector('img').src = it.src
    lb.querySelector('.dayinup-lb-count').textContent = (lbIdx + 1) + ' / ' + lbItems.length
  }
  function openLightbox(list, idx) {
    lbItems = list; lbIdx = idx
    lb = d.createElement('div'); lb.className = 'dayinup-lightbox'; lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-label', '圖片燈箱')
    lb.innerHTML = '<button class="dayinup-lb-close" aria-label="關閉">×</button>' + (list.length > 1 ? '<button class="dayinup-lb-prev" aria-label="上一張">‹</button><button class="dayinup-lb-next" aria-label="下一張">›</button>' : '') + '<img alt=""><span class="dayinup-lb-count"></span>'
    body.appendChild(lb); d.documentElement.style.overflow = 'hidden'
    renderLb()
    lb.addEventListener('click', function (e) {
      if (e.target.classList.contains('dayinup-lb-prev')) { lbIdx = (lbIdx - 1 + lbItems.length) % lbItems.length; renderLb() }
      else if (e.target.classList.contains('dayinup-lb-next')) { lbIdx = (lbIdx + 1) % lbItems.length; renderLb() }
      else if (e.target.tagName !== 'IMG') closeLightbox()
    })
  }
  d.addEventListener('keydown', function (e) {
    if (!lb) return
    if (e.key === 'ArrowLeft') { lbIdx = (lbIdx - 1 + lbItems.length) % lbItems.length; renderLb() }
    if (e.key === 'ArrowRight') { lbIdx = (lbIdx + 1) % lbItems.length; renderLb() }
  })
  $$('.woocommerce-product-gallery').forEach(function (g) {
    var figs = $$('figure[data-src]', g)
    var list = figs.map(function (f) { return { src: f.getAttribute('data-src') } })
    figs.forEach(function (f, k) { f.style.cursor = 'zoom-in'; f.addEventListener('click', function () { openLightbox(list, k) }) })
  })
  // quantity +/- (Blocksy type-2)
  d.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.quantity .ct-increase, .quantity .ct-decrease')
    if (!b) return
    var inp = $('input.qty', b.closest('.quantity'))
    var v = parseInt(inp.value || '1', 10) || 1
    var min = parseInt(inp.min || '1', 10) || 1
    var max = parseInt(inp.max || '0', 10) || 0
    v += b.classList.contains('ct-increase') ? 1 : -1
    if (v < min) v = min
    if (max && v > max) v = max
    inp.value = v
    inp.dispatchEvent(new Event('change', { bubbles: true }))
  })

  function notice(form, html, type) {
    var wrap = $('.woocommerce-notices-wrapper') || form
    wrap.innerHTML = '<div class="woocommerce-' + (type || 'message') + '" role="alert">' + html + '</div>'
    wrap.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  $$('form.variations_form').forEach(function (form) {
    var vars = []
    try { vars = JSON.parse(form.getAttribute('data-product_variations') || '[]') } catch (e) {}
    var sel = $('select', form)
    var radios = $$('.variation-radios input[type=radio]', form)
    var wrap = $('.single_variation', form)
    var btnWrap = $('.woocommerce-variation-add-to-cart', form)
    var btn = $('.single_add_to_cart_button', form)
    var reset = $('.reset_variations', form)
    var vid = $('input.variation_id', form)
    var mainColor = btn ? getComputedStyle(btn).backgroundColor : '#1877F2'
    function paint() {
      $$('.tag-list label', form).forEach(function (l) { l.style.backgroundColor = '#efefef'; l.style.color = '#000' })
      var c = $('.tag-list input:checked + label', form)
      if (c) { c.style.backgroundColor = mainColor; c.style.color = '#fff' }
    }
    function update() {
      var val = sel.value
      var key = sel.getAttribute('data-attribute_name')
      var v = vars.find(function (x) { return x.attributes[key] === val })
      if (!val || !v) {
        wrap.style.display = 'none'; wrap.innerHTML = ''
        vid.value = '0'
        btn.classList.add('disabled', 'wc-variation-selection-needed')
        btnWrap.classList.add('woocommerce-variation-add-to-cart-disabled'); btnWrap.classList.remove('woocommerce-variation-add-to-cart-enabled')
        reset.style.visibility = 'hidden'
        return
      }
      vid.value = v.variation_id
      wrap.innerHTML = '<div class="woocommerce-variation-description"></div><div class="woocommerce-variation-price">' + v.price_html + '</div><div class="woocommerce-variation-availability">' + (v.availability_html || '') + (v.discount_html || '') + '</div>'
      wrap.style.display = ''
      var ok = v.is_in_stock && v.is_purchasable
      btn.classList.toggle('disabled', !ok); btn.classList.remove('wc-variation-selection-needed')
      btn.classList.toggle('wc-variation-is-unavailable', !ok)
      btnWrap.classList.toggle('woocommerce-variation-add-to-cart-disabled', !ok); btnWrap.classList.toggle('woocommerce-variation-add-to-cart-enabled', ok)
      var q = $('input.qty', form); if (q) { q.max = v.max_qty || '' }
      reset.style.visibility = 'visible'
      if (v.image && v.image.src) { var im = $('.woocommerce-product-gallery img'); if (im) { if (v.image.srcset) im.srcset = v.image.srcset; else im.removeAttribute('srcset'); im.src = v.image.src } }
    }
    radios.forEach(function (r) { r.addEventListener('change', function () { sel.value = r.value; paint(); update() }) })
    $$('.tag-list label', form).forEach(function (l) { l.addEventListener('click', function () { var r = d.getElementById(l.getAttribute('for')); if (r) { r.checked = true; sel.value = r.value; paint(); update() } }) })
    sel.addEventListener('change', function () { radios.forEach(function (r) { r.checked = r.value === sel.value }); paint(); update() })
    reset.addEventListener('click', function (e) { e.preventDefault(); sel.value = ''; radios.forEach(function (r) { r.checked = false }); paint(); update() })
    paint(); update()
  })

  // add to cart (single product forms + loop ajax buttons)
  function addToCart(pid, vid, qty, attrs) {
    return api('/api/cart/', { method: 'POST', body: JSON.stringify({ product_id: pid, variation_id: vid || null, quantity: qty, variation: attrs || {} }) })
  }
  $$('form[data-dayinup-cart]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault()
      var btn = $('.single_add_to_cart_button', form)
      if (btn.classList.contains('disabled')) {
        if (btn.classList.contains('wc-variation-selection-needed')) alert('在加入購物車前，請先選擇商品選項。')
        else alert('抱歉，這項商品無法購買。請選擇不同的組合。')
        return
      }
      var pid = form.getAttribute('data-product_id')
      var vid = ($('input.variation_id', form) || {}).value
      var qty = parseInt(($('input.qty', form) || {}).value || '1', 10) || 1
      var attrs = {}
      var s = $('select[data-attribute_name]', form)
      if (s) attrs[decodeURIComponent(s.getAttribute('data-attribute_name').replace(/^attribute_/, ''))] = s.value
      btn.classList.add('loading')
      addToCart(pid, vid, qty, attrs).then(function (r) {
        btn.classList.remove('loading')
        if (r.ok) {
          var title = ($('.product_title') || {}).textContent || ''
          notice(form, '<a href="/cart/" tabindex="1" class="button wc-forward">查看購物車</a> 「' + title.replace(/[<>&]/g, '') + '」已加入您的購物車中。', 'message')
          updateCartBadge(r.cart)
        } else {
          notice(form, (r.error || '無法加入購物車').replace(/[<>&]/g, ''), 'error')
        }
      })
    })
  })
  d.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a.ajax_add_to_cart')
    if (!a) return
    e.preventDefault()
    a.classList.add('loading')
    addToCart(a.getAttribute('data-product_id'), null, 1).then(function (r) {
      a.classList.remove('loading')
      if (r.ok) { a.classList.add('added'); a.insertAdjacentHTML('afterend', ' <a href="/cart/" class="added_to_cart wc-forward" title="查看購物車">查看購物車</a>'); updateCartBadge(r.cart) }
      else alert(r.error || '無法加入購物車')
    })
  })

  function updateCartBadge(cart) {
    if (!cart) return
    $$('.ct-dynamic-count-cart').forEach(function (b) { b.textContent = cart.count; b.setAttribute('data-count', cart.count) })
    $$('.ct-header-cart .ct-amount').forEach(function (b) { b.innerHTML = moneyHtml(cart.total) })
    $$('.ct-cart-content').forEach(function (c) { c.setAttribute('data-count', cart.count) })
  }
  window.dayinup.updateCartBadge = updateCartBadge

  // product ordering select
  $$('form[data-dayinup-ordering] select').forEach(function (s) { s.addEventListener('change', function () { s.form.submit() }) })
  $$('form[data-dayinup-catfilter] select').forEach(function (s) { s.addEventListener('change', function () { var o = new URLSearchParams(location.search).get('orderby'); location.href = s.value + (o ? '?orderby=' + encodeURIComponent(o) : '') }) })

  /* ------------------------------------------------------------ session state (account icon + cart count) */
  api('/api/session/').then(function (r) {
    if (r.cart) updateCartBadge(r.cart)
    if (r.user) {
      body.dataset.loggedIn = '1'
      $$('.ct-header-account').forEach(function (h) {
        h.setAttribute('data-state', 'in')
        var a = $('a', h); if (a) { a.setAttribute('href', '/my-account/'); a.setAttribute('aria-label', '我的帳號') }
      })
    }
  })

  /* ------------------------------------------------------------ account modal (login / register / lost password) */
  var am = $('#account-modal')
  if (am) {
    function showForm(which) {
      $$('.ct-account-forms > div', am).forEach(function (f) { f.classList.remove('active') })
      var f = $('.ct-' + which + '-form', am); if (f) f.classList.add('active')
      $$('.ct-account-modal > ul li', am).forEach(function (li) { li.classList.toggle('active', li.classList.contains('ct-' + which)) })
    }
    am.addEventListener('click', function (e) {
      var t = e.target
      if (t.closest('li.ct-login') || t.closest('.ct-back-to-login')) { e.preventDefault(); showForm('login') }
      else if (t.closest('li.ct-register')) { e.preventDefault(); showForm('register') }
      else if (t.closest('.ct-forgot-password')) { e.preventDefault(); showForm('forgot-password') }
    })
    $$('.show-password-input', am).forEach(function (s) { s.addEventListener('click', function () { var i = s.previousElementSibling; i.type = i.type === 'password' ? 'text' : 'password'; s.classList.toggle('display-password') }) })
  }
  function formMsg(form, msg, ok) {
    var box = $('.dayinup-form-msg', form)
    if (!box) { box = d.createElement('div'); box.className = 'dayinup-form-msg'; form.insertBefore(box, form.firstChild) }
    box.className = 'dayinup-form-msg ' + (ok ? 'woocommerce-message' : 'woocommerce-error')
    box.setAttribute('role', 'alert')
    box.textContent = msg
  }
  window.dayinup.formMsg = formMsg
  function bindAuth(sel, url, pick, after) {
    $$(sel).forEach(function (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault()
        var btn = $('button', form); if (btn) btn.classList.add('ct-loading')
        api(url, { method: 'POST', body: JSON.stringify(pick(form)) }).then(function (r) {
          if (btn) btn.classList.remove('ct-loading')
          if (r.ok) { formMsg(form, r.message || '完成', true); if (after) after(r) }
          else formMsg(form, r.error || '發生錯誤，請稍後再試。', false)
        })
      })
    })
  }
  bindAuth('#loginform', '/api/auth/login/', function (f) { return { login: f.log.value, password: f.pwd.value, remember: f.rememberme && f.rememberme.checked } }, function () { location.reload() })
  bindAuth('#registerform', '/api/auth/register/', function (f) { return { username: f.user_login.value, email: f.user_email.value, attribution: attribution() } })
  bindAuth('form.dayinup-register', '/api/auth/register/', function (f) { return { username: f.user_login.value, email: f.user_email.value, attribution: attribution() } })
  bindAuth('#lostpasswordform', '/api/auth/lost-password/', function (f) { return { user_login: f.user_login.value } })

  /* ------------------------------------------------------------ generic forms → /api/forms/<slug>/ */
  function serialize(form) {
    var o = {}
    new FormData(form).forEach(function (v, k) { if (typeof v === 'string') { if (o[k] !== undefined) { o[k] = [].concat(o[k], v) } else o[k] = v } })
    return o
  }
  d.addEventListener('submit', function (e) {
    var form = e.target
    var slug = form.getAttribute('data-dayinup-form')
    if (!slug && form.classList.contains('elementor-form')) slug = 'elementor-form'
    if (!slug) return
    e.preventDefault()
    var data = serialize(form)
    data.__page = location.pathname
    var btn = $('[type=submit]', form); if (btn) btn.disabled = true
    api('/api/forms/' + slug + '/', { method: 'POST', body: JSON.stringify(data) }).then(function (r) {
      if (btn) btn.disabled = false
      if (r.ok) { formMsg(form, r.message || '已送出，謝謝！', true); form.reset() }
      else formMsg(form, r.error || '送出失敗，請稍後再試。', false)
    })
  }, true)

  /* ------------------------------------------------------------ order attribution (wc_order_attribution_*) */
  function attribution() {
    try {
      var key = 'dayinup_attr'
      var a = JSON.parse(sessionStorage.getItem(key) || 'null')
      if (!a) {
        var q = new URLSearchParams(location.search)
        a = {
          source_type: q.get('utm_source') ? 'utm' : (d.referrer && d.referrer.indexOf(location.host) < 0 ? 'referral' : 'typein'),
          referrer: d.referrer || '', utm_campaign: q.get('utm_campaign') || '', utm_source: q.get('utm_source') || '', utm_medium: q.get('utm_medium') || '',
          utm_content: q.get('utm_content') || '', utm_id: q.get('utm_id') || '', utm_term: q.get('utm_term') || '',
          session_entry: location.href, session_start_time: new Date().toISOString(), session_pages: 0, user_agent: navigator.userAgent,
        }
      }
      a.session_pages = (a.session_pages || 0) + (window.__dayinupCounted ? 0 : 1)
      window.__dayinupCounted = true
      sessionStorage.setItem(key, JSON.stringify(a))
      return a
    } catch (e) { return {} }
  }
  window.dayinup.attribution = attribution
  attribution()
})()
