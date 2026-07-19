# Canon — The 7 Canonical Concerns

The non-negotiable conventions every change is measured against. This file is the index — the full rules live in the referenced files. When a canon rule and any other guidance conflict, canon wins. Known gaps are flagged so we close them deliberately instead of re-discovering them.

## 1. Next.js best practices

Server Components by default; `'use client'` only on the smallest leaf. `page.tsx` owns metadata. `next/image` with `priority` on the LCP element; `next/dynamic` for below-fold. Client refs are never called server-side (enforced by `scripts/check-client-boundary-imports.ts`).

- Full rules: `apps/sim/app/(landing)/CLAUDE.md` (landing), `.claude/rules/sim-architecture.md` (server boundary)
- **Gap**: no general app-router conventions rule — when to add `error.tsx` / `loading.tsx` / `not-found.tsx`, `generateMetadata` vs static `metadata`, ISR/`revalidate`, Suspense/streaming. Landing doc covers landing only.

## 2. SEO / GEO (landing only)

One `<h1>` (Hero), strict heading hierarchy, `<section aria-labelledby>`, server-rendered navbar, JSON-LD, answer-first H2s, atomic extractable blocks, entity consistency ("Sim", never "the platform"), sr-only summaries, concrete numbers. Copy follows `.claude/rules/constitution.md`.

- Full rules: `.claude/rules/landing-seo-geo.md`, `apps/sim/app/(landing)/CLAUDE.md`
- **Gap**: docs reference a single `structured-data.tsx` but code is split into `site-structured-data/`, `home-structured-data/`, `json-ld/`. `sitemap.ts` / `robots.ts` / `manifest.ts` conventions (app root) are undocumented.

## 3. Feature file structure

Every feature dir: `feature.tsx` + `page.tsx` (+ `error.tsx`, `loading.tsx`, `search-params.ts` where applicable) + `utils/` (only for 2+ consumers — single-consumer helpers stay in `feature.tsx`) + `hooks/` + `components/`. Every component lives in its own kebab-case folder holding `<name>.tsx` + `index.ts` barrel; children nest under that folder's own `components/`, recursively. Never a bare `<name>.tsx` flat inside a `components/` directory. Reference implementation: `apps/sim/app/workspace/[workspaceId]/scheduled-tasks/`.

- Full rules: `apps/sim/app/(landing)/CLAUDE.md` "Structure", `.claude/rules/sim-architecture.md`
- **Gap**: the recursion + barrel rule is only fully written in the landing CLAUDE.md; `sim-architecture.md` shows a flatter sketch and omits `search-params.ts` / `error.tsx` / `loading.tsx` co-location.

## 4. EMCN components only (platform)

No custom buttons/inputs/menus — always the `@sim/emcn` chip-family equivalent. Components own their chrome; consumers pass props, never chrome via `className` (layout/sizing only).

- Full rules: `.claude/rules/emcn-components.md` (authoring), `.claude/rules/sim-styling.md` (consumer)
- **Gap**: stale paths — EMCN moved to `packages/emcn/` but `emcn-components.md` frontmatter still scopes `apps/sim/components/emcn/**`, and the landing CLAUDE.md still says import from `@/components/emcn`.

## 5. No ad-hoc animations or colors

Colors come from tokens in `apps/sim/app/_styles/globals.css` / `tailwind.config.ts` — never raw hex in components. Animations: prefer CSS, respect `prefers-reduced-motion`, no new keyframes outside the Tailwind config / scoped `.module.css`. Never touch global styles.

- Full rules: `.claude/rules/sim-styling.md` (tokens), `apps/sim/app/(landing)/CLAUDE.md` (motion)
- **Gap**: the positive rule ("declare custom keyframes/tokens HERE and nowhere else") is unwritten — only the prohibition exists.

## 6. State placement (useState / Zustand / React Query / URL)

One four-way decision: React Query = all server state · nuqs URL params = shareable view-state · Zustand = high-frequency, ephemeral, or socket-synced state · useState = purely local UI. Never `useState` + `fetch`; never store-synced-with-effects for view-state.

- Full rules: `.claude/rules/sim-url-state.md` (the canonical 4-way table), `.claude/rules/sim-queries.md`, `.claude/rules/sim-stores.md`

## 7. Meta — authoring skills, rules, and CLAUDE.md files

How we write the docs themselves: CLAUDE.md stays a lean index; detailed conventions go in `.claude/rules/*.md` with `paths:` frontmatter globs so they load only when matching files are touched; repeatable multi-step procedures become skills (`.claude/skills/` or `.claude/commands/`); one-off preferences go in memory, not the repo.

- **Gap**: no authoring guide exists — rule/skill conventions are learned by imitating existing files. Needs a short `.claude/rules/meta-authoring.md`.
