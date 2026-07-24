/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { batchScrapeTool } from '@/tools/firecrawl/batch-scrape'
import { crawlTool } from '@/tools/firecrawl/crawl'
import { extractTool } from '@/tools/firecrawl/extract'
import { FIRECRAWL_CREDIT_USD } from '@/tools/firecrawl/hosting'
import { mapTool } from '@/tools/firecrawl/map'
import { parseTool } from '@/tools/firecrawl/parse'
import { scrapeTool } from '@/tools/firecrawl/scrape'
import { searchTool } from '@/tools/firecrawl/search'

/** The slice of a tool config this suite exercises, free of each tool's param type. */
interface HostedTool {
  hosting?: {
    envKeyPrefix: string
    apiKeyParam: string
    byokProviderId?: string
    rateLimit: { mode: string }
    pricing:
      | { type: 'per_request'; cost: number }
      | {
          type: 'custom'
          getCost: (
            params: never,
            output: Record<string, unknown>
          ) => number | { cost: number; metadata?: Record<string, unknown> }
        }
  }
}

const HOSTED_TOOLS: Array<[string, HostedTool]> = [
  ['scrape', scrapeTool],
  ['search', searchTool],
  ['crawl', crawlTool],
  ['map', mapTool],
  ['extract', extractTool],
  ['parse', parseTool],
  ['batchScrape', batchScrapeTool],
]

function getCost(tool: HostedTool, output: Record<string, unknown>) {
  const pricing = tool.hosting?.pricing
  if (pricing?.type !== 'custom') throw new Error('expected custom pricing')
  return pricing.getCost(undefined as never, output)
}

describe('firecrawl hosted-key config', () => {
  it.each(HOSTED_TOOLS)('%s resolves a complete hosting config', (_name, tool) => {
    expect(tool.hosting).toMatchObject({
      envKeyPrefix: 'FIRECRAWL_API_KEY',
      apiKeyParam: 'apiKey',
      byokProviderId: 'firecrawl',
      rateLimit: { mode: 'per_request', requestsPerMinute: 100 },
    })
    expect(tool.hosting?.pricing.type).toBe('custom')
  })

  it('bills credits reported on the response envelope', () => {
    expect(getCost(searchTool, { creditsUsed: 4 })).toEqual({
      cost: 4 * FIRECRAWL_CREDIT_USD,
      metadata: { creditsUsed: 4 },
    })
  })

  it('bills credits reported on the returned document metadata', () => {
    // Firecrawl reports per-page usage on the document rather than the
    // envelope; reading only the envelope left every scrape and parse unbilled.
    expect(getCost(scrapeTool, { metadata: { creditsUsed: 5 } })).toEqual({
      cost: 5 * FIRECRAWL_CREDIT_USD,
      metadata: { creditsUsed: 5 },
    })

    expect(getCost(parseTool, { metadata: { creditsUsed: 12 } })).toEqual({
      cost: 12 * FIRECRAWL_CREDIT_USD,
      metadata: { creditsUsed: 12 },
    })
  })

  it.each(HOSTED_TOOLS)('%s rejects a response with no usable credit count', (_name, tool) => {
    expect(() => getCost(tool, {})).toThrow(/creditsUsed/)
    expect(() => getCost(tool, { creditsUsed: 'many' })).toThrow(/non-numeric/)
  })
})
