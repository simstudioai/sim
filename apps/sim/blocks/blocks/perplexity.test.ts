import { describe, expect, it } from 'vitest'
import { PerplexityBlock } from '@/blocks/blocks/perplexity'
import type { BlockToolParamsContext } from '@/blocks/types'

function mapParams(params: Record<string, unknown>, context?: BlockToolParamsContext) {
  const mapper = PerplexityBlock.tools.config?.params
  if (!mapper) throw new Error('Perplexity block has no params mapper')
  return { ...params, ...mapper(params, context) }
}

describe('Perplexity tool calls', () => {
  it('keeps a model temperature of 0 on Chat', () => {
    const result = mapParams(
      { apiKey: 'k', content: 'q', temperature: 0 },
      { operation: 'perplexity_chat' }
    )
    expect(result.temperature).toBe(0)
  })

  it('keeps a model domain filter array on Search', () => {
    const result = mapParams(
      { apiKey: 'k', query: 'q', search_domain_filter: ['nature.com', ' science.org '] },
      { operation: 'perplexity_search' }
    )
    expect(result.search_domain_filter).toEqual(['nature.com', 'science.org'])
  })
})

describe('Perplexity canvas', () => {
  it('sends a Temperature of 0 on Chat', () => {
    const result = mapParams({
      operation: 'perplexity_chat',
      apiKey: 'k',
      content: 'q',
      temperature: 0,
    })
    expect(result.temperature).toBe(0)
  })
})
