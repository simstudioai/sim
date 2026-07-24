---
paths:
  - "apps/sim/app/(landing)/**/*.tsx"
  - "apps/sim/content/**/*.mdx"
---

# Landing Page — SEO / GEO

## SEO

- One `<h1>` per page, in Hero only — never add another.
- Strict heading hierarchy: H1 (Hero) → H2 (section titles) → H3 (feature names).
- Every section: `<section id="…" aria-labelledby="…-heading">`.
- Decorative/animated elements: `aria-hidden="true"`.
- All internal routes use Next.js `<Link>` (crawlable). External links get `rel="noopener noreferrer"`.
- Navbar is a Server Component (no `'use client'`) for immediate crawlability. Logo `<Image>` has `priority` (LCP element).
- Navbar `<nav>` carries `SiteNavigationElement` schema.org markup.
- Feature lists must stay in sync with `WebApplication.featureList` in `structured-data.tsx`.

## GEO (Generative Engine Optimisation)

- **Answer-first pattern**: each section's H2 + subtitle should directly answer a user question (e.g. "What is Sim?", "How fast can I deploy?").
- **Atomic answer blocks**: each feature / template card should be independently extractable by an AI summariser.
- **Entity consistency**: always write "Sim" by name — never "the platform" or "our tool".
- **Keyword density**: first 150 visible chars of Hero must name "Sim", "AI workspace", "AI agents".
- **sr-only summaries**: Hero and Templates each have a `<p className="sr-only">` (~50 words) as an atomic product/catalog summary for AI citation.
- **Specific numbers**: prefer concrete figures ("1,000+ integrations", "15+ AI providers") over vague claims.

## Citations and linking (`/library`, `/blog`, `/comparisons`)

The Princeton GEO study (Aggarwal et al., KDD 2024, [arXiv:2311.09735](https://arxiv.org/abs/2311.09735)) found that adding citations, quotations, and statistics were the three strongest of nine tested tactics, worth 30–40% relative lifts in AI-answer visibility. Sourcing is also what makes a claim checkable by a human reader.

- **Every third-party factual claim carries an outbound source link.** Pricing, rate limits, feature availability, licensing, compliance certifications — link the primary source (the vendor's own pricing page, docs, changelog, or license file), not a secondary blog. External links get `rel="noopener noreferrer"`.
- **Prefer the primary source over a roundup.** Citing another vendor's comparison post to substantiate a fact about them is second-hand and ages badly.
- **Internal links: 3–5 per library post**, pointing at genuinely related library entries, using real `href`s (Next `<Link>` in TSX; a plain markdown link in MDX). A post with zero internal links is a dead end for crawlers and readers alike.
- **Never fabricate a citation.** An unlinked claim is better than a link that does not substantiate it. If a number cannot be sourced, cut the number.

## Freshness

Answer engines weight recency to avoid repeating stale facts, and a reader deciding whether to trust a pricing comparison wants to know when it was last checked. The vendor-published "fresh content earns Nx more citations" figures are directional, not measured — the reason to do this is that both signals must agree and both must be real.

- **Emit `dateModified`** in the page's structured data (JSON-LD or microdata), and emit it exactly once per document.
- **Show the same date to the reader.** `/comparisons/[provider]` renders "Last verified …" from `getLatestVerifiedDate()`; `/library` and `/blog` posts render "Updated …" next to the publish date. A date that exists only in metadata is invisible to a reader deciding whether to trust the page.
- **Only surface a modified date when it differs from the publish date** — an "Updated" label on the publish day is noise.
- **Bump the date only on a substantive edit.** Touching frontmatter without changing the content is date-washing; it degrades the signal for every other page on the domain.
- **Comparison facts are dated at the fact level.** Every `Fact` in `apps/sim/lib/compare/data` carries `sources: [{ url, label, asOf }]`. Re-checking a fact means updating its `asOf`, which flows through `getLatestVerifiedDate()` to the visible date, the JSON-LD, and the sitemap.
