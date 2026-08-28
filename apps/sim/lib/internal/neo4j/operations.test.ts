/**
 * @vitest-environment node
 */
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

function queryResult() {
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
  return {
    records: [{ keys: ['name'], get: vi.fn().mockReturnValue('Ada') }],
    summary: {
      resultAvailableAfter: { toNumber: () => 2 },
      resultConsumedAfter: { toNumber: () => 3 },
      counters: { updates: () => updates },
    },
  }
}

describe('Neo4j operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.run.mockResolvedValue(queryResult())
    mocks.sessionClose.mockResolvedValue(undefined)
    mocks.driverClose.mockResolvedValue(undefined)
    mocks.createDriver.mockResolvedValue({
      session: vi.fn().mockReturnValue({ run: mocks.run, close: mocks.sessionClose }),
      close: mocks.driverClose,
    })
  })

  it('projects records and always closes the session and driver', async () => {
    await expect(executeNeo4jQuery(INPUT)).resolves.toMatchObject({
      message: 'Found 1 records',
      records: [{ name: 'Ada' }],
      recordCount: 1,
    })
    expect(mocks.sessionClose).toHaveBeenCalledOnce()
    expect(mocks.driverClose).toHaveBeenCalledOnce()
  })

  it('closes resources when the query fails', async () => {
    mocks.run.mockRejectedValueOnce(new Error('provider failed'))

    await expect(executeNeo4jQuery(INPUT)).rejects.toThrow('provider failed')
    expect(mocks.sessionClose).toHaveBeenCalledOnce()
    expect(mocks.driverClose).toHaveBeenCalledOnce()
  })

  it('rejects invalid Cypher before opening a driver', async () => {
    await expect(executeNeo4jQuery({ ...INPUT, cypherQuery: '   ' })).rejects.toBeInstanceOf(
      Neo4jOperationInputError
    )
    expect(mocks.createDriver).not.toHaveBeenCalled()
  })
})
