import { describe, expect, it } from 'vitest'
import { PeopleDataLabsBlock } from '@/blocks/blocks/peopledatalabs'
import type { BlockToolParamsContext } from '@/blocks/types'

function mapParams(params: Record<string, unknown>, context?: BlockToolParamsContext) {
  const mapper = PeopleDataLabsBlock.tools.config?.params
  if (!mapper) throw new Error('People Data Labs block has no params mapper')
  return { ...params, ...mapper(params, context) }
}

describe('People Data Labs tool calls', () => {
  it('keeps the model company identifiers and likelihood on Company Enrich', () => {
    const result = mapParams(
      { apiKey: 'k', name: 'Acme', website: 'acme.com', min_likelihood: 6 },
      { operation: 'pdl_company_enrich' }
    )
    expect(result).toMatchObject({ name: 'Acme', website: 'acme.com', min_likelihood: 6 })
  })

  it('keeps the model size on Autocomplete', () => {
    const result = mapParams(
      { apiKey: 'k', field: 'company', text: 'acm', size: 5 },
      { operation: 'pdl_autocomplete' }
    )
    expect(result.size).toBe(5)
  })
})
