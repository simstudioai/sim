import {
  executorPrincipalMock,
  executorPrincipalMockFns,
} from '@sim/testing/mocks/executor-principal.mock'
import { describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from '@/executor/types'

vi.mock('@/lib/internal/principals/executor', () => executorPrincipalMock)
vi.mock('@/lib/internal/logs/operations', () => ({
  executeLogsList: vi.fn(),
  executeLogsGet: vi.fn(),
  executeLogsGetRunDetails: vi.fn(),
  executeLogsGetExecution: vi.fn(),
}))

import { executeLogsTool } from '@/lib/internal/logs/execute-tool'
import { ExecutorDelegationOriginRequiredError } from '@/lib/internal/tool-operations/identity-faults'

const mockCreatePrincipal = executorPrincipalMockFns.mockCreateExecutorPrincipalFromExecutionContext

const CONTEXT = { userId: 'user-1', workflowId: 'workflow-1' } as ExecutionContext

describe('executeLogsTool', () => {
  it('answers a missing execution context as unauthenticated, not as a broken tool', async () => {
    mockCreatePrincipal.mockRejectedValueOnce(new ExecutorDelegationOriginRequiredError())

    const response = await executeLogsTool({
      toolId: 'logs_query',
      input: {},
      headers: new Headers(),
      context: CONTEXT,
      requestId: 'request-1',
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Authentication required' })
  })
})
