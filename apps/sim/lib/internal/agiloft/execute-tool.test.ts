import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operationMocks = vi.hoisted(() => ({
  executeAgiloftAsyncStatus: vi.fn(),
  executeAgiloftAttachFile: vi.fn(),
  executeAgiloftAttachmentInfo: vi.fn(),
  executeAgiloftCreateRecord: vi.fn(),
  executeAgiloftDeleteRecord: vi.fn(),
  executeAgiloftGetChoiceLineId: vi.fn(),
  executeAgiloftListTables: vi.fn(),
  executeAgiloftLockRecord: vi.fn(),
  executeAgiloftNlpSearch: vi.fn(),
  executeAgiloftReadRecord: vi.fn(),
  executeAgiloftRemoveAttachment: vi.fn(),
  executeAgiloftRetrieveAttachment: vi.fn(),
  executeAgiloftRunActionButton: vi.fn(),
  executeAgiloftSavedSearch: vi.fn(),
  executeAgiloftSearchRecords: vi.fn(),
  executeAgiloftSelectRecords: vi.fn(),
  executeAgiloftUpdateRecord: vi.fn(),
  executeAgiloftUpsertRecord: vi.fn(),
}))

vi.mock('@/lib/internal/agiloft/operations', () => operationMocks)

import { executeAgiloftTool as executeAgiloftToolOperation } from '@/lib/internal/agiloft/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const CREDENTIALS = {
  instanceUrl: 'https://example.agiloft.com',
  knowledgeBase: 'demo',
  login: 'user',
  password: 'not-a-real-password',
}

const BASE = {
  ...CREDENTIALS,
  table: 'contracts',
}

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'agiloft_create_record',
    input: { ...BASE, data: '{"name":"Contract"}' },
    headers: new Headers({ 'content-type': 'application/json' }),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      workspaceId: 'workspace-1',
      userId: 'user-current',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

async function executeAgiloftTool(
  request: Parameters<typeof executeAgiloftToolOperation>[0]
): Promise<Response> {
  const result = await executeAgiloftToolOperation(request)
  if (!(result instanceof Response)) throw new Error('Expected a JSON response')
  return result
}

describe('executeAgiloftTool', () => {
  beforeEach(() => {
    for (const operation of Object.values(operationMocks)) {
      operation.mockResolvedValue({ success: true, output: { handled: true } })
    }
  })

  it('uses the trusted delegation origin and forwards cancellation', async () => {
    const controller = new AbortController()
    const input = { ...BASE, data: '{"name":"Contract"}' }

    await executeAgiloftTool(
      createRequest({
        input,
        signal: controller.signal,
        context: {
          ...createExecutionContext({ workflowId: 'workflow-current' }),
          workspaceId: 'workspace-1',
          userId: 'user-current',
          executorDelegationOrigin: {
            subjectUserId: 'user-origin',
            workflowId: 'workflow-origin',
            executionId: 'execution-origin',
          },
        },
      })
    )

    expect(operationMocks.executeAgiloftCreateRecord).toHaveBeenCalledWith(input, {
      requestId: 'request-1',
      userId: 'user-origin',
      signal: controller.signal,
    })
  })
})
