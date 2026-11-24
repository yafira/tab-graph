// tab graph. window in the middle, a hub for each site with more than one tab,
// a node for every tab, and a pink line from a tab to the tab it was opened from

const api = typeof browser !== 'undefined' ? browser : chrome
const $ = (id) => document.getElementById(id)
const canvas = $('canvas')
const ctx = canvas.getContext('2d')
const peek = $('peek')
const list = $('list')

let nodes = []
let links = []
let index = {}
let colors = {}
let family = 'monospace'
let w = 0, h = 0, dpr = 1
let k = 1, tx = 0, ty = 0
let heat = 0
let raf = 0
let hover = null
let query = ''
let fitted = false
let selfId = null
let shown = []
let view = 'graph'
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches

// favicons load once and are kept
const icons = new Map()
function icon(url) {
  if (!url || url.startsWith('chrome:')) return null
  let entry = icons.get(url)
  if (!entry) {
    entry = { img: new Image(), ok: false }
    entry.img.onload = () => { entry.ok = true; draw() }
    entry.img.src = url
    icons.set(url, entry)
  }
  return entry.ok ? entry.img : null
}

function readColors() {
  const css = getComputedStyle(document.documentElement)
  for (const key of ['bg', 'surface', 'ink', 'muted', 'line', 'thread']) colors[key] = css.getPropertyValue('--' + key).trim()
  family = getComputedStyle(document.body).fontFamily
}

// which site a tab belongs to
function site(url) {
  try {
    const u = new URL(url)
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.hostname.replace(/^www\./, '')
    if (u.protocol === 'about:') return u.pathname === 'blank' || u.pathname === 'newtab' || u.pathname === 'home' ? 'new tab' : 'about'
    return u.protocol.replace(':', '')
  } catch (err) {
    return 'new tab'
  }
}

// a steady starting angle per id, so new nodes don't all pile up in one spot
function angle(id) {
  let n = 0
  for (const ch of String(id)) n = (n * 31 + ch.charCodeAt(0)) % 3600
  return (n / 3600) * Math.PI * 2
}

function build(tabs) {
  const old = index
  nodes = []
  links = []
  index = {}

  function add(id, near, spread, props) {
    const prev = old[id]
    const a = angle(id)
    const node = {
      id,
      x: prev ? prev.x : (near ? near.x : 0) + Math.cos(a) * spread,
      y: prev ? prev.y : (near ? near.y : 0) + Math.sin(a) * spread,
      vx: 0, vy: 0,
      ...props
    }
    nodes.push(node)
    index[id] = node
    return node
  }

  const windows = [...new Set(tabs.map((t) => t.windowId))]
  windows.forEach((id, i) => {
    add('w' + id, { x: i * 500, y: 0 }, 0, {
      kind: 'win', r: 9, charge: 60,
      label: windows.length > 1 ? 'window ' + (i + 1) : 'tabs'
    })
  })

  // group each window's tabs by site
  const groups = {}
  for (const t of tabs) {
    const key = t.windowId + ' ' + site(t.url)
    ;(groups[key] = groups[key] || []).push(t)
  }

  let sites = 0
  shown = []
  for (const key in groups) {
    const list = groups[key]
    const win = index['w' + list[0].windowId]
    const host = site(list[0].url)
    let parent = win
    if (list.length > 1) {
      sites += 1
      const fav = list.find((t) => t.favIconUrl)
      parent = add('s' + key, win, 160, { kind: 'site', r: 12, charge: 40, label: host, fav: fav && fav.favIconUrl, count: list.length })
      links.push({ a: win.id, b: parent.id, kind: 'spoke', len: 130 + 9 * Math.sqrt(list.length) })
    }
    shown.push({ key, host, tabs: list, hub: list.length > 1 ? 's' + key : null, win: windows.length > 1 ? windows.indexOf(list[0].windowId) + 1 : 0 })
    for (const t of list) {
      const alone = list.length === 1
      add('t' + t.id, parent, alone ? 110 : 40, {
        kind: 'tab', tab: t, alone, host,
        r: alone ? 10 : 4.5, charge: alone ? 26 : 12,
        label: alone ? host : ''
      })
      links.push({ a: parent.id, b: 't' + t.id, kind: alone ? 'spoke' : 'leaf', len: alone ? 95 : 26 + 5 * Math.sqrt(list.length) })
    }
  }

  // tabs that were opened from another tab that is still open
  for (const t of tabs) {
    if (t.openerTabId != null && index['t' + t.openerTabId]) {
      links.push({ a: 't' + t.openerTabId, b: 't' + t.id, kind: 'thread', len: 70 })
    }
  }

  const count = (n, word) => n + ' ' + word + (n === 1 ? '' : 's')
  $('counts').textContent = [count(tabs.length, 'tab'), count(Object.keys(groups).length, 'site'), count(windows.length, 'window')].join(' · ')
  $('empty').hidden = tabs.length > 0 || view === 'list'
}

function tick() {
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]
      let dx = b.x - a.x, dy = b.y - a.y
      let d2 = dx * dx + dy * dy
      if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.5 }
      const d = Math.sqrt(d2)
      let f = (a.charge * b.charge) / d2
      const gap = a.r + b.r + 7
      if (d < gap) f += (gap - d) * 0.2
      const fx = (dx / d) * f, fy = (dy / d) * f
      a.vx -= fx; a.vy -= fy
      b.vx += fx; b.vy += fy
    }
  }
  for (const l of links) {
    const a = index[l.a], b = index[l.b]
    const dx = b.x - a.x, dy = b.y - a.y
    const d = Math.sqrt(dx * dx + dy * dy) || 1
    // opener lines only tug gently so they don't pull sites apart
    const pull = (d - l.len) * (l.kind === 'thread' ? 0.004 : l.kind === 'leaf' ? 0.08 : 0.03)
    const fx = (dx / d) * pull, fy = (dy / d) * pull
    a.vx += fx; a.vy += fy
    b.vx -= fx; b.vy -= fy
  }
  for (const n of nodes) {
    if (n.held) { n.vx = 0; n.vy = 0; continue }
    n.vx -= n.x * 0.002
    n.vy -= n.y * 0.002
    n.vx *= 0.8; n.vy *= 0.8
    n.x += n.vx; n.y += n.vy
  }
}

function fit() {
  if (!nodes.length) return
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const n of nodes) {
    x0 = Math.min(x0, n.x - 60); x1 = Math.max(x1, n.x + 60)
    y0 = Math.min(y0, n.y - 20); y1 = Math.max(y1, n.y + 40)
  }
  k = Math.min((w - 24) / (x1 - x0), (h - 44) / (y1 - y0), 1.6)
  tx = w / 2 - ((x0 + x1) / 2) * k
  ty = h / 2 - 10 - ((y0 + y1) / 2) * k
}

function matches(n) {
  if (!query || n.kind !== 'tab') return false
  return ((n.tab.title || '') + ' ' + (n.tab.url || '')).toLowerCase().includes(query)
}

function clip(text, max) {
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

function draw() {
  if (!w) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  ctx.translate(tx, ty)
  ctx.scale(k, k)
  ctx.lineCap = 'round'
  const thin = 1 / Math.min(k, 1)

  for (const l of links) {
    const a = index[l.a], b = index[l.b]
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.lineWidth = (l.kind === 'thread' ? 1.4 : l.kind === 'leaf' ? 0.7 : 1) * thin
    ctx.strokeStyle = l.kind === 'thread' ? colors.thread : colors.line
    ctx.stroke()
  }

  // labels stay between 10 and 13 pixels on screen however far you zoom
  const size = Math.min(Math.max(11, 10 / k), 13 / k)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.lineJoin = 'round'

  for (const n of nodes) {
    const hot = n === hover
    const found = matches(n)
    const faded = query && n.kind === 'tab' && !found
    ctx.globalAlpha = faded ? 0.25 : 1

    if (n.kind === 'win') {
      ctx.beginPath()
      ctx.arc(n.x, n.y, n.r, 0, 7)
      ctx.fillStyle = colors.thread
      ctx.fill()
    } else if (n.kind === 'site' || n.alone) {
      // a round badge with the site's favicon in it
      ctx.beginPath()
      ctx.arc(n.x, n.y, n.r, 0, 7)
      ctx.fillStyle = colors.surface
      ctx.fill()
      ctx.lineWidth = hot || found ? 2.2 : 1.3
      ctx.strokeStyle = hot || found ? colors.thread : n.kind === 'site' ? colors.ink : colors.muted
      ctx.stroke()
      const img = icon(n.kind === 'site' ? n.fav : n.tab.favIconUrl)
      const s = n.r * 1.15
      if (img) {
        try { ctx.drawImage(img, n.x - s / 2, n.y - s / 2, s, s) } catch (err) {}
      } else {
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r * 0.3, 0, 7)
        ctx.fillStyle = colors.muted
        ctx.fill()
      }
    } else {
      ctx.beginPath()
      ctx.arc(n.x, n.y, n.r, 0, 7)
      // tabs the browser has put to sleep are drawn hollow
      if (n.tab.discarded) {
        ctx.fillStyle = colors.bg
        ctx.fill()
        ctx.lineWidth = 1.2
        ctx.strokeStyle = hot || found ? colors.thread : colors.muted
        ctx.stroke()
      } else {
        ctx.fillStyle = hot || found ? colors.thread : colors.muted
        ctx.fill()
      }
    }

    // a ring around the tab that's showing in its window
    if (n.kind === 'tab' && n.tab.active) {
      ctx.beginPath()
      ctx.arc(n.x, n.y, n.r + 3.5, 0, 7)
      ctx.lineWidth = 1.4
      ctx.strokeStyle = colors.thread
      ctx.stroke()
    }

    const text = n.label
    if (text) {
      ctx.font = (n.kind === 'tab' && !found ? '400 ' : '600 ') + size + 'px ' + family
      ctx.lineWidth = 4
      ctx.strokeStyle = colors.bg
      ctx.fillStyle = found ? colors.thread : n.kind === 'tab' ? colors.muted : colors.ink
      ctx.strokeText(text, n.x, n.y + n.r + 5)
      ctx.fillText(text, n.x, n.y + n.r + 5)
    }
  }
  ctx.globalAlpha = 1
}

function loop() {
  raf = 0
  if (heat > 0) {
    tick()
    heat -= 1
  }
  draw()
  if (heat > 0) raf = requestAnimationFrame(loop)
}

function warm(amount) {
  if (calm) {
    for (let i = 0; i < amount; i++) tick()
    heat = 0
  } else {
    heat = Math.max(heat, amount)
  }
  if (!raf) raf = requestAnimationFrame(loop)
}

function resize() {
  const box = canvas.getBoundingClientRect()
  if (!box.width || !box.height) return
  w = box.width; h = box.height
  dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  if (!fitted && nodes.length) { fit(); fitted = true }
  draw()
}

function at(px, py) {
  const x = (px - tx) / k, y = (py - ty) / k
  const slack = Math.max(4, 6 / k)
  let best = null, bestD = Infinity
  for (const n of nodes) {
    const d = Math.hypot(n.x - x, n.y - y) - n.r
    if (d < slack && d < bestD) { best = n; bestD = d }
  }
  return best
}

function showPeek(n, px, py) {
  if (!n || n.kind === 'win') { peek.hidden = true; return }
  const [title, sub] = peek.children
  if (n.kind === 'site') {
    title.textContent = n.label
    sub.textContent = n.count + ' tabs'
  } else {
    title.textContent = n.tab.title || 'untitled'
    sub.textContent = clip((n.tab.url || '').replace(/^https?:\/\/(www\.)?/, ''), 70)
  }
  peek.hidden = false
  peek.style.left = Math.max(8, Math.min(px + 14, w - peek.offsetWidth - 8)) + 'px'
  peek.style.top = Math.max(8, Math.min(py + 14, h - peek.offsetHeight - 8)) + 'px'
}

// pointer handling
let drag = null
let moved = 0

function local(e) {
  const box = canvas.getBoundingClientRect()
  return [e.clientX - box.left, e.clientY - box.top]
}

canvas.addEventListener('pointerdown', (e) => {
  closeMenu()
  if (e.button !== 0) return
  canvas.setPointerCapture(e.pointerId)
  const [px, py] = local(e)
  const node = at(px, py)
  drag = { node, px, py }
  moved = 0
  if (node) node.held = true
  canvas.classList.add('grabbing')
  peek.hidden = true
})

canvas.addEventListener('pointermove', (e) => {
  const [px, py] = local(e)
  if (drag) {
    const dx = px - drag.px, dy = py - drag.py
    moved += Math.abs(dx) + Math.abs(dy)
    drag.px = px; drag.py = py
    if (drag.node) {
      drag.node.x += dx / k
      drag.node.y += dy / k
      warm(40)
    } else {
      tx += dx; ty += dy
      draw()
    }
    return
  }
  if (!menu.hidden) return
  const node = at(px, py)
  if (node !== hover) {
    hover = node
    canvas.classList.toggle('over', !!node && node.kind === 'tab')
    draw()
  }
  showPeek(node, px, py)
})

async function release(e) {
  canvas.classList.remove('grabbing')
  if (!drag) return
  const { node } = drag
  if (node) node.held = false
  drag = null
  if (moved > 6 || !node || node.kind !== 'tab') return
  try {
    if (e.shiftKey) {
      await api.tabs.remove(node.tab.id)
    } else {
      await api.tabs.update(node.tab.id, { active: true })
      await api.windows.update(node.tab.windowId, { focused: true })
    }
  } catch (err) {
    // the tab was already gone. the next refresh clears it
    refresh()
  }
}
canvas.addEventListener('pointerup', release)
canvas.addEventListener('pointercancel', release)
canvas.addEventListener('pointerleave', () => { hover = null; peek.hidden = true; draw() })

canvas.addEventListener('wheel', (e) => {
  e.preventDefault()
  const [px, py] = local(e)
  const next = Math.min(5, Math.max(0.15, k * Math.exp(-e.deltaY * 0.0015)))
  tx = px - ((px - tx) / k) * next
  ty = py - ((py - ty) / k) * next
  k = next
  draw()
}, { passive: false })

// the right-click menu. the same things the tab strip lets you do
const menu = $('menu')

function closeMenu() {
  menu.hidden = true
}

// run a tab action, and if the tab is already gone just redraw
async function act(fn) {
  closeMenu()
  try {
    await fn()
  } catch (err) {}
  later()
}

function item(label, fn, danger) {
  const b = document.createElement('button')
  b.textContent = label
  b.setAttribute('role', 'menuitem')
  if (danger) b.className = 'danger'
  b.onclick = () => act(fn)
  return b
}

function head(text) {
  const d = document.createElement('div')
  d.className = 'head'
  d.textContent = text
  return d
}

function goTo(t) {
  return api.tabs.update(t.id, { active: true }).then(() => api.windows.update(t.windowId, { focused: true }))
}

function openMenu(node, px, py) {
  const rule = () => document.createElement('hr')
  const parts = []
  if (node && node.kind === 'tab') {
    const t = node.tab
    const muted = t.mutedInfo && t.mutedInfo.muted
    parts.push(
      head(t.title || node.host),
      item('go to tab', () => goTo(t)),
      item('reload', () => api.tabs.reload(t.id)),
      item('duplicate', () => api.tabs.duplicate(t.id)),
      item(t.pinned ? 'unpin' : 'pin', () => api.tabs.update(t.id, { pinned: !t.pinned })),
      item(muted ? 'unmute' : 'mute', () => api.tabs.update(t.id, { muted: !muted })),
      item('move to a new window', () => api.windows.create({ tabId: t.id })),
      item('copy link', () => navigator.clipboard.writeText(t.url || ''))
    )
    if (!t.active && !t.discarded) parts.push(item('put to sleep', () => api.tabs.discard(t.id)))
    parts.push(rule(), item('close tab', () => api.tabs.remove(t.id), true))
  } else if (node && node.kind === 'site') {
    const tabs = nodes.filter((n) => n.kind === 'tab' && links.some((l) => l.a === node.id && l.b === n.id)).map((n) => n.tab)
    const ids = tabs.map((t) => t.id)
    parts.push(
      head(node.label + ' · ' + ids.length + ' tabs'),
      item('reload all ' + ids.length, () => Promise.all(ids.map((id) => api.tabs.reload(id)))),
      item('put all to sleep', () => api.tabs.discard(tabs.filter((t) => !t.active).map((t) => t.id))),
      item('move all to a new window', async () => {
        const win = await api.windows.create({ tabId: ids[0] })
        if (ids.length > 1) await api.tabs.move(ids.slice(1), { windowId: win.id, index: -1 })
      }),
      rule(),
      item('close all ' + ids.length + ' tabs', () => api.tabs.remove(ids), true)
    )
  } else {
    parts.push(item('new tab', () => api.tabs.create({})))
    if (api.sessions) parts.push(item('reopen closed tab', () => api.sessions.restore()))
  }
  menu.replaceChildren(...parts)
  menu.hidden = false
  const box = menu.parentElement.getBoundingClientRect()
  menu.style.left = Math.max(8, Math.min(px, box.width - menu.offsetWidth - 8)) + 'px'
  menu.style.top = Math.max(8, Math.min(py, box.height - menu.offsetHeight - 8)) + 'px'
  const firstButton = menu.querySelector('button')
  if (firstButton) firstButton.focus({ preventScroll: true })
}

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  const [px, py] = local(e)
  peek.hidden = true
  openMenu(at(px, py), px, py)
})
addEventListener('blur', closeMenu)

// search. / jumps to the box, escape clears it
$('q').addEventListener('input', (e) => {
  query = e.target.value.trim().toLowerCase()
  draw()
  drawList()
})
addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== $('q')) {
    e.preventDefault()
    $('q').focus()
  }
  // delete or backspace closes the tab under the pointer
  if ((e.key === 'Delete' || e.key === 'Backspace') && document.activeElement !== $('q') && hover && hover.kind === 'tab') {
    e.preventDefault()
    const id = hover.tab.id
    act(() => api.tabs.remove(id))
  }
  if (e.key === 'Escape' && !menu.hidden) {
    closeMenu()
    return
  }
  if (e.key === 'Escape') {
    $('q').value = ''
    query = ''
    $('q').blur()
    draw()
    drawList()
  }
})

// list view. the same tabs as rows, grouped by site, biggest groups first
function el(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

function drawList() {
  if (view !== 'list') return
  const inner = el('div', 'inner')
  const groups = shown.slice().sort((a, b) => b.tabs.length - a.tabs.length || a.host.localeCompare(b.host))
  for (const g of groups) {
    const tabs = g.tabs.filter((t) => !query || ((t.title || '') + ' ' + (t.url || '')).toLowerCase().includes(query))
    if (!tabs.length) continue
    const group = el('div', 'group')
    const head = el('div', 'ghead')
    const fav = g.tabs.find((t) => t.favIconUrl && !t.favIconUrl.startsWith('chrome:'))
    if (fav) {
      const img = el('img')
      img.alt = ''
      img.src = fav.favIconUrl
      img.onerror = () => img.replaceWith(el('span', 'noicon'))
      head.append(img)
    } else {
      head.append(el('span', 'noicon'))
    }
    head.append(el('span', 'name', g.host + (g.win ? ' · window ' + g.win : '')))
    head.append(el('span', 'n', g.tabs.length > 1 ? g.tabs.length + ' tabs' : ''))
    if (g.tabs.length > 1) {
      const all = el('button', '', 'close all')
      const ids = g.tabs.map((t) => t.id)
      all.onclick = () => act(() => api.tabs.remove(ids))
      head.append(all)
      head.oncontextmenu = (e) => {
        e.preventDefault()
        const box = list.parentElement.getBoundingClientRect()
        openMenu(index[g.hub], e.clientX - box.left, e.clientY - box.top)
      }
    }
    group.append(head)
    for (const t of tabs) {
      const row = el('div', 'row' + (t.active ? ' active' : '') + (t.discarded ? ' asleep' : ''))
      const go = el('button', 'go')
      go.title = t.url || ''
      go.append(el('span', 'mark'), el('span', 'title', t.title || 'untitled'))
      const flags = [t.pinned && 'pinned', t.mutedInfo && t.mutedInfo.muted && 'muted', t.discarded && 'asleep'].filter(Boolean).join(' · ')
      if (flags) go.append(el('span', 'flags', flags))
      go.onclick = () => act(() => goTo(t))
      const x = el('button', 'x', '×')
      x.setAttribute('aria-label', 'close ' + (t.title || 'tab'))
      x.onclick = () => act(() => api.tabs.remove(t.id))
      row.oncontextmenu = (e) => {
        e.preventDefault()
        const box = list.parentElement.getBoundingClientRect()
        openMenu(index['t' + t.id], e.clientX - box.left, e.clientY - box.top)
      }
      row.append(go, x)
      group.append(row)
    }
    inner.append(group)
  }
  if (!inner.children.length) inner.append(el('p', 'none', query ? 'no tabs match that search.' : 'no other tabs are open.'))
  const top = list.scrollTop
  list.replaceChildren(inner)
  list.scrollTop = top
}

// switching between graph and list. the choice is remembered
function setView(next) {
  view = next
  canvas.hidden = view !== 'graph'
  $('legend').hidden = view !== 'graph'
  list.hidden = view !== 'list'
  if (view === 'list') $('empty').hidden = true
  peek.hidden = true
  closeMenu()
  $('view-graph').setAttribute('aria-pressed', view === 'graph')
  $('view-list').setAttribute('aria-pressed', view === 'list')
  try { localStorage.setItem('tab-graph-view', view) } catch (err) {}
  drawList()
}
$('view-graph').onclick = () => setView('graph')
$('view-list').onclick = () => setView('list')
list.addEventListener('scroll', closeMenu)
addEventListener('pointerdown', (e) => {
  if (!menu.hidden && !menu.contains(e.target)) closeMenu()
})

// reading tabs, and keeping up as they change
let first = true
let timer = 0

async function refresh() {
  const all = await api.tabs.query({})
  const tabs = all.filter((t) => t.id !== selfId)
  build(tabs)
  drawList()
  if (first) {
    first = false
    // settle before the first frame so the page opens at rest
    for (let i = 0; i < 400; i++) tick()
    if (w) { fit(); fitted = true }
    draw()
  } else {
    warm(140)
  }
}

function later() {
  clearTimeout(timer)
  timer = setTimeout(refresh, 150)
}

async function start() {
  readColors()
  new ResizeObserver(resize).observe(canvas)
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); draw() })
  try {
    const me = await api.tabs.getCurrent()
    selfId = me ? me.id : null
  } catch (err) {}
  try {
    if (localStorage.getItem('tab-graph-view') === 'list') setView('list')
  } catch (err) {}
  await refresh()
  for (const name of ['onCreated', 'onRemoved', 'onUpdated', 'onActivated', 'onAttached', 'onDetached', 'onReplaced']) {
    if (api.tabs[name]) api.tabs[name].addListener(later)
  }
}

start()
