import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db/knowledge-projection', () => ({
  SOURCE_ACL_PROJECTIONS: ['embedding_search', 'embedding_keyword_tin'],
}))

import { prewarmSearchProjection } from '@/lib/knowledge/search/prewarm'

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
  it('does nothing where the extension is absent, so the application role never needs it', async () => {
    const fake = session({ installed: false })
    await expect(prewarmSearchProjection(fake)).resolves.toEqual([])
    expect(fake.statements).toHaveLength(1)
    expect(fake.statements[0].query).toContain("extname = 'pg_prewarm'")
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

  it('bounds every read by the budget left and leaves the rest cold once it is spent', async () => {
    vi.useFakeTimers()
    try {
      const fake = session({
        installed: true,
        relations: [
          'embedding_search',
          'embedding_keyword_tin',
          'embedding_search_512_cosine_hnsw_idx',
        ],
      })
      const read = fake.unsafe
      fake.unsafe = async (query: string, parameters?: string[]) => {
        const rows = await read(query, parameters)
        /** Each read takes 400 ms of a 1 s budget. */
        if (query.includes('pg_prewarm(')) vi.advanceTimersByTime(400)
        return rows
      }
      const warmed = await prewarmSearchProjection(fake, { budgetMs: 1000 })
      expect(warmed.map((item) => item.relation)).toEqual([
        'embedding_search',
        'embedding_keyword_tin',
        'embedding_search_512_cosine_hnsw_idx',
      ])
      const timeouts = fake.statements
        .filter((statement) => statement.query.startsWith('SET statement_timeout'))
        .map((statement) => Number(statement.query.split('= ')[1]))
      expect(timeouts).toEqual([1000, 600, 200])
      expect(fake.statements.at(-1)?.query).toBe('RESET statement_timeout')
    } finally {
      vi.useRealTimers()
    }
  })

  it('never sets a timeout on an unbounded pass', async () => {
    const fake = session({ installed: true, relations: ['embedding_search'] })
    await prewarmSearchProjection(fake)
    expect(fake.statements.some((statement) => statement.query.includes('statement_timeout'))).toBe(
      false
    )
  })
})
