import { describe, expect, it } from 'vitest'
import { sailpointSearchAggregateTool } from '@/tools/sailpoint/definitions'
import type { SailPointSearchAggregateParams } from '@/tools/sailpoint/types'

const credentials = { clientId: 'client', clientSecret: 'secret', tenant: 'tenant' }

function operationInput(params: SailPointSearchAggregateParams) {
  return sailpointSearchAggregateTool.operation.input(params)
}

describe('SailPoint Search Aggregate tool input', () => {
  it.each([
    ['aggregationsDsl', {}],
    ['aggregationsDsl', '{}'],
    ['aggregations', {}],
    ['aggregations', '{}'],
  ] as const)('rejects an empty %s definition', (field, value) => {
    expect(() => operationInput({ ...credentials, [field]: value })).toThrow(
      'aggregationsDsl or aggregations must be a non-empty object'
    )
  })

  it('accepts either non-empty aggregation representation', () => {
    expect(
      operationInput({ ...credentials, aggregationsDsl: { names: { terms: { field: 'name' } } } })
    ).toMatchObject({ aggregationsDsl: { names: { terms: { field: 'name' } } } })
    expect(
      operationInput({ ...credentials, aggregations: { names: { type: 'TERM', field: 'name' } } })
    ).toMatchObject({ aggregations: { names: { type: 'TERM', field: 'name' } } })
  })
})
