// Builds desktop/plugin.js (catalog, SDK-only) from full/plugin.js by deleting
// every `// #full` … `// #end` block.  node scripts/build.mjs
import { readFileSync, writeFileSync } from 'node:fs'

export function strip(src) {
  const out = []
  let depth = 0
  for (const line of src.split('\n')) {
    const tag = line.trim()
    if (tag === '// #full') depth++
    else if (tag === '// #end') {
      if (!depth) throw new Error('stray // #end')
      depth--
    } else if (!depth) out.push(line)
  }
  if (depth) throw new Error('unclosed // #full')
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = new URL('..', import.meta.url)
  writeFileSync(new URL('desktop/plugin.js', root), strip(readFileSync(new URL('full/plugin.js', root), 'utf8')))
  console.log('built desktop/plugin.js')
}
