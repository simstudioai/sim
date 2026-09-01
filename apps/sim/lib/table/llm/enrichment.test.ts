/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { MULTI_SELECT_OPS, SINGLE_SELECT_OPS } from '@/lib/table/column-types'
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

  /**
   * An unknown field is rejected outright, so every field the instructions name
   * has to be a column the table actually has.
   */
  it('names a real text column in the wildcard example', () => {
    expect(enriched).toContain('{"field":"status","op":"ilike","value":"*jo*"}')
    expect(enriched).not.toContain('{"field":"name"')
  })

  /**
   * `buildPatternClause` ESCAPES `%` before translating `*`, so a model that
   * sends `%` gets a literal-percent match and silently wrong rows rather than
   * an error. All four pattern operators share that translation.
   */
  it('covers every pattern operator in the wildcard rule and warns off %', () => {
    expect(enriched).toContain('like, ilike, nlike and nilike all use * as the wildcard - never %')
  })

  /**
   * A question with no condition ("the 5 most recent rows") is answered with
   * order and limit; the model must not invent a predicate to satisfy it.
   */
  it('tells the model a filter is optional when no condition was asked for', () => {
    expect(enriched).toContain('omit filter entirely and use order and limit')
    expect(enriched).toContain('omit it whenever the question carries no condition')
  })

  it('drops the wildcard example when the table has no text column', () => {
    const numeric = enrichTableToolDescription(
      'Query rows.',
      { name: 'Scores', columns: [{ name: 'wins', type: 'number' }] },
      'table_query_rows_v2'
    )
    expect(numeric).toContain('matching anywhere in a text value')
    expect(numeric).not.toContain('"op":"ilike"')
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

/**
 * A select column rejects any operator outside its subset — the query layer
 * throws rather than returning no rows — so the description has to name the
 * subset per column instead of advertising the full operator list.
 */
describe('select columns in the v2 description', () => {
  const SELECT_TABLE: TableSummary = {
    name: 'Transactions',
    columns: [
      { name: 'category', type: 'select', multiple: false },
      { name: 'tags', type: 'select', multiple: true },
      { name: 'description', type: 'string' },
    ],
  }

  const enriched = enrichTableToolDescription('Query rows.', SELECT_TABLE, 'table_query_rows_v2')

  it('names the allowed operators on a single-select column', () => {
    expect(enriched).toContain(
      'category (single-select; only eq, ne, in, nin, isEmpty, isNotEmpty, isNull, isNotNull)'
    )
  })

  it('names the allowed operators on a multi-select column', () => {
    expect(enriched).toContain(
      'tags (multi-select; only contains, ncontains, isEmpty, isNotEmpty, isNull, isNotNull)'
    )
  })

  /**
   * The list is derived from the sets `fieldPredicate` gates on, so it cannot
   * drift from the validator the way a hand-copied list did.
   */
  it('derives the operator list from the validator sets', () => {
    for (const op of SINGLE_SELECT_OPS) expect(enriched).toContain(op)
    for (const op of MULTI_SELECT_OPS) expect(enriched).toContain(op)
  })

  it('leaves non-select columns unannotated', () => {
    expect(enriched).toContain('description (string)')
  })

  it('never claims the table has no array columns', () => {
    expect(enriched).not.toContain('no array columns')
  })

  it('steers multi-select matching to contains rather than ilike', () => {
    expect(enriched).toContain('match it by option name with contains, never ilike')
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

  it('omits the restriction note when no column restricts operators', () => {
    expect(properties.filter.description).not.toContain('rejected outright')
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
