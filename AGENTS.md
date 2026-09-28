# AGENTS.md

Start here if you are an agent working on this repo. The plugin is two files built from one source, with pure-function tests and no dependencies.

## Map

| Path | What it is |
|---|---|
| `full/plugin.js` | **The source. Edit this one.** Plain ESM, loaded by Hermes Desktop uncompiled. |
| `desktop/plugin.js` | Catalog build, **generated**. Never edit by hand. |
| `scripts/build.mjs` | Writes `desktop/plugin.js` by deleting every `// #full` … `// #end` block. |
| `tests/ops.test.mjs` | Tests the pure functions in either build. |
| `plugin.yaml` | Manifest: name, version, description. |
| `docs/*.png` | README screenshots. `catalog-*.png` show the catalog build. |

## Commands

Node 22 or newer. Nothing to install.

```sh
node scripts/build.mjs          # → built desktop/plugin.js
node tests/ops.test.mjs         # catalog build → 46 "ok" lines, exit 0
node tests/ops.test.mjs full    # full build   → 56 "ok" lines, exit 0
hermes plugins validate .       # → "Validation passed." (catalog admission; not an SDK-only proof)
```

A change is done when all four pass and `git diff desktop/plugin.js` shows only what the build wrote.

## Code graph (optional)

[graphify](https://github.com/Graphify-Labs/graphify) turns the repo into a queryable graph. It uses a local parse, no LLM and no API key, and needs [uv](https://docs.astral.sh/uv/):

```sh
uvx --from graphifyy graphify update .         # → "Rebuilt: ~100 nodes, ~160 edges", about 2 s
uvx --from graphifyy graphify query "how does unpin work"
```

Read `graphify-out/GRAPH_REPORT.md` for the hubs and communities. `graphify-out/` is git-ignored: rebuild it after pulling instead of trusting a stale copy. `.graphifyignore` leaves out the generated `desktop/plugin.js` and the screenshots.

## Rules

1. **The catalog build uses only the plugin SDK.** Imports come from `@hermes/plugin-sdk`, `react` and `react/jsx-runtime`. Anything that reaches past the SDK goes inside a `// #full` … `// #end` block: `window.hermesDesktop`, `localStorage`, `document`, or core's own storage keys. `node tests/ops.test.mjs` enforces this ("catalog build stays inside the SDK"). `hermes plugins validate .` does not: it only checks prototype patching, `eval`, dynamic `import()` and script tags.
2. **No build step and no JSX.** Write `jsx()` / `jsxs()` calls. The app loads the file as-is.
3. **Logic lives in exported pure functions, and the tests cover them:** `ops`, `normalize`, `folderActivity`, `filterView`, `exportLayout`, `importLayout`, `unpinPinnedRow` and `unpinAndReconcile` (both builds; they take the host so tests can stub `host.sessions.pin`), and in the full build `scrubCorePins` and `isFreshUserChat`. React code stays thin. The test stubs every name the file imports from the SDK, so a new SDK import needs no test change.
4. **Saved layouts never break.** Storage is `ctx.storage` (plugin-scoped). The layout lives at `tree.<connectionId|local>`:

   ```js
   { folders: [{ id, name, parent, color? }], placed: { [sessionId]: folderId },
     order: [sessionId], collapsed: { [folderId]: true }, foldersOrdered: true }
   ```

   To change the shape, migrate old data inside `normalize()` and add a test for the old form. Exported layouts carry `pinned-folders/layout@1`. Bump that tag only together with an import path for the previous version.
5. **Pins belong to the backend.** Folders only arrange pinned chats. Catalog Unpin uses only the SDK's `host.sessions.pin(id, false)` (which core syncs to the owning backend); on older Desktop without that method it is disabled with guidance to use Sessions, never a local layout-only unpin. `pin(id, false)` resolving is not a durable ack (core fires the backend write and swallows its error), so catalog Unpin never forgets folder placement eagerly: it re-reads the pinned rows and prunes placement only once a read no longer lists the id; if the backend keeps the pin, the chat stays in its original folder and order. Full Unpin uses its direct backend PATCH + core pin-cache scrub, whose awaited result is a real ack, so placement is forgotten at once; full auto-pin also writes the backend.

## Try it live

From this checkout on the machine that runs the Desktop app, explicitly select the full build:

```sh
node scripts/install-local.mjs --variant full
```

The local installer verifies the destination bytes and refuses to overwrite a detectable Hermes-managed install. An existing different local file requires `--replace`; see README for the catalog alternative.

Then run ⌘K → **Reload desktop plugins**. The PINNED tab sits next to SESSIONS and BOTS.

Screenshots use demo chats only: a throwaway `HERMES_HOME` outside `~/.hermes`, seeded with made-up sessions. Never publish screenshots of a real chat list.

## Releasing

1. On a `release/vX.Y.Z` branch, bump `version` in `plugin.yaml` and add the `CHANGELOG.md` section (merged PRs since the last tag, with `#n` and author). Rebuild, test, validate, then open a PR labelled `release`. The owner tags `vX.Y.Z` on the merge commit.
2. The catalog entry (`plugin-catalog/pinned-folders.yaml` in NousResearch/hermes-agent) pins a full 40-character commit SHA. A release is a PR there that moves the SHA and version.
