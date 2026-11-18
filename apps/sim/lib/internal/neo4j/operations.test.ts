import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createDriver: vi.fn(),
  sessionClose: vi.fn(),
  driverClose: vi.fn(),
  run: vi.fn(),
}))

vi.mock('@/lib/internal/neo4j/client', () => ({
  createNeo4jDriver: mocks.createDriver,
}))

import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { executeNeo4jQuery, Neo4jOperationInputError } from '@/lib/internal/neo4j/operations'

const INPUT = {
  host: 'neo4j.example.com',
  port: 7687,
  database: 'neo4j',
  username: 'neo4j',
  password: 'password',
  encryption: 'enabled' as const,
  cypherQuery: 'MATCH (n) RETURN n',
  parameters: {},
}

/** A driver `Result` streaming `count` records, recording whether the rest was discarded. */
function streamingResult(count: number, value = 'Ada') {
  const updates = {
    nodesCreated: 0,
    nodesDeleted: 0,
    relationshipsCreated: 0,
    relationshipsDeleted: 0,
    propertiesSet: 0,
    labelsAdded: 0,
    labelsRemoved: 0,
    indexesAdded: 0,
    indexesRemoved: 0,
    constraintsAdded: 0,
    constraintsRemoved: 0,
  }
  const summary = {
    resultAvailableAfter: { toNumber: () => 2 },
    resultConsumedAfter: { toNumber: () => 3 },
    counters: { updates: () => updates },
  }
  const state = { pulled: 0, discarded: false }
  const record = { keys: ['name'], get: () => value }
  return {
    state,
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        if (state.pulled >= count) return { done: true, value: summary }
        state.pulled++
        return { done: false, value: record }
      },
      return: async () => {
        state.discarded = true
        return { done: true, value: summary }
      },
    }),
  }
}

describe('Neo4j operations', () => {
  beforeEach(() => {
    mocks.run.mockImplementation(() => streamingResult(1))
    mocks.sessionClose.mockResolvedValue(undefined)
    mocks.driverClose.mockResolvedValue(undefined)
    mocks.createDriver.mockResolvedValue({
      session: vi.fn().mockReturnValue({ run: mocks.run, close: mocks.sessionClose }),
      close: mocks.driverClose,
    })
  })

  it('returns every record of a result that fits the response limit', async () => {
    const result = streamingResult(20_000)
    mocks.run.mockReturnValue(result)

    const response = await executeNeo4jQuery(INPUT)

    expect(response).toMatchObject({ recordCount: 20_000, summary: { resultAvailableAfter: 2 } })
    expect(result.state.discarded).toBe(false)
  })

  it('fails with the response size error and discards the rest once records cannot fit', async () => {
    const result = streamingResult(1_000, 'x'.repeat(64 * 1024))
    mocks.run.mockReturnValue(result)

    const error = await executeNeo4jQuery(INPUT).catch((caught: unknown) => caught)

    expect(isPayloadSizeLimitError(error)).toBe(true)
    expect(error).toMatchObject({ label: 'neo4j_query response body' })
    expect(result.state.discarded).toBe(true)
    expect(result.state.pulled).toBeLessThan(1_000)
    expect(mocks.sessionClose).toHaveBeenCalled()
  })

  it('rejects invalid Cypher before opening a driver', async () => {
    await expect(executeNeo4jQuery({ ...INPUT, cypherQuery: '   ' })).rejects.toBeInstanceOf(
      Neo4jOperationInputError
    )
    expect(mocks.createDriver).not.toHaveBeenCalled()
  })
})
