import { describe, expect, it } from 'vitest'
import { ExaBlock } from '@/blocks/blocks/exa'
import type { BlockToolParamsContext } from '@/blocks/types'

function mapParams(params: Record<string, unknown>, context?: BlockToolParamsContext) {
  const mapper = ExaBlock.tools.config?.params
  if (!mapper) throw new Error('Exa block has no params mapper')
  return mapper(params, context)
}

describe('Exa legacy Research tool rows', () => {
  it('maps the stored research model to an Agent effort when the operation arrives only in the context', () => {
    expect(
      mapParams({ query: 'q', model: 'exa-research-pro' }, { operation: 'exa_research' }).effort
    ).toBe('high')
  })
})
