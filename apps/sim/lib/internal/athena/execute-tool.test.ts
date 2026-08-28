/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockOperations = vi.hoisted(() => ({
  executeAthenaBatchGetQueryExecution: vi.fn(),
  executeAthenaCreateNamedQuery: vi.fn(),
  executeAthenaDeleteNamedQuery: vi.fn(),
  executeAthenaGetNamedQuery: vi.fn(),
  executeAthenaGetQueryExecution: vi.fn(),
  executeAthenaGetQueryResults: vi.fn(),
  executeAthenaListDatabases: vi.fn(),
  executeAthenaListNamedQueries: vi.fn(),
  executeAthenaListQueryExecutions: vi.fn(),
  executeAthenaListTableMetadata: vi.fn(),
  executeAthenaStartQuery: vi.fn(),
  executeAthenaStopQuery: vi.fn(),
}))

vi.mock('@/lib/internal/athena/operations', () => mockOperations)

import { executeAthenaTool } from '@/lib/internal/athena/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
}

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'athena_list_named_queries',
    input: CONNECTION,
    headers: new Headers({ 'content-type': 'application/json' }),
    context: {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      metadata: {},
    },
    requestId: 'request-1',
    ...overrides,
  }
}

const NAMED_QUERY = { ...CONNECTION, namedQueryId: 'named-query-id' }
const QUERY_EXECUTION = { ...CONNECTION, queryExecutionId: 'query-execution-id' }

const TOOL_CASES = [
  [
    'athena_batch_get_query_execution',
    { ...CONNECTION, queryExecutionIds: ['query-execution-id'] },
    mockOperations.executeAthenaBatchGetQueryExecution,
  ],
  [
    'athena_create_named_query',
    { ...CONNECTION, name: 'query', database: 'analytics', queryString: 'SELECT 1' },
    mockOperations.executeAthenaCreateNamedQuery,
  ],
  ['athena_delete_named_query', NAMED_QUERY, mockOperations.executeAthenaDeleteNamedQuery],
  ['athena_get_named_query', NAMED_QUERY, mockOperations.executeAthenaGetNamedQuery],
  ['athena_get_query_execution', QUERY_EXECUTION, mockOperations.executeAthenaGetQueryExecution],
  ['athena_get_query_results', QUERY_EXECUTION, mockOperations.executeAthenaGetQueryResults],
  [
    'athena_list_databases',
    { ...CONNECTION, catalogName: 'AwsDataCatalog' },
    mockOperations.executeAthenaListDatabases,
  ],
  ['athena_list_named_queries', CONNECTION, mockOperations.executeAthenaListNamedQueries],
  ['athena_list_query_executions', CONNECTION, mockOperations.executeAthenaListQueryExecutions],
  [
    'athena_list_table_metadata',
    { ...CONNECTION, catalogName: 'AwsDataCatalog', databaseName: 'analytics' },
    mockOperations.executeAthenaListTableMetadata,
  ],
  [
    'athena_start_query',
    { ...CONNECTION, queryString: 'SELECT 1' },
    mockOperations.executeAthenaStartQuery,
  ],
  ['athena_stop_query', QUERY_EXECUTION, mockOperations.executeAthenaStopQuery],
] as const

describe('executeAthenaTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(TOOL_CASES)('validates and dispatches %s', async (toolId, input, operation) => {
    const controller = new AbortController()
    operation.mockResolvedValue({ toolId })

    const response = await executeAthenaTool(
      createRequest({ toolId, input, signal: controller.signal })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ toolId })
    expect(operation).toHaveBeenCalledWith(input, controller.signal)
  })

  it('returns the canonical validation envelope before provider work', async () => {
    const response = await executeAthenaTool(createRequest({ input: { region: '' } }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(mockOperations.executeAthenaListNamedQueries).not.toHaveBeenCalled()
  })

  it('preserves the provider error envelope', async () => {
    mockOperations.executeAthenaListNamedQueries.mockRejectedValue(new Error('Athena rejected'))

    const response = await executeAthenaTool(createRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Athena rejected' })
  })

  it('propagates cancellation without starting provider work', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeAthenaTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockOperations.executeAthenaListNamedQueries).not.toHaveBeenCalled()
  })
})
