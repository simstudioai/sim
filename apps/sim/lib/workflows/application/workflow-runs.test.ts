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
  getRunFiles: vi.fn(),
  describeFiles: vi.fn(),
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

vi.mock('@/lib/workflows/executor/execution-run-files', () => ({
  getWorkflowRunFiles: mocks.getRunFiles,
  describeWorkflowRunFiles: mocks.describeFiles,
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
        selectedOutputs: ['4f1c2b3a-0000-4000-8000-000000000001.value'],
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
      selectedOutputs: ['4f1c2b3a-0000-4000-8000-000000000001.value'],
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      viewerUserId: undefined,
    })
  })

  it('refuses a selector that is not headed by a block id instead of answering an empty selection', async () => {
    mocks.getStatus.mockResolvedValueOnce({
      executionId: 'run-1',
      workflowId: 'workflow-1',
      status: 'completed',
      blockOutputs: {},
    })

    await expect(
      readWorkflowRun.execute({
        principal: principals[2],
        input: {
          workflowId: 'workflow-1',
          runId: 'run-1',
          includeOutput: true,
          selectedOutputs: ['doubler.doubled'],
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })
  })

  /**
   * A well-formed id that produced nothing is a legitimate empty answer — the
   * block may simply not have run on this path.
   */
  it('allows a block id that produced no output on this run', async () => {
    mocks.getStatus.mockResolvedValueOnce({
      executionId: 'run-1',
      workflowId: 'workflow-1',
      status: 'completed',
      blockOutputs: {},
    })

    const result = await readWorkflowRun.execute({
      principal: principals[2],
      input: {
        workflowId: 'workflow-1',
        runId: 'run-1',
        includeOutput: true,
        selectedOutputs: ['4f1c2b3a-0000-4000-8000-000000000001.value'],
      },
    })

    expect(result.blockOutputs).toEqual({})
  })

  /**
   * File descriptors follow `output`'s gating: a caller that did not ask for
   * output must not receive a file list it did not request.
   */
  it('reports files as null when output was not requested', async () => {
    const result = await readWorkflowRun.execute({
      principal: principals[2],
      input: {
        workflowId: 'workflow-1',
        runId: 'run-1',
        includeOutput: false,
        selectedOutputs: [],
      },
    })

    expect(result.files).toBeNull()
    expect(mocks.getRunFiles).not.toHaveBeenCalled()
  })

  it('describes the run files when output was requested', async () => {
    mocks.describeFiles.mockResolvedValueOnce([
      {
        id: 'file_1',
        name: 'report.pdf',
        size: 10,
        type: 'application/pdf',
        downloadPath: '/api/v2/workflows/workflow-1/runs/run-1/files/file_1',
        base64: null,
      },
    ])

    const result = await readWorkflowRun.execute({
      principal: principals[2],
      input: {
        workflowId: 'workflow-1',
        runId: 'run-1',
        includeOutput: true,
        selectedOutputs: [],
      },
    })

    expect(result.files).toHaveLength(1)
    expect(mocks.describeFiles).toHaveBeenCalledWith(
      expect.any(Map),
      expect.objectContaining({ workflowId: 'workflow-1', runId: 'run-1', includeBase64: false })
    )
  })

  it('forwards the inline request and ceiling to the descriptor projection', async () => {
    await readWorkflowRun.execute({
      principal: principals[2],
      input: {
        workflowId: 'workflow-1',
        runId: 'run-1',
        includeOutput: true,
        selectedOutputs: [],
        includeFileBase64: true,
        base64MaxBytes: 4096,
      },
    })

    expect(mocks.describeFiles).toHaveBeenCalledWith(
      expect.any(Map),
      expect.objectContaining({ includeBase64: true, base64MaxBytes: 4096 })
    )
  })

  it('reports an empty file list for a run with no recording', async () => {
    mocks.getRunFiles.mockResolvedValueOnce(null)

    const result = await readWorkflowRun.execute({
      principal: principals[2],
      input: {
        workflowId: 'workflow-1',
        runId: 'run-1',
        includeOutput: true,
        selectedOutputs: [],
      },
    })

    expect(result.files).toEqual([])
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
