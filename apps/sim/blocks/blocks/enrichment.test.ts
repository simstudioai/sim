import { describe, expect, it } from 'vitest'
import { EnrichmentBlock } from '@/blocks/blocks/enrichment'
import type { BlockToolParamsContext } from '@/blocks/types'

function mapParams(params: Record<string, unknown>, context?: BlockToolParamsContext) {
  const mapper = EnrichmentBlock.tools.config?.params
  if (!mapper) throw new Error('Enrichment block has no params mapper')
  return mapper(params, context)
}

describe('Enrichment tool calls', () => {
  it('runs the row enrichment with the model inputs when the operation arrives only in the context', () => {
    expect(mapParams({ inputs: { domain: 'acme.com' } }, { operation: 'company-info' })).toEqual({
      enrichmentId: 'company-info',
      inputs: { domain: 'acme.com' },
    })
  })

  it('lets a value filled on the tool row override the model input', () => {
    const mapped = mapParams(
      { 'company-info__domain': 'stored.com', inputs: '{"domain":"model.com"}' },
      { operation: 'company-info' }
    )
    expect(mapped.inputs).toEqual({ domain: 'stored.com' })
  })

  it('keeps the model enrichment id when the tool row carries no operation', () => {
    expect(mapParams({ enrichmentId: 'company-info' }, { operation: undefined }).enrichmentId).toBe(
      'company-info'
    )
  })
})
