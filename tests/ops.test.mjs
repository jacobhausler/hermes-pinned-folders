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
  const { scrubCorePins, isFreshUserChat } = mod
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
} else {
  const leaks = ['hermesDesktop', 'localStorage', 'querySelector', 'MutationObserver', 'BroadcastChannel', 'composer.middleware', 'translateNow'].filter(w => src.includes(w))
  assert(!leaks.length, 'catalog build stays inside the SDK: ' + (leaks.join(', ') || 'no internals referenced'))
  assert(!('scrubCorePins' in mod) && !('isFreshUserChat' in mod), 'catalog build has no unpin/auto-pin code')
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
