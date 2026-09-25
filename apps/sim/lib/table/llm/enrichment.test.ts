import { describe, expect, it } from 'vitest'
import { enrichTableToolParameters } from '@/lib/table/llm/enrichment'
import type { TableSummary } from '@/lib/table/types'

const TABLE: TableSummary = {
  name: 'Players',
  columns: [
    { name: 'status', type: 'string' },
    { name: 'wins', type: 'number' },
  ],
}

const V2_SCHEMA = {
  properties: {
    filter: { type: 'object' },
    order: { type: 'array' },
    columns: { type: 'array' },
    limit: { type: 'number' },
    cursor: { type: 'string' },
  },
  required: [] as string[],
}

describe('enrichTableToolParameters for table_query_rows_v2', () => {
  const { properties, required } = enrichTableToolParameters(
    V2_SCHEMA,
    TABLE,
    'table_query_rows_v2'
  )

  it('describes filter with the predicate grammar and real columns', () => {
    expect(properties.filter.description).toContain('status, wins')
    expect(properties.filter.description).toContain('"op"')
    expect(properties.filter.description).not.toContain('$eq')
  })

  /**
   * The parameter schema is what the model reads when deciding the filter's
   * shape, so the select restriction has to appear there and not only in the
   * tool description.
   */
  it('carries the select restriction into the filter parameter description', () => {
    const withSelect = enrichTableToolParameters(
      V2_SCHEMA,
      {
        name: 'Transactions',
        columns: [
          { name: 'category', type: 'select', multiple: false },
          { name: 'tags', type: 'select', multiple: true },
        ],
      },
      'table_query_rows_v2'
    )
    expect(withSelect.properties.filter.description).toContain('rejected outright')
    expect(withSelect.properties.filter.description).toContain('category accept only')
    expect(withSelect.properties.filter.description).toContain('tags hold a list')
  })
})

describe('v1 enrichment is unchanged', () => {
  it('still forces filter required and teaches $eq', () => {
    const { properties, required } = enrichTableToolParameters(
      { properties: { filter: { type: 'object' }, sort: { type: 'object' } }, required: [] },
      TABLE,
      'table_query_rows'
    )
    expect(required).toContain('filter')
    expect(properties.filter.description).toContain('$eq')
  })
})
