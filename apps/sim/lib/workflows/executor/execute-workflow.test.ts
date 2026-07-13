/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import type { ExecutionSnapshot } from '@/executor/execution/snapshot'

const {
  captureServerEventMock,
  executeWorkflowCoreMock,
  handlePostExecutionPauseStateMock,
  loggingSessionConstructorMock,
  safeStartMock,
} = vi.hoisted(() => ({
  captureServerEventMock: vi.fn(),
  executeWorkflowCoreMock: vi.fn(),
  handlePostExecutionPauseStateMock: vi.fn(),
  loggingSessionConstructorMock: vi.fn(),
  safeStartMock: vi.fn(),
}))

vi.mock('@sim/utils/id', () => ({
  generateId: () => 'execution-1',
}))

vi.mock('@/lib/logs/execution/logging-session', () => ({
  LoggingSession: class {
    safeStart = safeStartMock

    constructor(...args: unknown[]) {
      loggingSessionConstructorMock(...args)
    }
  },
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: captureServerEventMock,
}))

vi.mock('@/lib/workflows/executor/execution-core', () => ({
  executeWorkflowCore: executeWorkflowCoreMock,
}))

vi.mock('@/lib/workflows/executor/pause-persistence', () => ({
  handlePostExecutionPauseState: handlePostExecutionPauseStateMock,
}))

import { executeWorkflow } from '@/lib/workflows/executor/execute-workflow'

const billingAttribution: BillingAttributionSnapshot = {
  actorUserId: 'actor-1',
  workspaceId: 'workspace-1',
  organizationId: 'org-1',
  billedAccountUserId: 'owner-1',
  billingEntity: { type: 'organization', id: 'org-1' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  payerSubscription: {
    id: 'subscription-1',
    referenceId: 'org-1',
    plan: 'team',
    status: 'active',
    seats: 5,
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-08-01T00:00:00.000Z',
  },
}

const workflow = {
  id: 'workflow-1',
  userId: 'owner-1',
  workspaceId: 'workspace-1',
  variables: {},
}

describe('executeWorkflow billing attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    safeStartMock.mockResolvedValue(true)
    handlePostExecutionPauseStateMock.mockResolvedValue(undefined)
    executeWorkflowCoreMock.mockImplementation(
      async (params: {
        snapshot: ExecutionSnapshot
        loggingSession: { safeStart: (startParams: unknown) => Promise<boolean> }
      }) => {
        await params.loggingSession.safeStart({
          userId: params.snapshot.metadata.userId,
          billingAttribution: params.snapshot.metadata.billingAttribution,
          workspaceId: params.snapshot.metadata.workspaceId,
        })
        return {
          success: true,
          output: { ok: true },
          logs: [],
          metadata: { duration: 10 },
          status: 'completed',
        }
      }
    )
  })

  it('rejects workspace execution without immutable billing attribution', async () => {
    await expect(
      executeWorkflow(workflow, 'request-1', undefined, 'actor-1', {
        enabled: true,
      })
    ).rejects.toThrow('Billing attribution is required for workspace execution')

    expect(executeWorkflowCoreMock).not.toHaveBeenCalled()
    expect(safeStartMock).not.toHaveBeenCalled()
  })

  it.each([
    ['actor', { ...billingAttribution, actorUserId: 'other-actor' }],
    ['workspace', { ...billingAttribution, workspaceId: 'other-workspace' }],
  ])('rejects a billing attribution %s mismatch', async (_scope, mismatchedAttribution) => {
    await expect(
      executeWorkflow(workflow, 'request-1', undefined, 'actor-1', {
        enabled: true,
        billingAttribution: mismatchedAttribution,
      })
    ).rejects.toThrow('Workflow billing attribution does not match its actor and workspace')

    expect(executeWorkflowCoreMock).not.toHaveBeenCalled()
    expect(safeStartMock).not.toHaveBeenCalled()
  })

  it('asserts the billing attribution snapshot before execution', async () => {
    const malformedAttribution = {
      ...billingAttribution,
      billingPeriod: undefined,
    } as unknown as BillingAttributionSnapshot

    await expect(
      executeWorkflow(workflow, 'request-1', undefined, 'actor-1', {
        enabled: true,
        billingAttribution: malformedAttribution,
      })
    ).rejects.toThrow('Billing attribution snapshot is missing its billing period')

    expect(executeWorkflowCoreMock).not.toHaveBeenCalled()
  })

  it('propagates validated attribution through execution metadata to logger startup', async () => {
    await executeWorkflow(workflow, 'request-1', { prompt: 'hello' }, 'actor-1', {
      enabled: true,
      workflowTriggerType: 'copilot',
      billingAttribution,
    })

    const coreParams = executeWorkflowCoreMock.mock.calls[0]?.[0] as {
      snapshot: ExecutionSnapshot
    }
    expect(coreParams.snapshot.metadata.billingAttribution).toEqual(billingAttribution)
    expect(Object.isFrozen(coreParams.snapshot.metadata.billingAttribution)).toBe(true)
    expect(safeStartMock).toHaveBeenCalledWith({
      userId: 'actor-1',
      billingAttribution,
      workspaceId: 'workspace-1',
    })
    expect(loggingSessionConstructorMock).toHaveBeenCalledWith(
      'workflow-1',
      'execution-1',
      'copilot',
      'request-1'
    )
  })
})
