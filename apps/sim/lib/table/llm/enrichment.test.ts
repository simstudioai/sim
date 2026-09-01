/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { enrichTableToolDescription, enrichTableToolParameters } from '@/lib/table/llm/enrichment'
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

describe('enrichTableToolDescription for table_query_rows_v2', () => {
  const enriched = enrichTableToolDescription('Query rows.', TABLE, 'table_query_rows_v2')

  it('names the real columns', () => {
    expect(enriched).toContain('status (string)')
    expect(enriched).toContain('wins (number)')
  })

  it('teaches the predicate grammar built from a real column', () => {
    expect(enriched).toContain('{"field":"wins","op":"gte","value":10}')
    expect(enriched).toContain('"all"')
  })

  it('never teaches the v1 MongoDB grammar or offset paging', () => {
    expect(enriched).not.toContain('$eq')
    expect(enriched).not.toContain('offset')
  })

  it('describes order rather than sort', () => {
    expect(enriched).toContain('Example order: [{"field":"wins","direction":"desc"}]')
  })

  /**
   * A metrics table is all-numeric and a lookup table is all-text; both are
   * common, and each picks a different arm of the example builder.
   */
  it('builds a numeric example when the table has no string column', () => {
    const numeric = enrichTableToolDescription(
      'Query rows.',
      { name: 'Scores', columns: [{ name: 'wins', type: 'number' }] },
      'table_query_rows_v2'
    )
    expect(numeric).toContain('{"field":"wins","op":"gte","value":10}')
    expect(numeric).not.toContain('AND group')
  })

  it('builds a string example when the table has no numeric column', () => {
    const textual = enrichTableToolDescription(
      'Query rows.',
      { name: 'Statuses', columns: [{ name: 'status', type: 'string' }] },
      'table_query_rows_v2'
    )
    expect(textual).toContain('{"field":"status","op":"eq","value":"active"}')
    expect(textual).not.toContain('"op":"gte"')
  })

  it('omits the example rather than naming a placeholder column', () => {
    const bare = enrichTableToolDescription(
      'Query rows.',
      { name: 'Blobs', columns: [{ name: 'payload', type: 'json' }] },
      'table_query_rows_v2'
    )
    expect(bare).toContain('payload (json)')
    expect(bare).not.toContain('Example filter')
    expect(bare).not.toContain('Example order')
  })
})

describe('enrichTableToolParameters for table_query_rows_v2', () => {
  const { properties, required } = enrichTableToolParameters(
    V2_SCHEMA,
    TABLE,
    'table_query_rows_v2'
  )

  /**
   * The v1 branch force-pushes `filter` into `required` because a v1 query
   * without one fails. A v2 query without a filter is valid and returns every
   * row, so forcing it would make the model invent a filter for "list all".
   */
  it('leaves filter optional', () => {
    expect(required).not.toContain('filter')
  })

  it('describes filter with the predicate grammar and real columns', () => {
    expect(properties.filter.description).toContain('status, wins')
    expect(properties.filter.description).toContain('"op"')
    expect(properties.filter.description).not.toContain('$eq')
  })

  it('enriches order, columns, limit, and cursor', () => {
    expect(properties.order.description).toContain('direction')
    expect(properties.columns.description).toContain('status, wins')
    expect(properties.limit.description).toContain('5MB')
    expect(properties.cursor.description).toContain('nextCursor')
  })

  it('does not enrich a sort property that v2 does not have', () => {
    expect(properties.sort).toBeUndefined()
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

  /**
   * Both Table blocks expose the bulk tools and the rows route accepts either
   * grammar, so these keep teaching $eq — enrichment cannot tell which block
   * called it.
   */
  it('keeps the shared bulk tools on the v1 grammar', () => {
    const { properties } = enrichTableToolParameters(
      { properties: { filter: { type: 'object' } }, required: [] },
      TABLE,
      'table_update_rows_by_filter'
    )
    expect(properties.filter.description).toContain('$eq')
  })
})
