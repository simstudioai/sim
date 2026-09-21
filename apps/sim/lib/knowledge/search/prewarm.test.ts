/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db/script-migrations/0021_embedding_search_connector', () => ({
  PROJECTION_SOURCE_ACL_TABLES: ['embedding_search', 'embedding_keyword_tin'],
}))

import {
  pgPrewarmInstalled,
  prewarmRelation,
  prewarmSearchProjection,
} from '@/lib/knowledge/search/prewarm'

interface Statement {
  query: string
  parameters?: string[]
}

/** A session that records every statement and answers from the case's catalog. */
function session(state: { installed: boolean; relations?: string[]; failing?: string[] }): {
  statements: Statement[]
  unsafe: (query: string, parameters?: string[]) => Promise<unknown[]>
} {
  const statements: Statement[] = []
  return {
    statements,
    unsafe: async (query: string, parameters?: string[]) => {
      statements.push({ query, parameters })
      if (query.includes('pg_extension')) return state.installed ? [{ '?column?': 1 }] : []
      if (query.includes('pg_class'))
        return (state.relations ?? []).map((relation) => ({ relation }))
      if (query.includes('pg_prewarm(')) {
        const [relation] = parameters ?? []
        if (state.failing?.includes(relation))
          throw new Error(`relation "${relation}" does not exist`)
        return [{ pages: 7 }]
      }
      return []
    },
  }
}

describe('prewarmSearchProjection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does nothing where the extension is absent, so the application role never needs it', async () => {
    const fake = session({ installed: false })
    await expect(prewarmSearchProjection(fake)).resolves.toEqual([])
    expect(fake.statements).toHaveLength(1)
    expect(fake.statements[0].query).toContain("extname = 'pg_prewarm'")
  })

  it('reads the projections and their ranking indexes in the order the catalog lists them', async () => {
    const fake = session({
      installed: true,
      relations: [
        'embedding_search',
        'embedding_keyword_tin',
        'embedding_search_512_cosine_hnsw_idx',
      ],
    })
    const warmed = await prewarmSearchProjection(fake)
    expect(warmed.map((item) => item.relation)).toEqual([
      'embedding_search',
      'embedding_keyword_tin',
      'embedding_search_512_cosine_hnsw_idx',
    ])
    expect(warmed.every((item) => item.pages === 7)).toBe(true)
    const listed = fake.statements.find((statement) => statement.query.includes('pg_class'))
    expect(listed?.parameters).toEqual([
      '{embedding_search,embedding_keyword_tin}',
      '{hnsw,tin,gin}',
    ])
    expect(listed?.query).toContain("ORDER BY c.relkind = 'r' DESC")
    const reads = fake.statements.filter((statement) => statement.query.includes('pg_prewarm('))
    expect(reads.map((statement) => statement.parameters)).toEqual([
      ['embedding_search'],
      ['embedding_keyword_tin'],
      ['embedding_search_512_cosine_hnsw_idx'],
    ])
    expect(reads.every((statement) => statement.query.includes("'read'"))).toBe(true)
  })

  it('skips a relation that fails to warm and carries on with the rest', async () => {
    const fake = session({
      installed: true,
      relations: ['embedding_search', 'embedding_search_512_cosine_hnsw_idx'],
      failing: ['embedding_search'],
    })
    const warmed = await prewarmSearchProjection(fake)
    expect(warmed.map((item) => item.relation)).toEqual(['embedding_search_512_cosine_hnsw_idx'])
  })

  it('returns nothing when the catalog cannot be read, never failing its caller', async () => {
    const fake = session({ installed: true })
    fake.unsafe = async (query: string) => {
      if (query.includes('pg_extension')) return [{ '?column?': 1 }]
      throw new Error('permission denied for table pg_class')
    }
    await expect(prewarmSearchProjection(fake)).resolves.toEqual([])
  })
})

describe('prewarmRelation', () => {
  it('reports the pages read for one relation', async () => {
    const fake = session({ installed: true })
    await expect(prewarmRelation(fake, 'embedding_search')).resolves.toMatchObject({
      relation: 'embedding_search',
      pages: 7,
    })
    expect(await pgPrewarmInstalled(fake)).toBe(true)
  })
})
