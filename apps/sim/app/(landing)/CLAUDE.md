# Landing Page - Build & Optimization Instructions

This route group owns `/` and the entire public marketing surface - the home page, platform/solutions pages, pricing, legal, and the marketing subroutes (`/blog`, `/library`, `/models`, `/integrations`, `/demo`, `/partners`, `/changelog`). Read this file in full before adding or changing anything here. Positioning and language rules live in `.claude/rules/constitution.md`; SEO/GEO rules in `.claude/rules/landing-seo-geo.md`. Both apply to every file in this directory.

`/blog` (editorial/company-voice posts) and `/library` (AEO/GEO content - listicles, comparisons, how-tos) are two separate route trees over one shared engine: `apps/sim/lib/content/` (generic registry factory, MDX components, SEO builders) instantiated per-section by the thin `apps/sim/lib/blog/` and `apps/sim/lib/library/` modules, rendered through the shared `Content*Page` components in `components/`. Content lives in `apps/sim/content/blog/` and `apps/sim/content/library/`; both share `apps/sim/content/authors/`. Adding a post to either section, or adding a new content section entirely, must reuse this engine - never hand-roll a divergent registry or page layout. Every new marketing subroute (including any future content section) needs `app/sitemap.ts` and `app/robots.ts` updated, same as `/blog` and `/library` were.

## What this is

- `app/(landing)/` - the marketing site. A shared `layout.tsx` renders the chrome once (the `LandingShell`: light tokens, navbar with server-side GitHub stars, footer, site-wide JSON-LD); each page supplies only its `<main>` content.
- The legacy `app/(home)/` group (old dark landing + `--landing-*` tokens) has been **deleted** - its marketing pages were migrated here and its chrome retired. Do not reintroduce `--landing-*` tokens, Martian Mono accents, or a separate marketing theme.

## Styling - draw from the platform's light mode

The landing page looks like the product. Its visual language is the workspace UI in light mode, not a separate marketing theme.

- **Always light.** The root wrapper in `landing.tsx` carries the `light` class, which pins every token to its light value (see `app/_styles/globals.css`, the `:root, .light` block). Never add `dark:` variants here; never read the user's theme.
- **Use platform tokens, never hex.** Canvas `--bg`, surfaces `--surface-1`…`--surface-7`, cards/modals `--surface-2`, hover `--surface-hover`, active `--surface-active`; text `--text-primary` / `--text-secondary` / `--text-muted` / `--text-body`, icons `--text-icon`; borders `--border` (dividers) / `--border-1` (fields); brand `--brand-agent` / `--brand-secondary` / `--brand-accent`. Do **not** use the legacy `--landing-*` tokens - they belong to the old dark landing.
- **Use emcn components where they fit.** The chip family (`Chip`, `ChipLink`, `ChipTag`, `ChipInput`, `ChipModal*`, …) from `@/components/emcn` is the canonical chrome - a demo-request form is a `ChipModal` with `ChipModalField`s, a pill CTA is a `Chip`/`ChipLink`. Components own their chrome; pass props, not className overrides. Full consumer rules: `.claude/rules/sim-styling.md`.
- **Typography is the platform's.** Season is the global body font (`font-season` is applied on `<body>` in the root layout). Use the platform text scale (`text-small` = 13px, `text-base` = 15px, etc. - see `tailwind.config.ts`). Don't add new fonts or font CSS variables without explicit direction.
- **Never touch global styles.** No additions to `app/_styles/globals.css`. All styling is local Tailwind classes; `cn()` from `@/lib/core/utils/cn` for conditionals; no inline `style` attributes.
- **Responsive - desktop is the source of truth, scaled down via `max-*` overrides.** The page is fully responsive (iPad + phone). The desktop layout stays the unprefixed baseline; smaller screens are handled by *layering* `max-*` overrides on top, so desktop renders byte-identically. Tiers:
  - `max-xl:` (≤1279) - the hero's two-panel split (absolute visual + logos) collapses to a stacked, in-flow column. The split needs ≥1280 to avoid the headline colliding with the visual panel; iPad-landscape (1024) therefore gets the stacked hero with the desktop nav.
  - `max-lg:` (≤1023) - the desktop nav clusters hide (`hidden lg:flex`) and `MobileNav` (hamburger sheet) takes over; multi-column grids step down (mothership 4→2, footer 7→3); shared gutter `px-20 → max-lg:px-8`; section gaps tighten.
  - `max-md:` (≤767) - Features beats drop the floating callout (`max-md:hidden`) and show the un-masked backdrop preview full-width.
  - `max-sm:` (≤639) - single-column grids, smallest type scale, `px-5` gutter, hero CTA row stacks.

  When adding a new section, give it the same `px-20 max-lg:px-8 max-sm:px-5` gutter so the navbar wordmark stays aligned with section content at every width. Verify desktop is unchanged and there is zero horizontal overflow at 1280 / 1024 / 768 / 390 before shipping.

## Performance - page speed is a feature

Target: Lighthouse 95+ on mobile, LCP < 2.0s, CLS < 0.05, minimal hydration cost.

- **Server Components by default.** `'use client'` only on the smallest leaf that genuinely needs interactivity (a button with state, not the section containing it). The navbar, hero copy, footer, and every static section must be server-rendered HTML.
- **No heavy client libraries above the fold.** No animation frameworks (framer-motion etc.), no ReactFlow, no chart libs in the initial bundle. If a below-fold section truly needs one, load it with `next/dynamic` and a dimension-stable placeholder.
- **Images via `next/image` always.** The LCP element (logo or hero visual) gets `priority`; everything below the fold lazy-loads (the default). Every image has explicit `width`/`height` - zero layout shift.
- **Prefer CSS over JS.** Hover states, transitions, marquees, and reveal effects in CSS (`transition-*`, `animation`) rather than scroll listeners or animation libraries. Decorative motion respects `prefers-reduced-motion`.
- **Static rendering.** The page is statically generated with `revalidate` (set in `page.tsx`). Never fetch per-request data in the page tree; anything dynamic (e.g. GitHub stars) is fetched at build/revalidate time or deferred to a client island. A `cookies()`/`headers()`/`unstable_noStore()` call anywhere in the tree - including the root `app/layout.tsx` - silently overrides every page's `revalidate` and forces the whole app dynamic. If a marketing page builds as `ƒ` instead of `○`/`●` (check `bun run build`'s route table), look upstream, not just at the page itself.
- **Reserve space for everything.** Fixed dimensions or aspect ratios on all media, embeds, and async content. CLS budget is effectively zero.
- **Decorative canvases and animations are non-interactive.** A hand-built product-demo animation or embedded ReactFlow canvas is presentation only - no drag handlers, no `nodesDraggable`/`panOnDrag`/`elementsSelectable` on ReactFlow. A visitor should never be able to click or drag a decorative element.
- **Lazy-mount a heavy client island's second occurrence.** If the same animated component appears twice on a page, only the first (usually the hero) loads eagerly - the rest go through a small `'use client'` mount wrapper: `next/dynamic(..., { ssr: false })` gated by an `IntersectionObserver`. See `components/product-demo/components/product-demo-visual-mount/` for the reference pattern, and `.claude/rules/sim-imports.md` for the barrel-cleanup step that must come with it.
- **Don't prefetch authenticated-app routes from an always-visible CTA.** `<Link>` prefetches its target route's JS once it's in the viewport - a navbar/hero CTA to `/signup` or `/login` is always in view, so it downloads that route's bundle on every pageview. Pass `prefetch={false}` there. Leave the default on CTAs that only enter the viewport on scroll (prefetch-on-approach is the desired behavior there).

## SEO

`page.tsx` owns the metadata (title, description, OG/Twitter, canonical, robots) - keep it the single source of truth and keep it aligned with the constitution's claim hierarchy. Beyond metadata:

- **One `<h1>`, in the hero, containing "Sim" and "AI workspace".** Strict hierarchy below it: H2 per section, H3 for items within a section. Never skip levels, never add a second H1.
- **Semantic landmarks**: `<header>`, `<main>`, `<footer>`, `<nav>`; each section is `<section id="…" aria-labelledby="…-heading">`. Decorative/animated elements get `aria-hidden='true'`.
- **Structured data**: emit JSON-LD (`Organization`, `WebSite`, `WebApplication` with `featureList`, `FAQPage` if an FAQ exists) from a server component rendered before visible content. Keep `featureList` in sync with the features actually shown on the page.
- **Crawlable links**: all internal navigation uses Next `<Link>` with real `href`s - never `onClick` navigation. External links get `rel='noopener noreferrer'`.
- **All copy is server-rendered text.** No text baked into images, no content that only exists after a client effect runs.
- After adding routes or anchors, verify `app/sitemap.ts` and `app/robots.ts` still reflect reality.

## GEO (generative engine optimization)

AI crawlers and answer engines read this page. Optimize for extraction:

- **Answer-first sections.** Each H2 + first paragraph should directly answer a question a user would ask an AI ("What is Sim?", "What integrations does Sim support?", "How much does Sim cost?").
- **Atomic blocks.** Every feature card, template, and pricing tier must be independently quotable - self-contained, with "Sim" named explicitly. Never "the platform", "our tool", or a bare pronoun as the subject.
- **Specific numbers over vague claims.** "1,000+ integrations", "every major LLM", "100,000+ builders" - and only numbers that are true and shipped.
- **sr-only summaries.** The hero gets a `<p className='sr-only'>` (~50 words) stating what Sim is, who it's for, and what it does - a clean citation target for AI summarizers.
- The first 150 visible characters of the page must include "Sim", "AI workspace", and "AI agents".

## Copy

Follow `.claude/rules/constitution.md` exactly: Sim is "the open-source AI workspace where teams build, deploy, and manage AI agents" - never a workflow tool or automation platform. Direct sentences, active voice, concrete examples, no exclamation marks, no unexplained jargon on public pages.

## Structure

**Directory convention - mirror `app/workspace/[workspaceId]/<feature>`.** Every component lives in its own kebab-case folder holding `<name>.tsx` plus an `index.ts` barrel (relative re-export); a component's children nest under that folder's `components/` (each itself foldered, with its own `index.ts`). Non-component modules - `types.ts`, `constants.ts`, data files - sit at the relevant folder root. Never leave a bare `<name>.tsx` flat inside a `components/` directory.

```
(landing)/
├── CLAUDE.md                            # this file
├── page.tsx                             # route entry: metadata + <Landing />
├── landing.tsx                          # root composition: <main> section order
├── workflows/                           # a platform route: page.tsx (metadata) + workflows.tsx (config + shell)
└── components/
    ├── index.ts                         # top barrel
    ├── navbar/{navbar.tsx, index.ts, components/<chip>/…}   # <header><nav>: wordmark, dropdowns, stars, auth chips
    ├── hero/{hero.tsx, index.ts, components/hero-visual/…}  # h1, description, CTA, platform visual, logos
    ├── lifecycle/, features/, footer/, testimonials/        # each: <name>.tsx + index.ts (+ components/)
    ├── shared/                          # cross-page reused chrome (folder-per-component + barrel)
    │   ├── landing-shell/               # light wrapper + skip link + Navbar(stars) + Footer; wraps every page
    │   ├── hero-cta/                    # the one email-capture + Sign-up CTA (hero + every platform hero)
    │   └── logos/                       # the one customer-logo set; layout='grid' (hero) | 'row' (platform)
    └── platform-page/                   # the reusable platform-page layout (Workflows, Tables, Files, …)
        ├── platform-page.tsx, index.ts, types.ts, constants.ts   # PlatformPage + the content contract + spacing
        └── components/                  # platform-hero, platform-logos-row, platform-card-row (→ card, pill-cta),
                                         #   platform-visual-frame, platform-structured-data
```

Each section component's TSDoc carries its layout spec - read it before implementing. Section components own their landmark (Navbar → `<header>`, Footer → `<footer>`, the rest → `<section>`); the shared `LandingShell` owns the page frame (light wrapper, skip link, navbar, footer, GitHub stars via `@/lib/github/stars` - fetched at build/revalidate time, never client-fetched), and the page's `<main>` owns the section order and rhythm. Platform routes consume `PlatformPage` with a single content `config` - see `platform-page/CLAUDE`-level TSDoc on `platform-page.tsx`. Sub-components of a section go in `components/<section>/components/`.

Absolute imports only in component code (`@/app/(landing)/components/...`); `index.ts` barrels use relative re-exports (`export { X } from './x'`), matching the workspace convention. Props interfaces for every component. No `utils.ts` until two files share a helper.

## Checklist for every section you add

1. Server Component unless it provably needs client state; if client, it's a leaf.
2. H2 with `id` + `aria-labelledby` wiring; heading hierarchy intact.
3. Platform light tokens and emcn chrome only - no hex colors, no `--landing-*`, no `dark:`.
4. Images: `next/image`, explicit dimensions, `priority` only on the LCP element.
5. Copy passes the constitution (language table, claim hierarchy, tone).
6. "Sim" named explicitly; section quotable in isolation.
7. JSON-LD updated if the section adds features, FAQs, or pricing.
8. No layout shift: load the page, watch nothing move.
