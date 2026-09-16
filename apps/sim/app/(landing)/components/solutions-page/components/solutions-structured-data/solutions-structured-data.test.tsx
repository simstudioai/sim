/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/utils/urls', () => ({ SITE_URL: 'https://sim.ai' }))

import { SolutionsStructuredData } from '@/app/(landing)/components/solutions-page/components/solutions-structured-data/solutions-structured-data'
import type {
  SolutionsPageConfig,
  SolutionsProductPageConfig,
} from '@/app/(landing)/components/solutions-page/types'

const IDENTITY = {
  module: 'Knowledge Base',
  path: '/knowledge',
  seoDescription: 'Search company knowledge with Sim.',
  hero: {
    heading: 'Knowledge for your agents',
    description: 'Search company knowledge with Sim.',
    summary: 'Sim connects documents to AI agents.',
    visual: null,
  },
}

function readGraph(config: SolutionsPageConfig | SolutionsProductPageConfig) {
  const html = renderToStaticMarkup(<SolutionsStructuredData config={config} />)
  return JSON.parse(html.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''))['@graph']
}

describe('SolutionsStructuredData', () => {
  it('preserves existing solution feature lists, canonical identity, and paid-only offers', () => {
    const config: SolutionsPageConfig = {
      ...IDENTITY,
      offersFreeTier: false,
      rows: ['first', 'second'].map((id) => ({
        id,
        title: id,
        subtitle: 'Manage sources.',
        cta: { label: 'Explore', href: '/knowledge' },
        cards: [{ title: 'Connect sources', description: 'Sync documents.', visual: null }],
      })),
    }
    const graph = readGraph(config)
    expect(graph[0]).toMatchObject({
      url: 'https://sim.ai/knowledge',
      description: IDENTITY.seoDescription,
    })
    expect(graph[2].featureList).toEqual(['Connect sources'])
    expect(graph[2]).not.toHaveProperty('offers')
  })

  it('derives product-page features from the visible stories and keeps the free tier', () => {
    const config: SolutionsProductPageConfig = {
      ...IDENTITY,
      features: ['Connect sources', 'Retrieve context'].map((title, index) => ({
        id: `feature-${index}`,
        label: title,
        title,
        description: title,
        visual: null,
      })),
    }
    const graph = readGraph(config)
    expect(graph[2].featureList).toEqual(['Connect sources', 'Retrieve context'])
    expect(graph[2].offers).toMatchObject({ price: '0', priceCurrency: 'USD' })
    expect(graph[1].itemListElement[1]).toMatchObject({
      name: 'Knowledge Base',
      item: 'https://sim.ai/knowledge',
    })
  })
})
