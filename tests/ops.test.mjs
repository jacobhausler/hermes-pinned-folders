// Tests both builds: `node tests/ops.test.mjs` (catalog, desktop/plugin.js)
// and `node tests/ops.test.mjs full` (full/plugin.js). The SDK and React are
// stubbed with exactly the names the file imports, read from its own source.
import { register } from 'node:module'
import { readFileSync } from 'node:fs'
const FULL = process.argv[2] === 'full'
const target = new URL(FULL ? '../full/plugin.js' : '../desktop/plugin.js', import.meta.url)
const src = readFileSync(target, 'utf8')
const sdkNames = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)].flatMap(m => m[1].split(',').map(x => x.trim()).filter(Boolean))
const stub = 'export const ' + [...new Set(sdkNames)].map(n => n + '=()=>null').join(',') + '; export default {}'
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(s, c, n) {
  if (s === '@hermes/plugin-sdk' || s === 'react' || s === 'react/jsx-runtime') return { url: 'stub:' + s, shortCircuit: true }
  return n(s, c)
}
export async function load(u, c, n) {
  if (u.startsWith('stub:')) return { format: 'module', shortCircuit: true, source: ${JSON.stringify(stub)} }
  return n(u, c)
}`))
const mod = await import(target.href)
const { ops, normalize, folderActivity, filterView, exportLayout, importLayout, default: plugin } = mod
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1) } else console.log('ok', m) }
console.log('# build:', FULL ? 'full' : 'catalog')
let t = { folders: [], placed: {}, order: [], collapsed: {} }
t = ops.addFolder(t, null, 'Work', 'a'); t = ops.addFolder(t, 'a', 'Infra', 'b'); t = ops.addFolder(t, 'b', 'Tailscale', 'c')
assert(t.folders.length === 3 && t.folders[2].parent === 'b', 'nest 3 deep')
assert(ops.moveFolder(t, 'a', 'c') === t, 'refuse cycle (a into its grandchild)')
assert(ops.moveFolder(t, 'a', 'a') === t, 'refuse self-parent')
t = ops.placeSession(t, 's1', 'c'); t = ops.placeSession(t, 's2', 'c'); t = ops.placeSession(t, 's3', 'c', 's1')
assert(t.order.join() === 's3,s1,s2', 'order insert-before: ' + t.order.join())
t = ops.deleteFolder(t, 'b')
assert(t.folders.find(f => f.id === 'c').parent === 'a' && !t.folders.find(f => f.id === 'b'), 'delete lifts children')
t = ops.deleteFolder(t, 'c')
assert(t.placed.s1 === 'a' && t.placed.s2 === 'a', 'delete lifts chats to parent')
t = ops.deleteFolder(t, 'a')
assert(Object.keys(t.placed).length === 0, 'deleting top folder returns chats to Unsorted')
assert(ops.rename(ops.addFolder(t,null,'x','z'),'z','  ').folders[0].name === 'x', 'blank rename ignored')
assert(plugin.id === 'pinned-folders' && typeof plugin.register === 'function', 'plugin shape')

let u = ops.placeSession(ops.addFolder({ folders: [], placed: {}, order: [], collapsed: {} }, null, 'W', 'w'), 'x', 'w')
u = ops.forgetSession(u, 'x')
assert(!('x' in u.placed) && !u.order.includes('x'), 'unpin forgets placement')

if (FULL) {
  const { scrubCorePins, isFreshUserChat, autoPinNext, pinAndJudge } = mod
  const mem = new Map([
    ['hermes.desktop.pinnedSessions', JSON.stringify(['a', 'b'])],
    ['hermes.desktop.pinnedSessions.remote.https%3A%2F%2Fdesk', JSON.stringify(['b', 'c'])],
    ['hermes.desktop.pinnedSessionsOther', JSON.stringify(['b'])],
    ['hermes.desktop.sessionOrder', JSON.stringify(['b'])]
  ])
  const storage = { get length() { return mem.size }, key: i => [...mem.keys()][i], getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) }
  const n = scrubCorePins(storage, new Set(['b']))
  assert(n === 2, 'scrub touched exactly the two core pin keys (' + n + ')')
  assert(mem.get('hermes.desktop.pinnedSessions') === '["a"]' && mem.get('hermes.desktop.pinnedSessions.remote.https%3A%2F%2Fdesk') === '["c"]', 'scrub removed b from local + remote scope')
  assert(mem.get('hermes.desktop.pinnedSessionsOther') === '["b"]' && mem.get('hermes.desktop.sessionOrder') === '["b"]', 'scrub left unrelated keys alone')

  const now = 1_800_000_000_000, sec = now / 1000
  assert(isFreshUserChat({ source: 'desktop', started_at: sec - 2 }, now), 'fresh desktop chat auto-pins')
  assert(!isFreshUserChat({ source: 'desktop', started_at: sec - 3600 }, now), 'old chat reopened does NOT auto-pin')
  assert(!isFreshUserChat({ source: 'cli', started_at: sec }, now), 'agent/cli chat does NOT auto-pin')
  assert(!isFreshUserChat({ source: 'workflow', started_at: sec }, now), 'workflow chat does NOT auto-pin')
  assert(!isFreshUserChat({ source: 'desktop', started_at: sec, parent_session_id: 'p' }, now), 'subagent child does NOT auto-pin')
  assert(!isFreshUserChat({ source: 'desktop', started_at: sec, pinned: true }, now), 'already pinned is left alone')
  assert(!isFreshUserChat({ source: 'desktop', started_at: sec, hidden: 1 }, now), 'hidden (bot) chat does NOT auto-pin')
  const fresh = { id: 'new', _lineage_root_id: 'root', source: 'desktop', started_at: sec }
  const until = now + 60_000
  assert(autoPinNext(fresh, now, new Set(), now, until) === 'pin', 'fresh chat requests a pin')
  const judgedIds = new Set()
  const mark = ids => ids.forEach(id => judgedIds.add(id))
  let attempts = 0
  const patch = async () => { if (++attempts === 1) throw new Error('PATCH failed') }
  try { await pinAndJudge(fresh, patch, mark) } catch {}
  assert(attempts === 1 && !judgedIds.size, 'failed PATCH cannot persist judged ids')
  assert(autoPinNext(fresh, now, judgedIds, now + 2000, until) === 'pin', 'failed PATCH leaves chat eligible for retry')
  await pinAndJudge(fresh, patch, mark)
  assert(attempts === 2 && judgedIds.has('new') && judgedIds.has('root'), 'successful retry persists judged ids')
  assert(autoPinNext(fresh, now, new Set(['root']), now + 2000, until) === 'skip', 'successful pin judges lineage')
  assert(autoPinNext(null, now, new Set(), now, until) === 'wait', 'unresolved row waits before deadline')
  assert(autoPinNext(null, now, new Set(), until, until) === 'timeout', 'unresolved row reports deadline')
  assert(autoPinNext(fresh, now, new Set(), until, until) === 'timeout', 'failed PATCH reports deadline')
  assert(autoPinNext({ ...fresh, started_at: sec - 3600 }, now, new Set(), now, until) === 'skip', 'old chat judged without pinning')

  // ── full unpin: backend PATCH + core scrub, never a second SDK pin mutation ──
  const patchCalls = []
  const fullLocalStorage = new Map([
    ['hermes.desktop.pinnedSessions', JSON.stringify(['s1', 'keep'])],
    ['hermes.desktop.pinnedSessions.remote.https%3A%2F%2Fdesk', JSON.stringify(['s1'])]
  ])
  globalThis.window = {
    hermesDesktop: { api: async opts => { patchCalls.push(opts) } },
    localStorage: {
      get length() { return fullLocalStorage.size },
      key: i => [...fullLocalStorage.keys()][i],
      getItem: k => fullLocalStorage.get(k) ?? null,
      setItem: (k, v) => fullLocalStorage.set(k, v)
    }
  }
  let sdkPinCalls = 0
  await mod.unpinPinnedRow({ id: 's1', profile: 'p1' }, { sessions: { pin: (id, v) => { sdkPinCalls++ } } })
  delete globalThis.window
  assert(patchCalls.length === 1 && patchCalls[0].path === '/api/sessions/s1' && patchCalls[0].method === 'PATCH' && patchCalls[0].body.pinned === false && patchCalls[0].profile === 'p1',
    'full unpin sends the backend PATCH (pinned:false, owning profile)')
  assert(sdkPinCalls === 0, 'full unpin does NOT also call host.sessions.pin (no double mutation)')
  assert(fullLocalStorage.get('hermes.desktop.pinnedSessions') === '["keep"]' && !fullLocalStorage.get('hermes.desktop.pinnedSessions.remote.https%3A%2F%2Fdesk')?.includes('s1'),
    'full unpin scrubs the row from core pin caches (local + remote scope)')
  globalThis.window = { hermesDesktop: { api: async () => {} }, localStorage: { length: 0, key: () => null, getItem: () => null, setItem: () => {} } }
  const forgot = []
  const fullOut = await mod.unpinAndReconcile({ id: 's1', profile: 'p1' }, { refresh: async () => [{ id: 's1' }], forget: id => forgot.push(id), notifyError: () => {} })
  assert(fullOut === 'pruned' && forgot.join() === 's1', 'full unpin: awaited backend PATCH is the ack -> placement forgotten at once')
  globalThis.window.hermesDesktop.api = async () => { throw new Error('patch boom') }
  const fullErrs = [], fullForgot = []
  const fullFail = await mod.unpinAndReconcile({ id: 's2', profile: 'p1' }, { refresh: async () => null, forget: id => fullForgot.push(id), notifyError: e => fullErrs.push(e.message) })
  delete globalThis.window
  assert(fullFail === 'failed' && !fullForgot.length && fullErrs.join() === 'patch boom', 'full unpin: PATCH rejection -> placement kept + notifyError')
} else {
  const leaks = ['hermesDesktop', 'localStorage', 'querySelector', 'MutationObserver', 'BroadcastChannel', 'composer.middleware', 'translateNow'].filter(w => src.includes(w))
  if (/\bdocument\s*\./.test(src.replace(/^\s*(\/\/|\*).*$/gm, ''))) leaks.push('document')
  assert(!leaks.length, 'catalog build stays inside the SDK: ' + (leaks.join(', ') || 'no internals referenced'))
  // Allowed host imports are codified in AGENTS.md rule 1: @hermes/plugin-sdk, react,
  // react/jsx-runtime (the app's loader provides exactly these at runtime). Enforce the
  // enumeration itself so a new third-party import is red, not a reviewer judgment call.
  // The extractor covers every module-source form: `from 'x'|x"|x\``, bare
  // `import 'x'`, dynamic `import('x')`, and `require('x')`.
  const importSources = [...src.matchAll(
    /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"`])([^'"`]+)\1/g
  )].map(m => m[2])
  const allowed = new Set(['@hermes/plugin-sdk', 'react', 'react/jsx-runtime'])
  // Liveness: the parser must actually find the known sources — zero matches must never pass.
  assert(importSources.includes('@hermes/plugin-sdk'), 'import gate is live: extractor finds @hermes/plugin-sdk in the catalog build')
  const rogue = [...new Set(importSources)].filter(s => !allowed.has(s))
  assert(!rogue.length, 'catalog build imports only host-provided modules (AGENTS.md rule 1), found: ' + rogue.join(', '))
  // Canary: the same extractor must catch every forbidden form on a fixture.
  const canary = [
    `import { a } from "dquoted-mod"`,
    "import 'bare-side-effect-mod'",
    "const m = await import(`dynamic-template-mod`)",
    "const r = require('required-mod')",
    "import ok from 'react'" // the one legal line, proving the canary isn't just match-anything
  ].join('\n')
  const canaryFound = [...canary.matchAll(
    /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"`])([^'"`]+)\1/g
  )].map(m => m[2])
  const canaryMissed = ['dquoted-mod', 'bare-side-effect-mod', 'dynamic-template-mod', 'required-mod', 'react'].filter(s => !canaryFound.includes(s))
  assert(!canaryMissed.length, 'import gate canary catches every forbidden import form (missed: ' + canaryMissed.join(', ') + ')')
  assert(!('scrubCorePins' in mod) && !('isFreshUserChat' in mod), 'catalog build has no full-only pin cache/auto-pin code')
  assert(typeof mod.unpinPinnedRow === 'function', 'catalog build exports the unpin path')

  // ── catalog unpin on supported Desktop: exactly one SDK pin(id, false) ──
  const pinCalls = []
  await mod.unpinPinnedRow({ id: 's1' }, { sessions: { pin: (id, v) => pinCalls.push([id, v]) } })
  assert(pinCalls.length === 1 && pinCalls[0][0] === 's1' && pinCalls[0][1] === false, 'catalog unpin calls host.sessions.pin(id, false) exactly once')
  let settled = false
  await mod.unpinPinnedRow({ id: 's1' }, { sessions: { pin: () => new Promise(r => setTimeout(() => { settled = true; r() }, 5)) } })
  assert(settled, 'catalog unpin awaits an async host.sessions.pin before resolving')
  let asyncErr = ''
  try { await mod.unpinPinnedRow({ id: 's1' }, { sessions: { pin: async () => { throw new Error('pin boom') } } }) } catch (e) { asyncErr = e.message }
  assert(asyncErr === 'pin boom', 'catalog unpin surfaces an async pin rejection (menu keeps placement, calls notifyError)')

  // ── catalog unpin on older Desktop: guidance error, layout untouched ──
  let oldHostErr = ''
  let layout = ops.placeSession(ops.addFolder(normalize(null), null, 'W', 'w'), 's1', 'w')
  const layoutBefore = JSON.stringify(layout)
  try {
    // Mirrors the menu contract: dropRow/forgetSession run only after success.
    await mod.unpinPinnedRow({ id: 's1' }, { sessions: {} })
    layout = ops.forgetSession(layout, 's1')
  } catch (e) { oldHostErr = e.message }
  assert(/update hermes desktop|unpin this chat in sessions/i.test(oldHostErr), 'older Desktop (no sessions.pin): unpin reports the guidance error: ' + oldHostErr)
  assert(JSON.stringify(layout) === layoutBefore, 'failed unpin leaves the layout untouched (no layout-only unpin)')
  let noSessionsErr = ''
  try { await mod.unpinPinnedRow({ id: 's1' }, {}) } catch (e) { noSessionsErr = e.message }
  assert(/update hermes desktop/i.test(noSessionsErr), 'host without sessions at all: same guidance error, no internals touched')

  // ── catalog unpin reconciles on read: pin(id,false) resolving is no ack ──
  // Harness mirrors the pane: layout lives in `lay`, forget prunes it.
  const unpinHarness = (pinImpl, reads) => {
    const h = { lay: ops.placeSession(ops.placeSession(ops.addFolder(normalize(null), null, 'W', 'w'), 's0', 'w'), 's1', 'w'), errors: [], refreshes: 0 }
    h.before = JSON.stringify(h.lay)
    h.run = () => mod.unpinAndReconcile({ id: 's1' }, {
      sessionsHost: { sessions: { pin: pinImpl } },
      refresh: async () => reads[Math.min(h.refreshes++, reads.length - 1)],
      forget: id => { h.lay = ops.forgetSession(h.lay, id) },
      notifyError: e => h.errors.push(e.message),
      sleep: async () => {}
    })
    return h
  }
  let h = unpinHarness(async () => {}, [[{ id: 's0' }, { id: 's1' }]])
  let out = await h.run()
  assert(out === 'kept' && JSON.stringify(h.lay) === h.before && h.lay.placed.s1 === 'w' && h.lay.order.join() === 's0,s1',
    'catalog unpin: pin resolves but refreshed list STILL has the id -> original folder + order preserved (' + out + ')')
  assert(h.refreshes >= 2 && !h.errors.length, 'catalog unpin re-reads before giving up, no error shown')
  h = unpinHarness(async () => {}, [[{ id: 's0' }, { id: 's1' }], [{ id: 's0' }]])
  out = await h.run()
  assert(out === 'pruned' && !('s1' in h.lay.placed) && !h.lay.order.includes('s1') && h.lay.placed.s0 === 'w',
    'catalog unpin: refreshed list drops the id -> placement pruned (' + out + ')')
  h = unpinHarness(async () => {}, [null, [{ id: 's0' }]])
  out = await h.run()
  assert(out === 'pruned', 'catalog unpin: a failed read (null) never prunes; a later good read does')
  h = unpinHarness(async () => { throw new Error('pin boom') }, [[{ id: 's0' }]])
  out = await h.run()
  assert(out === 'failed' && JSON.stringify(h.lay) === h.before && h.errors.join() === 'pin boom' && h.refreshes === 1,
    'catalog unpin: rejection -> placement kept + notifyError + refresh')
}

const names = t => t.folders.filter(f => !f.parent).map(f => f.name).join(',')
let o = normalize({ folders: [{ id: 'z', name: 'Zeta', parent: null }, { id: 'a', name: 'Alpha', parent: null }, { id: 'm', name: 'Mid', parent: null }] })
assert(names(o) === 'Alpha,Mid,Zeta', 'legacy layout sorted alphabetically once: ' + names(o))
o = ops.placeFolder(o, 'z', 'a', 'before')
assert(names(o) === 'Zeta,Alpha,Mid', 'drag Zeta above Alpha: ' + names(o))
assert(names(normalize(JSON.parse(JSON.stringify(o)))) === 'Zeta,Alpha,Mid', 'custom order survives save/reload (no re-sort)')
o = ops.placeFolder(o, 'z', 'm', 'after')
assert(names(o) === 'Alpha,Mid,Zeta', 'drag Zeta below Mid: ' + names(o))
o = ops.addFolder(o, 'a', 'Child', 'c')
o = ops.placeFolder(o, 'm', 'c', 'before')
assert(o.folders.find(f => f.id === 'm').parent === 'a' && o.folders.filter(f => f.parent === 'a').map(f => f.id).join() === 'm,c', 'reorder next to a nested folder re-parents it')
assert(ops.placeFolder(o, 'a', 'c', 'before') === o, 'cannot drop a folder beside its own descendant')
o = ops.addFolder(o, null, 'Newest', 'n')
assert(names(o).endsWith('Newest'), 'new folder appends at the end')

// ── folder colors ──
let c = ops.addFolder(normalize(null), null, 'Work', 'w')
c = ops.setColor(c, 'w', 'hsl(30 70% 55%)')
assert(c.folders[0].color === 'hsl(30 70% 55%)', 'set folder color')
c = ops.setColor(c, 'w', null)
assert(!('color' in c.folders[0]), 'clear folder color back to default')

// ── activity on collapsed folders (rolls up through ancestors) ──
let A = normalize(null)
A = ops.addFolder(A, null, 'Top', 'top'); A = ops.addFolder(A, 'top', 'Mid', 'mid'); A = ops.addFolder(A, null, 'Quiet', 'q')
A = ops.placeSession(A, 'x', 'mid'); A = ops.placeSession(A, 'y', 'top'); A = ops.placeSession(A, 'z', 'q')
const act = folderActivity(A, [{ id: 'x', unread: true }, { id: 'y', is_active: true }, { id: 'z' }, { id: 'loose', unread: true }])
assert(act.get('mid')?.unread === 1 && !act.get('mid').active, 'unread chat marks its folder')
assert(act.get('top')?.unread === 1 && act.get('top').active === true, 'parent rolls up child unread + own active')
assert(!act.has('q'), 'quiet folder has no badge')

// ── filter ──
let F = normalize(null)
F = ops.addFolder(F, null, 'Infra', 'inf'); F = ops.addFolder(F, 'inf', 'Tailscale', 'ts'); F = ops.addFolder(F, null, 'Personal', 'per')
F = ops.placeSession(F, 'a', 'ts'); F = ops.placeSession(F, 'b', 'per')
const fr = [{ id: 'a', title: 'ACL cleanup' }, { id: 'b', title: 'Vacation plans' }, { id: 'u', title: 'Loose acl idea' }]
assert(filterView(F, fr, '  ') === null, 'blank filter = no filtering')
let v = filterView(F, fr, 'acl')
assert(v.chats.has('a') && v.chats.has('u') && !v.chats.has('b'), 'filter matches chat titles (case-insensitive)')
assert(v.folders.has('ts') && v.folders.has('inf') && !v.folders.has('per'), 'filter keeps ancestor folders of matches')
v = filterView(F, fr, 'tailsc')
assert(v.chats.has('a') && v.folders.has('inf') && v.folders.has('ts'), 'folder-name match shows its chats and ancestors')

// ── export / import ──
let E = ops.setColor(ops.placeSession(F, 'b', 'per'), 'per', 'hsl(0 70% 55%)')
const round = importLayout(exportLayout(E))
assert(JSON.stringify(round.folders) === JSON.stringify(E.folders) && round.placed.a === 'ts', 'export → import round-trips folders, colors, placement')
let threw = ''
try { importLayout('{"folders":[]}') } catch (e) { threw = e.message }
assert(/not a Pinned folders layout/.test(threw), 'import refuses foreign JSON: ' + threw)
try { importLayout('nope') } catch (e) { threw = e.message }
assert(/not valid JSON/.test(threw), 'import refuses non-JSON')
const cyc = importLayout(JSON.stringify({ format: 'pinned-folders/layout@1', folders: [{ id: 'p', name: 'P', parent: 'q' }, { id: 'q', name: 'Q', parent: 'p' }, { id: 'o', name: 'Orphan', parent: 'gone' }], placed: { s: 'gone', t: 'p' } }))
assert(cyc.folders.some(f => f.parent === null && (f.id === 'p' || f.id === 'q')), 'import breaks a parent cycle')
assert(cyc.folders.find(f => f.id === 'o').parent === null, 'import lifts orphan folder to top level')
assert(!('s' in cyc.placed) && cyc.placed.t === 'p', 'import drops placement into missing folders')

// ── row gestures: core's ⇧-click language, pinned-pane subset (#12) ──
const { handlePinnedRowClick, pinnedRowClick, chatMenuItems } = mod
const click = mods => {
  const calls = { open: [], unpin: 0, prevented: 0, stopped: 0 }
  const e = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...mods, preventDefault: () => calls.prevented++, stopPropagation: () => calls.stopped++ }
  calls.action = handlePinnedRowClick(e, { open: intent => calls.open.push(intent), unpin: () => calls.unpin++ })
  return calls
}
let k = click({ shiftKey: true })
assert(k.unpin === 1 && k.open.length === 0, 'shift+click unpins and does NOT open the chat')
assert(k.prevented === 1 && k.stopped === 1, 'shift+click is consumed (no bubbling to the list, no default)')
k = click({})
assert(k.open.length === 1 && k.open[0] === undefined && k.unpin === 0, 'plain click still opens the chat')
k = click({ metaKey: true })
assert(k.open.join() === 'tab' && !k.unpin, 'cmd/ctrl+click still opens in a new tab')
assert(pinnedRowClick({ altKey: true, shiftKey: true }) === 'open' && pinnedRowClick({ metaKey: true, shiftKey: true }) === 'tab',
  'alt+shift (archive) and cmd+shift (new window) stay core-only: never unpin here')
const menuAct = { open: () => {}, copyId: () => {}, place: () => {}, unpin: () => {}, del: () => {}, rename: () => {}, toggleRead: () => {}, archive: () => {} }
const menu = chatMenuItems({ id: 's1' }, { fid: null, flat: [], canUnpin: true, act: menuAct })
const labels = menu.filter(it => it && it.label).map(it => it.label)
assert(['Open', 'Open in new tab', 'Open in new window', 'Copy session ID', 'Unpin', 'Delete…'].every(l => labels.includes(l)),
  'context/kebab menu keeps its items: ' + labels.join('|'))
assert(menu.find(it => it.label === 'Unpin').onSelect === menuAct.unpin, 'menu Unpin and the shift+click gesture share one handler')
const oldMenu = chatMenuItems({ id: 's1' }, { fid: null, flat: [], canUnpin: false, act: menuAct })
assert(oldMenu.find(it => /^Unpin/.test(it.label || '')).disabled === true, 'menu Unpin stays disabled with guidance when unpin is unavailable')

// ── filter menu: view state (#12) ──
const { normalizeView, narrowView, orderRows, applyView, DEFAULT_VIEW } = mod
const legacy = { folders: [{ id: 'w', name: 'Work', parent: null, color: 'hsl(1 2% 3%)' }], placed: { a: 'w' }, order: ['a'], collapsed: { w: true }, foldersOrdered: true }
const loaded = normalize(JSON.parse(JSON.stringify(legacy)))
assert(JSON.stringify(loaded.view) === JSON.stringify(DEFAULT_VIEW), 'old layout without view state loads with default view')
assert(JSON.stringify({ ...loaded, view: undefined }) === JSON.stringify({ ...legacy, view: undefined }), 'old layout keeps folders, colors, placement, order, collapse unchanged')
assert(JSON.stringify(normalizeView({ order: 'sideways', status: 42, unreadOnly: 'yes' })) === JSON.stringify(DEFAULT_VIEW), 'garbage view values fall back to defaults')
const recRows = [{ id: 'old', last_active: 100 }, { id: 'mid', last_active: 200 }, { id: 'new', last_active: 300 }]
assert(orderRows(recRows, ['old', 'new', 'mid'], 'manual').map(r => r.id).join() === 'old,new,mid', 'ordering Manual follows the dragged order')
assert(orderRows(recRows, ['old', 'new', 'mid'], 'recent').map(r => r.id).join() === 'new,mid,old', 'ordering Most recent sorts by last activity')
let V = ops.placeSession(ops.addFolder(normalize(null), null, 'W', 'w'), 'r1', 'w')
V = ops.placeSession(V, 'u1', 'w')
const vr = [{ id: 'r1', title: 'read', profile: 'default' }, { id: 'u1', title: 'unread', unread: true, profile: 'work' }, { id: 'act', title: 'busy', is_active: true }]
assert(narrowView(V, vr, '', V.view, 'default') === null, 'default view does not filter')
let nv = narrowView(V, vr, '', ops.setView(V, { unreadOnly: true }).view, 'default')
assert(nv.chats.has('u1') && !nv.chats.has('r1') && !nv.chats.has('act') && nv.folders.has('w'), 'unread-only hides read rows, keeps the folder of an unread one')
nv = narrowView(V, vr, '', ops.setView(V, { status: 'working' }).view, 'default')
assert(nv.chats.has('act') && nv.chats.size === 1 && !nv.folders.has('w'), 'status Working shows only working rows; folders with none hide')
assert(applyView(vr, { profile: 'current' }, 'default').map(r => r.id).join() === 'r1,act', 'profile Current keeps rows of the current profile (no profile = default)')
nv = narrowView(V, vr, 'unread', ops.setView(V, { profile: 'current' }).view, 'default')
assert(nv.chats.size === 0, 'text filter and view filters combine')
assert(narrowView(V, vr, '', ops.setView(V, { order: 'recent' }).view, 'default') === null, 'ordering alone filters nothing')
let R = ops.setView(ops.setColor(V, 'w', 'red'), { order: 'recent', unreadOnly: true, status: 'unread', profile: 'current' })
const rs = ops.resetView(R)
assert(JSON.stringify(rs.view) === JSON.stringify(DEFAULT_VIEW), 'reset view restores filter + ordering defaults')
assert(JSON.stringify({ ...rs, view: 0 }) === JSON.stringify({ ...R, view: 0 }), 'reset view leaves folders, colors and layout alone')
assert(JSON.stringify(normalize(JSON.parse(JSON.stringify(R))).view) === JSON.stringify(R.view), 'view state survives save/reload')
const C = ops.collapseAll(ops.addFolder(V, 'w', 'Sub', 'sub'))
assert(C.collapsed.w && C.collapsed.sub && C.collapsed.__unsorted, 'collapse all closes every folder and Unsorted')

// ── #13 review: Collapse all under a filter (F1), Open all = visible rows (F2) ──
const { collapseAllItem, chatsBeneath, visibleRows } = mod
let collapsed = 0
const caOff = collapseAllItem({ filtering: false, empty: false, collapse: () => collapsed++ })
caOff.onSelect()
assert(!caOff.disabled && caOff.label === 'Collapse all' && collapsed === 1, 'collapse all is enabled with no filter and runs the collapse')
const caOn = collapseAllItem({ filtering: true, empty: false, collapse: () => collapsed++ })
caOn.onSelect()
assert(caOn.disabled === true && /clear filters to collapse/i.test(caOn.label) && collapsed === 1, 'collapse all is disabled while a filter is active, with the reason in its label')
let G = ops.addFolder(ops.addFolder(normalize(null), null, 'W', 'w'), 'w', 'Sub', 'sub')
for (const [sid, f] of [['r1', 'w'], ['u1', 'w'], ['u2', 'sub'], ['r2', 'sub']]) G = ops.placeSession(G, sid, f)
const gr = [{ id: 'r1', title: 'read' }, { id: 'u1', title: 'new', unread: true }, { id: 'u2', title: 'news', unread: true }, { id: 'r2', title: 'old' }]
const gIn = new Map([['w', gr.filter(r => G.placed[r.id] === 'w')], ['sub', gr.filter(r => G.placed[r.id] === 'sub')]])
const gKids = new Map([['w', G.folders.filter(f => f.parent === 'w')]])
assert(chatsBeneath('w', gIn, gKids, null).map(r => r.id).join() === 'r1,u1,u2,r2', 'open all as tabs with no filter opens every chat beneath the folder')
const gUnread = narrowView(G, gr, '', ops.setView(G, { unreadOnly: true }).view, 'default')
assert(chatsBeneath('w', gIn, gKids, gUnread).map(r => r.id).join() === 'u1,u2', 'open all as tabs under Unread only opens only the visible rows')
const gText = narrowView(G, gr, 'old', G.view, 'default')
assert(chatsBeneath('w', gIn, gKids, gText).map(r => r.id).join() === 'r2', 'open all as tabs under the text filter opens only the visible rows')
assert(visibleRows(gIn.get('w'), gUnread).map(r => r.id).join() === 'u1', 'the render selector and open all share visibleRows')
