# Contributing

Thanks for helping. This is a small plugin, and the process is small too.

## Bugs and ideas

Open an issue and include:

- your Hermes version (shown at the bottom right of the app),
- which build you run (catalog or full),
- what you did, what you expected, and what happened.

A screenshot helps. Crop out any chat titles you'd rather not share.

## Pull requests

1. Edit `full/plugin.js`. Never edit `desktop/plugin.js`: it is generated.
2. Run:

   ```sh
   node scripts/build.mjs
   node tests/ops.test.mjs && node tests/ops.test.mjs full
   hermes plugins validate .
   ```

3. Commit both `full/plugin.js` and the rebuilt `desktop/plugin.js`.

The PR description should say what changed and how you checked it in the app.

## Keep in mind

- **Catalog build = plugin SDK only.** If a feature needs anything outside the SDK, wrap it in `// #full` … `// #end` so it stays in the full build only.
- **Existing layouts must keep loading.** If you change what's saved, migrate old data in `normalize()` and add a test for it.
- **Small is the point.** Before adding a new setting or button, open an issue so we can talk it over.
- Pure logic goes in exported functions with a test. UI code stays thin.

[AGENTS.md](AGENTS.md) has the file map and the full set of rules. It works as a guide for people too.

By contributing, you agree that your work is released under the [MIT License](LICENSE).
