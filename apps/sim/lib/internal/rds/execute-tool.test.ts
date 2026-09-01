/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operationMocks = vi.hoisted(() => {
  class RdsOperationInputError extends Error {}

  return {
    RdsOperationInputError,
    executeRdsDelete: vi.fn(),
    executeRdsInsert: vi.fn(),
    executeRdsIntrospection: vi.fn(),
    executeRdsQuery: vi.fn(),
    executeRdsStatement: vi.fn(),
    executeRdsUpdate: vi.fn(),
  }
})

vi.mock('@/lib/internal/rds/operations', () => operationMocks)

import { executeRdsTool } from '@/lib/internal/rds/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const VALID_BODY = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
  resourceArn: 'arn:aws:rds:us-east-1:123456789012:cluster:database',
  secretArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:database',
  database: 'application',
  query: 'SELECT 1',
} as const

const SUPPORTED_TOOL_IDS = [
  'rds_query',
  'rds_execute',
  'rds_insert',
  'rds_update',
  'rds_delete',
  'rds_introspect',
] as const

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'rds_query',
    input: VALID_BODY,
    headers: new Headers({ 'content-type': 'application/json' }),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      workspaceId: 'workspace-1',
      userId: 'user-1',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

describe('executeRdsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('validates and executes the matching RDS operation with cancellation', async () => {
    const controller = new AbortController()
    operationMocks.executeRdsQuery.mockResolvedValue({
      message: 'Query executed successfully. 1 row(s) returned.',
      rows: [{ value: 1 }],
      rowCount: 1,
    })

    const response = await executeRdsTool(createRequest({ signal: controller.signal }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      message: 'Query executed successfully. 1 row(s) returned.',
      rows: [{ value: 1 }],
      rowCount: 1,
    })
    expect(operationMocks.executeRdsQuery).toHaveBeenCalledWith(VALID_BODY, controller.signal)
  })

  it('returns the route-compatible contract validation envelope before provider work', async () => {
    const response = await executeRdsTool(createRequest({ input: { region: 'us-east-1' } }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(operationMocks.executeRdsQuery).not.toHaveBeenCalled()
  })

  it.each(SUPPORTED_TOOL_IDS)('recognizes the canonical tool ID %s', async (toolId) => {
    const response = await executeRdsTool(createRequest({ toolId, input: {} }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'Invalid request data' })
  })

  it('preserves the provider error envelope', async () => {
    operationMocks.executeRdsQuery.mockRejectedValue(new Error('AWS rejected credentials'))

    const response = await executeRdsTool(createRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'RDS query failed: AWS rejected credentials',
    })
  })

  it('preserves query validation as a 400 error', async () => {
    operationMocks.executeRdsQuery.mockRejectedValue(
      new operationMocks.RdsOperationInputError('Only SELECT statements are allowed')
    )

    const response = await executeRdsTool(createRequest())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Only SELECT statements are allowed' })
  })

  it('propagates cancellation without converting it into a provider failure', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeRdsTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(operationMocks.executeRdsQuery).not.toHaveBeenCalled()
  })
})
