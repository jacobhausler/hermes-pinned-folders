// Unit tests for the strip() parser in scripts/build.mjs — the one that turns
// full/plugin.js into desktop/plugin.js by deleting `// #full` … `// #end`
// blocks. Run: node tests/build.test.mjs
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { strip } from '../scripts/build.mjs'

let failed = 0
const ok = (name, fn) => {
  try { fn(); console.log('ok', name) }
  catch (e) { failed++; console.error('FAIL', name, '\n ', e.message) }
}

// (a) blocks are deleted, incl. one nested inside another
ok('deletes // #full … // #end blocks', () => {
  const src = ['keep1', '// #full', 'gone', '// #end', 'keep2'].join('\n')
  assert.equal(strip(src), 'keep1\nkeep2')
})
ok('deletes a // #full nested inside another', () => {
  const src = ['a', '// #full', 'outer', '// #full', 'inner', '// #end', 'outer2', '// #end', 'b'].join('\n')
  assert.equal(strip(src), 'a\nb')
})
ok('keeps content around a nested block, drops only fenced lines', () => {
  const src = ['x', '// #full', 'a', '// #full', 'b', '// #end', 'c', '// #end', 'y', '// #full', 'z', '// #end', 'w'].join('\n')
  assert.equal(strip(src), 'x\ny\nw')
})

// (b) canary: a stray '// #end' with no opener THROWS
ok('stray // #end with no opener throws', () => {
  assert.throws(() => strip('a\n// #end\nb'), /#end/)
})
ok('extra // #end after a closed block throws', () => {
  assert.throws(() => strip('// #full\nx\n// #end\n// #end'), /#end/)
})

// (c) canary: an unclosed '// #full' THROWS (a parser that cannot fail is decoration)
ok('unclosed // #full throws', () => {
  assert.throws(() => strip('a\n// #full\nb'), /#full/)
})
ok('unclosed outer after a closed inner block throws', () => {
  assert.throws(() => strip('// #full\n// #full\nx\n// #end'), /#full/)
})

// (d) blank-line collapse (3+ newlines -> 2) and no-mangle identity
ok('collapses 3+ newlines to 2 (void left by a deleted block)', () => {
  assert.equal(strip('a\n\n// #full\nx\n// #end\n\n\nb'), 'a\n\nb')
})
ok('text with no fences passes through unchanged (identity)', () => {
  const src = "import x from 'y'\n\nconst a = 1\n// a plain comment\nif (a) {\n  f('// #fullish')\n}\n"
  assert.equal(strip(src), src)
})

// (e) LIVE canary: strip(full/plugin.js) === desktop/plugin.js byte-for-byte
ok('live canary: strip(full/plugin.js) === desktop/plugin.js byte-for-byte', () => {
  const full = readFileSync(new URL('../full/plugin.js', import.meta.url), 'utf8')
  const desktop = readFileSync(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
  assert.equal(strip(full), desktop)
})

if (failed) { console.error(`FAIL ${failed} test(s) failed`); process.exit(1) }
console.log('PASS all tests')
