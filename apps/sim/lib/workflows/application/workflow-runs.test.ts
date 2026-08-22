/**
 * @vitest-environment node
 */
import type { Principal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  list: vi.fn(),
  resolvePermission: vi.fn(),
  resolveRunContext: vi.fn(),
  resolveWorkflowContext: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowApplicationContext: mocks.resolveWorkflowContext,
  resolveActiveWorkflowRunApplicationContext: mocks.resolveRunContext,
}))

vi.mock('@/lib/workflows/executor/execution-queries', () => ({
  listWorkflowExecutions: mocks.list,
}))

vi.mock('@/lib/workflows/executor/execution-status', () => ({
  getWorkflowExecutionStatus: mocks.getStatus,
}))

import { FunctionalOutputsUnavailableError } from '@/lib/logs/execution/functional-outputs'
import { listWorkflowRuns } from '@/lib/workflows/application/list-workflow-runs'
import { readWorkflowRun } from '@/lib/workflows/application/read-workflow-run'

const workflowContext = {
  workflowId: 'workflow-1',
  workflow: { id: 'workflow-1' },
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const runContext = { ...workflowContext, runId: 'run-1' }

const principals: Principal[] = [
  { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
  { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-personal' },
  { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'key-workspace' },
  {
    kind: 'delegated',
    serviceId: 'copilot',
    subjectUserId: 'user-1',
    workspaceId: 'workspace-1',
    delegationId: 'delegation-1',
    audience: 'sim:workflows',
    issuedAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: new Date('2999-01-01T00:00:00Z'),
  },
]

describe('workflow run application use cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.resolveWorkflowContext.mockResolvedValue(workflowContext)
    mocks.resolveRunContext.mockResolvedValue(runContext)
    mocks.list.mockResolvedValue({ data: [], nextCursor: null })
    mocks.getStatus.mockResolvedValue({
      executionId: 'run-1',
      workflowId: 'workflow-1',
      status: 'completed',
    })
  })

  it.each(principals)(
    'allows $kind to list runs through the canonical workflow',
    async (principal) => {
      await listWorkflowRuns.execute({
        principal,
        input: { workflowId: 'workflow-1', limit: 25, order: 'desc' },
      })

      expect(mocks.resolveWorkflowContext).toHaveBeenCalledWith({
        workflowId: 'workflow-1',
      })
      expect(mocks.list).toHaveBeenCalledWith(
        expect.objectContaining({ workflowId: 'workflow-1', limit: 25, order: 'desc' })
      )
    }
  )

  it('resolves a run canonically before reading its status', async () => {
    await readWorkflowRun.execute({
      principal: principals[2],
      input: {
        workflowId: 'workflow-1',
        runId: 'run-1',
        includeOutput: true,
        selectedOutputs: ['block-1.value'],
      },
    })

    expect(mocks.resolveRunContext).toHaveBeenCalledWith({
      runId: 'run-1',
      assertedWorkflowId: 'workflow-1',
    })
    expect(mocks.getStatus).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      executionId: 'run-1',
      includeOutput: true,
      selectedOutputs: ['block-1.value'],
    })
  })

  it('stops before authorization and data access when canonical run scope disagrees', async () => {
    mocks.resolveRunContext.mockRejectedValueOnce(
      Object.assign(new Error('Run not found'), { code: 'not_found' })
    )

    await expect(
      readWorkflowRun.execute({
        principal: principals[2],
        input: {
          workflowId: 'other-workflow',
          runId: 'run-1',
          includeOutput: false,
          selectedOutputs: [],
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.getStatus).not.toHaveBeenCalled()
  })

  it('maps unavailable functional outputs to a semantic conflict', async () => {
    mocks.getStatus.mockRejectedValueOnce(new FunctionalOutputsUnavailableError())

    await expect(
      readWorkflowRun.execute({
        principal: principals[0],
        input: {
          workflowId: 'workflow-1',
          runId: 'run-1',
          includeOutput: false,
          selectedOutputs: ['block-1'],
        },
      })
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('propagates run repository infrastructure failures', async () => {
    const infrastructureError = new Error('database unavailable')
    mocks.list.mockRejectedValueOnce(infrastructureError)

    await expect(
      listWorkflowRuns.execute({
        principal: principals[0],
        input: { workflowId: 'workflow-1', limit: 25, order: 'desc' },
      })
    ).rejects.toBe(infrastructureError)
  })
})
