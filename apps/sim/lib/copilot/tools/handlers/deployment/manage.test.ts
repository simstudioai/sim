/**
 * @vitest-environment node
 */

import { auditMock, workflowsOrchestrationMock, workflowsOrchestrationMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from '@/lib/copilot/request/types'

const { ensureWorkflowAccessMock, checkNeedsRedeploymentMock } = vi.hoisted(() => ({
  ensureWorkflowAccessMock: vi.fn(),
  checkNeedsRedeploymentMock: vi.fn(),
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

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  chat: {},
  workflow: {},
  workflowDeploymentVersion: {},
  workflowMcpServer: {},
  workflowMcpTool: {},
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
  resolveWorkflowStateRef: resolveWorkflowStateRefMock,
}))

vi.mock('@/lib/workflows/comparison', () => ({
  generateWorkflowDiffSummary: generateWorkflowDiffSummaryMock,
}))

vi.mock('@/app/api/workflows/utils', () => ({
  checkNeedsRedeployment: checkNeedsRedeploymentMock,
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  listWorkflowVersions: listWorkflowVersionsMock,
  updateDeploymentVersionMetadata: vi.fn(),
}))

import { db } from '@sim/db'
import {
  executeCheckDeploymentStatus,
  executeDiffWorkflows,
  executeGetDeploymentLog,
  executeLoadDeployment,
  executePromoteToLive,
} from './manage'

function selectChain(result: unknown[], resolveOnWhere = false) {
  const chain = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => (resolveOnWhere ? Promise.resolve(result) : chain)),
    orderBy: vi.fn(() => Promise.resolve(result)),
    limit: vi.fn(() => Promise.resolve(result)),
  }
  return chain
}

describe('executeLoadDeployment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureWorkflowAccessMock.mockResolvedValue({
      workflow: { id: 'wf-1', workspaceId: 'ws-1', name: 'Test Workflow' },
    })
  })

  it('loads a version into the draft via performRevertToVersion', async () => {
    performRevertToVersionMock.mockResolvedValue({ success: true, lastSaved: 12345 })

    const result = await executeLoadDeployment({ workflowId: 'wf-1', version: 7 }, {
      userId: 'user-1',
      workflowId: 'wf-1',
    } as ExecutionContext)

    expect(ensureWorkflowAccessMock).toHaveBeenCalledWith('wf-1', 'user-1', 'admin')
    expect(performRevertToVersionMock).toHaveBeenCalledWith({
      workflowId: 'wf-1',
      version: 7,
      userId: 'user-1',
      workflow: { id: 'wf-1', workspaceId: 'ws-1', name: 'Test Workflow' },
    })
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
    performRevertToVersionMock.mockResolvedValue({ success: true, lastSaved: 1 })

    await executeLoadDeployment({ workflowId: 'wf-1', version: 'live' }, {
      userId: 'user-1',
      workflowId: 'wf-1',
    } as ExecutionContext)

    expect(performRevertToVersionMock).toHaveBeenCalledWith(
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
    performRevertToVersionMock.mockResolvedValue({
      success: false,
      error: 'Deployment version not found',
    })

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
    performActivateVersionMock.mockResolvedValue({
      success: true,
      deployedAt: new Date('2026-05-30T00:00:00.000Z'),
      latestDeploymentAttempt: {
        id: 'op-1',
        deploymentVersionId: 'dv-3',
        version: 3,
        action: 'activate',
        status: 'active',
        readiness: { webhooks: 'ready', schedules: 'ready', mcp: 'ready' },
        requestedAt: '2026-05-30T00:00:00.000Z',
        activatedAt: '2026-05-30T00:00:00.000Z',
        error: null,
      },
    })

    const result = await executePromoteToLive({ workflowId: 'wf-1', version: 3 }, {
      userId: 'user-1',
      workflowId: 'wf-1',
    } as ExecutionContext)

    expect(ensureWorkflowAccessMock).toHaveBeenCalledWith('wf-1', 'user-1', 'admin')
    expect(performActivateVersionMock).toHaveBeenCalledWith({
      workflowId: 'wf-1',
      version: 3,
      userId: 'user-1',
    })
    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({
      workflowId: 'wf-1',
      version: 3,
      message: 'Promoted version 3 to live',
      lifecycleStatus: 'active',
      error: null,
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
    listWorkflowVersionsMock.mockResolvedValue({
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

    expect(listWorkflowVersionsMock).toHaveBeenCalledWith('wf-1')
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
    resolveWorkflowStateRefMock
      .mockResolvedValueOnce({ state: { base: true }, ref: '1', version: 1, isActive: false })
      .mockResolvedValueOnce({ state: { target: true }, ref: 'live', version: 2, isActive: true })

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

    expect(resolveWorkflowStateRefMock).toHaveBeenCalledWith('wf-1', 1, 'user-1')
    expect(resolveWorkflowStateRefMock).toHaveBeenCalledWith('wf-1', 'live', 'user-1')
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
    ensureWorkflowAccessMock.mockResolvedValue({
      workflow: { id: 'wf-1', workspaceId: 'ws-1', name: 'Test Workflow' },
    })
    checkNeedsRedeploymentMock.mockResolvedValue(false)
    getWorkflowDeploymentSummaryMock.mockResolvedValue({
      activeDeployment: null,
      latestDeploymentAttempt: null,
      warnings: [],
    })
  })

  it('uses the shared redeployment freshness helper for deployed APIs', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(
        selectChain([{ isDeployed: true, deployedAt: new Date('2026-05-28') }]) as never
      )
      .mockReturnValueOnce(selectChain([]) as never)
      .mockReturnValueOnce(selectChain([], true) as never)
    checkNeedsRedeploymentMock.mockResolvedValueOnce(true)

    const result = await executeCheckDeploymentStatus({ workflowId: 'wf-1' }, {
      userId: 'user-1',
      workflowId: 'wf-1',
    } as ExecutionContext)

    expect(checkNeedsRedeploymentMock).toHaveBeenCalledWith('wf-1')
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
    vi.mocked(db.select)
      .mockReturnValueOnce(selectChain([{ isDeployed: false, deployedAt: null }]) as never)
      .mockReturnValueOnce(selectChain([]) as never)
      .mockReturnValueOnce(selectChain([], true) as never)

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
})
