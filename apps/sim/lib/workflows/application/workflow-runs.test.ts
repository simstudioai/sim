import type { Principal } from '@sim/auth/principal'
import {
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import {
  workflowContextMock,
  workflowContextMockFns,
} from '@sim/testing/mocks/workflow-context.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  list: vi.fn(),
  getRunFiles: vi.fn(),
  describeFiles: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/workflows/application/context', () => workflowContextMock)

vi.mock('@/lib/workflows/executor/execution-queries', () => ({
  listWorkflowExecutions: mocks.list,
}))

vi.mock('@/lib/workflows/executor/execution-status', () => ({
  getProjectedWorkflowExecutionStatus: mocks.getStatus,
}))

vi.mock('@/lib/workflows/executor/execution-run-files', () => ({
  getWorkflowRunFiles: mocks.getRunFiles,
  describeWorkflowRunFiles: mocks.describeFiles,
}))

import { FunctionalOutputsUnavailableError } from '@/lib/logs/execution/functional-outputs'
import { listWorkflowRuns } from '@/lib/workflows/application/list-workflow-runs'
import { readWorkflowRun } from '@/lib/workflows/application/read-workflow-run'

const mockResolvePermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission
const mockResolveWorkflowContext =
  workflowContextMockFns.mockResolveActiveWorkflowApplicationContext
const mockResolveRunContext = workflowContextMockFns.mockResolveActiveWorkflowRunApplicationContext

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
  createSessionPrincipal(),
  createPersonalApiKeyPrincipal({ keyId: 'key-personal' }),
  createWorkspaceApiKeyPrincipal({ keyId: 'key-workspace' }),
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
    mockResolvePermission.mockResolvedValue('read')
    mockResolveWorkflowContext.mockResolvedValue(workflowContext)
    mockResolveRunContext.mockResolvedValue(runContext)
    mocks.list.mockResolvedValue({ data: [], nextCursor: null })
    mocks.getStatus.mockResolvedValue({
      status: { executionId: 'run-1', workflowId: 'workflow-1', status: 'completed' },
      projection: { hideTraceSpans: false, hideCostInfo: false },
    })
    mocks.getRunFiles.mockResolvedValue({
      terminal: true,
      workspaceId: 'workspace-1',
      filesById: new Map(),
    })
    mocks.describeFiles.mockResolvedValue([])
  })

  it.each(principals)(
    'allows $kind to list runs through the canonical workflow',
    async (principal) => {
      await listWorkflowRuns.execute({
        principal,
        input: { workflowId: 'workflow-1', limit: 25, order: 'desc' },
      })

      expect(mockResolveWorkflowContext).toHaveBeenCalledWith({
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
        selectedOutputs: ['4f1c2b3a-0000-4000-8000-000000000001.value'],
      },
    })

    expect(mockResolveRunContext).toHaveBeenCalledWith({
      runId: 'run-1',
      assertedWorkflowId: 'workflow-1',
    })
    expect(mocks.getStatus).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      executionId: 'run-1',
      includeOutput: true,
      selectedOutputs: ['4f1c2b3a-0000-4000-8000-000000000001.value'],
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      viewerUserId: null,
    })
  })

  it('propagates an over-ceiling inline request as payload_too_large', async () => {
    mocks.describeFiles.mockRejectedValueOnce(
      Object.assign(new Error('exceeds the 16MB inline limit'), { code: 'payload_too_large' })
    )

    await expect(
      readWorkflowRun.execute({
        principal: principals[2],
        input: {
          workflowId: 'workflow-1',
          runId: 'run-1',
          includeOutput: true,
          selectedOutputs: [],
          includeFileBase64: true,
        },
      })
    ).rejects.toMatchObject({ code: 'payload_too_large' })
  })

  it('stops before authorization and data access when canonical run scope disagrees', async () => {
    mockResolveRunContext.mockRejectedValueOnce(
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
    expect(mockResolvePermission).not.toHaveBeenCalled()
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
})
