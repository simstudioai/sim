/**
 * @vitest-environment node
 */
import { db } from '@sim/db'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  dropSourceVectorIndex,
  ensureSourceVectorIndex,
  indexedVectorSources,
  SOURCE_INDEX_MIN_DOCUMENTS,
} from '@/lib/knowledge/search/source-vector-indexes'

const CONNECTOR = '2bdd2c0c-1988-4a83-97b9-44562dd9e5f9'

describe('source vector indexes', () => {
  let indexed: Array<{ connectorId: string }>
  let statements: string[]

  beforeEach(async () => {
    resetDbChainMock()
    indexed = []
    statements = []
    dbChainMockFns.execute.mockImplementation(async (query: unknown) => {
      const text = typeof query === 'string' ? query : JSON.stringify(query)
      statements.push(text)
      if (text.includes('pg_index')) return indexed
      if (text.includes('sampled')) return [{ column: 'vector_512' }]
      return []
    })
    /** The build reserves one connection; its statements are recorded with the rest. */
    Object.assign(db, {
      $client: {
        reserve: async () => ({
          unsafe: async (text: string) => {
            statements.push(text)
            return []
          },
          release: () => undefined,
        }),
      },
    })
    /** Warms the catalog cache with this case's state, so a build decision is not a stale read. */
    expect((await indexedVectorSources()).size).toBe(indexed.length)
    statements = []
  })

  it('builds an index for a source large enough to be walked', async () => {
    dbChainMockFns.select.mockReturnValue({
      from: () => ({ where: async () => [{ documents: SOURCE_INDEX_MIN_DOCUMENTS }] }),
    } as never)
    expect(await ensureSourceVectorIndex(CONNECTOR)).toBe(true)
    const created = statements.find((text) => text.includes('CREATE INDEX CONCURRENTLY'))
    expect(created).toContain(`connector_id = '${CONNECTOR}'`)
    expect(created).toContain('vector_512 halfvec_cosine_ops')
  })

  it('leaves a source below the threshold to exact ranking', async () => {
    dbChainMockFns.select.mockReturnValue({
      from: () => ({ where: async () => [{ documents: SOURCE_INDEX_MIN_DOCUMENTS - 1 }] }),
    } as never)
    expect(await ensureSourceVectorIndex(CONNECTOR)).toBe(false)
    expect(statements.some((text) => text.includes('CREATE INDEX'))).toBe(false)
  })

  it('never spells an unexpected identifier into DDL', async () => {
    expect(await ensureSourceVectorIndex("x'; DROP TABLE document; --")).toBe(false)
    await dropSourceVectorIndex("x'; DROP TABLE document; --")
    expect(statements.some((text) => text.includes('DROP TABLE'))).toBe(false)
  })
})
