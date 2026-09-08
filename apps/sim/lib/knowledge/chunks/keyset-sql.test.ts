/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@sim/db/schema')
vi.unmock('drizzle-orm')

import { SOURCE_ACL_MAX_AGE_MS } from '@/lib/knowledge/access/freshness'
import { WORKSPACE_ACCESS_SCOPE } from '@/lib/knowledge/access/scope'
import { SYSTEM_ACCESS_SCOPE } from '@/lib/knowledge/access/types'
import { queryChunks } from '@/lib/knowledge/chunks/service'
import type { ChunkSortBy } from '@/lib/knowledge/chunks/types'

/**
 * The SQL the chunk list actually generates, rendered rather than mocked.
 *
 * `chunks.test.ts` stubs `queryChunks` outright and the application tests stub
 * `db`, so nothing there would notice a fragment Postgres cannot parse — which
 * is the failure mode this list is exposed to: the `enabled` sort orders and
 * compares on a hand-written `case when` expression rather than a plain column,
 * and it appears in both `ORDER BY` and the keyset's `>`/`<` comparison. A green
 * suite is not evidence for either.
 *
 * This renders through drizzle's own `PgDialect`, which is what builds the
 * string sent to Postgres. It proves the fragment is well-formed and that every
 * caller value is bound rather than interpolated; it does not prove Postgres
 * accepts it, because this repo has no Postgres in its test environment.
 */
const dialect = new PgDialect()

function render(fragment: unknown): { sql: string; params: unknown[] } {
  const query = dialect.sqlToQuery(fragment as SQL)
  return { sql: query.sql, params: query.params }
}

/** The `WHERE` predicate and the `ORDER BY` list of the page read. */
async function readPageSql(sortBy: ChunkSortBy, sortOrder: 'asc' | 'desc', cursorKeys?: unknown[]) {
  await queryChunks(
    'document-1',
    { sortBy, sortOrder, limit: 10, cursorKeys: cursorKeys as never },
    'request-1',
    SYSTEM_ACCESS_SCOPE
  )
  return {
    where: render(dbChainMockFns.where.mock.calls[0]?.[0]),
    orderBy: (dbChainMockFns.orderBy.mock.calls[0] ?? []).map(render),
  }
}

const ENABLED_CASE = 'case when "embedding"."enabled" then 1 else 0 end'

describe('chunk list generated SQL', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it.each([
    ['chunkIndex', 'asc', '"embedding"."chunk_index" asc'],
    ['chunkIndex', 'desc', '"embedding"."chunk_index" desc'],
    ['tokenCount', 'asc', '"embedding"."token_count" asc'],
    ['tokenCount', 'desc', '"embedding"."token_count" desc'],
    ['enabled', 'asc', `${ENABLED_CASE} asc`],
    ['enabled', 'desc', `${ENABLED_CASE} desc`],
  ] as const)(
    'orders %s %s on the declared expression, tie-broken by id',
    async (sortBy, sortOrder, leading) => {
      const { orderBy } = await readPageSql(sortBy, sortOrder)

      expect(orderBy.map((entry) => entry.sql)).toEqual([leading, `"embedding"."id" ${sortOrder}`])
    }
  )

  it.each([
    ['chunkIndex', 'asc', '>', '"embedding"."chunk_index"'],
    ['chunkIndex', 'desc', '<', '"embedding"."chunk_index"'],
    ['tokenCount', 'asc', '>', '"embedding"."token_count"'],
    ['tokenCount', 'desc', '<', '"embedding"."token_count"'],
    ['enabled', 'asc', '>', ENABLED_CASE],
    ['enabled', 'desc', '<', ENABLED_CASE],
  ] as const)(
    'resumes %s %s strictly after the cursor on the same expression',
    async (sortBy, sortOrder, comparison, expression) => {
      const { where } = await readPageSql(sortBy, sortOrder, [1, 'chunk-1'])

      expect(where.sql).toContain(`${expression} ${comparison} $`)
      expect(where.sql).toContain(`${expression} = $`)
      expect(where.params).toEqual(['document-1', 1, 1, 'chunk-1'])
    }
  )

  it('binds a search term with its LIKE wildcards escaped', async () => {
    await queryChunks('document-1', { search: '100%_raw\\' }, 'request-1', SYSTEM_ACCESS_SCOPE)

    const where = render(dbChainMockFns.where.mock.calls[0]?.[0])
    expect(where.sql).toContain('"embedding"."content" ilike $')
    expect(where.params).toContain('%100\\%\\_raw\\\\%')
  })

  it('binds the caller access tokens as scalars against the document acl', async () => {
    await queryChunks('document-1', {}, 'request-1', WORKSPACE_ACCESS_SCOPE)

    const where = render(dbChainMockFns.where.mock.calls[0]?.[0])
    expect(where.sql).toContain('"document"."acl" && ARRAY[$2, $3]::text[]')
    expect(where.sql).toContain('required_clause.tokens ?| ARRAY[$4, $5]::text[]')
    expect(where.sql).toContain(
      '"knowledge_connector_member"."subject_token" = ANY(ARRAY[$7, $8]::text[])'
    )
    expect(where.params).toEqual([
      'document-1',
      'pub',
      'ws',
      'pub',
      'ws',
      SOURCE_ACL_MAX_AGE_MS,
      'pub',
      'ws',
      SOURCE_ACL_MAX_AGE_MS,
    ])
  })
})
