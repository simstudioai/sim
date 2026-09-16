/**
 * @vitest-environment node
 */
import { loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnqueue } = vi.hoisted(() => ({ mockEnqueue: vi.fn() }))

vi.mock('@/lib/core/async-jobs', () => ({
  getJobQueue: vi.fn(async () => ({ enqueue: mockEnqueue })),
  shouldExecuteInline: vi.fn(() => false),
}))
vi.mock('@/lib/billing/calculations/usage-reservation', () => ({
  releaseExecutionSlot: vi.fn(),
}))
vi.mock('@/background/workflow-execution', () => ({ executeWorkflowJob: vi.fn() }))

import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { enqueueWorkflowExecution } from '@/lib/workflows/executor/enqueue-execution'

const params = {
  requestId: 'req-1',
  workflowId: 'wf-1',
  principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
  userId: 'user-1',
  billingAttribution: {} as BillingAttributionSnapshot,
  workspaceId: 'workspace-1',
  input: {},
  triggerType: 'api',
  executionId: 'exec-1',
  executionTimeoutMs: 60_000,
} as const

describe('enqueueWorkflowExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnqueue.mockResolvedValue('job-1')
  })

  it('carries the queuing request attribution on the job payload', async () => {
    vi.mocked(loggerMock.getRequestContext).mockReturnValue({
      requestId: 'req-1',
      client: { surface: 'cli', version: '2.1.2', source: 'header' },
      auth: { kind: 'personal_api_key' },
    })

    await enqueueWorkflowExecution(params)

    expect(mockEnqueue).toHaveBeenCalledWith(
      'workflow-execution',
      expect.objectContaining({
        attribution: {
          client: { surface: 'cli', version: '2.1.2', source: 'header' },
          auth: { kind: 'personal_api_key' },
        },
      }),
      expect.anything()
    )
  })
})
