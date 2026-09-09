/**
 * @vitest-environment node
 */
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  Badge: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
  TableOfContents: () => null,
}))

vi.mock('@sim/emcn/icons', () => ({
  Check: () => null,
  X: () => null,
}))

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not-found')
  },
}))

vi.mock('@/app/(landing)/components', () => ({ BackLink: () => null }))
vi.mock('@/app/(landing)/components/landing-faq', () => ({ LandingFAQ: () => null }))
vi.mock('@/app/(landing)/comparisons/components/brand-icon-tile', () => ({
  BrandIconTile: () => null,
  SimIconTile: () => null,
}))
vi.mock('@/app/(landing)/comparisons/components/comparison-cards', () => ({
  ComparisonCards: () => null,
}))
vi.mock('@/app/(landing)/comparisons/components/source-info/source-popover', () => ({
  SourcePopover: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

import { simProfile } from '@/lib/compare/data'
import ComparisonProviderPage, {
  dynamicParams,
  generateStaticParams,
} from '@/app/(landing)/comparisons/[provider]/page'
import { COMPARISON_SECTIONS, getFactGroup } from '@/app/(landing)/comparisons/comparison-sections'
import { ComparisonTable } from '@/app/(landing)/comparisons/components/comparison-table'
import { ALL_COMPETITORS, buildBottomLine } from '@/app/(landing)/comparisons/utils'

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

/** Mirrors React's text escaping so data-derived copy can be matched in markup. */
function escapeForMarkup(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

describe('ComparisonProviderPage', () => {
  it.each(ALL_COMPETITORS)(
    'renders every fact and section for $name in one chart',
    async (competitor) => {
      const markup = await renderProvider(competitor.id)

      expect(countMatches(markup, /role="table"/g)).toBe(1)
      expect(markup).toContain(
        `aria-label="Sim and ${escapeForMarkup(competitor.name)} comparison"`
      )
      expect(countMatches(markup, /role="rowgroup"/g)).toBe(COMPARISON_SECTIONS.length)
      expect(countMatches(markup, /role="rowheader"/g)).toBe(
        TOTAL_FACT_ROWS + COMPARISON_SECTIONS.length * 2
      )

      for (const section of COMPARISON_SECTIONS) {
        expect(markup).toContain(`aria-labelledby="${section.id}-heading"`)
        expect(markup).toContain(`id="${section.id}-heading"`)
        expect(markup).toContain(`id="${section.id}"`)
        const intro = competitor.sectionIntros?.[section.group]
        if (intro) {
          const introCell = markup.match(
            new RegExp(
              `<div id="${section.id}" role="cell" aria-colspan="2"[^>]*>([\\s\\S]*?)</div>`
            )
          )?.[1]
          expect(introCell).toBeDefined()
          for (const segment of intro) {
            expect(introCell).toContain(
              escapeForMarkup(typeof segment === 'string' ? segment : segment.text)
            )
          }
        } else {
          expect(markup).toContain(`id="${section.id}" role="rowheader"`)
        }
        for (const row of section.rows) {
          expect(markup).toContain(escapeForMarkup(row.label))
          for (const profile of [simProfile, competitor]) {
            const fact = getFactGroup(profile, section.group)[row.key]
            expect(markup).toContain(escapeForMarkup(fact.value))
            if (fact.detail) expect(markup).toContain(escapeForMarkup(fact.detail))
            for (const source of fact.sources) {
              expect(markup).toContain(escapeForMarkup(source.url))
            }
          }
        }
      }

      const verdict = buildBottomLine(competitor)
      expect(markup).toContain(escapeForMarkup(verdict.chooseSim))
      expect(markup).toContain(escapeForMarkup(verdict.chooseCompetitor))
    }
  )

  it('preserves internal and external links in AgentKit category introductions', async () => {
    const markup = await renderProvider('openai-agentkit')
    const internal = markup.match(/<a [^>]*>Sim combines a per-user subscription<\/a>/)?.[0]
    const external = markup.match(/<a [^>]*>self-hosting<\/a>/)?.[0]

    expect(internal).toContain('href="/pricing"')
    expect(internal).not.toContain('target=')
    expect(external).toContain('href="https://docs.sim.ai/platform/self-hosting"')
    expect(external).toContain('target="_blank"')
    expect(external).toContain('rel="noopener noreferrer"')
  })

  it('pre-renders every known competitor and lets unknown slugs reach the section 404', async () => {
    expect(await generateStaticParams()).toEqual(
      ALL_COMPETITORS.map((competitor) => ({ provider: competitor.id }))
    )
    expect(dynamicParams).toBe(true)
    await expect(renderProvider('unknown-comparison-provider')).rejects.toThrow('not-found')
  })

  it('retains the upstream single-section table API for existing consumers', () => {
    const competitor = ALL_COMPETITORS[0]
    const section = COMPARISON_SECTIONS[0]
    const markup = renderToStaticMarkup(
      <ComparisonTable sim={simProfile} competitor={competitor} section={section} />
    )

    expect(countMatches(markup, /role="table"/g)).toBe(1)
    expect(countMatches(markup, /role="rowheader"/g)).toBe(section.rows.length)
    expect(markup).toContain(
      `aria-label="Sim vs ${escapeForMarkup(competitor.name)}: ${escapeForMarkup(section.title)}"`
    )
  })
})
