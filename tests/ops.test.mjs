// Tests both builds: `node tests/ops.test.mjs` (catalog, desktop/plugin.js)
// and `node tests/ops.test.mjs full` (full/plugin.js). The SDK and React are
// stubbed with exactly the names the file imports, read from its own source.
import { register } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const FULL = process.argv[2] === 'full'
const target = new URL(FULL ? '../full/plugin.js' : '../desktop/plugin.js', import.meta.url)
const src = readFileSync(target, 'utf8')
const sdkNames = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)].flatMap(m => m[1].split(',').map(x => x.trim()).filter(Boolean))
// `host` is the one SDK import used as an object, not a component: register()
// (full build) reads host.state.focusedStoredSessionId's get/listen at call time.
globalThis.__pfHost = { state: { focusedStoredSessionId: { get: () => 'f1', listen: () => () => {} } } }
// `jsx`/`jsxs` are the two imports a UI-shape test must see THROUGH: the stub records
// (type, props, key) and returns the element, so pure builders like menuChildren are
// assertable without a renderer. Every other name stays a `()=>null` component stub.
globalThis.__pfJsx = (type, props, key) => ({ type, props, key })
const stub = 'export const ' + [...new Set(sdkNames)].map(n => (n === 'host' ? 'host=globalThis.__pfHost' : n === 'jsx' || n === 'jsxs' ? n + '=globalThis.__pfJsx' : n + '=()=>null')).join(',') + '; export default {}'
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
const { ops, normalize, folderActivity, filterView, ancestorsOf, isDescendant, folderOf, exportLayout, importLayout, default: plugin } = mod
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

// Tree helpers: ancestorsOf / isDescendant / folderOf edge cases.
{
  let th = { folders: [], placed: {}, order: [], collapsed: {} }
  th = ops.addFolder(th, null, 'a', 'a'); th = ops.addFolder(th, 'a', 'b', 'b'); th = ops.addFolder(th, 'b', 'c', 'c')
  const byId = new Map(th.folders.map(f => [f.id, f]))
  assert(ancestorsOf(byId, 'c').map(f => f.id).join() === 'c,b,a', 'ancestorsOf 3-deep chain, nearest first')
  const orphan = new Map([['orphan', { id: 'orphan', parent: 'ghost' }]])
  assert(ancestorsOf(orphan, 'orphan').map(f => f.id).join() === 'orphan', 'ancestorsOf orphan (absent parent id) returns just [self]')
  assert(ancestorsOf(byId, 'nope').length === 0, 'ancestorsOf unknown fid returns []')
  assert(isDescendant(th, 'c', 'a') === true, 'isDescendant grandchild -> ancestor is true')
  assert(isDescendant(th, 'a', 'c') === false, 'isDescendant ancestor -> descendant is false')
  const cyc = { folders: [{ id: 'a', name: 'a', parent: 'c' }, { id: 'c', name: 'c', parent: 'a' }], placed: {}, order: [], collapsed: {} }
  assert(isDescendant(cyc, 'a', 'zz') === false, 'isDescendant terminates on forged parent cycle a->c->a (hop cap), returns false')
  const tp = ops.placeSession(ops.placeSession(th, 's1', 'b'), 's2', 'ghost-folder')
  const ids = new Set(tp.folders.map(f => f.id))
  assert(folderOf(tp, ids, 's1') === 'b', 'folderOf returns the placed folder id')
  assert(folderOf(tp, ids, 'nosid') === null, 'folderOf unplaced sid falls back to ROOT (null)')
  assert(folderOf(tp, ids, 's2') === null, 'folderOf sid placed in a deleted folder falls back to ROOT (null)')
}

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

  // ── scrubCorePins defensive branches (IDLE-DRIVE sweep c, 10-27): each case runs on
  // a FRESH Map + the same storage-facade shape. The happy-path `mem` above is reused
  // by the unpin tests further down — it must stay untouched here.
  const scrubStub = entries => {
    const m = new Map(entries)
    const writes = []
    return [m, { get length() { return m.size }, key: i => [...m.keys()][i], getItem: k => m.get(k) ?? null, setItem: (k, v) => { writes.push(k); m.set(k, v) } }, writes]
  }
  {
    const [m, s, w0] = scrubStub([['hermes.desktop.pinnedSessions', JSON.stringify(['a', 'b'])], ['hermes.desktop.pinnedSessions.remote.https%3A%2F%2Fdesk', JSON.stringify(['b', 'c'])]])
    const snap = JSON.stringify([...m.entries()])
    assert(scrubCorePins(s, new Set()) === 0 && !w0.length && JSON.stringify([...m.entries()]) === snap,
      'empty ids: early return counts 0 and touches no storage key (snapshot byte-identical)')
  }
  {
    const [m, s] = scrubStub([['hermes.desktop.pinnedSessions', '{"a",oops'], ['hermes.desktop.pinnedSessions.remote.https%3A%2F%2Fdesk', JSON.stringify(['b', 'c'])]])
    assert(scrubCorePins(s, new Set(['b'])) === 1 && m.get('hermes.desktop.pinnedSessions') === '{"a",oops' && m.get('hermes.desktop.pinnedSessions.remote.https%3A%2F%2Fdesk') === '["c"]',
      'malformed core-pin JSON: catch skips it without crash, raw text byte-unchanged, only the parseable remote key counted')
  }
  {
    const [m, s] = scrubStub([['hermes.desktop.pinnedSessions', '{}'], ['hermes.desktop.pinnedSessions.remote.https%3A%2F%2Fdesk', '42']])
    assert(scrubCorePins(s, new Set(['b'])) === 0 && m.get('hermes.desktop.pinnedSessions') === '{}' && m.get('hermes.desktop.pinnedSessions.remote.https%3A%2F%2Fdesk') === '42',
      'valid non-array core-pin JSON: skipped, counts 0, both raw values byte-unchanged')
  }
  {
    const [m, s, writes] = scrubStub([['hermes.desktop.pinnedSessions', JSON.stringify(['a', 'b'])], ['hermes.desktop.pinnedSessions.remote.https%3A%2F%2Fdesk', JSON.stringify(['b', 'c'])]])
    const once = scrubCorePins(s, new Set(['b']))
    const post = JSON.stringify([...m.entries()])
    assert(once === 2 && writes.length === 2 && scrubCorePins(s, new Set(['b'])) === 0 && writes.length === 2 && JSON.stringify([...m.entries()]) === post,
      'idempotent re-scrub: second pass counts 0, set-writes nothing, every value byte-identical to post-first-scrub')
  }

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

  // ── unpin -> tombstone -> expiry contract (full-only; same window stub harness) ──
  const { pinIdsOf, tombstoned } = mod
  assert(JSON.stringify(pinIdsOf({ id: 't1', _lineage_root_id: 'troot' })) === '["t1","troot"]',
    'pinIdsOf carries the row id plus its lineage root')
  assert(JSON.stringify(pinIdsOf({ id: 't1' })) === '["t1"]', 'pinIdsOf on a row without lineage is just the id')
  const tombPatchCalls = []
  const tombStorage = new Map([['hermes.desktop.pinnedSessions', JSON.stringify(['t1', 'troot', 'keep'])]])
  globalThis.window = {
    hermesDesktop: { api: async opts => { tombPatchCalls.push(opts) } },
    localStorage: {
      get length() { return tombStorage.size },
      key: i => [...tombStorage.keys()][i],
      getItem: k => tombStorage.get(k) ?? null,
      setItem: (k, v) => tombStorage.set(k, v)
    }
  }
  await mod.unpinPinnedRow({ id: 't1', _lineage_root_id: 'troot' }, { sessions: { pin: () => { throw new Error('full unpin must not use the SDK pin verb') } } })
  delete globalThis.window
  const t0 = Date.now()
  assert(tombPatchCalls.length === 1 && tombPatchCalls[0].body.pinned === false, 'tombstone setup: the unpin PATCH went out')
  assert(tombstoned({ id: 't1', _lineage_root_id: 'troot' }, t0 + 30_000) === true,
    'just-unpinned row reads as tombstoned within TOMBSTONE_MS (ids incl. lineage root)')
  const stillPinned = JSON.parse(tombStorage.get('hermes.desktop.pinnedSessions') || '[]')
  assert(!stillPinned.includes('t1') && !stillPinned.includes('troot') && stillPinned.join() === 'keep',
    'unpin scrubbed t1 + troot from core pin cache (scrubTombstones ran)')
  assert(tombstoned({ id: 't1' }, t0 + 61_000) === false, 'tombstone expires past TOMBSTONE_MS=60_000 -> row shows again')
  assert(tombstoned({ id: 'never', _lineage_root_id: 'nope' }, t0 + 30_000) === false, 'never-unpinned row is never tombstoned')

  // ── pinAndJudge seam edges (full-only). Drives the injectable seams of
  // pinAndJudge(row, pin, judge) — full/plugin.js: `await pin(row); judge(pinIdsOf(row))`;
  // pinIdsOf: `[row.id, row._lineage_root_id].filter(Boolean)` drops falsy slots. judge
  // captures JSON.stringify([...ids]): a missing key, an undefined slot (unfiltered
  // stringifies '["solo",null]'), an empty string, or a reordering all change the captured
  // bytes. pin and judge share one monotonic tick, so strict ordering is measured, not
  // assumed. The rejecting-pin path (pin attempted, judge untouched) is already pinned
  // above ('failed PATCH cannot persist judged ids').
  const ajRun = async (row, pin) => {
    let tick = 0, pinnedTick = 0, judgedTick = 0, judgeCalls = 0, captured = null
    await pinAndJudge(row, pin ?? (async () => { pinnedTick = ++tick }),
      ids => { captured = JSON.stringify([...ids]); judgeCalls++; judgedTick = ++tick })
    return { captured, judgeCalls, pinnedTick, judgedTick }
  }
  const a1 = await ajRun({ id: 'solo' })
  assert(a1.captured === '["solo"]' && a1.judgeCalls === 1,
    'pinAndJudge: row with no _lineage_root_id key judges exactly ["solo"] — no undefined slot, no empty string')
  const a2a = await ajRun({ id: 'e1', _lineage_root_id: '' })
  const a2b = await ajRun({ id: 'e2', _lineage_root_id: undefined })
  assert(a2a.captured === '["e1"]' && a2b.captured === '["e2"]',
    'pinAndJudge: present-but-falsy roots ("" and undefined) never ride — judge sees exactly ["e1"] / ["e2"]')
  const a3 = await ajRun({ id: 'ord', _lineage_root_id: 'oroot' })
  assert(a3.captured === '["ord","oroot"]',
    'pinAndJudge: judge receives pinIdsOf ORDER — row id first, lineage root second')
  let ajResolve, ajCalls = 0, ajCaptured = null
  const ajT = { n: 0, pin: 0, judge: 0 }
  const ajP = pinAndJudge({ id: 'pend' },
    () => { ajT.pin = ++ajT.n; return new Promise(r => { ajResolve = r }) },
    ids => { ajT.judge = ++ajT.n; ajCalls++; ajCaptured = JSON.stringify([...ids]) })
  await new Promise(r => setTimeout(r, 0))
  assert(ajCalls === 0, 'pinAndJudge: judge NOT called while the pin promise is pending (still 0 after a setTimeout(0) flush)')
  ajResolve()
  await ajP
  assert(ajCalls === 1 && ajT.judge === ajT.pin + 1 && ajCaptured === '["pend"]',
    'pinAndJudge: judge runs EXACTLY ONCE, strictly after pin resolution (judgedTick === pinnedTick + 1)')
} else {
  const leaks = ['hermesDesktop', 'localStorage', 'querySelector', 'MutationObserver', 'BroadcastChannel', 'composer.middleware', 'translateNow'].filter(w => src.includes(w))
  if (/\bdocument\s*\./.test(src.replace(/^\s*(\/\/|\*).*$/gm, ''))) leaks.push('document')
  assert(!leaks.length, 'catalog build stays inside the SDK: ' + (leaks.join(', ') || 'no internals referenced'))
  // Allowed host imports are codified in AGENTS.md rule 1: @hermes/plugin-sdk, react,
  // react/jsx-runtime (the app's loader provides exactly these at runtime). Enforce the
  // enumeration itself so a new third-party import is red, not a reviewer judgment call.
  // The extractor covers every module-source form: `from 'x'|x"|x\``, bare
  // `import 'x'`, dynamic `import('x')`, and `require('x')`.
  // ONE extractor, shared by the gate and its canary, so the canary tests what the gate runs.
  const IMPORT_SOURCE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"`])([^'"`]+)\1/g
  const extractImportSources = text => [...text.matchAll(IMPORT_SOURCE)].map(m => m[2])
  const allowed = new Set(['@hermes/plugin-sdk', 'react', 'react/jsx-runtime'])
  const rogueImports = text => [...new Set(extractImportSources(text))].filter(s => !allowed.has(s)).sort()
  const importSources = extractImportSources(src)
  // Liveness: the parser must actually find the known sources — no matches must ever pass.
  assert(importSources.includes('@hermes/plugin-sdk'), 'import gate is live: extractor finds @hermes/plugin-sdk in the catalog build')
  const rogue = rogueImports(src)
  assert(!rogue.length, 'catalog build imports only host-provided modules (AGENTS.md rule 1), found: ' + rogue.join(', '))
  // Canary: the same extractor must catch every forbidden form on a fixture.
  const canary = [
    `import { a } from "dquoted-mod"`,
    "import 'bare-side-effect-mod'",
    "const m = await import(`dynamic-template-mod`)",
    "const r = require('required-mod')",
    "import ok from 'react'" // the one legal line, proving the canary isn't just match-anything
  ].join('\n')
  // Through the same `allowed` filter: rogue must be EXACTLY the forbidden modules, so a
  // missed form fails and so does the legal react line being flagged.
  const canaryRogue = rogueImports(canary).join()
  const canaryWant = ['bare-side-effect-mod', 'dquoted-mod', 'dynamic-template-mod', 'required-mod'].sort().join()
  assert(canaryRogue === canaryWant, 'import gate canary: rogue set is exactly the forbidden fixture modules (got: ' + canaryRogue + ')')
  assert(extractImportSources(canary).includes('react'), 'import gate canary sees the legal react line and leaves it unflagged')
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
// A hand-edited or half-written save can carry an entry with no name: the
// one-time alphabetical sort reads .name, so a nameless entry must be dropped,
// not crash the pane on load (same shape importLayout already refuses).
const nl = normalize({ folders: [{ id: 'z', name: 'Zed' }, { id: 'noname' }, null, 42, { id: 'a', name: 'Ant' }, { name: 'noid' }], foldersOrdered: false })
assert(names(nl) === 'Ant,Zed', 'load drops id-less and name-less folder entries instead of crashing')
assert(nl.placed['noname'] === undefined || nl.folders.length === 2, 'dropped entries leave no renderable ghost folder')
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

// ── activity edge cases ──
// Placement pointing at a folder that no longer exists contributes nothing.
const dang = folderActivity({ folders: [{ id: 'a', parent: null }], placed: { s: 'gone' } }, [{ id: 's', unread: true, is_active: true }])
assert(dang.size === 0, 'activity: placement into a missing folder is ignored')
assert(folderActivity(A, null).size === 0, 'activity: null rows give an empty map')
assert(folderActivity(A, undefined).size === 0, 'activity: undefined rows give an empty map')
// Siblings sum into their shared parent, and the sum reaches every ancestor.
let S = normalize(null)
S = ops.addFolder(S, null, 'Root', 'r'); S = ops.addFolder(S, 'r', 'Top', 'top')
S = ops.addFolder(S, 'top', 'K1', 'k1'); S = ops.addFolder(S, 'top', 'K2', 'k2')
S = ops.placeSession(S, 's1', 'k1'); S = ops.placeSession(S, 's2', 'k1'); S = ops.placeSession(S, 's3', 'k2')
const sib = folderActivity(S, [{ id: 's1', unread: true }, { id: 's2', unread: true }, { id: 's3', unread: true }])
assert(sib.get('k1')?.unread === 2, 'activity: two unread chats in one folder count 2')
assert(sib.get('k2')?.unread === 1, 'activity: sibling folder counts only its own chat')
assert(sib.get('top')?.unread === 3, 'activity: parent sums both sibling folders')
assert(sib.get('r')?.unread === 3, 'activity: sum reaches the root, not just the parent')
// Active with no unread: badge is active with a zero count, all the way up.
const onlyAct = folderActivity(S, [{ id: 's3', is_active: true }])
assert(['k2', 'top', 'r'].every(f => onlyAct.get(f)?.unread === 0 && onlyAct.get(f).active === true), 'activity: active-only chat marks folder and every ancestor active with 0 unread')
assert(!onlyAct.has('k1'), 'activity: active-only chat leaves the sibling folder unbadged')
// A parent cycle (ops refuse it, so build it by hand) must not hang and must
// not multiply: ancestorsOf stops at the first revisit, so each folder on the
// cycle counts the unread chat exactly once (est-vssmr).
const faCyc = folderActivity({ folders: [{ id: 'a', parent: 'c' }, { id: 'c', parent: 'a' }], placed: { s: 'a' } }, [{ id: 's', unread: true }])
assert(faCyc.has('a') && faCyc.has('c'), 'activity: parent cycle returns and badges both folders')
assert(faCyc.get('a').active === false && faCyc.get('c').active === false, 'activity: parent cycle with no active chat stays inactive')
assert(faCyc.get('a').unread === 1 && faCyc.get('c').unread === 1, 'activity: parent cycle counts the unread chat exactly once per folder (est-vssmr)')

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
// hand-edited export files exercise the defensive branches the round-trip never hits
const junk = importLayout(JSON.stringify({ format: 'pinned-folders/layout@1', folders: [{ id: 'p', name: 'P' }, { id: 'x', name: 7 }, { id: 'y' }, 42], placed: { s: 7, t: null, u: 'p' }, order: ['b', 3, null, 'a'] }))
assert(junk.folders.length === 1 && junk.folders[0].id === 'p', 'import drops folder entries missing a string id or name')
assert(Object.keys(junk.placed).join() === 'u', 'import keeps only string placements pointing at real folders')
assert(junk.order.join() === 'b,a', 'import keeps only string ids in order')
assert(importLayout(JSON.stringify({ format: 'pinned-folders/layout@1', folders: [] })).order.length === 0, 'import defaults a missing order to empty')
const colr = importLayout(JSON.stringify({ format: 'pinned-folders/layout@1', folders: [{ id: 'p', name: 'P', color: 3.14 }], placed: {}, order: [] }))
assert(!('color' in colr.folders[0]), 'import drops a non-string color instead of writing junk into state')
assert(colr.foldersOrdered === true, 'import marks imported folders as manually ordered')
// exportLayout's side of the contract: tagged envelope, hand-editable pretty
// print, and exactly the portable keys — UI-only state never leaves the device.
const EX = ops.toggle(ops.placeSession(E, 'z', 'ts'), 'ts') // place a chat, collapse its folder
const env = JSON.parse(exportLayout(EX))
assert(Object.keys(env).join() === 'format,folders,placed,order', 'export carries exactly the four portable keys')
assert(!('collapsed' in env), 'export never leaks collapsed (UI-only) state')
assert(env.format === 'pinned-folders/layout@1', 'export carries the layout tag')
assert(exportLayout(EX).includes('\n  '), 'export is pretty-printed so hand edits survive import')
const rz = importLayout(exportLayout(EX))
assert(rz.order.join() === EX.order.join(), 'round-trip preserves manual order')
assert(Object.keys(rz.collapsed).length === 0, 'import resets collapsed instead of trusting the file')

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

// ── click gestures + chatMenuItems: delta batch — complements the #12-era
// click tests above. That block already covers bare/shift/meta clicks through
// the spies and the basic menu labels; this batch adds only the delta: the
// ctrl gesture, handlePinnedRowClick return values + consume flags per path,
// the Move to header, per-folder indent/disabled, the Unsorted pair, the
// canUnpin=false guidance label, Delete destructive, and Open-in-new-tab
// routing. Exported by BOTH builds; these assertions use only entries the
// #full fences leave in the catalog build (Rename / Mark read / Archive are
// full-only).
const GD = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }
assert(pinnedRowClick({ ...GD, ctrlKey: true }) === 'tab', 'gesture: ctrl opens in a new tab')
// est-nj9n0: mapper precedence edges the batches above leave unpinned.
assert(pinnedRowClick({ ...GD, altKey: true }) === 'open', 'gesture: alt alone opens (alt never maps to tab here)')
assert(pinnedRowClick({ ...GD, ctrlKey: true, shiftKey: true }) === 'tab', 'gesture: ctrl+shift takes the tab branch before bare-shift unpin — unpin must not fire')
assert(pinnedRowClick({ ...GD, metaKey: true, ctrlKey: true }) === 'tab', 'gesture: meta+ctrl opens in a new tab')
assert(pinnedRowClick({ ...GD, altKey: true, ctrlKey: true, shiftKey: true }) === 'open', 'gesture: alt+ctrl+shift stays on the archive-substitute branch (open)')
{
  const spy = { opens: [], unpins: 0, prevented: 0, stopped: 0 }
  const ev = { ...GD, shiftKey: true, preventDefault: () => spy.prevented++, stopPropagation: () => spy.stopped++ }
  const ret = handlePinnedRowClick(ev, { open: i => spy.opens.push(i), unpin: () => spy.unpins++ })
  assert(ret === 'unpin' && spy.unpins === 1 && spy.prevented === 1 && spy.stopped === 1 && !spy.opens.length,
    'handlePinnedRowClick unpin path: unpin() + preventDefault + stopPropagation, no open, returns the action')
  const spy2 = { opens: [], prevented: 0, stopped: 0 }
  const ret2 = handlePinnedRowClick({ ...GD, ctrlKey: true, preventDefault: () => spy2.prevented++, stopPropagation: () => spy2.stopped++ }, { open: i => spy2.opens.push(i), unpin: () => spy.unpins++ })
  assert(ret2 === 'tab' && spy2.opens.join() === 'tab' && !spy2.prevented && !spy2.stopped,
    'handlePinnedRowClick modifier path: open("tab"), returns tab, consumes nothing, never unpins')
  const spy3 = { opens: [] }
  const ret3 = handlePinnedRowClick({ ...GD, preventDefault: () => {}, stopPropagation: () => {} }, { open: i => spy3.opens.push(i), unpin: () => spy.unpins++ })
  assert(ret3 === 'open' && spy3.opens.length === 1 && spy3.opens[0] === undefined,
    'handlePinnedRowClick plain path: open() with undefined intent (not "tab"), returns open')
}
{
  // Flat tree mirroring the pane's render order: Work (depth 0) > Infra (depth 1),
  // with the row currently living in Infra.
  const flat = [{ f: { id: 'w', name: 'Work' }, depth: 0 }, { f: { id: 'i', name: 'Infra' }, depth: 1 }]
  const fm = chatMenuItems({ id: 's1' }, { fid: 'i', flat, canUnpin: true, act: menuAct })
  assert(fm.some(it => it && it.header === 'Move to'), 'chatMenuItems carries the Move to section header')
  const folderItems = fm.filter(it => it && it.icon === 'folder')
  assert(folderItems.length === flat.length && folderItems.map(it => it.indent).join() === '0,1',
    'Move to renders one item per flat folder, indented by tree depth')
  assert(folderItems.find(it => it.label === 'Infra').disabled === true && folderItems.find(it => it.label === 'Work').disabled === false,
    "the chat's current folder (f.id === fid) is the only disabled Move-to entry")
  assert(fm.find(it => it.label === 'Unsorted').disabled === false, 'Unsorted is enabled while the chat sits in a folder')
  assert(chatMenuItems({ id: 's1' }, { fid: null, flat: [], canUnpin: true, act: menuAct }).find(it => it.label === 'Unsorted').disabled === true,
    'Unsorted is disabled when the chat is already Unsorted (fid === ROOT)')
  const noUnpin = chatMenuItems({ id: 's1' }, { fid: null, flat: [], canUnpin: false, act: menuAct }).find(it => /^Unpin/.test(it.label || ''))
  assert(/update Desktop/i.test(noUnpin.label),
    'canUnpin=false: Unpin label names the fix (update Desktop)')
  assert(fm.find(it => it.label === 'Delete…').destructive === true, "Delete… is the menu's destructive entry")
  const tabCalls = []
  chatMenuItems({ id: 's1' }, { fid: 'i', flat, canUnpin: true, act: { ...menuAct, open: i => tabCalls.push(i) } })
    .find(it => it.label === 'Open in new tab').onSelect()
  assert(tabCalls.join() === 'tab', "chatMenuItems 'Open in new tab' routes act.open('tab')")
}
// ── filter menu: view state (#12) ──
const { normalizeView, narrowView, orderRows, applyView, DEFAULT_VIEW } = mod
const legacy = { folders: [{ id: 'w', name: 'Work', parent: null, color: 'hsl(1 2% 3%)' }], placed: { a: 'w' }, order: ['a'], collapsed: { w: true }, foldersOrdered: true }
const loaded = normalize(JSON.parse(JSON.stringify(legacy)))
assert(JSON.stringify(loaded.view) === JSON.stringify(DEFAULT_VIEW), 'old layout without view state loads with default view')
assert(JSON.stringify({ ...loaded, view: undefined }) === JSON.stringify({ ...legacy, view: undefined }), 'old layout keeps folders, colors, placement, order, collapse unchanged')
assert(JSON.stringify(normalizeView({ order: 'sideways', status: 42, unreadOnly: 'yes' })) === JSON.stringify(DEFAULT_VIEW), 'garbage view values fall back to defaults')
// ── normalizeView edges: the persisted-view migration boundary. This function
// rewrites user view state on every load, so "never break user state" applies to
// it field-by-field: valid survives untouched, invalid repairs alone, truthy
// non-true never counts as a filter.
{
  const nvFull = { order: 'recent', unreadOnly: true, status: 'working', profile: 'current' }
  assert(JSON.stringify(normalizeView(nvFull)) === JSON.stringify(nvFull), 'a fully-valid view passes through byte-identical (no silent coercion of user state)')
  const nvHalf = normalizeView({ order: 'recent', status: 'nope', profile: 'current' })
  assert(nvHalf.order === 'recent' && nvHalf.profile === 'current' && nvHalf.status === 'all' && nvHalf.unreadOnly === false,
    'mixed valid/invalid keeps every valid field, repairs only the bad ones')
  for (const truthy of ['yes', 1, {}, []])
    assert(normalizeView({ unreadOnly: truthy }).unreadOnly === false, 'unreadOnly honors only true: ' + JSON.stringify(truthy) + ' is not a filter')
  for (const junk of [null, undefined, 'recent', 42, []])
    assert(JSON.stringify(normalizeView(junk)) === JSON.stringify(DEFAULT_VIEW), 'non-object view input falls back to defaults (' + String(junk) + ')')
  // Drift guard on the menu vocabulary seen through the normalizer: if a choice
  // is renamed or dropped, its round-trip fails here before the menu mis-repairs.
  for (const patch of [{ order: 'recent' }, { status: 'unread' }, { status: 'working' }, { profile: 'current' }])
    assert(JSON.stringify(normalizeView({ ...DEFAULT_VIEW, ...patch })) === JSON.stringify({ ...DEFAULT_VIEW, ...patch }), 'menu choice round-trips: ' + JSON.stringify(patch))
  assert(Object.isFrozen(DEFAULT_VIEW), 'DEFAULT_VIEW is frozen (a stray mutation would corrupt every default)')
  const nvWrap = normalize({ folders: [], foldersOrdered: true, view: { order: 'recent', status: 'nope' } })
  assert(nvWrap.view.order === 'recent' && nvWrap.view.status === 'all', 'normalize repairs a half-valid view field-by-field, not by wiping it')
}
// viewFilters / viewIsDefault: the menu's enable lines. Order is not a filter,
// so the two predicates differ exactly on `order` — pin the seam.
const { viewFilters, viewIsDefault } = mod
assert(viewFilters(normalize(null).view) === false && viewIsDefault(normalize(null).view) === true, 'a fresh view filters nothing and reads as default (Reset view disabled)')
assert(viewFilters({ order: 'recent', unreadOnly: false, status: 'all', profile: 'all' }) === false, 'ordering Most recent alone filters nothing')
assert(viewIsDefault({ order: 'recent', unreadOnly: false, status: 'all', profile: 'all' }) === false, '...but the view is no longer default (Reset view enabled)')
for (const patch of [{ unreadOnly: true }, { status: 'unread' }, { status: 'working' }, { profile: 'current' }]) {
  const v = { ...DEFAULT_VIEW, ...patch }
  assert(viewFilters(v) === true && viewIsDefault(v) === false, `${JSON.stringify(patch)} is both a filter and a departure from default`)
}
assert(viewFilters({ order: 'sideways', status: 42, unreadOnly: 'yes' }) === false && viewIsDefault({ order: 'sideways', status: 42, unreadOnly: 'yes' }) === true, 'a garbage view normalises to default before either predicate reads it')
assert(viewIsDefault(ops.resetView(ops.setView(normalize(null), { unreadOnly: true, order: 'recent' })).view) === true, 'Reset view lands a dirtied view back on the default')
const recRows = [{ id: 'old', last_active: 100 }, { id: 'mid', last_active: 200 }, { id: 'new', last_active: 300 }]
assert(orderRows(recRows, ['old', 'new', 'mid'], 'manual').map(r => r.id).join() === 'old,new,mid', 'ordering Manual follows the dragged order')
assert(orderRows(recRows, ['old', 'new', 'mid'], 'recent').map(r => r.id).join() === 'new,mid,old', 'ordering Most recent sorts by last activity')
// orderRows edges: unranked rows sink to the tail in recency order; a missing
// order list is safe; recency falls back to started_at when last_active is absent.
assert(orderRows([...recRows, { id: 'x', last_active: 400 }], ['new'], 'manual').map(r => r.id).join() === 'new,x,mid,old', 'ordering Manual keeps ranked rows first and sinks unranked ones by recency')
assert(orderRows(recRows, null, 'manual').map(r => r.id).join() === 'new,mid,old', 'ordering Manual with no order list falls back to recency')
assert(orderRows([{ id: 'a', started_at: 50 }, { id: 'b', started_at: 60 }], [], 'recent').map(r => r.id).join() === 'b,a', 'recency reads started_at when last_active is absent')
assert(orderRows([], ['ghost'], 'manual').length === 0, 'ordering an empty list is empty')
// applyView edges: unreadOnly and status compose; profile trims before compare.
assert(applyView([{ id: 'u', unread: true }, { id: 'w', is_active: true }, { id: 'uw', unread: true, is_active: true }], { unreadOnly: true, status: 'working' }, 'p').map(r => r.id).join() === 'uw', 'unreadOnly AND status compose (intersection, not union)')
assert(applyView([{ id: 'sp', profile: '  default  ' }], { profile: 'current' }, 'default').map(r => r.id).join() === 'sp', 'profile Current trims before comparing (padded profile still matches)')
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

// ── single-folder toggle (the caret click path) ──
let TG = ops.addFolder(ops.addFolder(normalize(null), null, 'Top', 'top'), 'top', 'Mid', 'mid')
TG = ops.toggle(TG, 'mid')
assert(TG.collapsed.mid === true && !('top' in TG.collapsed), 'toggle collapses just the clicked folder')
TG = ops.toggle(TG, 'mid')
assert(!('mid' in TG.collapsed), 'toggle again re-expands it')
assert(JSON.stringify(ops.toggle(normalize(null), 'ghost').collapsed) === '{"ghost":true}', 'toggle only ever writes the clicked id\'s key')

// ── persisted-state normalization: rename/addFolder (nightly sweep c, 10-26) ──
{
  const base = ops.addFolder(normalize(null), null, 'R', 'r')
  assert(ops.rename(base, 'r', '  Work  ').folders[0].name === 'Work',
    'rename stores the trimmed name, not the padded one')
  assert(ops.rename(base, 'r', 42).folders[0].name === '42',
    'rename coerces a numeric name via String() before trimming')
  const noop = ops.rename(base, 'ghost', 'Nope')
  assert(JSON.stringify(noop) === JSON.stringify(base),
    'rename on an unknown id returns a deep-equal state (no mutation)')
  const top = ops.addFolder(base, undefined, 'Top', 'n')
  const saved = top.folders.find(f => f.id === 'n')
  assert(saved.parent === null && JSON.stringify(JSON.parse(JSON.stringify(saved))) === JSON.stringify(saved),
    'addFolder with an absent parent stores parent null (JSON round-trip stable)')
  const kid = ops.addFolder({ ...base, collapsed: { r: true } }, 'r', 'Kid', 'k')
  assert(kid.folders.some(f => f.id === 'k' && f.parent === 'r') && !('r' in kid.collapsed),
    'addFolder into a collapsed parent clears the parent collapsed key')
}

// ── #13 review: Collapse all under a filter (F1), Open all = visible rows (F2) ──
const { collapseAllItem, chatsBeneath, visibleRows } = mod
let collapsed = 0
const caOff = collapseAllItem({ filtering: false, empty: false, collapse: () => collapsed++ })
caOff.onSelect()
assert(!caOff.disabled && caOff.label === 'Collapse all' && collapsed === 1, 'collapse all is enabled with no filter and runs the collapse')
const caOn = collapseAllItem({ filtering: true, empty: false, collapse: () => collapsed++ })
caOn.onSelect()
assert(caOn.disabled === true && /clear filters to collapse/i.test(caOn.label) && collapsed === 1, 'collapse all is disabled while a filter is active, with the reason in its label')
// est-om14c (nightly pass): the two branches the trio above leaves unpinned —
// the unfiltered branch's `disabled: !!empty` at empty:true, and the filtered
// branch's no-op onSelect, pinned explicitly per branch.
const caEmptyFn = () => { collapsed++ }
const caEmpty = collapseAllItem({ filtering: false, empty: true, collapse: caEmptyFn })
caEmpty.onSelect()
assert(caEmpty.disabled === true && caEmpty.label === 'Collapse all' && caEmpty.onSelect === caEmptyFn && collapsed === 2, 'collapse all is disabled when nothing can collapse, keeps its plain label, and still runs the passed collapse')
const caOnEmpty = collapseAllItem({ filtering: true, empty: true, collapse: () => collapsed++ })
caOnEmpty.onSelect()
assert(caOnEmpty.disabled === true && collapsed === 2, 'filtered collapse-all onSelect is a hard no-op (counter unchanged) even when empty:true')
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
// visibleRows edges (IDLE-DRIVE sweep): passthrough (default view and explicit
// null), null-list tolerance, empty and ghost views, the status/profile gates,
// and that the order comes from the INPUT list, not the chats-set insertion
// order. One local row array carries the is_active/profile fields the gates read.
const gWk = [
  { id: 'r1', title: 'read' },
  { id: 'u1', title: 'new', unread: true },
  { id: 'u2', title: 'news', unread: true, is_active: true },
  { id: 'r2', title: 'old', is_active: true, profile: 'here' },
]
const gDef = narrowView(G, gr, '', G.view, 'default')
assert(gDef === null, 'the default view narrows to null (null shows everything)')
assert(visibleRows(gr, gDef).map(r => r.id).join() === 'r1,u1,u2,r2', 'a null view passes every row through in input order')
assert(visibleRows(gr, null).map(r => r.id).join() === 'r1,u1,u2,r2', 'an explicit null view passes through identically')
assert(visibleRows(null, gUnread).length === 0 && visibleRows(undefined, null).length === 0, 'null/undefined lists return [] under a real view and under none')
assert(visibleRows(gr, { folders: new Set(), chats: new Set() }).length === 0, 'an empty view shows nothing')
assert(visibleRows(gr, { folders: new Set(), chats: new Set(['u1', 'ghost']) }).map(r => r.id).join() === 'u1', 'a ghost id in the view invents no rows')
const gWork = narrowView(G, gWk, '', ops.setView(G, { status: 'working' }).view, 'default')
assert(visibleRows(gWk, gWork).map(r => r.id).join() === 'u2,r2', 'status Working keeps only rows carrying is_active')
const gUn = narrowView(G, gWk, '', ops.setView(G, { status: 'unread' }).view, 'default')
assert(visibleRows(gWk, gUn).map(r => r.id).join() === 'u1,u2', 'status Unread keeps only unread rows')
const gPf = narrowView(G, gWk, '', ops.setView(G, { profile: 'current' }).view, 'here')
assert(visibleRows(gWk, gPf).map(r => r.id).join() === 'r2', 'profile Current keeps only the focused profile (no profile reads as default and is excluded)')
assert(visibleRows(gr, { folders: new Set(), chats: new Set(['r2', 'u1', 'r1']) }).map(r => r.id).join() === 'r1,u1,r2', 'visible order follows the input list, not the chats-set insertion order')
const gTu = narrowView(G, gr, 'new', ops.setView(G, { unreadOnly: true }).view, 'default')
assert(gTu.chats.size === 2 && gTu.chats.has('u1') && gTu.chats.has('u2'), 'text query and unread filter intersect (only matching unread rows survive)')
assert(visibleRows(gIn.get('w'), gTu).map(r => r.id).join() === 'u1', 'under text∩unread the w list shows only u1')

// Public-repo standard (issue #18): the private security route and the issue forms.
// Field-level checks only, run once (catalog pass). GitHub reads these files as config.
if (!FULL) {
  const repoFile = p => { try { return readFileSync(new URL('../' + p, import.meta.url), 'utf8') } catch { return '' } }
  const sec = repoFile('SECURITY.md')
  assert(sec.includes('/security/advisories/new') && /^#+\s*supported versions/im.test(sec) && /latest release/i.test(sec) && /within \d+ (?:business )?(?:hours?|days?)/i.test(sec),
    'SECURITY.md: private vulnerability reporting link, supported versions (latest release), response time')
  const cfg = repoFile('.github/ISSUE_TEMPLATE/config.yml')
  assert(/^blank_issues_enabled:\s*false\s*$/m.test(cfg) && /^\s*url:\s*\S*(?:SECURITY\.md|\/security\/policy)\s*$/m.test(cfg),
    'issue chooser: blank issues off, security reports routed to SECURITY.md')
  const bug = repoFile('.github/ISSUE_TEMPLATE/bug_report.md')
  const front = /^---\n([\s\S]*?)\n---\n/.exec(bug)?.[1] ?? ''
  const asks = ['hermes version', 'plugin version', 'steps to reproduce', 'expected', 'actual'].filter(k => !bug.toLowerCase().includes(k))
  assert(/^name:\s*\S/m.test(front) && /^about:\s*\S/m.test(front) && !/^labels:/m.test(front) && !asks.length,
    'bug template: name/about front matter, no auto-label (triage stays with the maintainer), asks ' + (asks.length ? 'MISSING ' + asks.join(', ') : 'Hermes version, plugin version, steps, expected vs actual'))
}

// register() writes through one door: store = ctx.storage, so mutateTree and
// markJudged are only testable once the plugin is registered. Stub the globals
// register() reaches (DOM for the hide-core observer, host for focus tracking)
// and hand it a Map-backed storage, then exercise the write paths behaviourally.
const { mutateTree, markJudged } = mod
if (FULL) {
  globalThis.document = { hidden: false, body: {}, querySelectorAll: () => [] }
  globalThis.MutationObserver = class { observe() {} disconnect() {} }
  globalThis.requestAnimationFrame = fn => (fn(), 1)
  globalThis.cancelAnimationFrame = () => {}
  globalThis.window = { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } }

  const mem = new Map([['autoJudged', []]])
  const writes = []
  const registered = []
  const disposed = []
  const CONN = 'conn-9'
  plugin.register({
    storage: {
      get: (k, d) => (mem.has(k) ? mem.get(k) : d),
      set: (k, v) => { writes.push(k); mem.set(k, v) },
      remove: k => { mem.delete(k) }
    },
    os: { writeText: () => {} },
    register: entry => registered.push(entry),
    onDispose: fn => { disposed.push(fn); return () => {} }
  })
  assert(registered.map(e => e.id).join() === 'auto-pin,pane', 'register() registers the composer middleware and the pane')

  // mutateTree: a new tree writes exactly once, at the connection-scoped key.
  const tk = 'tree.' + CONN
  const before = writes.length
  const written = mutateTree(tk, t => ({ ...t, order: [...t.order, 's1'] }))
  assert(writes.length === before + 1 && writes[before] === tk, 'mutateTree writes the tree once, at tree.<connectionId>')

  // mutateTree: a handler that returns the tree it was given is a no-op write.
  const same = before + 1
  mutateTree(tk, t => t)
  assert(writes.length === same, 'mutateTree skips the write when the mutation returns the same tree')

  // markJudged: appends, dropping blanks and ids already judged.
  mem.set('autoJudged', ['seed'])
  markJudged(['x', 'x', null, 'y', 'seed'])
  assert(mem.get('autoJudged').join() === 'seed,x,y', 'markJudged appends de-duplicated ids after the ones already judged')

  // markJudged: the ledger keeps the most recent 1000 ids, oldest evicted first.
  mem.set('autoJudged', Array.from({ length: 999 }, (_, i) => 'j' + i))
  markJudged(Array.from({ length: 20 }, (_, i) => 'k' + i))
  const ledger = mem.get('autoJudged')
  assert(ledger.length === 1000 && ledger[0] === 'j19' && ledger[999] === 'k19',
    'markJudged caps the judged ledger at the newest 1000 ids, evicting the oldest')
}

// --- sdk-contract.mjs prints the checkout's ACTUAL short HEAD, never a
// hardcoded literal: a drift probe at upstream main must not read like a pin
// check. Fake checkout = one index.ts whose plain star
// re-export resolves every imported name.
{
  const dir = mkdtempSync(join(tmpdir(), 'pf-sdkgate-'))
  const failFixture = (what) => { console.error('FAIL sdk-contract fixture: ' + what); process.exit(1) }
  mkdirSync(join(dir, 'apps/desktop/src/sdk'), { recursive: true })
  writeFileSync(join(dir, 'apps/desktop/src/sdk/index.ts'), "export * from './real'\n")
  // GIT_CEILING_DIRECTORIES: the no-git assertion walks up looking for an
  // enclosing work tree; the ceiling makes the fixture inert anywhere tmp
  // sits inside a repo, not just on CI's /tmp.
  const run = () => spawnSync('node', [fileURLToPath(new URL('../scripts/sdk-contract.mjs', import.meta.url)), dir],
    { encoding: 'utf8', env: { ...process.env, GIT_CEILING_DIRECTORIES: tmpdir() } })
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: { ...process.env, HOME: dir, GIT_CONFIG_NOSYSTEM: '1' } })
  const rNoGit = run()
  assert(rNoGit.status === 0 && /resolved at unknown/.test(rNoGit.stdout),
    'sdk-contract: a non-git checkout honestly reports at unknown, exit 0 unchanged')
  if (git('init', '-q').status !== 0) failFixture('init')
  if (git('add', '-A').status !== 0) failFixture('add')
  if (git('-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'fixture').status !== 0) failFixture('commit')
  const head = git('rev-parse', '--short', 'HEAD').stdout.trim()
  const rGit = run()
  assert(rGit.status === 0, 'sdk-contract: exit 0 when the checkout star-re-exports every imported name')
  assert(rGit.stdout.includes('resolved at ' + head),
    'sdk-contract OK line carries the checkout short HEAD (' + head + '), not a fixed label')
  rmSync(dir, { recursive: true, force: true })
}
// ── unpinAndReconcile pacing contract via injected seams (both builds; est-u4zo4) ──
// Pins the reconcile pacing: refresh never exceeds the reads budget; sleep fires
// exactly once between reads (never before the first) with the injected gapMs;
// a row vanishing only at the final read still prunes. Full build short-circuits
// on the real PATCH ack, so its pacing shape is zero reads / zero sleeps.
{
  const prevWin = globalThis.window
  if (FULL) globalThis.window = { hermesDesktop: { api: async () => ({}) }, localStorage: { length: 0, key: () => null, getItem: () => null, setItem: () => {} } }
  // vanishAt: the refresh number on which the row first drops off (Infinity -> reads always keep the id)
  const paced = async (reads, gapMs, vanishAt) => {
    const h = { trace: [], sleeps: [], forgot: [], errs: [], refreshes: 0 }
    const out = await mod.unpinAndReconcile({ id: 's1', profile: 'p1' }, {
      sessionsHost: { sessions: { pin: async () => {} } },
      refresh: async () => { h.trace.push('R'); return ++h.refreshes >= vanishAt ? [{ id: 's0' }] : [{ id: 's1' }] },
      forget: id => h.forgot.push(id),
      notifyError: e => h.errs.push(e.message),
      reads,
      sleep: async ms => { h.trace.push('S'); h.sleeps.push(ms) },
      gapMs
    })
    return { h, out }
  }
  let r = await paced(3, 250, Infinity)
  assert(r.out === (FULL ? 'pruned' : 'kept') && r.h.forgot.join() === (FULL ? 's1' : ''),
    'pacing: acked unpin prunes at once (full) / keeps placement while every read still lists the id (catalog) -> ' + r.out)
  assert(r.h.refreshes === (FULL ? 0 : 3), 'pacing: refresh calls never exceed reads (' + r.h.refreshes + ' for reads=3)')
  assert(r.h.sleeps.length === (FULL ? 0 : 2), 'pacing: sleep awaited exactly reads-1 times (' + r.h.sleeps.length + ')')
  assert((FULL ? '' : 'R,S,R,S,R') === r.h.trace.join(',') && (FULL || r.h.sleeps.every(ms => ms === 250)),
    'pacing: every gap carries the injected gapMs=250 and none fires before the first read (' + r.h.trace.join(',') + ')')
  assert(!r.h.errs.length, 'pacing: an acked pin records no notifyError')
  r = await paced(3, 250, 3)
  assert(r.out === 'pruned' && r.h.forgot.join() === 's1' && r.h.refreshes === (FULL ? 0 : 3) && r.h.sleeps.length === (FULL ? 0 : 2),
    'pacing: row vanishing only at the final read still returns pruned after the full read+gap budget (' + r.h.trace.join(',') + ')')
  if (prevWin) globalThis.window = prevWin; else delete globalThis.window
}

// ── filterView path-reveal contract (both builds; est-7t0s2) ──
// Six clauses of how one query reveals the tree: a folder-name hit with nothing
// beneath pulls its chain and adds no chats; placement under a name-matching
// folder lands a chat in .chats with no text hit of its own; a chat text hit
// drags its FULL placement chain into .folders (the row-loop chain.forEach,
// not the folder-name loop); placement under a dead folder id degrades to
// unplaced with no phantom folder; unplaced rows match by text alone; and the
// whole match is case-insensitive. Fixture built through ops, as the pane does.
{
  let G = normalize(null)
  G = ops.addFolder(G, null, 'Root', 'rt'); G = ops.addFolder(G, 'rt', 'Mid', 'md'); G = ops.addFolder(G, 'md', 'Leaf', 'lf')
  G = ops.addFolder(G, null, 'Other', 'ot'); G = ops.addFolder(G, null, 'Zeta', 'zet')
  G = ops.placeSession(G, 'deep', 'lf'); G = ops.placeSession(G, 'flat', 'ot')
  const rows = [{ id: 'deep', title: 'Q4 budget', preview: 'roadmap' }, { id: 'flat', title: 'Vacation plans' }, { id: 'loose', title: 'Grocery list' }]
  const j1 = filterView(G, rows, 'zet')
  assert(j1.folders.has('zet') && j1.chats.size === 0, 'path-reveal: folder-name hit with nothing beneath pulls its chain, adds no chats')
  const j2 = filterView(G, rows, 'leaf')
  assert(j2.chats.has('deep') && !j2.chats.has('flat'), 'path-reveal: chat lands in .chats purely by placement under a name-matching folder')
  const j3 = filterView(G, rows, 'budget')
  assert(j3.chats.has('deep') && j3.folders.has('lf') && j3.folders.has('md') && j3.folders.has('rt'), 'path-reveal: chat text hit pulls its FULL placement chain lf,md,rt into .folders')
  let j4 = null, j4err = ''
  try { j4 = filterView({ folders: [{ id: 'f', name: 'Alpha', parent: null }], placed: { g: 'ghost' }, order: [], collapsed: {} }, [{ id: 'g', title: 'zzz' }], 'alpha') } catch (e) { j4err = String(e && e.message) }
  assert(!j4err && j4.folders.has('f') && !j4.folders.has('ghost') && j4.chats.size === 0, 'path-reveal: placement under an unknown folder id degrades to unplaced, no phantom folder')
  const j5 = filterView(G, rows, 'grocery')
  assert(j5.chats.has('loose') && j5.folders.size === 0, 'path-reveal: unplaced rows match by text only')
  const j6 = filterView(G, rows, 'BUDGET')
  const joinSet = s => [...s].sort().join(',')
  assert(joinSet(j6.folders) === joinSet(j3.folders) && joinSet(j6.chats) === joinSet(j3.chats), 'path-reveal: case-insensitive, BUDGET equals budget in .folders and .chats')
}

// ── menuChildren contract (both builds; est-831vb) ──
// The one item list feeding both the ⋯ dropdown and the right-click menu, pinned
// through the jsx recorder stub — no renderer. Eight clauses: (1) falsy entries drop
// BEFORE index/key minting, so a conditional item renumbers every survivor; (2) '-'
// becomes the kit's own Separator with empty props; (3) headers are plain tertiary
// 'div's, never kit items; (4) items carry variant destructive/default with disabled
// and onSelect passed through; (5) indent math is exactly paddingLeft 8+12*i and a
// falsy indent keeps style undefined; (6) the children slot is the fixed
// [icon-or-null at key 'i', label span at key 'l'] pair; (7) swatches rows wrap
// ColorSwatches in a 176px stopPropagation div carrying value||null, the row's own
// onChange and clearLabel 'Default color'; (8) keys are kind-tagged, positional and
// identical across repeated calls.
{
  const { menuChildren } = mod
  const KIT = { Item: 'KIT-ITEM', Separator: 'KIT-SEP' }
  const on = () => 'sel'
  const holes = menuChildren([null, '-', false, { header: 'H' }, { label: 'Go', onSelect: on }], KIT)
  assert(holes.length === 3 && holes.map(e => e.key).join() === 'sep0,h1,m2',
    'menuChildren holes: null/false entries drop before keys are minted — survivors get compacted positional keys')
  assert(holes[0].type === KIT.Separator && Object.keys(holes[0].props).length === 0,
    "menuChildren separator: '-' renders the kit's own Separator with an empty props object")
  assert(holes[1].type === 'div' && holes[1].props.className === 'text-(--ui-text-tertiary)' && holes[1].props.children === 'H' &&
    holes[1].props.style.padding === '4px 8px 2px' && holes[1].props.style.fontSize === '0.6875rem',
    'menuChildren header: a plain tertiary div with the exact padding/typography style, never a kit item')
  const v = menuChildren([{ label: 'A', onSelect: on }, { label: 'B', destructive: true, disabled: true }], KIT)
  assert(v[0].type === KIT.Item && v[0].props.variant === 'default' && v[0].props.onSelect === on && v[0].props.disabled === undefined &&
    v[1].props.variant === 'destructive' && v[1].props.disabled === true,
    "menuChildren variant: plain items get variant 'default' with disabled/onSelect passed through; destructive:true flips to 'destructive'")
  const ind = menuChildren([{}, { label: 'x', indent: 1 }, { label: 'y', indent: 3 }, { label: 'z', indent: 0 }], KIT)
  assert(ind.map(e => (e.props.style ? e.props.style.paddingLeft : 'undef').toString()).join() === 'undef,20,44,undef',
    'menuChildren indent: paddingLeft is exactly 8+12*i (1 -> 20, 3 -> 44); falsy indent keeps style undefined')
  const pair = menuChildren([{ label: 'No icon' }, { label: 'With', icon: 'pinned' }], KIT)
  const kids = e => e.props.children.map(c => (c === null ? 'null' : (typeof c.type === 'function' ? c.type.name : c.type) + ':' + c.key)).join()
  assert(kids(pair[0]) === 'null,span:l' && kids(pair[1]) === 'Codicon:i,span:l' && pair[1].props.children[1].props.children === 'With',
    "menuChildren children slot: the fixed [icon-or-null at key 'i', label span at key 'l'] pair — the label span is unconditional")
  const onChange = () => 'chg'
  const sw = menuChildren([{ swatches: true, value: 'red', onChange }, { swatches: true }], KIT)
  let stopped = 0
  sw[0].props.onClick({ stopPropagation: () => stopped++ })
  const inner = e => e.props.children
  // The wrapper passes the SDK's PROFILE_SWATCHES by reference; under the test stub
  // that constant is the name-inferred `()=>null` arrow, so identity shows as .name.
  assert(sw[0].type === 'div' && sw[0].key === 'sw0' && sw[0].props.style.width === 176 && stopped === 1 &&
    typeof inner(sw[0]).type === 'function' && inner(sw[0]).type.name === 'ColorSwatches' &&
    typeof inner(sw[0]).props.swatches === 'function' && inner(sw[0]).props.swatches.name === 'PROFILE_SWATCHES' &&
    inner(sw[0]).props.value === 'red' && inner(sw[0]).props.onChange === onChange &&
    inner(sw[0]).props.clearLabel === 'Default color' && inner(sw[1]).props.value === null,
    "menuChildren swatches: ColorSwatches inside a 176px stopPropagation div, carrying value||null, the row's own onChange, clearLabel 'Default color'")
  const MIX = ['-', { swatches: true, onChange }, { header: 'H' }, { label: 'L' }]
  assert(menuChildren(MIX, KIT).map(e => e.key).join() === 'sep0,sw1,h2,m3' &&
    menuChildren(MIX, KIT).map(e => e.key).join() === 'sep0,sw1,h2,m3',
    'menuChildren keys: kind-tagged and positional (sep/sw/h/m + index), identical across repeated calls')
}


// ── chatsBeneath recursion + empty-folder contract (both builds; est-uqarl) ──
// Five clauses of the recursion itself, on hand-built Maps (sessionsIn: folderId ->
// ordered rows; childFolders: folderId -> [{id}]): (1) a children-only folder has no
// direct sessionsIn key yet returns its descendants — under a view AND under null — and
// that keyless node adds nothing mid-recursion; (2) precedence lock: the parent's own
// visible rows strictly precede every child folder's rows, re-checked inside the depth-2
// subtree; (3) grandchildren are visited in childFolders.get(fid) ARRAY INSERTION ORDER:
// [A,B] puts A's whole subtree before B's, the swapped control flips it; (4) an unknown
// fid is [] with both Maps missing, no throw; (5) visibleRows gates at EVERY level — a
// folder whose own rows all filter out contributes nothing while deeper rows survive,
// and excluded rows at depth >= 1 never leak. Empty-folder here = a folder holding no
// directly-placed chats, the shape countIn/open-all hit on any group-by-parent tree.
{
  const row = id => ({ id, title: 'T-' + id })
  const ids = list => (list || []).map(x => x.id)
  const sIn = new Map([['rt', [row('p1'), row('p2')]], ['A', [row('a1'), row('aX')]],
    ['A1', [row('a11'), row('a1X')]], ['B', [row('b1')]], ['C', [row('c1')]]])
  const cIn = new Map([['rt', [{ id: 'A' }, { id: 'B' }]], ['A', [{ id: 'A1' }]], ['mid', [{ id: 'C' }]]])
  const fold = new Set(['rt', 'A', 'A1', 'B', 'C', 'mid'])
  const V1 = { folders: fold, chats: new Set(['p1', 'p2', 'a1', 'aX', 'a11', 'a1X', 'b1', 'c1']) }
  const V2 = { folders: fold, chats: new Set(['a1', 'b1']) }
  const V3 = { folders: fold, chats: new Set(['p1', 'a11']) }
  const deep = new Map([...cIn, ['rt', [{ id: 'A' }, { id: 'B' }, { id: 'mid' }]]])
  const swap = new Map([...cIn, ['rt', [{ id: 'B' }, { id: 'A' }]]])
  // precedence alone (exact membership, no foreign leak), so sibling order
  // (clause 3) cannot borrow this assert's red
  const firstBefore = (seq, own, kids) => seq.length === own.length + kids.length &&
    seq.every(id => own.includes(id) || kids.includes(id)) &&
    own.every(o => kids.every(k => seq.indexOf(o) < seq.indexOf(k)))
  let errA = '', gotA = ''
  try { gotA = ids(chatsBeneath('mid', sIn, cIn, V1)).join() + '|' + ids(chatsBeneath('mid', sIn, cIn, null)).join() +
      '|' + ids(chatsBeneath('rt', sIn, deep, V1)).join() } catch (e) { errA = String(e && e.message) }
  assert(!errA && gotA === 'c1|c1|p1,p2,a1,aX,a11,a1X,b1,c1',
    'chatsBeneath sessionsIn miss: a children-only folder returns its descendants under a view and under null, no throw, and adds nothing at the keyless node mid-recursion (' + (errA || gotA) + ')')
  assert(firstBefore(ids(chatsBeneath('rt', sIn, cIn, V1)), ['p1', 'p2'], ['a1', 'aX', 'a11', 'a1X', 'b1']) &&
    firstBefore(ids(chatsBeneath('A', sIn, cIn, V1)), ['a1', 'aX'], ['a11', 'a1X']),
    'chatsBeneath precedence: a parent\'s own visible rows strictly precede every child-folder row, at the root and again one level down')
  assert(ids(chatsBeneath('rt', sIn, cIn, V1)).join() === 'p1,p2,a1,aX,a11,a1X,b1' &&
    ids(chatsBeneath('rt', sIn, swap, V1)).join() === 'p1,p2,b1,a1,aX,a11,a1X',
    'chatsBeneath DFS order: childFolders.get(fid) array insertion order drives the walk — [A,B] yields A\'s WHOLE subtree then B, the [B,A] control flips it')
  let errB = '', gotB = ''
  try { gotB = ids(chatsBeneath('zzz', sIn, cIn, V1)).length + ',' + ids(chatsBeneath('zzz', sIn, cIn, null)).length +
      ',' + ids(chatsBeneath('C', sIn, cIn, V1)).length } catch (e) { errB = String(e && e.message) }
  assert(!errB && gotB === '0,0,1',
    'chatsBeneath unknown fid: [] from both Map misses, with a view and without, no throw (a leaf that has rows still returns them) (' + (errB || gotB) + ')')
  assert(ids(chatsBeneath('rt', sIn, cIn, V2)).join() === 'a1,b1' &&
    ids(chatsBeneath('rt', sIn, cIn, V3)).join() === 'p1,a11',
    'chatsBeneath view at EVERY level: rt\'s own rows all filtering out contributes nothing while child rows survive (a1,b1), a depth-2-only visible row surfaces alone (p1,a11), excluded rows at depth >= 1 never leak')
}
