/**
 * @vitest-environment node
 */
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
  Tooltip: {
    Root: ({ children }: { children: ReactNode }) => <>{children}</>,
    Trigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    Content: () => null,
  },
}))

vi.mock('@sim/emcn/icons', () => ({
  Check: () => null,
  X: () => null,
}))

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('@/app/(landing)/components', () => ({ BackLink: () => null }))
vi.mock('@/app/(landing)/components/cta/cta', () => ({ Cta: () => null }))
vi.mock('@/app/(landing)/components/json-ld', () => ({ JsonLd: () => null }))
vi.mock('@/app/(landing)/components/landing-faq', () => ({ LandingFAQ: () => null }))
vi.mock('@/app/(landing)/comparisons/components/brand-icon-tile', () => ({
  BrandIconTile: () => null,
  SimIconTile: () => null,
}))
vi.mock('@/app/(landing)/comparisons/components/comparison-cards', () => ({
  ComparisonCards: () => null,
}))

import ComparisonProviderPage from '@/app/(landing)/comparisons/[provider]/page'
import { COMPARISON_SECTIONS } from '@/app/(landing)/comparisons/comparison-sections'

const TOTAL_FACT_ROWS = COMPARISON_SECTIONS.reduce(
  (total, section) => total + section.rows.length,
  0
)

async function renderProvider(provider: string): Promise<string> {
  const element = await ComparisonProviderPage({ params: Promise.resolve({ provider }) })
  return renderToStaticMarkup(element)
}

function countMatches(markup: string, pattern: RegExp): number {
  return markup.match(pattern)?.length ?? 0
}

/**
 * The opening tag of the anchor whose entire body is `text`. Anchored on the
 * link text rather than the href because source-citation links elsewhere on the
 * page point at some of the same URLs — matching on href alone silently passes
 * against the wrong anchor.
 */
function anchorWrapping(markup: string, text: string): string {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return markup.match(new RegExp(`<a [^>]*>${escaped}</a>`))?.[0] ?? ''
}

/** Section titles contain `&`, which React escapes on the way into the markup. */
function escapeForMarkup(value: string): string {
  return value.replace(/&/g, '&amp;')
}

describe('ComparisonProviderPage', () => {
  it('renders one table per section with every fact row, for a profile with optional prose', async () => {
    const markup = await renderProvider('dust')

    expect(countMatches(markup, /role="table"/g)).toBe(COMPARISON_SECTIONS.length)
    expect(countMatches(markup, /role="rowheader"/g)).toBe(TOTAL_FACT_ROWS)
  })

  it('renders the same section and row inventory for a profile without optional prose', async () => {
    const markup = await renderProvider('n8n')

    expect(countMatches(markup, /role="table"/g)).toBe(COMPARISON_SECTIONS.length)
    expect(countMatches(markup, /role="rowheader"/g)).toBe(TOTAL_FACT_ROWS)
  })

  it('gives every section heading an id its section aria-labelledby points at', async () => {
    const markup = await renderProvider('dust')

    for (const section of COMPARISON_SECTIONS) {
      const headingId = `comparison-section-${section.group}-heading`
      expect(markup).toContain(`aria-labelledby="${headingId}"`)
      expect(markup).toContain(`id="${headingId}"`)
    }
  })

  it('labels each section table distinctly so the seven tables are distinguishable', async () => {
    const markup = await renderProvider('dust')

    for (const section of COMPARISON_SECTIONS) {
      expect(markup).toContain(`aria-label="Sim vs Dust: ${escapeForMarkup(section.title)}"`)
    }
  })

  it('renders the lead answer and verdict only when the profile supplies them', async () => {
    const withProse = await renderProvider('dust')
    const withoutProse = await renderProvider('n8n')

    expect(withProse).toContain('Is Sim better than Dust?')
    expect(withProse).toContain('id="better-than-heading"')
    expect(withoutProse).not.toContain('Is Sim better than n8n?')
    expect(withoutProse).not.toContain('id="better-than-heading"')
  })

  it('hardens external prose links and keeps internal ones as plain paths', async () => {
    const markup = await renderProvider('openai-agentkit')

    const external = anchorWrapping(markup, 'self-hosting')
    expect(external).toContain('href="https://docs.sim.ai/platform/self-hosting"')
    expect(external).toContain('target="_blank"')
    expect(external).toContain('rel="noopener noreferrer"')

    const internal = anchorWrapping(markup, 'Sim combines a per-user subscription')
    expect(internal).toContain('href="/pricing"')
    expect(internal).not.toContain('target=')
    expect(internal).not.toContain('rel=')
  })
})
