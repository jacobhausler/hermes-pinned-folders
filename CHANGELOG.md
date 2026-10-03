# Changelog

All notable changes to this plugin. Versions follow `plugin.yaml`; each release is a
`vX.Y.Z` tag and a catalog entry pinned to that tag's commit.

## [0.1.3] - 2026-10-03

Tests-only hardening release: the shipped plugin is byte-identical to `v0.1.2`
(`git diff v0.1.2..HEAD -- plugin.yaml desktop/ full/ scripts/` is empty apart from
this release's `version` literal; `desktop/plugin.js` and `full/plugin.js` are
unchanged). No behavior change.

### Maintenance
- Cover `viewFilters` + `viewIsDefault`, the menu's two enable predicates, incl. the
  `order`-only seam and `ops.resetView` round-trip (#23, @jacobhausler)

## [0.1.2] - 2026-10-01

Test/docs hardening release. `desktop/plugin.js` and `full/plugin.js` are byte-identical
to `v0.1.1` (sha256-verified); `plugin.yaml` changes only its `version` literal — no
shipped-code change.

### Maintenance
- Codify the host-import allow-list in the catalog gate (#15, @jacobhausler)
- Widen the import-gate extractor and prove it live with a parser canary (#16, @jacobhausler)
- AGENTS.md catalog gate count 75 → 79 (#17, @jacobhausler)
- SECURITY.md and issue templates (public-repo standard, closes #18) (#19, @jacobhausler)
- Cover `ops.toggle`, the single-folder collapse path (#20, @jacobhausler)
- Unit-test the `strip()` parser that produces the catalog build, with a live canary (#21, @jacobhausler)

## [0.1.1] - 2026-09-28

### Added
- Pinned pane gestures: ⇧-click a pinned chat to **unpin** it (same path as the menu's
  Unpin: PATCH in the full build, SDK `host.sessions.pin(id, false)` in the catalog
  build); ⌘/⌃-click still opens a new tab. The ⋯ and right-click menus share one item
  list, and the hint is hidden where unpin is unavailable (#13, fixes #12, @jacobhausler)
- Filter menu in the Pinned header: order (Manual / Most recent), unread only, status
  (All / Unread / Working), profile (All / Current), collapse all, reset view. The view
  is saved per connection as `view`; older layouts without it load unchanged through
  `normalize()` (#13, @jacobhausler)

## [0.1.0] - 2026-09-28

First release. Adds a **Pinned** tab to the Hermes Desktop sidebar with nested,
colored, drag-ordered folders for pinned chats. Two builds come from one source:
`full/plugin.js` (full desktop) and the generated catalog build `desktop/plugin.js`,
which uses only the SDK.

### Fixed
- Catalog build: the pinned-row menu has a working **Unpin** through the SDK's
  `host.sessions.pin(id, false)`; on Desktop older than `host.sessions` the item renders
  disabled with update guidance (#10, fixes #7, @jacobhausler)
- Catalog build no longer reads `document.hidden`. The hidden-window polling back-off
  now exists only in the full build, and the SDK-only test catches any `document.`
  reference (#8, @jacobhausler)
- Local installer: an explicit `--variant full|catalog` install verifies the SHA-256 at
  the destination and refuses to replace a file unless asked or to overwrite a detectable
  managed install (#6, fixes #5, @jacobhausler)
- Full-build auto-pin retries after a failed PATCH and reports a notice when the
  60-second resolve deadline runs out (#4, fixes #3, @jacobhausler)

### Maintenance
- repo-admin standard: path-scoped CI `gates` check, CONTRIBUTING with the review
  checklist, PR template (#2, @jacobhausler)

[0.1.3]: https://github.com/jacobhausler/hermes-pinned-folders/releases/tag/v0.1.3
[0.1.2]: https://github.com/jacobhausler/hermes-pinned-folders/releases/tag/v0.1.2
[0.1.1]: https://github.com/jacobhausler/hermes-pinned-folders/releases/tag/v0.1.1
[0.1.0]: https://github.com/jacobhausler/hermes-pinned-folders/releases/tag/v0.1.0
