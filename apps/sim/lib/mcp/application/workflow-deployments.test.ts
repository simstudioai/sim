import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { createDelegatedPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { mcpPubsubMock, mcpPubsubMockFns } from '@sim/testing/mocks/mcp-pubsub.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { hoisted } = vi.hoisted(() => ({
  hoisted: {
    updateServer: vi.fn(),
    deleteTool: vi.fn(),
  },
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)

vi.mock('@/lib/mcp/orchestration', () => ({
  performCreateWorkflowMcpServer: vi.fn(),
  performCreateWorkflowMcpTool: vi.fn(),
  performDeleteWorkflowMcpServer: vi.fn(),
  performDeleteWorkflowMcpTool: hoisted.deleteTool,
  performUpdateWorkflowMcpServer: hoisted.updateServer,
  performUpdateWorkflowMcpTool: vi.fn(),
}))

vi.mock('@/lib/mcp/pubsub', () => mcpPubsubMock)

vi.mock('@/lib/mcp/workflow-mcp-sync', () => ({
  getDeployedWorkflowInputFormat: vi.fn(),
}))

vi.mock('@/lib/mcp/workflow-tool-schema', () => ({
  applyDescriptionOverrides: vi.fn(),
  generateToolInputSchema: vi.fn(),
  sanitizeToolName: vi.fn((name: string) => name),
}))

import {
  undeployWorkflowMcpTool,
  updateWorkflowMcpDeploymentServer,
} from '@/lib/mcp/application/workflow-deployments'

const mocks = {
  ...hoisted,
  publish: mcpPubsubMockFns.mockPublishWorkflowToolsChanged,
  audit: auditMockFns.mockRecordAudit,
  loadWorkspace: workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext,
  permission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

const principal = createDelegatedPrincipal({
  delegationId: 'tool-call-1',
  audience: 'sim:mcp-servers',
})

const server = {
  id: 'server-1',
  workspaceId: 'workspace-1',
  name: 'Production MCP',
  description: null,
  isPublic: false,
  deletedAt: null,
}

describe('workflow MCP deployment application commands', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.loadWorkspace.mockImplementation(async (workspaceId: string) => ({
      workspaceId,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    }))
    mocks.permission.mockResolvedValue('admin')
    mocks.updateServer.mockResolvedValue({
      success: true,
      server: { ...server, name: 'Renamed MCP' },
      updatedFields: ['name'],
    })
  })

  /**
   * Undeploying a workflow archives its registrations so a redeploy can restore
   * them — which makes an explicit tool delete the only way to withdraw one for
   * good. Resolving only live rows would block that while the workflow is
   * undeployed, and the archived row would then come back on the next deploy.
   */
  it('withdraws a registration that an undeployed workflow left archived', async () => {
    const archivedTool = {
      id: 'tool-1',
      serverId: server.id,
      workflowId: 'wf-1',
      toolName: 'orders',
      archivedAt: new Date('2026-01-02T00:00:00Z'),
    }
    queueTableRows(schemaMock.workflowMcpServer, [server])
    queueTableRows(schemaMock.workflow, [{ id: 'wf-1', name: 'Orders', isDeployed: false }])
    queueTableRows(schemaMock.workflowMcpTool, [])
    queueTableRows(schemaMock.workflowMcpTool, [archivedTool])
    mocks.deleteTool.mockResolvedValue({ success: true, tool: archivedTool })

    const result = await undeployWorkflowMcpTool.execute({
      principal,
      input: { serverId: server.id, workflowId: 'wf-1' },
    })

    expect(result.tool.id).toBe('tool-1')
    expect(mocks.deleteTool).toHaveBeenCalledWith(expect.objectContaining({ toolId: 'tool-1' }))
  })

  it('derives workspace authorization canonically from the server id', async () => {
    queueTableRows(schemaMock.workflowMcpServer, [{ ...server, workspaceId: 'workspace-2' }])

    await expect(
      updateWorkflowMcpDeploymentServer.execute({
        principal,
        input: { serverId: server.id, name: 'Renamed MCP' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.loadWorkspace).toHaveBeenCalledWith('workspace-2')
    expect(mocks.updateServer).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('rechecks the delegated subject permission before mutation', async () => {
    queueTableRows(schemaMock.workflowMcpServer, [server])
    mocks.permission.mockResolvedValueOnce(null)

    await expect(
      updateWorkflowMcpDeploymentServer.execute({
        principal,
        input: { serverId: server.id, name: 'Renamed MCP' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.updateServer).not.toHaveBeenCalled()
  })

  /**
   * The body carries `isPublic`, and a public server answers
   * `/api/mcp/serve/{serverId}` with no Sim credential — so a `write` member
   * could otherwise remove authentication from every workflow it publishes.
   */
  it('refuses a write-role member, because the update can publish the server', async () => {
    queueTableRows(schemaMock.workflowMcpServer, [server])
    mocks.permission.mockResolvedValueOnce('write')

    await expect(
      updateWorkflowMcpDeploymentServer.execute({
        principal,
        input: { serverId: server.id, isPublic: true },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.updateServer).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
})
