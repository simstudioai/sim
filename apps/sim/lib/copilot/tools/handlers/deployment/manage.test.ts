/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from '@/lib/copilot/request/types'

const { ensureWorkflowAccessMock, performRevertToVersionMock } = vi.hoisted(() => ({
  ensureWorkflowAccessMock: vi.fn(),
  performRevertToVersionMock: vi.fn(),
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

vi.mock('@/lib/audit/log', () => ({
  AuditAction: {},
  AuditResourceType: {},
  recordAudit: vi.fn(),
}))

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

vi.mock('@/lib/workflows/orchestration', () => ({
  performRevertToVersion: performRevertToVersionMock,
}))

import { executeRevertToVersion } from './manage'

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
