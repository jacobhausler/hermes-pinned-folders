// SDK contract gate: every name desktop/plugin.js imports from
// @hermes/plugin-sdk must actually exist in the pinned hermes-agent checkout.
// The catalog build's stub-based tests cannot see an upstream removal — this
// gate reads the real apps/desktop/src/sdk/index.ts in the checkout it is given.
//
// The gate also covers the host SURFACE: every `host.<path>` (depth <=2, `?.`
// normalized) dereferenced by the repo's own full/plugin.js must exist on the
// checkout's `export const host = {` literal — see the host section below.
//
// Usage: node scripts/sdk-contract.mjs <path-to-hermes-agent-checkout>
// Exit 0: every import and host path resolved. Exit 1: `MISSING: <names>`
// and/or one `host-drift: MISSING <path>` line per missed path printed.
// The OK line prints the checkout's ACTUAL short HEAD (or `unknown` when the
// checkout isn't a git tree) — a drift probe at upstream main must not read
// like a pin check (a fixed label once misled exactly that way).
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.argv[2]
if (!root) { console.error('usage: node scripts/sdk-contract.mjs <path-to-hermes-agent-checkout>'); process.exit(1) }
const indexTs = join(root, 'apps/desktop/src/sdk/index.ts')
if (!existsSync(indexTs)) { console.error('not a hermes-agent checkout (missing ' + indexTs + ')'); process.exit(1) }
const SRC_DIR = join(root, 'apps/desktop/src')
const git = spawnSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' })
const at = git.status === 0 ? git.stdout.trim() : 'unknown'

// ONE extractor shape, same regex family as tests/ops.test.mjs (the import gate
// precedent): capture the braces block AND the module specifier so we can keep
// only @hermes/plugin-sdk names. Every import in the catalog build must exist —
// desktop/plugin.js IS the catalog build, no #full fencing to strip.
const SDK_IMPORT = /import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g
const pluginJs = readFileSync(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const names = [...new Set(
  [...pluginJs.matchAll(SDK_IMPORT)]
    .filter(m => m[2] === '@hermes/plugin-sdk')
    .flatMap(m => m[1].split(','))
    .map(x => x.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim())
    .filter(Boolean)
)]
if (!names.length) { console.error('sdk-contract: extractor found no @hermes/plugin-sdk imports — gate is dead'); process.exit(1) }

const fileCache = new Map()
function readTs(stem) {
  for (const cand of [stem, stem + '.ts', stem + '.tsx', join(stem, 'index.ts'), join(stem, 'index.tsx')]) {
    if (fileCache.has(cand)) { if (fileCache.get(cand) !== null) return fileCache.get(cand); continue }
    if (existsSync(cand)) { const t = readFileSync(cand, 'utf8'); fileCache.set(cand, t); return t }
    fileCache.set(cand, null)
  }
  return null
}
function moduleStem(module) {
  if (module.startsWith('./') || module.startsWith('../')) return join(root, 'apps/desktop/src/sdk', module)
  if (module.startsWith('@/')) return join(SRC_DIR, module.slice(2))
  return null // resolves outside the checkout (node_modules etc.): trust it
}
function declares(name, text) {
  const q = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (new RegExp('export\\s+(?:const|function|class|let|var|async function|type)\\s+' + q + '\\b').test(text)) return true
  if (new RegExp('export\\s*\\{[^}]*[,{\\s]' + q + '[,\\s}]', 's').test(text)) return true
  return false
}
function resolveName(name, module, depth = 0) {
  if (depth > 4) return false
  const stem = moduleStem(module)
  if (stem === null) return true
  const text = readTs(stem)
  if (text === null) return false
  if (declares(name, text)) return true
  if (/export\s*\*\s*from/.test(text)) return true // plain star re-export: counts (a namespaced `export * as x from` does not)
  for (const m of text.matchAll(/export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gs)) {
    const ns = m[1].split(',').map(x => x.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()).filter(Boolean)
    if (ns.includes(name) && resolveName(name, m[2], depth + 1)) return true
  }
  return false
}

const top = readFileSync(indexTs, 'utf8')
const missing = names.filter(n => {
  if (declares(n, top)) return false
  for (const m of top.matchAll(/export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gs)) {
    const ns = m[1].split(',').map(x => x.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()).filter(Boolean)
    if (ns.includes(n) && resolveName(n, m[2])) return false
  }
  if (/export\s*\*\s*from/.test(top)) return false // plain star re-export: counts
  return true
})
for (const n of names) if (!missing.includes(n)) console.log('ok', n)
if (missing.length) { console.log('MISSING: ' + missing.join(', ')); process.exit(1) }

// ── host surface ───────────────────────────────────────────────────────────
// Every `host.<path>` the plugin's own source dereferences (full/plugin.js —
// the catalog build is its stripped subset, so the source is ground truth)
// must exist on the checkout's exported host object. Recognized entry shapes,
// all proven present at the CI pin AND at v0.23.1 — a key:-only parser reads
// false-red on real upstream drift (warmProfile moved inline-arrow ->
// shorthand-import between those refs):
//   - depth-1 `key:` entries and bare shorthand `key,` entries
//   - ONE inline nested object, resolved via its own depth-1 keys
//   - ONE named-reference hop: `sessions: sessionsHost` -> the relative
//     import in index.ts -> `export const sessionsHost = {` there, depth-1 keys
// Comments are blanked before key scanning so a `, word,` inside a JSDoc note
// cannot fake a shorthand entry. Same trust rule as the import gate above: a
// plain `export * from` in index.ts trusts the host surface wholesale. When
// full/plugin.js is absent (gate shipped without the source) the legacy
// import-only OK line stands.
const HOST_DEREF = /(?<![\w$.])host\.([A-Za-z_$][\w$]*)(?:\??\.([A-Za-z_$][\w$]*))?/g
const fullJs = new URL('../full/plugin.js', import.meta.url)

// Blanks block and line comments; copies string/template literals verbatim
// (so a `'//'` can't open a comment); consumes regex literals with the
// classic last-significant-char division heuristic and replaces them with a
// single `0` so the key scanner below never sees structural chars in disguise.
function blankComments(src) {
  let out = '', i = 0
  const n = src.length
  const regexAllowed = () => {
    let j = out.length - 1
    while (j >= 0 && /\s/.test(out[j])) j--
    return j < 0 || '(,=:[!&|?{};+-*%<>~^'.includes(out[j])
  }
  while (i < n) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue }
    if (c === '/' && src[i + 1] === '*') {
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (c === '/' && regexAllowed()) {
      i++
      let cls = false
      while (i < n) {
        const d = src[i]
        i++
        if (d === '\\') { i++; continue }
        if (d === '[') cls = true
        else if (d === ']') cls = false
        else if (d === '/' && !cls) break
      }
      while (i < n && /[a-z]/.test(src[i])) i++
      out += '0'
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      out += c; i++
      while (i < n) {
        const d = src[i]
        if (d === '\\') { out += d + (src[i + 1] ?? ''); i += 2; continue }
        if (c === '`' && d === '$' && src[i + 1] === '{') {
          out += '${'; i += 2
          let d2 = 1
          while (i < n && d2 > 0) {
            const e = src[i]
            if (e === '"' || e === "'" || e === '`') {
              out += e; i++
              while (i < n) {
                const q = src[i]
                if (q === '\\') { out += q + (src[i + 1] ?? ''); i += 2; continue }
                out += q; i++
                if (q === e) break
              }
              continue
            }
            if (e === '{') d2++
            else if (e === '}') d2--
            out += e; i++
          }
          continue
        }
        out += d; i++
        if (d === c) break
      }
      continue
    }
    out += c; i++
  }
  return out
}

// Depth-1 entries of the object literal whose `{` sits at src[open] (src must
// be comment-blanked): tracks (), [] and {} depth, skips string/template
// literals, and records only identifiers that start an entry (right after the
// opening `{` or a depth-1 comma) followed by `:` (key form) or `,`/`}` (bare
// shorthand). Values starting with `{` record nestedOpen for a lazy depth-1
// scan; values that are exactly one identifier record ident (the named-hop
// candidates). Anything else (arrows, calls) is a plain key.
function entriesOf(src, open) {
  const entries = new Map()
  let i = open + 1, depth = 1, atEntry = true
  const n = src.length
  while (i < n) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (c === '"' || c === "'" || c === '`') {
      i++
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue }
        if (c === '`' && src[i] === '$' && src[i + 1] === '{') {
          i += 2
          let d = 1
          while (i < n && d > 0) {
            if (src[i] === '{') d++
            else if (src[i] === '}') d--
            i++
          }
          continue
        }
        const q = src[i]
        i++
        if (q === c) break
      }
      atEntry = false
      continue
    }
    if (c === '{' || c === '[' || c === '(') { depth++; atEntry = false; i++; continue }
    if (c === '}' || c === ']' || c === ')') {
      depth--
      if (depth === 0) break
      atEntry = false; i++; continue
    }
    if (c === ',') { if (depth === 1) atEntry = true; i++; continue }
    if (atEntry && /[A-Za-z_$]/.test(c)) {
      let j = i
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++
      const name = src.slice(i, j)
      let k = j
      while (k < n && /\s/.test(src[k])) k++
      if (src[k] === ':') {
        let v = k + 1
        while (v < n && /\s/.test(src[v])) v++
        const e = { shorthand: false, ident: null, nestedOpen: -1 }
        if (src[v] === '{') e.nestedOpen = v
        else if (/[A-Za-z_$]/.test(src[v])) {
          let g = v
          while (g < n && /[A-Za-z0-9_$]/.test(src[g])) g++
          let f = g
          while (f < n && /\s/.test(src[f])) f++
          if (src[f] === ',' || src[f] === '}') e.ident = src.slice(v, g)
        }
        entries.set(name, e)
        i = v; atEntry = false
        continue
      }
      if (src[k] === ',' || src[k] === '}') {
        entries.set(name, { shorthand: true, ident: null, nestedOpen: -1 })
        i = k; atEntry = false
        continue
      }
      i = j; atEntry = false // not an entry key (e.g. `get x() {}` getters)
      continue
    }
    atEntry = false
    i++
  }
  return entries
}

function anchorOpen(text, name) {
  const q = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp('export\\s+(?:const|let|var)\\s+' + q + '\\s*=\\s*\\{').exec(text)
  return m ? m.index + m[0].length - 1 : -1
}

// ONE hop: the ident named as a depth-1 value was imported from a module
// specifier inside the checkout; find its `export const <ident> = {` literal
// and require `key` among its depth-1 entries. A specifier that resolves
// outside the checkout is trusted (same rule as moduleStem/resolveName).
function hopResolves(indexBlanked, ident, key) {
  for (const m of indexBlanked.matchAll(SDK_IMPORT)) {
    const ns = m[1].split(',').map(x => x.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()).filter(Boolean)
    if (!ns.includes(ident)) continue
    const stem = moduleStem(m[2])
    if (stem === null) return true
    const text = readTs(stem)
    if (text === null) return false
    const inner = blankComments(text)
    const open = anchorOpen(inner, ident)
    if (open === -1) return false
    return entriesOf(inner, open).has(key)
  }
  return false
}

if (existsSync(fullJs)) {
  const hostPaths = [...new Set([...readFileSync(fullJs, 'utf8').matchAll(HOST_DEREF)]
    .map(m => m[2] ? m[1] + '.' + m[2] : m[1]))]
  const hostDrift = []
  if (!/export\s*\*\s*from/.test(top)) { // plain star re-export: trust the surface
    const blanked = blankComments(top)
    const open = anchorOpen(blanked, 'host')
    const entries = open === -1 ? null : entriesOf(blanked, open)
    for (const path of hostPaths) {
      const dot = path.indexOf('.')
      const p0 = dot === -1 ? path : path.slice(0, dot)
      const p1 = dot === -1 ? null : path.slice(dot + 1)
      const e = entries && entries.get(p0)
      if (!e) { hostDrift.push(path); continue }
      if (!p1) continue
      if (e.nestedOpen !== -1 && entriesOf(blanked, e.nestedOpen).has(p1)) continue
      if (e.ident && hopResolves(blanked, e.ident, p1)) continue
      hostDrift.push(path)
    }
  }
  for (const p of hostDrift) console.log('host-drift: MISSING ' + p)
  if (hostDrift.length) process.exit(1)
  console.log(`sdk-contract: OK (${names.length} imports + ${hostPaths.length} host paths resolved at ${at})`)
} else {
  console.log(`sdk-contract: OK (${names.length} imports resolved at ${at})`)
}
