import { describe, expect, it } from 'vitest'
import { FirecrawlBlock } from '@/blocks/blocks/firecrawl'
import type { BlockToolParamsContext } from '@/blocks/types'

function mapParams(params: Record<string, unknown>, context?: BlockToolParamsContext) {
  const mapper = FirecrawlBlock.tools.config?.params
  if (!mapper) throw new Error('Firecrawl block has no params mapper')
  return mapper(params, context)
}

describe('Firecrawl tool calls', () => {
  it('sends Parse a single document when the model passes it in a list', () => {
    const file = { id: 'file-1' }
    expect(mapParams({ file: [file] }, { operation: 'parse' }).file).toEqual(file)
  })
})
