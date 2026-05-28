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

vi.mock('@/app/api/workflows/utils', () => ({
  checkNeedsRedeployment: checkNeedsRedeploymentMock,
}))

import { db } from '@sim/db'
import { executeCheckDeploymentStatus, executeRevertToVersion } from './manage'

function selectChain(result: unknown[], resolveOnWhere = false) {
  const chain = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => (resolveOnWhere ? Promise.resolve(result) : chain)),
    limit: vi.fn(() => Promise.resolve(result)),
  }
  return chain
}

describe('executeRevertToVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
    ensureWorkflowAccessMock.mockResolvedValue({
      workflow: { id: 'wf-1', workspaceId: 'ws-1', name: 'Test Workflow' },
    })
  })

  it('uses the shared revert helper instead of the HTTP route', async () => {
    performRevertToVersionMock.mockResolvedValue({
      success: true,
      lastSaved: 12345,
    })

    const result = await executeRevertToVersion({ workflowId: 'wf-1', version: 7 }, {
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
    expect(global.fetch).not.toHaveBeenCalled()
    expect(result).toEqual({
      success: true,
      output: {
        message: 'Reverted workflow to deployment version 7',
        lastSaved: 12345,
      },
    })
  })

  it('returns shared helper failures directly', async () => {
    performRevertToVersionMock.mockResolvedValue({
      success: false,
      error: 'Deployment version not found',
    })

    const result = await executeRevertToVersion({ workflowId: 'wf-1', version: 7 }, {
      userId: 'user-1',
      workflowId: 'wf-1',
    } as ExecutionContext)

    expect(result).toEqual({
      success: false,
      error: 'Deployment version not found',
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
  })

  it('uses the shared redeployment freshness helper for deployed APIs', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(selectChain([{ isDeployed: true, deployedAt: new Date('2026-05-28') }]) as never)
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
