import { describe, expect, it } from 'vitest'
import { EnrichBlock } from '@/blocks/blocks/enrich'

describe('Enrich agent tool calls', () => {
  it('forwards the model company ID list and location for Search Jobs', () => {
    const mapper = EnrichBlock.tools.config?.params
    if (!mapper) throw new Error('Enrich block has no params mapper')

    const result = mapper(
      { apiKey: 'key', keywords: 'engineer', companyIds: '2048, 3050', location: 'London' },
      { operation: 'search_jobs' }
    )

    expect(result).toMatchObject({ companyIds: '2048, 3050', location: 'London' })
  })
})
