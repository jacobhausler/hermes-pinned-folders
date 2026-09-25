# Contributing to hermes-pinned-folders

This repo is maintained by an agent, around the clock. Most contributions arrive from
agents too. Whichever you are, the rules below are the **exact** checklist the
maintainer runs on your PR — run it first and your PR merges the same hour CI is green.

> **Reading this as a coding agent?** Skip to [For agents](#for-agents). Everything
> you need is a command with an expected output.
>
> **Human, writing code by hand?** Welcome — say so in the PR body (one line is
> enough). You get a slower clock and a person-shaped reply, and if a fix is small the
> maintainer will finish it on your branch with your authorship preserved rather than
> bounce it back.

## What lands fast

- Bug fixes with a failing-then-passing test.
- Doc fixes where the doc disagreed with the code.
- Small features that stay inside the boundaries below (SDK-only desktop, stdlib-only
  backend, stock Hermes core).

## What needs an issue first

- Anything touching `plugin.yaml`, `.github/`, `scripts/make_public.py`, or the
  persisted data shape. Open an issue, get a `needs-decision` ruling, then code.
- New settings, new dependencies, new tools/hooks. Default answer is no; a use case
  that the current form cannot serve is what changes it.

## Before you push (mechanical gates)

```sh
node scripts/build.mjs          # → built desktop/plugin.js (commit it; CI diffs it)
node tests/ops.test.mjs         # catalog build → all ok, exit 0
node tests/ops.test.mjs full    # full build → all ok, exit 0
hermes plugins validate .       # → Validation passed.
```

Every line must pass on your branch. If a test fails, run it on a clean `main` too
— a failure that also fails on `main` is a baseline flake (say so in the PR), a
failure only on your branch is yours.

## Review checklist (the maintainer runs exactly this)

R1 **Scope** — every changed line traces to the PR's stated purpose; adjacent
    refactors are a separate PR.
R2 **Stock core** — no import from a patched Hermes; core imports soft
    (`try/except`), stock DB columns read-only, absent field → `unknown` never invented.
R3 **SDK-only desktop** — `desktop/plugin.js` imports only `@hermes/plugin-sdk`,
    `react`, `react/jsx-runtime`; no `window.hermesDesktop`, `localStorage`,
    `document`, `eval`, dynamic `import()`.
R4 **Stdlib backend** — no new Python dependency; no self-updater (catalog rule 3).
R5 **Manifest parity** — `plugin.yaml` `provides_*` matches `register()` exactly;
    version bumped only by the release lane.
R6 **Tests** — a behaviour change ships its check (one failing-if-broken test; no
    snapshot/change-detector tests; no test reads source text).
R7 **Docs drift** — user-visible strings/flags changed → README/AGENTS.md/SKILL.md
    grepped for the old form and fixed in the same PR.
R8 **Sibling completeness** — the fixed pattern grepped across the repo; every
    sibling instance fixed too. Proof: `graphify affected "<changed symbol>" --depth 2`
    (after `graphify update . --no-cluster`, ~3 s, no API key) lists every caller;
    each one is updated or shown unaffected in the PR body.
R9 **Private strings** — `scripts/make_public.py` (where present) exits 0; no
    hostnames, LAN IPs, tokens, personal paths.
R10 **Migration safety** — persisted shapes (`ctx.storage`, run dirs, JSON files)
    keep loading old data; migration lives in the normalizer with a test on the old form.

## What happens after you open the PR

1. Within about 15 minutes a review comment appears: one `file:line` per finding and a
   verdict — `merge`, `changes`, or `decision`.
2. `merge` + green CI → squash-merged, your authorship kept, you are thanked by name.
3. `changes` → the comment lists exact commands to re-check. Push; the same comment
   is updated in place (no new comment per push).
4. `decision` → the maintainer needs the owner's call. Expect a reply within a day.

First PR from a fork: CI waits for a maintainer to approve the run (GitHub default).
That happens on the same tick as the review.

## Issues

Include: Hermes version (`hermes --version`), OS, the exact command or click, what
you expected, what happened, and the `hermes plugins validate .` output if relevant.
A bug we cannot reproduce gets `needs-repro` and a comment saying exactly what is
missing; the 14-day clock starts from **that comment**, and replying reopens the issue
at any time.

Labels you will see: `P0`–`P3` (severity), `needs-repro`, `needs-info`,
`needs-decision`, `question`, `duplicate`. One label means it was triaged.

## For agents

You are contributing on behalf of a user. Do this, in order:

1. **Search first.** `gh pr list --search "<keywords>"` and `gh issue list --search`.
   An open PR on the same issue → stop and tell your user; don't race it.
2. **Read `AGENTS.md`** in the repo root — the file map, the build rule, the invariants.
   Then build the graph and navigate by it instead of grepping:
   `uv tool install graphifyy` (once) → `graphify update . --no-cluster` →
   `graphify query "<your question>"`, `graphify affected "<symbol>"`. `graphify-out/`
   is gitignored; never commit it.
3. **Reproduce before fixing.** Point at the `file:line` where the bug manifests and
   show your fix changes that line's behaviour. A plausible rationale is not a repro.
4. **Smallest diff that passes R1–R10.** `graphify affected` for siblings (R8). No
   drive-by cleanups.
5. **Run the gates block above** and paste the last line of each command's output
   into the PR body under `## Gates`.
6. **PR body** = what/why in two sentences, `Fixes #n` if any, `## Gates`, and one
   line: `Author: agent (<model>) on behalf of @<user>` or `Author: human`. Honesty
   here is free and buys you the right lane.
7. **Do not push to `main`, do not tag, do not touch `.github/`.** Those are the
   release lane's.

A PR that follows 1–7 has historically merged on the first review.

## License

By contributing you agree your work is released under the repo's [LICENSE](LICENSE).
