/**
 * @vitest-environment node
 */
import type { Principal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { MockWorkflowExecutionNotFoundError, mocks } = vi.hoisted(() => {
  class MockWorkflowExecutionNotFoundError extends Error {}
  return {
    MockWorkflowExecutionNotFoundError,
    mocks: {
      audit: vi.fn(),
      cancel: vi.fn(),
      capture: vi.fn(),
      resolvePermission: vi.fn(),
      resolveRunContext: vi.fn(),
      resume: vi.fn(),
    },
  }
})

vi.mock('@sim/audit', () => ({ recordAudit: mocks.audit }))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.capture }))

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
  resolveActiveWorkflowRunApplicationContext: mocks.resolveRunContext,
}))

vi.mock('@/lib/execution/cancel-workflow-execution', () => ({
  cancelWorkflowExecution: mocks.cancel,
  WorkflowExecutionNotFoundError: MockWorkflowExecutionNotFoundError,
}))

vi.mock('@/lib/workflows/executor/resume-execution', () => ({
  executeResumeWorkflow: mocks.resume,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { cancelWorkflowRun } from '@/lib/workflows/application/cancel-run'
import { resumeWorkflowRun } from '@/lib/workflows/application/resume-run'

const runContext = {
  workflowId: 'workflow-1',
  workflow: { id: 'workflow-1', workspaceId: 'workspace-1' },
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
  runId: 'parent-run-1',
}

const principals: Array<{ principal: Principal; actorUserId: string }> = [
  {
    principal: { kind: 'session', userId: 'session-user', sessionId: 'session-1' },
    actorUserId: 'session-user',
  },
  {
    principal: { kind: 'personal_api_key', userId: 'key-user', keyId: 'personal-key' },
    actorUserId: 'key-user',
  },
  {
    principal: {
      kind: 'workspace_api_key',
      workspaceId: 'workspace-1',
      keyId: 'workspace-key',
    },
    actorUserId: 'billing-owner-1',
  },
  {
    principal: {
      kind: 'delegated',
      serviceId: 'copilot',
      subjectUserId: 'delegated-user',
      workspaceId: 'workspace-1',
      delegationId: 'delegation-1',
      audience: 'sim:workflows',
      issuedAt: new Date('2026-01-01T00:00:00Z'),
      expiresAt: new Date('2999-01-01T00:00:00Z'),
    },
    actorUserId: 'delegated-user',
  },
]

describe('workflow run-control application use cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.resolveRunContext.mockResolvedValue(runContext)
    mocks.cancel.mockResolvedValue({
      success: true,
      executionId: 'parent-run-1',
      redisAvailable: true,
      durablyRecorded: true,
      locallyAborted: false,
      pausedCancelled: false,
      reason: 'recorded',
    })
    mocks.resume.mockResolvedValue({
      kind: 'queued',
      executionId: 'resumed-run-2',
      queuePosition: 1,
    })
  })

  it.each(principals)(
    'authorizes $principal.kind cancellation in canonical run scope',
    async ({ principal, actorUserId }) => {
      await cancelWorkflowRun.execute({
        principal,
        input: { runId: 'parent-run-1' },
      })

      expect(mocks.resolveRunContext).toHaveBeenCalledWith({
        runId: 'parent-run-1',
      })
      expect(mocks.cancel).toHaveBeenCalledWith({
        executionId: 'parent-run-1',
        workflowId: 'workflow-1',
        attributedUserId: actorUserId,
        workspaceId: 'workspace-1',
        abortSignal: undefined,
      })
      expect(mocks.capture).toHaveBeenCalledWith(
        actorUserId,
        'workflow_execution_cancelled',
        { workflow_id: 'workflow-1', workspace_id: 'workspace-1' },
        { groups: { workspace: 'workspace-1' } }
      )
      expect(mocks.audit).not.toHaveBeenCalled()
    }
  )

  it('derives cancellation workflow scope from the execution ID when no workflow is asserted', async () => {
    const result = await cancelWorkflowRun.execute({
      principal: principals[0].principal,
      input: { runId: 'parent-run-1', assertedWorkspaceId: 'workspace-1' },
    })

    expect(mocks.resolveRunContext).toHaveBeenCalledWith({
      runId: 'parent-run-1',
      assertedWorkflowId: undefined,
      assertedWorkspaceId: 'workspace-1',
    })
    expect(mocks.cancel).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 'parent-run-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      })
    )
    expect(result).toMatchObject({ workflowId: 'workflow-1', workspaceId: 'workspace-1' })
  })

  it.each(principals)(
    'authorizes $principal.kind resume and preserves the parent/new run distinction',
    async ({ principal, actorUserId }) => {
      const result = await resumeWorkflowRun.execute({
        principal,
        input: {
          workflowId: 'workflow-1',
          runId: 'parent-run-1',
          contextId: 'context-1',
          resumeInput: { approved: true },
        },
      })

      expect(mocks.resolveRunContext).toHaveBeenCalledWith({
        runId: 'parent-run-1',
        assertedWorkflowId: 'workflow-1',
      })
      expect(mocks.resume).toHaveBeenCalledWith({
        workflowId: 'workflow-1',
        executionId: 'parent-run-1',
        contextId: 'context-1',
        workspaceId: 'workspace-1',
        userId: actorUserId,
        resumeInput: { approved: true },
        isApiCaller: true,
        pollingSurface: 'v2',
        allowStreaming: false,
      })
      expect(result).toMatchObject({ executionId: 'resumed-run-2' })
      expect(mocks.audit).not.toHaveBeenCalled()
    }
  )

  it('stops cancellation and resume before authorization when canonical run resolution fails', async () => {
    mocks.resolveRunContext.mockRejectedValue(new OrchestrationError('not_found', 'Run not found'))
    const principal = principals[0].principal

    await expect(
      cancelWorkflowRun.execute({
        principal,
        input: { runId: 'parent-run-1' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      resumeWorkflowRun.execute({
        principal,
        input: {
          workflowId: 'wrong-workflow',
          runId: 'parent-run-1',
          contextId: 'context-1',
          resumeInput: {},
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.cancel).not.toHaveBeenCalled()
    expect(mocks.resume).not.toHaveBeenCalled()
  })

  it('requires current write permission for session cancellation and resume', async () => {
    mocks.resolvePermission.mockResolvedValue('read')
    const principal = principals[0].principal

    await expect(
      cancelWorkflowRun.execute({
        principal,
        input: { runId: 'parent-run-1' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      resumeWorkflowRun.execute({
        principal,
        input: {
          workflowId: 'workflow-1',
          runId: 'parent-run-1',
          contextId: 'context-1',
          resumeInput: {},
        },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.cancel).not.toHaveBeenCalled()
    expect(mocks.resume).not.toHaveBeenCalled()
  })

  it('maps stale cancellation manager state to semantic absence', async () => {
    mocks.cancel.mockRejectedValueOnce(new MockWorkflowExecutionNotFoundError())

    await expect(
      cancelWorkflowRun.execute({
        principal: principals[0].principal,
        input: { runId: 'parent-run-1' },
      })
    ).rejects.toMatchObject({ code: 'not_found', message: 'Run not found' })
  })

  it('propagates cancellation and resume infrastructure failures', async () => {
    const cancelFailure = new Error('cancellation store unavailable')
    const resumeFailure = new Error('resume manager unavailable')
    mocks.cancel.mockRejectedValueOnce(cancelFailure)

    await expect(
      cancelWorkflowRun.execute({
        principal: principals[2].principal,
        input: { runId: 'parent-run-1' },
      })
    ).rejects.toBe(cancelFailure)

    mocks.resume.mockRejectedValueOnce(resumeFailure)
    await expect(
      resumeWorkflowRun.execute({
        principal: principals[2].principal,
        input: {
          workflowId: 'workflow-1',
          runId: 'parent-run-1',
          contextId: 'context-1',
          resumeInput: {},
        },
      })
    ).rejects.toBe(resumeFailure)
  })
})
