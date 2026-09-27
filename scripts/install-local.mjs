#!/usr/bin/env node
// Local Desktop-only copy. Catalog/Git installs are managed by Hermes, not this script.
import { createHash } from 'node:crypto';
import { readFile, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const usage = 'Usage: node scripts/install-local.mjs --variant full|catalog [--home HERMES_HOME] [--replace]';

async function statOrNull(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

export async function install({ variant, home = process.env.HERMES_HOME || join(homedir(), '.hermes'), replace = false }) {
  if (!['full', 'catalog'].includes(variant)) throw new Error(usage);
  const source = join(repo, variant === 'full' ? 'full' : 'desktop', 'plugin.js');
  const dir = join(resolve(home), 'desktop-plugins', 'pinned-folders');
  const destination = join(dir, 'plugin.js');
  const bytes = await readFile(source);
  // Never follow a plugin directory/file symlink into some other installation.
  const root = dirname(dir);
  if ((await statOrNull(root))?.isSymbolicLink() || (await statOrNull(dir))?.isSymbolicLink()
      || (await statOrNull(destination))?.isSymbolicLink()) {
    throw new Error('Refusing symlinked desktop plugin path');
  }
  if ((await statOrNull(dir)) && !(await statOrNull(dir)).isDirectory())
    throw new Error('Desktop plugin destination is not a directory');
  // The app stamps materialized package halves with this marker. A catalog sidecar
  // is another detectable provenance signal. Never mutate either even with --replace.
  for (const marker of ['.hermes-package.json', '.hermes-catalog.json']) {
    if (await statOrNull(join(dir, marker)))
      throw new Error(`Refusing managed install (${marker}); use Hermes to manage it`);
  }
  const existing = await statOrNull(destination);
  if (existing && !existing.isFile()) throw new Error('Desktop plugin entry is not a regular file');
  if (existing && hash(await readFile(destination)) === hash(bytes)) {
    return { variant, source, destination, sha256: hash(bytes), status: 'already current' };
  }
  if (existing && !replace) throw new Error('Existing local plugin differs; pass --replace to replace it explicitly');
  await mkdir(dir, { recursive: true });
  // Same-directory staging avoids leaving a partial plugin.js when interrupted.
  const staging = join(dir, `.plugin.js.${process.pid}.${Date.now()}.tmp`);
  try {
    const handle = await open(staging, 'wx', 0o644);
    try { await handle.writeFile(bytes); } finally { await handle.close(); }
    // Recheck detectable provenance immediately before publishing.
    for (const marker of ['.hermes-package.json', '.hermes-catalog.json']) {
      if (await statOrNull(join(dir, marker))) throw new Error(`Refusing managed install (${marker})`);
    }
    await rename(staging, destination);
  } finally {
    await unlink(staging).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  if (hash(await readFile(destination)) !== hash(bytes)) throw new Error('Destination verification failed');
  return { variant, source, destination, sha256: hash(bytes), status: 'installed' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    let variant, home, replace = false;
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--variant' && i + 1 < args.length) variant = args[++i];
      else if (args[i] === '--home' && i + 1 < args.length) home = args[++i];
      else if (args[i] === '--replace') replace = true;
      else throw new Error(usage);
    }
    const result = await install({ variant, home, replace });
    console.log(`${result.status}: ${result.variant} ${result.source} -> ${result.destination}\nSHA-256 ${result.sha256}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
