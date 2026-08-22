/**
 * @vitest-environment node
 */

import {
  auditMock,
  resetDbChainMock,
  workflowsOrchestrationMock,
  workflowsOrchestrationMockFns,
} from '@sim/testing'
import { getErrorMessage } from '@sim/utils/errors'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from '@/lib/copilot/request/types'

const { ensureWorkflowAccessMock, checkNeedsRedeploymentMock, mockExecuteCopilotWorkflowUseCase } =
  vi.hoisted(() => ({
    ensureWorkflowAccessMock: vi.fn(),
    checkNeedsRedeploymentMock: vi.fn(),
    mockExecuteCopilotWorkflowUseCase: vi.fn(),
  }))

vi.mock('@/lib/copilot/application/execute-workflow-use-case', () => ({
  executeCopilotWorkflowUseCase: mockExecuteCopilotWorkflowUseCase,
  messageForCopilotWorkflowError: (error: unknown, fallback: string) =>
    getErrorMessage(error, fallback),
}))

const performRevertToVersionMock = workflowsOrchestrationMockFns.mockPerformRevertToVersion
const performActivateVersionMock = workflowsOrchestrationMockFns.mockPerformActivateVersion
const getWorkflowDeploymentSummaryMock =
  workflowsOrchestrationMockFns.mockGetWorkflowDeploymentSummary

const { resolveWorkflowStateRefMock, generateWorkflowDiffSummaryMock, listWorkflowVersionsMock } =
  vi.hoisted(() => ({
    resolveWorkflowStateRefMock: vi.fn(),
    generateWorkflowDiffSummaryMock: vi.fn(),
    listWorkflowVersionsMock: vi.fn(),
  }))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/mcp/pubsub', () => ({
  mcpPubSub: {
    publishWorkflowToolsChanged: vi.fn(),
  },
}))

vi.mock('@/lib/mcp/workflow-mcp-sync', () => ({
  generateParameterSchemaForWorkflow: vi.fn(),
}))

vi.mock('@/lib/mcp/workflow-tool-schema', () => ({
  sanitizeToolName: vi.fn((value: string) => value),
}))

vi.mock('@/lib/workflows/triggers/trigger-utils.server', () => ({
  hasValidStartBlock: vi.fn(),
}))

vi.mock('../access', () => ({
  ensureWorkflowAccess: ensureWorkflowAccessMock,
  ensureWorkspaceAccess: vi.fn(),
}))

vi.mock('@/lib/workflows/orchestration', () => workflowsOrchestrationMock)

vi.mock('./state-refs', () => ({
  parseWorkflowRef: (value: number | string) => (value === 'live' ? 'active' : value),
  resolveWorkflowStateRef: resolveWorkflowStateRefMock,
}))

vi.mock('@/lib/workflows/comparison', () => ({
  generateWorkflowDiffSummary: generateWorkflowDiffSummaryMock,
}))

vi.mock('@/lib/workflows/deployment-status', () => ({
  checkNeedsRedeployment: checkNeedsRedeploymentMock,
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  listWorkflowVersions: listWorkflowVersionsMock,
  updateDeploymentVersionMetadata: vi.fn(),
}))

import {
  executeCheckDeploymentStatus,
  executeDiffWorkflows,
  executeGetDeploymentLog,
  executeLoadDeployment,
  executePromoteToLive,
} from './manage'

afterAll(() => {
  resetDbChainMock()
})

describe('executeLoadDeployment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureWorkflowAccessMock.mockResolvedValue({
      workflow: { id: 'wf-1', workspaceId: 'ws-1', name: 'Test Workflow' },
    })
  })

  it('loads a version into the draft via performRevertToVersion', async () => {
    mockExecuteCopilotWorkflowUseCase.mockResolvedValue({ lastSaved: 12345 })

    const result = await executeLoadDeployment({ workflowId: 'wf-1', version: 7 }, {
      userId: 'user-1',
      workflowId: 'wf-1',
    } as ExecutionContext)

    expect(mockExecuteCopilotWorkflowUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      expect.objectContaining({
        operation: expect.objectContaining({ id: 'workflows.versions.revert' }),
      }),
      expect.objectContaining({ workflowId: 'wf-1', version: 7 })
    )
    expect(result).toEqual({
      success: true,
      output: {
        workflowId: 'wf-1',
        message: 'Loaded version 7 into the workflow draft',
        lastSaved: 12345,
      },
    })
  })

  it('maps "live" to the active version', async () => {
    mockExecuteCopilotWorkflowUseCase.mockResolvedValue({ lastSaved: 1 })

    await executeLoadDeployment({ workflowId: 'wf-1', version: 'live' }, {
      userId: 'user-1',
      workflowId: 'wf-1',
    } as ExecutionContext)

    expect(mockExecuteCopilotWorkflowUseCase).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({ version: 'active' })
    )
  })

  it('rejects "draft"', async () => {
    const result = await executeLoadDeployment({ workflowId: 'wf-1', version: 'draft' }, {
      userId: 'user-1',
      workflowId: 'wf-1',
    } as ExecutionContext)

    expect(result.success).toBe(false)
    expect(performRevertToVersionMock).not.toHaveBeenCalled()
  })

  it('returns shared helper failures directly', async () => {
    mockExecuteCopilotWorkflowUseCase.mockRejectedValue(new Error('Deployment version not found'))

    const result = await executeLoadDeployment({ workflowId: 'wf-1', version: 7 }, {
      userId: 'user-1',
      workflowId: 'wf-1',
    } as ExecutionContext)

    expect(result).toEqual({ success: false, error: 'Deployment version not found' })
  })
})

describe('executePromoteToLive', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureWorkflowAccessMock.mockResolvedValue({
      workflow: { id: 'wf-1', workspaceId: 'ws-1', name: 'Test Workflow' },
    })
  })

  it('promotes a version via performActivateVersion', async () => {
    mockExecuteCopilotWorkflowUseCase.mockResolvedValue({
      success: true,
      deployedAt: new Date('2026-05-30T00:00:00.000Z'),
      activeDeployment: {
        deploymentVersionId: 'dv-3',
        version: 3,
        deployedAt: '2026-05-30T00:00:00.000Z',
      },
      latestDeploymentAttempt: {
        id: 'op-1',
        deploymentVersionId: 'dv-3',
        version: 3,
        action: 'activate',
        status: 'active',
        isCurrent: true,
        readiness: { webhooks: 'ready', schedules: 'ready', mcp: 'ready' },
        requestedAt: '2026-05-30T00:00:00.000Z',
        activatedAt: '2026-05-30T00:00:00.000Z',
        error: null,
      },
    })

    const result = await executePromoteToLive({ workflowId: 'wf-1', version: 3 }, {
      userId: 'user-1',
      workflowId: 'wf-1',
      executionId: 'execution-1',
      toolCallId: 'call-1',
    } as ExecutionContext)

    expect(mockExecuteCopilotWorkflowUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      expect.objectContaining({
        operation: expect.objectContaining({ id: 'workflows.versions.activate' }),
      }),
      expect.objectContaining({
        workflowId: 'wf-1',
        version: 3,
        idempotencyKey: 'copilot:execution-1:operation:promote_to_live',
      })
    )
    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({
      workflowId: 'wf-1',
      version: 3,
      message: 'Promoted version 3 to live',
      lifecycleStatus: 'active',
      error: null,
    })
  })

  it('does not report a historical active operation as a successful promotion', async () => {
    mockExecuteCopilotWorkflowUseCase.mockResolvedValue({
      success: true,
      activeDeployment: null,
      latestDeploymentAttempt: {
        id: 'op-old',
        deploymentVersionId: 'dv-3',
        version: 3,
        action: 'activate',
        status: 'active',
        isCurrent: false,
        readiness: { webhooks: 'ready', schedules: 'ready', mcp: 'ready' },
        requestedAt: '2026-05-30T00:00:00.000Z',
        activatedAt: '2026-05-30T00:00:00.000Z',
        error: null,
      },
    })

    const result = await executePromoteToLive({ workflowId: 'wf-1', version: 3 }, {
      userId: 'user-1',
      workflowId: 'wf-1',
      executionId: 'execution-1',
      toolCallId: 'call-1',
    } as ExecutionContext)

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('historical'),
    })
  })

  it('rejects a non-numeric version like "live"', async () => {
    const result = await executePromoteToLive({ workflowId: 'wf-1', version: 'live' as never }, {
      userId: 'user-1',
      workflowId: 'wf-1',
    } as ExecutionContext)

    expect(result.success).toBe(false)
    expect(performActivateVersionMock).not.toHaveBeenCalled()
  })
})

describe('executeGetDeploymentLog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureWorkflowAccessMock.mockResolvedValue({
      workflow: { id: 'wf-1', workspaceId: 'ws-1', name: 'Test Workflow' },
    })
  })

  it('returns versions from the shared listWorkflowVersions helper', async () => {
    mockExecuteCopilotWorkflowUseCase.mockResolvedValue({
      versions: [
        {
          id: 'v2',
          version: 2,
          name: null,
          description: null,
          isActive: true,
          createdAt: new Date('2026-05-30T00:00:00.000Z'),
          createdBy: 'user-1',
          deployedByName: 'Waleed',
        },
        {
          id: 'v1',
          version: 1,
          name: 'first',
          description: 'initial',
          isActive: false,
          createdAt: new Date('2026-05-29T00:00:00.000Z'),
          createdBy: null,
          deployedByName: null,
        },
      ],
    })

    const result = await executeGetDeploymentLog({ workflowId: 'wf-1' }, {
      userId: 'user-1',
      workflowId: 'wf-1',
    } as ExecutionContext)

    expect(mockExecuteCopilotWorkflowUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      expect.objectContaining({
        operation: expect.objectContaining({ id: 'workflows.versions.list' }),
      }),
      expect.objectContaining({ workflowId: 'wf-1' })
    )
    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({
      workflowId: 'wf-1',
      count: 2,
      versions: [
        { id: 'v2', version: 2, isActive: true },
        { id: 'v1', version: 1, name: 'first', description: 'initial', isActive: false },
      ],
    })
  })
})

describe('executeDiffWorkflows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('diffs ref2 against ref1 and returns the structured summary', async () => {
    mockExecuteCopilotWorkflowUseCase.mockResolvedValue({
      references: [
        { state: { base: true }, ref: '1', version: 1, isActive: false },
        { state: { target: true }, ref: 'live', version: 2, isActive: true },
      ],
    })

    const summary = {
      addedBlocks: [],
      removedBlocks: [],
      modifiedBlocks: [],
      edgeChanges: { added: 0, removed: 0, addedDetails: [], removedDetails: [] },
      loopChanges: { added: 0, removed: 0, modified: 0 },
      parallelChanges: { added: 0, removed: 0, modified: 0 },
      variableChanges: {
        added: 0,
        removed: 0,
        modified: 0,
        addedNames: [],
        removedNames: [],
        modifiedNames: [],
      },
      hasChanges: false,
    }
    generateWorkflowDiffSummaryMock.mockReturnValue(summary)

    const result = await executeDiffWorkflows({ workflowId: 'wf-1', ref1: 1, ref2: 'live' }, {
      userId: 'user-1',
      workflowId: 'wf-1',
    } as ExecutionContext)

    expect(mockExecuteCopilotWorkflowUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      expect.objectContaining({
        operation: expect.objectContaining({ id: 'workflows.versions.compare_references' }),
      }),
      expect.objectContaining({ workflowId: 'wf-1', references: [1, 'active'] })
    )
    // ref1 = base/previous, ref2 = target/current.
    expect(generateWorkflowDiffSummaryMock).toHaveBeenCalledWith({ target: true }, { base: true })
    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({
      workflowId: 'wf-1',
      ref1: { ref: '1', version: 1 },
      ref2: { ref: 'live', version: 2, isActive: true },
      diff: { hasChanges: false },
    })
  })
})

describe('executeCheckDeploymentStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    ensureWorkflowAccessMock.mockResolvedValue({
      workflow: { id: 'wf-1', workspaceId: 'ws-1', name: 'Test Workflow' },
    })
    checkNeedsRedeploymentMock.mockResolvedValue(false)
    getWorkflowDeploymentSummaryMock.mockResolvedValue({
      activeDeployment: null,
      latestDeploymentAttempt: null,
      warnings: [],
      chatDeployment: null,
      mcpTools: [],
      mcpToolsTruncated: false,
    })
  })

  it('uses the shared redeployment freshness helper for deployed APIs', async () => {
    mockExecuteCopilotWorkflowUseCase.mockResolvedValue({
      workflow: { id: 'wf-1', workspaceId: 'ws-1', deployedAt: new Date('2026-05-28') },
      workspaceId: 'ws-1',
      isDeployed: true,
      needsRedeployment: true,
      activeDeployment: {
        deploymentVersionId: 'dv-1',
        version: 1,
        deployedAt: '2026-05-28T00:00:00.000Z',
      },
      latestDeploymentAttempt: null,
      warnings: [],
      chatDeployment: null,
      mcpTools: [],
      mcpToolsTruncated: false,
    })
    const result = await executeCheckDeploymentStatus({ workflowId: 'wf-1' }, {
      userId: 'user-1',
      workflowId: 'wf-1',
    } as ExecutionContext)

    expect(mockExecuteCopilotWorkflowUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      expect.objectContaining({
        operation: expect.objectContaining({ id: 'workflows.deployment_overview.read' }),
      }),
      expect.objectContaining({ workflowId: 'wf-1' })
    )
    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({
      isDeployed: true,
      api: {
        isDeployed: true,
        needsRedeployment: true,
      },
    })
  })

  it('does not check redeployment freshness for undeployed APIs', async () => {
    mockExecuteCopilotWorkflowUseCase.mockResolvedValue({
      workflow: { id: 'wf-1', workspaceId: 'ws-1', deployedAt: null },
      workspaceId: 'ws-1',
      isDeployed: false,
      needsRedeployment: false,
      activeDeployment: null,
      latestDeploymentAttempt: null,
      warnings: [],
      chatDeployment: null,
      mcpTools: [],
      mcpToolsTruncated: false,
    })

    const result = await executeCheckDeploymentStatus({ workflowId: 'wf-1' }, {
      userId: 'user-1',
      workflowId: 'wf-1',
    } as ExecutionContext)

    expect(checkNeedsRedeploymentMock).not.toHaveBeenCalled()
    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({
      isDeployed: false,
      api: {
        isDeployed: false,
        needsRedeployment: false,
      },
    })
  })

  it('separates a historical active attempt from the current undeployed state', async () => {
    mockExecuteCopilotWorkflowUseCase.mockResolvedValue({
      workflow: { id: 'wf-1', workspaceId: 'ws-1', deployedAt: null },
      workspaceId: 'ws-1',
      isDeployed: false,
      needsRedeployment: false,
      activeDeployment: null,
      latestDeploymentAttempt: {
        id: 'op-historical',
        deploymentVersionId: 'dv-old',
        version: 1,
        action: 'deploy',
        status: 'active',
        isCurrent: false,
        readiness: { webhooks: 'ready', schedules: 'ready', mcp: 'ready' },
        requestedAt: '2026-05-28T00:00:00.000Z',
        activatedAt: '2026-05-28T00:00:00.000Z',
        error: null,
      },
      warnings: ['The latest successful deployment attempt is historical.'],
      chatDeployment: null,
      mcpTools: [],
      mcpToolsTruncated: false,
    })
    const result = await executeCheckDeploymentStatus({ workflowId: 'wf-1' }, {
      userId: 'user-1',
      workflowId: 'wf-1',
    } as ExecutionContext)

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({
      isDeployed: false,
      api: {
        isDeployed: false,
        activeDeployment: null,
        latestDeploymentAttempt: {
          status: 'active',
          isCurrent: false,
        },
        currentDeploymentAttempt: null,
        warnings: [expect.stringContaining('historical')],
      },
    })
  })
})
