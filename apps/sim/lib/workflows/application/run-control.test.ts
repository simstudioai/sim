import type { Principal } from '@sim/auth/principal'
import {
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { posthogServerMock, posthogServerMockFns } from '@sim/testing/mocks/posthog-server.mock'
import {
  workflowContextMock,
  workflowContextMockFns,
} from '@sim/testing/mocks/workflow-context.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { MockWorkflowExecutionNotFoundError, mocks } = vi.hoisted(() => {
  class MockWorkflowExecutionNotFoundError extends Error {}
  return {
    MockWorkflowExecutionNotFoundError,
    mocks: {
      cancel: vi.fn(),
      resume: vi.fn(),
    },
  }
})

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/workflows/application/context', () => workflowContextMock)

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

const mockCapture = posthogServerMockFns.mockCaptureServerEvent

const mockAudit = auditMockFns.mockRecordAudit
const mockResolvePermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission
const mockResolveRunContext = workflowContextMockFns.mockResolveActiveWorkflowRunApplicationContext

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
    principal: createSessionPrincipal({ userId: 'session-user' }),
    actorUserId: 'session-user',
  },
  {
    principal: createPersonalApiKeyPrincipal({ userId: 'key-user', keyId: 'personal-key' }),
    actorUserId: 'key-user',
  },
  {
    principal: createWorkspaceApiKeyPrincipal({ keyId: 'workspace-key' }),
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
    mockResolvePermission.mockResolvedValue('write')
    mockResolveRunContext.mockResolvedValue(runContext)
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

      expect(mockResolveRunContext).toHaveBeenCalledWith({
        runId: 'parent-run-1',
      })
      expect(mocks.cancel).toHaveBeenCalledWith({
        executionId: 'parent-run-1',
        workflowId: 'workflow-1',
        attributedUserId: actorUserId,
        workspaceId: 'workspace-1',
        abortSignal: undefined,
      })
      expect(mockCapture).toHaveBeenCalledWith(
        actorUserId,
        'workflow_execution_cancelled',
        { workflow_id: 'workflow-1', workspace_id: 'workspace-1' },
        { groups: { workspace: 'workspace-1' } }
      )
      expect(mockAudit).not.toHaveBeenCalled()
    }
  )

  /**
   * A run that was already terminal is satisfied but nothing was cancelled.
   * The use case says so explicitly, so a surface can answer `success: false`
   * for the no-op without re-deriving it from three flags, and the analytics
   * event for a cancellation is not captured for a cancel that did nothing.
   */
  it.each(['already_completed', 'already_failed', 'already_cancelled'] as const)(
    'reports a %s run as satisfied but not cancelled',
    async (reason) => {
      mocks.cancel.mockResolvedValue({
        success: true,
        executionId: 'parent-run-1',
        redisAvailable: true,
        durablyRecorded: false,
        locallyAborted: false,
        pausedCancelled: false,
        reason,
      })

      const result = await cancelWorkflowRun.execute({
        principal: principals[0].principal,
        input: { runId: 'parent-run-1' },
      })

      expect(result).toMatchObject({ success: true, cancelled: false, reason })
      expect(mockCapture).not.toHaveBeenCalled()
    }
  )

  it('treats a queue-only cancellation as having cancelled the run', async () => {
    mocks.cancel.mockResolvedValue({
      success: true,
      executionId: 'parent-run-1',
      redisAvailable: false,
      durablyRecorded: false,
      locallyAborted: false,
      pausedCancelled: false,
      reason: 'queue_cancelled',
    })

    const result = await cancelWorkflowRun.execute({
      principal: principals[0].principal,
      input: { runId: 'parent-run-1' },
    })

    expect(result).toMatchObject({ success: true, cancelled: true, reason: 'queue_cancelled' })
    expect(mockCapture).toHaveBeenCalledTimes(1)
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

      expect(mockResolveRunContext).toHaveBeenCalledWith({
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
      expect(mockAudit).not.toHaveBeenCalled()
    }
  )

  it('stops cancellation and resume before authorization when canonical run resolution fails', async () => {
    mockResolveRunContext.mockRejectedValue(new OrchestrationError('not_found', 'Run not found'))
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

    expect(mockResolvePermission).not.toHaveBeenCalled()
    expect(mocks.cancel).not.toHaveBeenCalled()
    expect(mocks.resume).not.toHaveBeenCalled()
  })

  it('requires current write permission for session cancellation and resume', async () => {
    mockResolvePermission.mockResolvedValue('read')
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
})
