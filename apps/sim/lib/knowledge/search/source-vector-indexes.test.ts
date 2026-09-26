import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import { dropSourceVectorIndex } from '@/lib/knowledge/search/source-vector-indexes'

describe('source vector indexes', () => {
  let statements: string[]

  beforeEach(() => {
    resetDbChainMock()
    statements = []
    dbChainMockFns.execute.mockImplementation(async (query: unknown) => {
      statements.push(typeof query === 'string' ? query : JSON.stringify(query))
      return []
    })
  })

  it('never spells an unexpected identifier into DDL', async () => {
    await dropSourceVectorIndex("x'; DROP TABLE document; --")
    expect(statements.some((text) => text.includes('DROP TABLE'))).toBe(false)
  })
})
