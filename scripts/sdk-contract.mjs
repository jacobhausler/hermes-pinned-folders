// SDK contract gate: every name desktop/plugin.js imports from
// @hermes/plugin-sdk must actually exist in the pinned hermes-agent checkout.
// The catalog build's stub-based tests cannot see an upstream removal — this
// gate reads the real apps/desktop/src/sdk/index.ts at the pin.
//
// Usage: node scripts/sdk-contract.mjs <path-to-hermes-agent-checkout>
// Exit 0: every import resolved. Exit 1: `MISSING: <names>` printed.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2]
if (!root) { console.error('usage: node scripts/sdk-contract.mjs <path-to-hermes-agent-checkout>'); process.exit(1) }
const indexTs = join(root, 'apps/desktop/src/sdk/index.ts')
if (!existsSync(indexTs)) { console.error('not a hermes-agent checkout (missing ' + indexTs + ')'); process.exit(1) }
const SRC_DIR = join(root, 'apps/desktop/src')

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
console.log(`sdk-contract: OK (${names.length} imports resolved at the pin)`)
