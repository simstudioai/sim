/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  delete: vi.fn(),
  execute: vi.fn(),
  introspect: vi.fn(),
  merge: vi.fn(),
  query: vi.fn(),
  update: vi.fn(),
  InputError: class Neo4jOperationInputError extends Error {},
}))

vi.mock('@/lib/internal/neo4j/operations', () => ({
  executeNeo4jCreate: mocks.create,
  executeNeo4jDelete: mocks.delete,
  executeNeo4jStatement: mocks.execute,
  executeNeo4jIntrospection: mocks.introspect,
  executeNeo4jMerge: mocks.merge,
  executeNeo4jQuery: mocks.query,
  executeNeo4jUpdate: mocks.update,
  Neo4jOperationInputError: mocks.InputError,
}))

import { executeNeo4jTool } from '@/lib/internal/neo4j/execute-tool'

const BASE_BODY = {
  host: 'neo4j.example.com',
  port: 7687,
  database: 'neo4j',
  username: 'neo4j',
  password: 'password',
  encryption: 'enabled',
  cypherQuery: 'MATCH (n) RETURN n',
  parameters: {},
}

function request(toolId: string, signal?: AbortSignal) {
  return {
    toolId,
    input: toolId === 'neo4j_introspect' ? { ...BASE_BODY, cypherQuery: undefined } : BASE_BODY,
    headers: new Headers(),
    context: createExecutionContext(),
    requestId: 'request-1',
    signal,
  }
}

describe('executeNeo4jTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const operation of [
      mocks.create,
      mocks.delete,
      mocks.execute,
      mocks.introspect,
      mocks.merge,
      mocks.query,
      mocks.update,
    ]) {
      operation.mockResolvedValue({ message: 'ok' })
    }
  })

  it.each([
    ['neo4j_query', mocks.query],
    ['neo4j_execute', mocks.execute],
    ['neo4j_create', mocks.create],
    ['neo4j_update', mocks.update],
    ['neo4j_merge', mocks.merge],
    ['neo4j_delete', mocks.delete],
    ['neo4j_introspect', mocks.introspect],
  ])('dispatches %s directly', async (toolId, operation) => {
    const response = await executeNeo4jTool(request(toolId))

    expect(response.status).toBe(200)
    expect(operation).toHaveBeenCalledOnce()
    await expect(response.json()).resolves.toEqual({ message: 'ok' })
  })

  it('preserves query-validation errors as 400 responses', async () => {
    mocks.query.mockRejectedValueOnce(new mocks.InputError('Query cannot be empty'))

    const response = await executeNeo4jTool(request('neo4j_query'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Query validation failed: Query cannot be empty',
    })
  })

  it('propagates cancellation without converting it to a provider error', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(executeNeo4jTool(request('neo4j_query', controller.signal))).rejects.toMatchObject(
      {
        name: 'AbortError',
      }
    )
    expect(mocks.query).not.toHaveBeenCalled()
  })
})
