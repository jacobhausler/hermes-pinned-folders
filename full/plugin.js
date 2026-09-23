/**
 * pinned-folders: a PINNED tab in the Desktop sidebar that files your pinned
 * chats into folders, nested to any depth.
 *
 * - Pins come from the backend's own pinned flag (all profiles). A new pin
 *   lands in "Unsorted"; the folder layout never changes a pin.
 * - Folders: drag to reorder or nest, rename, color, delete (contents move up
 *   a level). Chats: drag between folders, or ⋯ / right-click → Move to.
 * - Collapsed folders show unread and agent-working activity from inside.
 * - Filter box, "Open all as tabs", layout export/import via the clipboard.
 * - Layout is local to this app, one copy per connection (ctx.storage).
 *
 * Two builds come from this one file. Blocks between `// #full` and `// #end`
 * reach past the plugin SDK (unpin, auto-pin chats you start, hide core's
 * flat Pinned list); scripts/build.mjs deletes them to make the catalog build
 * at desktop/plugin.js, which uses the SDK only.
 *
 * Plain ESM, loaded uncompiled: jsx()/jsxs() calls only.
 */

import {
  Button,
  Codicon,
  ColorSwatches,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DisclosureCaret,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  host,
  Input,
  PROFILE_SWATCHES,
  SearchField,
  SessionStatusDot,
  SidebarRowLead,
  // #full
  translateNow,
  // #end
  useValue
} from '@hermes/plugin-sdk'
import { useEffect, useMemo, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ROOT = null // "Unsorted": a chat with no folder
const POLL_MS = 4000
const POLL_HIDDEN_MS = 15000

let store = null // ctx.storage, set in register()
let os = null // ctx.os (clipboard), set in register()

// ── pure tree ops (exported for tests) ───────────────────────────────────────

const empty = () => ({ folders: [], placed: {}, order: [], collapsed: {}, foldersOrdered: true })

// Folder order is the user's (array order). Layouts saved before manual
// ordering existed were shown alphabetically, so sort them once on load.
// Every write after that saves the flag, and the sort never runs again.
export function normalize(v) {
  if (!v || typeof v !== 'object') return empty()
  let folders = Array.isArray(v.folders) ? v.folders.filter(f => f && typeof f.id === 'string') : []
  if (v.foldersOrdered !== true) folders = [...folders].sort(byName)
  return {
    folders,
    placed: v.placed && typeof v.placed === 'object' ? v.placed : {},
    order: Array.isArray(v.order) ? v.order : [],
    collapsed: v.collapsed && typeof v.collapsed === 'object' ? v.collapsed : {},
    foldersOrdered: true
  }
}

const newId = () => 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

function isDescendant(t, id, ancestor) {
  const byId = new Map(t.folders.map(f => [f.id, f]))
  for (let cur = byId.get(id), hops = 0; cur && hops < 1000; cur = byId.get(cur.parent), hops++) {
    if (cur.id === ancestor) return true
  }
  return false
}

export const ops = {
  addFolder(t, parent, name, id = newId()) {
    const collapsed = { ...t.collapsed }
    if (parent) delete collapsed[parent]
    return { ...t, folders: [...t.folders, { id, name, parent: parent ?? null }], collapsed }
  },
  rename(t, id, name) {
    const clean = String(name || '').trim()
    if (!clean) return t
    return { ...t, folders: t.folders.map(f => (f.id === id ? { ...f, name: clean } : f)) }
  },
  // Children and chats move up to the deleted folder's parent — nothing is lost.
  deleteFolder(t, id) {
    const gone = t.folders.find(f => f.id === id)
    if (!gone) return t
    const up = gone.parent ?? null
    const placed = {}
    for (const [sid, fid] of Object.entries(t.placed)) {
      const next = fid === id ? up : fid
      if (next) placed[sid] = next
    }
    const collapsed = { ...t.collapsed }
    delete collapsed[id]
    return {
      ...t,
      folders: t.folders.filter(f => f.id !== id).map(f => (f.parent === id ? { ...f, parent: up } : f)),
      placed,
      collapsed
    }
  },
  // Refuses cycles: a folder can't move into itself or its own subtree.
  // Folder order = array order among siblings, so a moved folder goes last.
  moveFolder(t, id, parent) {
    parent = parent ?? null
    if (parent === id || (parent && isDescendant(t, parent, id))) return t
    const self = t.folders.find(f => f.id === id)
    if (!self) return t
    const collapsed = { ...t.collapsed }
    if (parent) delete collapsed[parent]
    return { ...t, folders: [...t.folders.filter(f => f.id !== id), { ...self, parent }], collapsed }
  },
  // Drop a folder before/after a sibling (taking that sibling's parent).
  placeFolder(t, id, targetId, pos) {
    if (id === targetId) return t
    const self = t.folders.find(f => f.id === id)
    const target = t.folders.find(f => f.id === targetId)
    if (!self || !target) return t
    if (pos === 'into') return ops.moveFolder(t, id, targetId)
    const parent = target.parent ?? null
    if (parent && (parent === id || isDescendant(t, parent, id))) return t
    const rest = t.folders.filter(f => f.id !== id)
    const at = rest.findIndex(f => f.id === targetId) + (pos === 'after' ? 1 : 0)
    rest.splice(at, 0, { ...self, parent })
    return { ...t, folders: rest }
  },
  placeSession(t, sid, folder, beforeSid) {
    const placed = { ...t.placed }
    if (folder) placed[sid] = folder
    else delete placed[sid]
    const order = t.order.filter(x => x !== sid)
    const at = beforeSid && beforeSid !== sid ? order.indexOf(beforeSid) : -1
    if (at >= 0) order.splice(at, 0, sid)
    else order.push(sid)
    return { ...t, placed, order }
  },
  forgetSession(t, sid) {
    if (!(sid in t.placed) && !t.order.includes(sid)) return t
    const placed = { ...t.placed }
    delete placed[sid]
    return { ...t, placed, order: t.order.filter(x => x !== sid) }
  },
  toggle(t, id) {
    const collapsed = { ...t.collapsed }
    if (collapsed[id]) delete collapsed[id]
    else collapsed[id] = true
    return { ...t, collapsed }
  },
  setColor(t, id, color) {
    return {
      ...t,
      folders: t.folders.map(f => {
        if (f.id !== id) return f
        const next = { ...f }
        if (color) next.color = String(color)
        else delete next.color
        return next
      })
    }
  }
}

// ── derived views (pure, exported for tests) ─────────────────────────────────

// Ancestor chain of a folder, nearest first.
function ancestorsOf(byId, fid) {
  const out = []
  for (let cur = byId.get(fid), hops = 0; cur && hops < 1000; cur = byId.get(cur.parent), hops++) out.push(cur)
  return out
}

// Per folder: how many chats anywhere beneath it are unread, and whether any
// was active recently. Feeds the badge on COLLAPSED folders.
export function folderActivity(t, rows) {
  const byId = new Map(t.folders.map(f => [f.id, f]))
  const out = new Map()
  for (const row of rows || []) {
    if (!row.unread && !row.is_active) continue
    const fid = t.placed[row.id]
    if (!fid || !byId.has(fid)) continue
    for (const f of ancestorsOf(byId, fid)) {
      const a = out.get(f.id) || { unread: 0, active: false }
      if (row.unread) a.unread++
      if (row.is_active) a.active = true
      out.set(f.id, a)
    }
  }
  return out
}

// Filter: a chat matches on its title/preview or on any enclosing folder's
// name. Folders stay visible when they match or hold a match.
export function filterView(t, rows, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return null
  const byId = new Map(t.folders.map(f => [f.id, f]))
  const hit = s => String(s || '').toLowerCase().includes(q)
  const folders = new Set()
  const chats = new Set()
  for (const f of t.folders) {
    if (hit(f.name)) ancestorsOf(byId, f.id).forEach(a => folders.add(a.id))
  }
  for (const row of rows || []) {
    const fid = t.placed[row.id]
    const chain = fid && byId.has(fid) ? ancestorsOf(byId, fid) : []
    if (hit(row.title) || hit(row.preview) || chain.some(f => hit(f.name))) {
      chats.add(row.id)
      chain.forEach(f => folders.add(f.id))
    }
  }
  return { folders, chats }
}

// ── export / import ──────────────────────────────────────────────────────────

const EXPORT_TAG = 'pinned-folders/layout@1'

export function exportLayout(t) {
  const { folders, placed, order } = t
  return JSON.stringify({ format: EXPORT_TAG, folders, placed, order }, null, 2)
}

// Throws with a readable message on anything that isn't an exported layout.
export function importLayout(text) {
  let v
  try {
    v = JSON.parse(String(text || ''))
  } catch {
    throw new Error('That is not valid JSON.')
  }
  if (!v || v.format !== EXPORT_TAG) throw new Error('That is not a Pinned folders layout export.')
  if (!Array.isArray(v.folders)) throw new Error('The layout has no folder list.')
  const folders = v.folders
    .filter(f => f && typeof f.id === 'string' && typeof f.name === 'string')
    .map(f => ({ id: f.id, name: f.name, parent: typeof f.parent === 'string' ? f.parent : null, ...(typeof f.color === 'string' ? { color: f.color } : {}) }))
  const ids = new Set(folders.map(f => f.id))
  for (const f of folders) if (f.parent && !ids.has(f.parent)) f.parent = null
  // Break any cycle a hand-edited file might carry.
  for (const f of folders) {
    const seen = new Set()
    for (let cur = f; cur?.parent; cur = folders.find(x => x.id === cur.parent)) {
      if (seen.has(cur.id)) {
        f.parent = null
        break
      }
      seen.add(cur.id)
    }
  }
  const placed = {}
  for (const [sid, fid] of Object.entries(v.placed && typeof v.placed === 'object' ? v.placed : {})) {
    if (typeof fid === 'string' && ids.has(fid)) placed[sid] = fid
  }
  const order = Array.isArray(v.order) ? v.order.filter(x => typeof x === 'string') : []
  return { folders, placed, order, collapsed: {}, foldersOrdered: true }
}

// Folder id for a chat, falling back to Unsorted when its folder was deleted.
function folderOf(t, ids, sid) {
  const fid = t.placed[sid]
  return fid && ids.has(fid) ? fid : ROOT
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })

// ── pinned rows: the backend's own pinned flag, all profiles ─────────────────
// limit=0 + include_pinned back-fill = exactly the pinned rows, nothing else.

// #full
// ── unpin ────────────────────────────────────────────────────────────────────
// Core has no plugin door for unpin. Unpinning takes three steps:
//  1. PATCH the durable flag (the same request core sends).
//  2. Scrub the id from core's localStorage pin list. That list is the copy
//     core's pin-sync pushes back as pinned=true when the row next loads.
//  3. Ping the sessions channel so core refreshes and its own pull drops the
//     in-memory pin.
// A tombstone keeps step 2 applied until the server confirms the unpin, and
// is dropped if the user re-pins the chat in core later.

const CORE_PIN_KEY = 'hermes.desktop.pinnedSessions'
const TOMBSTONE_MS = 60_000
const tombstones = new Map() // pinId -> unpinned-at

function pinIdsOf(row) {
  return [row.id, row._lineage_root_id].filter(Boolean)
}

export function scrubCorePins(storage, ids) {
  if (!ids.size) return 0
  let changed = 0
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key !== CORE_PIN_KEY && !key?.startsWith(CORE_PIN_KEY + '.remote.')) continue
    let list
    try {
      list = JSON.parse(storage.getItem(key))
    } catch {
      continue
    }
    if (!Array.isArray(list)) continue
    const next = list.filter(id => !ids.has(id))
    if (next.length !== list.length) {
      storage.setItem(key, JSON.stringify(next))
      changed++
    }
  }
  return changed
}

// Fresh tombstone: this page predates our PATCH. Old tombstone + pinned
// row: the user re-pinned it in core; honour that.
function tombstoned(s, now) {
  const ids = pinIdsOf(s)
  const at = Math.max(0, ...ids.map(id => tombstones.get(id) || 0))
  if (!at) return false
  if (now - at < TOMBSTONE_MS) return true
  ids.forEach(id => tombstones.delete(id))
  return false
}

function scrubTombstones() {
  try {
    scrubCorePins(window.localStorage, new Set(tombstones.keys()))
  } catch {}
}

function pingCoreSessions() {
  try {
    const ch = new BroadcastChannel('hermes:sessions')
    ch.postMessage(1)
    ch.close()
  } catch {}
}

async function unpinRow(row) {
  const bridge = window.hermesDesktop
  if (!bridge?.api) throw new Error('This Desktop build has no API bridge')
  const connectionId = host.activeConnectionId?.() || null
  const profile = row.profile || null
  await bridge.api({
    ...(connectionId ? { connectionId } : {}),
    ...(profile ? { profile } : {}),
    path: '/api/sessions/' + encodeURIComponent(row.id),
    method: 'PATCH',
    body: { pinned: false, ...(profile ? { profile } : {}) }
  })
  const now = Date.now()
  for (const id of pinIdsOf(row)) tombstones.set(id, now)
  scrubTombstones()
  pingCoreSessions()
}
// #end

// ── shared tree state (pane + auto-pin write through one door) ───────────────

const bus = new Set()
const onBus = fn => (bus.add(fn), () => bus.delete(fn))
const emit = ev => bus.forEach(fn => { try { fn(ev) } catch {} })
const treeKey = connectionId => 'tree.' + (connectionId || 'local')
const loadTree = key => normalize(store.get(key, null))

function mutateTree(key, fn) {
  const prev = loadTree(key)
  const next = fn(prev)
  if (next === prev) return
  store.set(key, next)
  emit({ type: 'tree', key, tree: next })
}

// #full
// ── auto-pin: chats YOU start in the composer ────────────────────────────────
// The composer middleware fires only for text typed in this app. Agents,
// workflows and cron never pass through it. On each send, the plugin resolves
// the focused chat's row. The chat is auto-pinned when it is a desktop chat
// born while this app watched it: its started_at is not older than when the
// chat first came into focus here. That excludes old chats you reopen. Every
// chat is judged once (the ids are persisted), so unpinning an auto-pinned
// chat is final.

const firstSeen = new Map() // stored id -> ms first focused in this run
const SEEN_SLACK_MS = 10_000
const RESOLVE_MS = 60_000
const RESOLVE_EVERY_MS = 2000

export function isFreshUserChat(row, seenAt) {
  if (!row || row.hidden || row.pinned) return false
  if (row.source && row.source !== 'desktop') return false
  if (row.parent_session_id) return false
  const born = (row.started_at || 0) * 1000
  return born >= seenAt - SEEN_SLACK_MS
}

function judged() {
  return new Set(store.get('autoJudged', []))
}

function markJudged(ids) {
  const list = [...judged(), ...ids.filter(Boolean)]
  store.set('autoJudged', [...new Set(list)].slice(-1000))
}

async function pinRow(row) {
  const bridge = window.hermesDesktop
  if (!bridge?.api) throw new Error('This Desktop build has no API bridge')
  const connectionId = host.activeConnectionId?.() || null
  const profile = row.profile || null
  await bridge.api({
    ...(connectionId ? { connectionId } : {}),
    ...(profile ? { profile } : {}),
    path: '/api/sessions/' + encodeURIComponent(row.id),
    method: 'PATCH',
    body: { pinned: true, ...(profile ? { profile } : {}) }
  })
  pinIdsOf(row).forEach(id => tombstones.delete(id))
  pingCoreSessions() // core's pin-sync adopts server pins it hasn't seen
}

async function resolveAndAutoPin(idAtSend, sentAt) {
  const deadline = sentAt + RESOLVE_MS
  while (Date.now() < deadline) {
    const id = idAtSend || host.state.focusedStoredSessionId.get()
    if (id) {
      if (judged().has(id)) return
      const res = await host.listPersistedSessions(null, { profile: 'all', limit: 100 }).catch(() => null)
      const row = (res?.sessions || []).find(s => s.id === id || s._lineage_root_id === id)
      if (row) {
        markJudged(pinIdsOf(row))
        if (!isFreshUserChat(row, firstSeen.get(id) ?? sentAt)) return
        await pinRow(row)
        const folder = store.get('autoFolder', null)
        const key = treeKey(host.state.connectionId.get())
        const ids = new Set(loadTree(key).folders.map(f => f.id))
        mutateTree(key, t => ops.placeSession(t, row.id, folder && ids.has(folder) ? folder : ROOT))
        emit({ type: 'rows' })
        return
      }
    }
    await new Promise(r => setTimeout(r, RESOLVE_EVERY_MS))
  }
}

function onUserSend(draft) {
  if (store.get('autoPin', true) && !String(draft?.text || '').trim().startsWith('/')) {
    const id = host.state.focusedStoredSessionId.get()
    resolveAndAutoPin(id, Date.now()).catch(err => console.error('[pinned-folders] auto-pin failed', err))
  }
  return draft
}
// #end

function usePinnedRows(scope) {
  const [state, setState] = useState({ rows: null, error: null })
  const refresh = useRef(() => {})

  useEffect(() => {
    let alive = true
    let timer = 0
    setState({ rows: null, error: null })

    const tick = async () => {
      clearTimeout(timer)
      try {
        const res = await host.listPersistedSessions(null, { profile: 'all', limit: 0 })
        const seen = new Set()
        const rows = (res?.sessions || []).filter(s => {
          if (!s.pinned || seen.has(s.id)) return false
          seen.add(s.id)
          // #full
          if (tombstoned(s, Date.now())) return false
          // #end
          return true
        })
        // #full
        scrubTombstones()
        // #end
        if (alive) setState({ rows, error: null })
      } catch (err) {
        if (alive) setState(prev => ({ rows: prev.rows, error: String(err?.message || err) }))
      }
      if (alive) timer = setTimeout(tick, document.hidden ? POLL_HIDDEN_MS : POLL_MS)
    }

    refresh.current = tick
    tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [scope])

  const dropRow = id =>
    setState(prev => ({ ...prev, rows: prev.rows ? prev.rows.filter(r => r.id !== id) : prev.rows }))

  return { ...state, dropRow, refresh: () => refresh.current() }
}

// #full
// ── hide core's flat Pinned section (DOM, opt-out toggle) ────────────────────

let hideObserver = null
let hideRaf = 0
const hiddenGroups = new Set()

function corePinnedGroups() {
  const label = String(translateNow('sidebar.pinned') || 'Pinned').trim().toLowerCase()
  const out = []
  document.querySelectorAll('[data-sidebar="group"]').forEach(group => {
    if (group.closest('[data-pinned-folders]')) return
    const text = group.firstElementChild?.querySelector('span.truncate')?.textContent
    if (text && text.trim().toLowerCase() === label) out.push(group)
  })
  return out
}

function syncHidden(on) {
  for (const g of [...hiddenGroups]) {
    if (!on || !g.isConnected) {
      g.style.display = ''
      hiddenGroups.delete(g)
    }
  }
  if (!on) return
  for (const g of corePinnedGroups()) {
    if (!hiddenGroups.has(g)) {
      g.style.display = 'none'
      hiddenGroups.add(g)
    }
  }
}

function applyHideCore(on) {
  hideObserver?.disconnect()
  hideObserver = null
  cancelAnimationFrame(hideRaf)
  hideRaf = 0
  syncHidden(on)
  if (!on) return
  hideObserver = new MutationObserver(() => {
    if (hideRaf) return
    hideRaf = requestAnimationFrame(() => {
      hideRaf = 0
      syncHidden(true)
    })
  })
  hideObserver.observe(document.body, { childList: true, subtree: true })
}
// #end

// ── UI ───────────────────────────────────────────────────────────────────────

const rowStyle = (depth, extra) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minHeight: 28,
  paddingLeft: 4 + depth * 14,
  paddingRight: 2,
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: '0.8125rem',
  userSelect: 'none',
  ...extra
})

const dropStyle = on => (on ? { boxShadow: 'inset 0 0 0 1px var(--theme-primary)' } : null)

function IconButton({ icon, title, onClick }) {
  return jsx('button', {
    type: 'button',
    title,
    'aria-label': title,
    className: 'text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground',
    style: { display: 'grid', placeItems: 'center', width: 22, height: 22, borderRadius: 4, flexShrink: 0 },
    onClick: e => {
      e.stopPropagation()
      onClick?.(e)
    },
    children: jsx(Codicon, { name: icon, size: '0.875rem' })
  })
}

const DROPDOWN = { Item: DropdownMenuItem, Separator: DropdownMenuSeparator }
const CONTEXT = { Item: ContextMenuItem, Separator: ContextMenuSeparator }

// One item list feeds both the ⋯ dropdown and the right-click menu.
// Item shapes: '-' | { header } | { swatches, value, onChange } | { label, icon, onSelect, … }
function menuChildren(items, kit) {
  return items.filter(Boolean).map((it, i) => {
    if (it === '-') return jsx(kit.Separator, {}, 'sep' + i)
    if (it.header)
      return jsx(
        'div',
        { style: { padding: '4px 8px 2px', fontSize: '0.6875rem' }, className: 'text-(--ui-text-tertiary)', children: it.header },
        'h' + i
      )
    if (it.swatches)
      return jsx(
        'div',
        {
          style: { padding: '4px 8px 6px', width: 176 },
          onClick: e => e.stopPropagation(),
          children: jsx(ColorSwatches, {
            swatches: PROFILE_SWATCHES,
            value: it.value || null,
            onChange: it.onChange,
            clearLabel: 'Default color'
          })
        },
        'sw' + i
      )
    return jsx(
      kit.Item,
      {
        disabled: it.disabled,
        variant: it.destructive ? 'destructive' : 'default',
        onSelect: it.onSelect,
        style: it.indent ? { paddingLeft: 8 + it.indent * 12 } : undefined,
        children: [
          it.icon ? jsx(Codicon, { name: it.icon, size: '0.8125rem' }, 'i') : null,
          jsx('span', { children: it.label }, 'l')
        ]
      },
      'm' + i
    )
  })
}

function RowMenu({ items, icon = 'ellipsis', label = 'Actions' }) {
  return jsxs(DropdownMenu, {
    children: [
      jsx(DropdownMenuTrigger, {
        asChild: true,
        children: jsx('button', {
          type: 'button',
          'aria-label': label,
          title: label,
          className: 'text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground',
          style: { display: 'grid', placeItems: 'center', width: 20, height: 20, borderRadius: 4, flexShrink: 0 },
          onClick: e => e.stopPropagation(),
          children: jsx(Codicon, { name: icon, size: '0.875rem' })
        })
      }),
      jsx(DropdownMenuContent, {
        align: 'end',
        style: { maxHeight: '60vh', overflowY: 'auto' },
        onClick: e => e.stopPropagation(),
        children: menuChildren(items, DROPDOWN)
      })
    ]
  })
}

// Right-click wrapper. A row's menu sets defaultPrevented on the event, so an
// enclosing wrapper (the list's empty-space menu) does not also open.
function WithContextMenu({ items, children }) {
  return jsxs(ContextMenu, {
    children: [
      jsx(ContextMenuTrigger, { asChild: true, children }),
      jsx(ContextMenuContent, {
        style: { maxHeight: '60vh', overflowY: 'auto' },
        onClick: e => e.stopPropagation(),
        children: menuChildren(items, CONTEXT)
      })
    ]
  })
}

function ImportDialog({ open, onOpenChange, onImport }) {
  const [text, setText] = useState('')
  const [error, setError] = useState(null)
  useEffect(() => {
    if (open) {
      setText('')
      setError(null)
    }
  }, [open])
  const submit = () => {
    try {
      onImport(importLayout(text))
      onOpenChange(false)
    } catch (err) {
      setError(String(err?.message || err))
    }
  }
  return jsx(Dialog, {
    open,
    onOpenChange,
    children: jsxs(DialogContent, {
      children: [
        jsxs(DialogHeader, {
          children: [
            jsx(DialogTitle, { children: 'Import folder layout' }, 't'),
            jsx(
              DialogDescription,
              { children: 'Paste a layout copied with "Export layout". It replaces the folders on this connection. Your pins are not changed.' },
              'd'
            )
          ]
        }, 'h'),
        jsx('textarea', {
          value: text,
          autoFocus: true,
          spellCheck: false,
          placeholder: '{ "format": "' + EXPORT_TAG + '", … }',
          onChange: e => setText(e.target.value),
          className: 'border border-(--ui-border) bg-transparent text-foreground',
          style: { width: '100%', minHeight: 160, borderRadius: 6, padding: 8, fontFamily: 'var(--font-mono, monospace)', fontSize: '0.75rem', resize: 'vertical' }
        }, 'ta'),
        error ? jsx('div', { className: 'text-destructive', style: { fontSize: '0.75rem' }, children: error }, 'err') : null,
        jsxs(DialogFooter, {
          children: [
            jsx(Button, { variant: 'ghost', onClick: () => onOpenChange(false), children: 'Cancel' }, 'c'),
            jsx(Button, { disabled: !text.trim(), onClick: submit, children: 'Replace layout' }, 'ok')
          ]
        }, 'f')
      ]
    })
  })
}

function NameInput({ initial, onDone }) {
  const ref = useRef(null)
  const done = useRef(false)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const finish = value => {
    if (done.current) return
    done.current = true
    onDone(value)
  }
  return jsx(Input, {
    ref,
    defaultValue: initial,
    size: 'sm',
    style: { height: 22, fontSize: '0.8125rem', flex: 1, minWidth: 0 },
    onClick: e => e.stopPropagation(),
    onKeyDown: e => {
      e.stopPropagation()
      if (e.key === 'Enter') finish(e.currentTarget.value)
      if (e.key === 'Escape') finish(null)
    },
    onBlur: e => finish(e.currentTarget.value)
  })
}

function PinnedPane() {
  const connectionId = useValue(host.state.connectionId)
  const focused = useValue(host.state.focusedStoredSessionId)
  const key = treeKey(connectionId)

  const [tree, setTreeRaw] = useState(() => loadTree(key))
  useEffect(() => {
    setTreeRaw(loadTree(key))
    return onBus(ev => ev.type === 'tree' && ev.key === key && setTreeRaw(ev.tree))
  }, [key])
  const setTree = fn => mutateTree(key, fn)

  const { rows, error, dropRow, refresh: refreshRows } = usePinnedRows(key)
  useEffect(() => onBus(ev => ev.type === 'rows' && refreshRows()), [key])
  const [editing, setEditing] = useState(null)
  // #full
  const [hideCore, setHideCore] = useState(() => store.get('hideCore', true))
  const [autoPin, setAutoPin] = useState(() => store.get('autoPin', true))
  const [autoFolder, setAutoFolder] = useState(() => store.get('autoFolder', null))
  const setAutoFolderPersist = id => {
    setAutoFolder(id)
    store.set('autoFolder', id)
  }
  // #end
  const [dropAt, setDropAt] = useState(null)
  const [query, setQuery] = useState('')
  const [importing, setImporting] = useState(false)
  const drag = useRef(null)

  const folderIds = useMemo(() => new Set(tree.folders.map(f => f.id)), [tree.folders])
  const view = useMemo(() => filterView(tree, rows, query), [tree, rows, query])
  const activity = useMemo(() => folderActivity(tree, rows), [tree, rows])

  const childFolders = useMemo(() => {
    const m = new Map()
    for (const f of tree.folders) {
      const p = f.parent && folderIds.has(f.parent) ? f.parent : ROOT
      if (!m.has(p)) m.set(p, [])
      m.get(p).push(f)
    }
    return m
  }, [tree.folders, folderIds])

  const sessionsIn = useMemo(() => {
    const m = new Map()
    const rank = new Map(tree.order.map((sid, i) => [sid, i]))
    for (const row of rows || []) {
      const fid = folderOf(tree, folderIds, row.id)
      if (!m.has(fid)) m.set(fid, [])
      m.get(fid).push(row)
    }
    for (const list of m.values()) {
      list.sort(
        (a, b) =>
          (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) ||
          (b.last_active || b.started_at || 0) - (a.last_active || a.started_at || 0)
      )
    }
    return m
  }, [rows, tree, folderIds])

  const countIn = id => {
    let n = (sessionsIn.get(id) || []).length
    for (const f of childFolders.get(id) || []) n += countIn(f.id)
    return n
  }

  // Flattened folder list with depth, for "Move to…" menus.
  const flat = useMemo(() => {
    const out = []
    const walk = (parent, depth) => {
      for (const f of childFolders.get(parent) || []) {
        out.push({ f, depth })
        walk(f.id, depth + 1)
      }
    }
    walk(ROOT, 0)
    return out
  }, [childFolders])

  const newFolder = parent => {
    const id = newId()
    setQuery('')
    setTree(t => ops.addFolder(t, parent, 'New folder', id))
    setEditing(id)
  }

  const openRow = (row, intent) =>
    host
      .openSession(row.id, { profile: row.profile || undefined, ...(intent ? { intent } : {}) })
      .catch(err => host.notifyError(err, 'Could not open that chat'))

  // Every chat beneath a folder, in display order (its own, then subfolders').
  const chatsBeneath = fid => [
    ...(sessionsIn.get(fid) || []),
    ...(childFolders.get(fid) || []).flatMap(c => chatsBeneath(c.id))
  ]

  // Sequential on purpose: each open settles before the next tab is made.
  const openAllAsTabs = async fid => {
    for (const row of chatsBeneath(fid)) await openRow(row, 'tab')
  }

  const exportToClipboard = async () => {
    const ok = await (os?.writeClipboard(exportLayout(tree)) ?? Promise.resolve(false))
    host.notify(
      ok
        ? { kind: 'success', title: 'Layout copied', message: 'Paste it into Import layout on another machine.' }
        : { kind: 'error', title: 'Could not copy the layout', message: 'The clipboard is not available here.' }
    )
  }

  const layoutItems = [
    { label: 'New folder', icon: 'new-folder', onSelect: () => newFolder(ROOT) },
    '-',
    { label: 'Export layout (copy JSON)', icon: 'export', onSelect: exportToClipboard },
    { label: 'Import layout…', icon: 'desktop-download', onSelect: () => setImporting(true) }
  ]

  // #full
  const toggleHideCore = () => {
    const next = !hideCore
    setHideCore(next)
    store.set('hideCore', next)
    applyHideCore(next)
  }
  // #end

  // ── drag and drop ──
  const dragProps = (kind, id) => ({
    draggable: editing == null,
    onDragStart: e => {
      drag.current = { kind, id }
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', id)
      e.stopPropagation()
    },
    onDragEnd: () => {
      drag.current = null
      setDropAt(null)
    }
  })

  const dropProps = (target, accept, commit) => ({
    onDragOver: e => {
      const d = drag.current
      if (!d || !accept(d)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      if (dropAt !== target) setDropAt(target)
    },
    onDragLeave: e => {
      if (!e.currentTarget.contains(e.relatedTarget) && dropAt === target) setDropAt(null)
    },
    onDrop: e => {
      const d = drag.current
      drag.current = null
      setDropAt(null)
      if (!d || !accept(d)) return
      e.preventDefault()
      e.stopPropagation()
      commit(d)
    }
  })

  const intoFolder = fid =>
    dropProps(
      'f:' + (fid ?? 'root'),
      d => d.kind === 'session' || (d.id !== fid && !(fid && isDescendant(tree, fid, d.id))),
      d =>
        setTree(t =>
          d.kind === 'session' ? ops.placeSession(t, d.id, fid) : ops.moveFolder(t, d.id, fid)
        )
    )

  // Folder header drop: a chat always goes INTO the folder. A folder dropped
  // on the top quarter of the header goes before it, on the bottom quarter
  // after it, and in the middle into it.
  const zoneOf = (e, d) => {
    if (d.kind !== 'folder') return 'into'
    const r = e.currentTarget.getBoundingClientRect()
    const y = (e.clientY - r.top) / (r.height || 1)
    return y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'into'
  }
  const canPlace = (d, fid, zone) => {
    if (d.kind === 'session') return true
    if (d.id === fid || isDescendant(tree, fid, d.id)) return false
    return true
  }
  const folderDrop = fid => ({
    onDragOver: e => {
      const d = drag.current
      if (!d) return
      const zone = zoneOf(e, d)
      if (!canPlace(d, fid, zone)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      const target = 'f:' + fid + ':' + zone
      if (dropAt !== target) setDropAt(target)
    },
    onDragLeave: e => {
      if (!e.currentTarget.contains(e.relatedTarget) && dropAt?.startsWith('f:' + fid + ':')) setDropAt(null)
    },
    onDrop: e => {
      const d = drag.current
      const zone = d ? zoneOf(e, d) : null
      drag.current = null
      setDropAt(null)
      if (!d || !canPlace(d, fid, zone)) return
      e.preventDefault()
      e.stopPropagation()
      setTree(t => (d.kind === 'session' ? ops.placeSession(t, d.id, fid) : ops.placeFolder(t, d.id, fid, zone)))
    }
  })
  const folderDropStyle = fid =>
    dropAt === 'f:' + fid + ':into'
      ? dropStyle(true)
      : dropAt === 'f:' + fid + ':before'
        ? { boxShadow: 'inset 0 2px 0 var(--theme-primary)' }
        : dropAt === 'f:' + fid + ':after'
          ? { boxShadow: 'inset 0 -2px 0 var(--theme-primary)' }
          : null

  // ── rows ──
  const sessionRow = (row, depth) => {
    if (view && !view.chats.has(row.id)) return null
    const fid = folderOf(tree, folderIds, row.id)
    const items = [
      { label: 'Open', icon: 'go-to-file', onSelect: () => openRow(row) },
      { label: 'Open in new tab', icon: 'split-horizontal', onSelect: () => openRow(row, 'tab') },
      '-',
      { header: 'Move to' },
      { label: 'Unsorted', icon: 'inbox', disabled: fid === ROOT, onSelect: () => setTree(t => ops.placeSession(t, row.id, ROOT)) },
      ...flat.map(({ f, depth: d }) => ({
        label: f.name,
        icon: 'folder',
        indent: d,
        disabled: f.id === fid,
        onSelect: () => setTree(t => ops.placeSession(t, row.id, f.id))
      })),
      // #full
      '-',
      {
        label: 'Unpin',
        icon: 'pinned',
        onSelect: () => {
          dropRow(row.id)
          setTree(t => ops.forgetSession(t, row.id))
          unpinRow(row).catch(err => {
            host.notifyError(err, 'Could not unpin that chat')
            refreshRows()
          })
        }
      }
      // #end
    ]
    const active = focused && focused === row.id
    const el = jsxs(
      'div',
      {
        ...dragProps('session', row.id),
        ...dropProps(
          's:' + row.id,
          d => d.kind === 'session' && d.id !== row.id,
          d => setTree(t => ops.placeSession(t, d.id, fid, row.id))
        ),
        className: 'hover:bg-(--ui-control-hover-background)',
        style: rowStyle(depth, {
          ...(active ? { background: 'var(--ui-row-active-background)' } : null),
          ...(dropAt === 's:' + row.id ? { boxShadow: 'inset 0 2px 0 var(--theme-primary)' } : null)
        }),
        title: row.title || row.preview || row.id,
        onClick: e => openRow(row, e.metaKey || e.ctrlKey ? 'tab' : undefined),
        children: [
          jsx(SidebarRowLead, { children: jsx(SessionStatusDot, { storedSessionId: row.id, session: row }) }, 'dot'),
          jsx(
            'span',
            {
              style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
              children: row.title || row.preview || 'Untitled'
            },
            'title'
          ),
          jsx(RowMenu, { items }, 'menu')
        ]
      }
    )
    return jsx(WithContextMenu, { items, children: el }, 's:' + row.id)
  }

  const folderRow = (f, depth) => {
    if (view && !view.folders.has(f.id)) return []
    // While filtering, every surviving folder shows open so matches are visible.
    const open = view ? true : !tree.collapsed[f.id]
    const moveTargets = flat.filter(({ f: o }) => o.id !== f.id && !isDescendant(tree, o.id, f.id))
    const total = countIn(f.id)
    const items = [
      { label: 'Open all as tabs' + (total ? ` (${total})` : ''), icon: 'multiple-windows', disabled: !total, onSelect: () => openAllAsTabs(f.id) },
      '-',
      { label: 'New subfolder', icon: 'new-folder', onSelect: () => newFolder(f.id) },
      // #full
      autoFolder === f.id
        ? { label: 'Stop sending new chats here', icon: 'close', onSelect: () => setAutoFolderPersist(null) }
        : { label: 'New chats land here', icon: 'sparkle', onSelect: () => setAutoFolderPersist(f.id) },
      // #end
      { label: 'Rename', icon: 'edit', onSelect: () => setEditing(f.id) },
      '-',
      { header: 'Color' },
      { swatches: true, value: f.color, onChange: c => setTree(t => ops.setColor(t, f.id, c)) },
      '-',
      { header: 'Move into' },
      { label: 'Top level', icon: 'root-folder', disabled: !f.parent, onSelect: () => setTree(t => ops.moveFolder(t, f.id, ROOT)) },
      ...moveTargets.map(({ f: o, depth: d }) => ({
        label: o.name,
        icon: 'folder',
        indent: d,
        disabled: o.id === f.parent,
        onSelect: () => setTree(t => ops.moveFolder(t, f.id, o.id))
      })),
      '-',
      { label: 'Delete folder (keeps its chats)', icon: 'trash', destructive: true, onSelect: () => setTree(t => ops.deleteFolder(t, f.id)) }
    ]
    // Activity badge: only on a CLOSED folder — an open one shows its own dots.
    const act = !open ? activity.get(f.id) : null
    const badge = act
      ? jsxs(
          'span',
          {
            title: [act.unread ? `${act.unread} unread` : null, act.active ? 'agent working inside' : null].filter(Boolean).join(' · '),
            style: { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.6875rem', flexShrink: 0 },
            children: [
              act.active
                ? jsx('span', { style: { width: 6, height: 6, borderRadius: 9999, background: 'var(--ui-accent)' } }, 'a')
                : null,
              act.unread
                ? jsxs('span', {
                    style: { display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--ui-success)' },
                    children: [jsx('span', { style: { width: 6, height: 6, borderRadius: 9999, background: 'var(--ui-success)' } }, 'd'), act.unread]
                  }, 'u')
                : null
            ]
          },
          'act'
        )
      : null
    const header = jsxs(
      'div',
      {
        ...dragProps('folder', f.id),
        ...folderDrop(f.id),
        className: 'hover:bg-(--ui-control-hover-background)',
        style: rowStyle(depth, folderDropStyle(f.id)),
        onClick: () => editing !== f.id && !view && setTree(t => ops.toggle(t, f.id)),
        onDoubleClick: e => {
          e.stopPropagation()
          setEditing(f.id)
        },
        children: [
          jsx(DisclosureCaret, { open, className: 'text-(--ui-text-tertiary)' }, 'caret'),
          jsx(
            Codicon,
            {
              name: open ? 'folder-opened' : 'folder',
              size: '0.875rem',
              className: f.color ? undefined : 'text-(--ui-text-tertiary)',
              style: f.color ? { color: f.color } : undefined
            },
            'icon'
          ),
          editing === f.id
            ? jsx(
                NameInput,
                {
                  initial: f.name,
                  onDone: value => {
                    setEditing(null)
                    if (value != null) setTree(t => ops.rename(t, f.id, value))
                  }
                },
                'edit'
              )
            : jsx(
                'span',
                {
                  style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 },
                  children: f.name
                },
                'name'
              ),
          // #full
          autoFolder === f.id
            ? jsx('span', { title: 'New chats land here', className: 'text-(--ui-text-tertiary)', style: { display: 'grid', placeItems: 'center' }, children: jsx(Codicon, { name: 'sparkle', size: '0.75rem' }) }, 'auto')
            : null,
          // #end
          badge,
          jsx('span', { className: 'text-(--ui-text-quaternary)', style: { fontSize: '0.6875rem' }, children: total || '' }, 'n'),
          jsx(RowMenu, { items }, 'menu')
        ]
      }
    )
    const wrapped = jsx(WithContextMenu, { items, children: header }, 'fh:' + f.id)
    if (!open) return [wrapped]
    return [
      wrapped,
      ...(childFolders.get(f.id) || []).flatMap(c => folderRow(c, depth + 1)),
      ...(sessionsIn.get(f.id) || []).map(r => sessionRow(r, depth + 1)).filter(Boolean)
    ]
  }

  const unsorted = sessionsIn.get(ROOT) || []
  const unsortedShown = view ? unsorted.filter(r => view.chats.has(r.id)) : unsorted
  const unsortedOpen = view ? true : !tree.collapsed.__unsorted
  const unsortedRows = view && !unsortedShown.length ? [] : [
    jsxs(
      'div',
      {
        ...intoFolder(ROOT),
        className: 'hover:bg-(--ui-control-hover-background)',
        style: rowStyle(0, dropStyle(dropAt === 'f:root')),
        onClick: () => !view && setTree(t => ops.toggle(t, '__unsorted')),
        children: [
          jsx(DisclosureCaret, { open: unsortedOpen, className: 'text-(--ui-text-tertiary)' }, 'caret'),
          jsx(Codicon, { name: 'inbox', size: '0.875rem', className: 'text-(--ui-text-tertiary)' }, 'icon'),
          jsx('span', { style: { flex: 1, fontWeight: 500 }, className: 'text-(--ui-text-secondary)', children: 'Unsorted' }, 'name'),
          jsx('span', { className: 'text-(--ui-text-quaternary)', style: { fontSize: '0.6875rem', paddingRight: 24 }, children: unsorted.length || '' }, 'n')
        ]
      },
      'unsorted'
    ),
    ...(unsortedOpen ? unsortedShown.map(r => sessionRow(r, 1)).filter(Boolean) : [])
  ]

  const note = text =>
    jsx('div', { className: 'text-(--ui-text-tertiary)', style: { padding: '8px 10px', fontSize: '0.75rem' }, children: text }, 'note')

  let body
  if (rows == null && !error) {
    body = [note('Loading pinned chats…')]
  } else if (rows == null) {
    body = [note('Could not load pinned chats: ' + error)]
  } else {
    body = [...(childFolders.get(ROOT) || []).flatMap(f => folderRow(f, 0)), ...unsortedRows]
    if (rows.length === 0) body.push(note('No pinned chats yet. Pin one in Sessions (⋯ → Pin); it lands in Unsorted.'))
    else if (view && !body.length) body.push(note('Nothing matches “' + query.trim() + '”.'))
  }

  return jsxs('div', {
    'data-pinned-folders': '',
    style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 },
    children: [
      jsxs(
        'div',
        {
          style: { display: 'flex', alignItems: 'center', gap: 2, padding: '6px 6px 4px 10px', flexShrink: 0 },
          children: [
            jsx(
              'span',
              {
                style: { flex: 1, fontSize: '0.64rem', fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--theme-primary)' },
                children: 'Pinned folders'
              },
              'label'
            ),
            // #full
            jsx(IconButton, { icon: autoPin ? 'pinned' : 'pin', title: autoPin ? 'Auto-pin chats I start: ON' : 'Auto-pin chats I start: OFF', onClick: () => { const next = !autoPin; setAutoPin(next); store.set('autoPin', next) } }, 'auto'),
            jsx(IconButton, { icon: hideCore ? 'eye-closed' : 'eye', title: hideCore ? 'Show core Pinned list in Sessions' : 'Hide core Pinned list in Sessions', onClick: toggleHideCore }, 'hide'),
            // #end
            jsx(IconButton, { icon: 'new-folder', title: 'New folder', onClick: () => newFolder(ROOT) }, 'new'),
            jsx(RowMenu, { items: layoutItems, icon: 'kebab-vertical', label: 'More' }, 'more')
          ]
        },
        'head'
      ),
      rows && rows.length
        ? jsx(
            'div',
            {
              style: { padding: '0 10px 4px', flexShrink: 0, display: 'flex' },
              children: jsx(SearchField, {
                placeholder: 'Filter folders and chats',
                value: query,
                onChange: setQuery,
                containerClassName: 'w-full'
              })
            },
            'filter'
          )
        : null,
      jsx(
        WithContextMenu,
        {
          items: layoutItems,
          children: jsx('div', {
            style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 6px 8px' },
            children: [...body, error && rows ? jsx('div', { className: 'text-(--ui-text-quaternary)', style: { padding: '6px 10px', fontSize: '0.6875rem' }, children: 'Refresh failed; showing last list.' }, 'stale') : null]
          })
        },
        'list'
      ),
      jsx(ImportDialog, { open: importing, onOpenChange: setImporting, onImport: next => mutateTree(key, () => next) }, 'import')
    ]
  })
}

export default {
  id: 'pinned-folders',
  name: 'Pinned folders',
  description: 'A PINNED sidebar tab that files pinned chats into nested folders.',
  register(ctx) {
    store = ctx.storage
    os = ctx.os
    // #full
    applyHideCore(store.get('hideCore', true))
    ctx.onDispose(() => applyHideCore(false))
    const noteFocus = id => id && !firstSeen.has(id) && firstSeen.set(id, Date.now())
    noteFocus(host.state.focusedStoredSessionId.get())
    ctx.onDispose(host.state.focusedStoredSessionId.listen(noteFocus))
    ctx.register({
      id: 'auto-pin',
      area: 'composer.middleware',
      data: { handler: onUserSend }
    })
    // #end
    ctx.register({
      id: 'pane',
      area: 'panes',
      title: 'Pinned',
      data: {
        placement: 'left',
        width: '260px',
        collapsible: true,
        hideOnly: true,
        tabTitleText: () => 'Pinned',
        dock: { pane: 'sessions', pos: 'center', enforce: true }
      },
      render: () => jsx(PinnedPane, {})
    })
  }
}
