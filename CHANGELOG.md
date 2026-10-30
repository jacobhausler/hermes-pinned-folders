# Changelog

All notable changes to this plugin. Versions follow `plugin.yaml`; each release is a
`vX.Y.Z` tag and a catalog entry pinned to that tag's commit.

## [0.1.10] - 2026-10-30

Test-gain release: the shipped bundle is byte-identical to `v0.1.9` (`node
scripts/build.mjs` rebuild is byte-identical at this head; `desktop/plugin.js`
and `full/plugin.js` unchanged). No behavior change. Gates at this release:
suite 190 ok catalog / 209 ok full, 0 failures, `hermes plugins validate` clean.

### Tests
- pin `scrubCorePins` defensive branches — empty-ids, malformed JSON, non-array JSON, idempotent re-scrub (full-only, +4 ok → 184/203) (fda9a65, #64, @jacobhausler)
- pin `collapseAllItem` empty:true edges (both builds, +2 ok → 186/205) (20bfbb8, #65, @jacobhausler)
- pin `pinnedRowClick` precedence edges — alt-only, ctrl+shift, meta+ctrl, alt+ctrl+shift (both builds, +4 ok → 190/209) (afa6519, #67, @jacobhausler)

## [0.1.9] - 2026-10-26

Test-gain release: the shipped bundle is byte-identical to `v0.1.8` (`node
scripts/build.mjs` rebuild is byte-identical at this head; `desktop/plugin.js`
and `full/plugin.js` unchanged). No behavior change. Gates at this release:
suite 184 ok catalog / 199 ok full, 0 failures, `hermes plugins validate` clean.

### Tests
- pin the `visibleRows` edges — default/blank passthrough, null tolerance, view gating, order preserved (df65a6f, #61, @jacobhausler)
- pin persisted-state normalization for `ops.rename`/`ops.addFolder` — trim-on-store, `String()` coercion, unknown-id no-op, `parent: null` round-trip, collapsed-parent clear (5 asserts, +5 ok per build → 184/199) (650d32c, #62, @jacobhausler)

## [0.1.8] - 2026-10-19

Fix + hardening release: the shipped bundle changed — `ancestorsOf` now stops at
first revisit, so `folderActivity` no longer over-counts on cyclic folder graphs
(#58). The rest is test teeth, a CI floor repin and doc counts; no other behavior
change. Gates at this release: suite 167 ok catalog / 182 ok full, 0 failures,
`hermes plugins validate` clean, bundle rebuild byte-identical.

### Fixed
- `views`: `ancestorsOf` stops at first revisit — `folderActivity` cycle over-count fixed (39e64f8, #58, @jacobhausler)

### Tests
- pin the `exportLayout` envelope (f95b1a8, #55, @jacobhausler)
- pin `folderActivity` edges — dangling placement, parent cycle, null rows, sibling sums, active-only (45eb754, #57, @jacobhausler)

### Maintenance
- CI repin `HERMES_PIN` v2026.9.24 → v0.21.7 (+ Python 3.14) (7a72ebb, #56, @jacobhausler)
- `AGENTS.md`: refresh drifted ok-counts in Commands block to measured 167/182 (1500385, #59, @jacobhausler)

## [0.1.7] - 2026-10-15

Tests + gate-hygiene release: the shipped plugin is byte-identical to `v0.1.6`
(`git diff v0.1.6..HEAD -- full/ desktop/` is empty apart from this release's
`version` literal; `desktop/plugin.js` and `full/plugin.js` are unchanged).
No behavior change. The delta is test gain (+9 asserts per build — suite
140 → 149 ok catalog, 155 → 164 ok full: `importLayout` hand-edited-export
edges, `sdk-contract` HEAD-honesty and ceiling-guard coverage) plus a gate
script that now says which checkout it actually looked at.

### Maintenance
- `AGENTS.md`: bot-owned release flow (the maintainer bot merges the green release PR and tags it — no human gate) + re-measured gate counts (f319a62, #48, @jacobhausler)
- `sdk-contract`: print the checkout's real short HEAD, not a fixed label — a drift probe must not read like a pin check (31d968d, #50, @jacobhausler)
- Peer-nit discharge for #50: ceiling guard + `fileURLToPath`, dated clauses dropped from the test (758b65a, #51, @jacobhausler)
- `importLayout` hand-edited-export edges: junk folder entries, non-string placement values, order filtering, missing-order default, non-string color drop, `foldersOrdered` stamp (06ef18b, #53, @jacobhausler)

## [0.1.6] - 2026-10-12

CI-floor + tests release: the shipped plugin is byte-identical to `v0.1.5`
(`git diff v0.1.5..HEAD -- full/ desktop/ scripts/` is empty apart from this
release's `version` literal; `desktop/plugin.js` and `full/plugin.js` are
unchanged). No behavior change.

### Maintenance
- pr-compliance `diagram-check` gate + pr-diagram PR template (standard v0.2, pushed directly to main; mirrors the peer estate's gate) (0af26c1, ce67c36, @jacobhausler)
- CONTRIBUTING names the pr-compliance body sections (#44, @jacobhausler)
- Drop stale lowercase `pull_request_template.md` (est-ugims) (#45, @jacobhausler)
- `normalizeView` edge tests: field-by-field repair contract on the persisted-view boundary (#46, @jacobhausler)
- pr-compliance v0.3 C8 composition-law mirror (#47, @jacobhausler)

## [0.1.5] - 2026-10-09

Bugfix + tests release: `normalize()` now drops folder entries with no name on
load (id-only or name-only entries hit the one-time alphabetical sort and crashed
the whole PINNED pane); same-shape entries are now refused at load, matching what
`importLayout` already refused. Shipped-code delta is the two-line `normalize()`
filter in `full/plugin.js` + `desktop/plugin.js`; everything else is test gain
(+20 asserts per build — suite 94 → 114 ok catalog, 97 → 117 ok full:
`orderRows`/`applyView` edges, click-gesture and `chatMenuItems` deltas, the
nameless-load regression).

### Fixed
- Load no longer crashes the pane on a nameless/half-written folder entry (#39, @jacobhausler)

### Maintenance
- Cover `orderRows`/`applyView` edges: unranked sink, `started_at` fallback, filter composition (#38, @jacobhausler)
- Click-gesture + `chatMenuItems` coverage delta batch: ctrl gesture, per-path return/consume flags, Move-to indent/disabled, Unsorted pair, guidance label, Delete destructive, Open-in-new-tab (#36, @jacobhausler)

## [0.1.4] - 2026-10-06

Docs + CI-floor release: the shipped plugin is byte-identical to `v0.1.3`
(`git diff v0.1.3..HEAD -- plugin.yaml desktop/ full/` is empty apart from this
release's `version` literal). No behavior change.

### Maintenance
- AGENTS.md commands now include the `build.test.mjs` gate CI runs (#32, @jacobhausler)
- Raise the HERMES floor to v2026.9.24 and add the SDK-contract gate at the pin (4606a74, est-l6w3, @jacobhausler)
- CONTRIBUTING.md R5 PUBLIC-release-only carve-out (skills house 58ff35f) (#35, @jacobhausler)

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

[0.1.10]: https://github.com/jacobhausler/hermes-pinned-folders/releases/tag/v0.1.10
[0.1.9]: https://github.com/jacobhausler/hermes-pinned-folders/releases/tag/v0.1.9
[0.1.8]: https://github.com/jacobhausler/hermes-pinned-folders/releases/tag/v0.1.8
[0.1.7]: https://github.com/jacobhausler/hermes-pinned-folders/releases/tag/v0.1.7
[0.1.6]: https://github.com/jacobhausler/hermes-pinned-folders/releases/tag/v0.1.6
[0.1.5]: https://github.com/jacobhausler/hermes-pinned-folders/releases/tag/v0.1.5
[0.1.4]: https://github.com/jacobhausler/hermes-pinned-folders/releases/tag/v0.1.4
[0.1.3]: https://github.com/jacobhausler/hermes-pinned-folders/releases/tag/v0.1.3
[0.1.2]: https://github.com/jacobhausler/hermes-pinned-folders/releases/tag/v0.1.2
[0.1.1]: https://github.com/jacobhausler/hermes-pinned-folders/releases/tag/v0.1.1
[0.1.0]: https://github.com/jacobhausler/hermes-pinned-folders/releases/tag/v0.1.0
