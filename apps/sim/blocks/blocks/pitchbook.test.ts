import { describe, expect, it } from 'vitest'
import { PitchBookBlock } from '@/blocks/blocks/pitchbook'
import type { BlockToolParamsContext } from '@/blocks/types'

function mapParams(params: Record<string, unknown>, context?: BlockToolParamsContext) {
  const mapper = PitchBookBlock.tools.config?.params
  if (!mapper) throw new Error('PitchBook block has no params mapper')
  return { ...params, ...mapper(params, context) }
}

describe('PitchBook tool calls', () => {
  it('keeps the model pbId on a profile lookup', () => {
    const result = mapParams({ apiKey: 'k', pbId: '10618-03' }, { operation: 'company_bio' })
    expect(result.pbId).toBe('10618-03')
  })

  it('keeps the model search filters on the owning search', () => {
    const result = mapParams(
      { apiKey: 'k', country: 'US', dealType: 'VC' },
      { operation: 'deal_search' }
    )
    expect(result).toMatchObject({ country: 'US', dealType: 'VC' })
  })
})
