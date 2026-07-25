/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { contextDevClassifyNaicsTool } from '@/tools/context_dev/classify_naics'
import { contextDevGetBrandTool } from '@/tools/context_dev/get_brand'
import { CONTEXT_DEV_CREDIT_USD } from '@/tools/context_dev/hosting'
import { contextDevScrapeMarkdownTool } from '@/tools/context_dev/scrape_markdown'
import { contextDevScreenshotTool } from '@/tools/context_dev/screenshot'
import type { ToolConfig } from '@/tools/types'

function cost(tool: ToolConfig<any, any>, params: any, output: Record<string, unknown>) {
  const pricing = tool.hosting?.pricing
  if (!pricing || pricing.type !== 'custom') throw new Error('Expected custom pricing')
  const result = pricing.getCost(params, output)
  return typeof result === 'number' ? { cost: result } : result
}

describe('Context.dev hosted key pricing', () => {
  it('declares hosting with the shared env prefix and BYOK provider on every tool', () => {
    for (const tool of [
      contextDevScrapeMarkdownTool,
      contextDevScreenshotTool,
      contextDevGetBrandTool,
      contextDevClassifyNaicsTool,
    ]) {
      expect(tool.hosting?.envKeyPrefix).toBe('CONTEXT_DEV_API_KEY')
      expect(tool.hosting?.byokProviderId).toBe('context_dev')
    }
  })

  it('charges the reported credits at the per-credit rate for a 1-credit scrape', () => {
    expect(cost(contextDevScrapeMarkdownTool, {}, { creditsConsumed: 1 }).cost).toBeCloseTo(
      CONTEXT_DEV_CREDIT_USD
    )
  })

  it('charges the reported credits at the per-credit rate for a 5-credit screenshot', () => {
    expect(cost(contextDevScreenshotTool, {}, { creditsConsumed: 5 }).cost).toBeCloseTo(
      5 * CONTEXT_DEV_CREDIT_USD
    )
  })

  it('charges the reported credits at the per-credit rate for a 10-credit brand lookup', () => {
    expect(cost(contextDevGetBrandTool, {}, { creditsConsumed: 10 }).cost).toBeCloseTo(
      10 * CONTEXT_DEV_CREDIT_USD
    )
  })

  it('charges zero when the response has no credit accounting', () => {
    expect(cost(contextDevClassifyNaicsTool, {}, { creditsConsumed: null }).cost).toBe(0)
    expect(cost(contextDevClassifyNaicsTool, {}, {}).cost).toBe(0)
  })
})
