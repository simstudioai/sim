/**
 * @vitest-environment node
 */
import { dbChainMock, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    audit: vi.fn(),
    loadWorkspace: vi.fn(),
    permission: vi.fn(),
    publish: vi.fn(),
    updateServer: vi.fn(),
    deleteTool: vi.fn(),
  },
}))

vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    MCP_SERVER_ADDED: 'mcp_server.added',
    MCP_SERVER_UPDATED: 'mcp_server.updated',
    MCP_SERVER_REMOVED: 'mcp_server.removed',
  },
  AuditResourceType: { MCP_SERVER: 'mcp_server' },
  recordAudit: mocks.audit,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.permission,
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.loadWorkspace,
}))

vi.mock('@/lib/mcp/orchestration', () => ({
  performCreateWorkflowMcpServer: vi.fn(),
  performCreateWorkflowMcpTool: vi.fn(),
  performDeleteWorkflowMcpServer: vi.fn(),
  performDeleteWorkflowMcpTool: mocks.deleteTool,
  performUpdateWorkflowMcpServer: mocks.updateServer,
  performUpdateWorkflowMcpTool: vi.fn(),
}))

vi.mock('@/lib/mcp/pubsub', () => ({
  mcpPubSub: { publishWorkflowToolsChanged: mocks.publish },
}))

vi.mock('@/lib/mcp/workflow-mcp-sync', () => ({
  getDeployedWorkflowInputFormat: vi.fn(),
}))

vi.mock('@/lib/mcp/workflow-tool-schema', () => ({
  applyDescriptionOverrides: vi.fn(),
  generateToolInputSchema: vi.fn(),
  sanitizeToolName: vi.fn((name: string) => name),
}))

import {
  deployWorkflowMcpTool,
  undeployWorkflowMcpTool,
  updateWorkflowMcpDeploymentServer,
} from '@/lib/mcp/application/workflow-deployments'

const principal = {
  kind: 'delegated' as const,
  serviceId: 'copilot' as const,
  subjectUserId: 'user-1',
  workspaceId: 'workspace-1',
  delegationId: 'tool-call-1',
  audience: 'sim:mcp-servers',
  issuedAt: new Date('2026-01-01T00:00:00Z'),
  expiresAt: new Date('2099-01-01T00:00:00Z'),
}

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
    vi.clearAllMocks()
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
   * `deploy_as_api` is a Copilot tool name. A CLI or HTTP caller reading this
   * error has no such command, so the remediation has to name the action.
   */
  it('states the remediation without naming an agent-only tool', async () => {
    queueTableRows(schemaMock.workflowMcpServer, [server])
    queueTableRows(schemaMock.workflow, [{ id: 'wf-1', name: 'Orders', isDeployed: false }])

    const rejection = await deployWorkflowMcpTool
      .execute({ principal, input: { serverId: server.id, workflowId: 'wf-1' } })
      .catch((error: Error) => error)

    expect(rejection).toBeInstanceOf(Error)
    expect((rejection as Error).message).not.toMatch(/deploy_as_api|_as_api/)
    expect((rejection as Error).message).toContain('Deploy the workflow first')
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

  it('owns mutation attribution and semantic audit', async () => {
    queueTableRows(schemaMock.workflowMcpServer, [server])

    const result = await updateWorkflowMcpDeploymentServer.execute({
      principal,
      input: { serverId: server.id, name: 'Renamed MCP' },
    })

    expect(result.server.name).toBe('Renamed MCP')
    expect(mocks.updateServer).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: server.id,
        workspaceId: server.workspaceId,
        userId: principal.subjectUserId,
        projectLegacyAudit: false,
        publishEffects: false,
      })
    )
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'mcp_server.updated',
        resourceId: server.id,
        metadata: expect.objectContaining({
          operation: 'mcp_servers.workflow_deployments.update_server',
        }),
      })
    )
  })

  it('fails fast with a generic application error for an internal lower-layer result', async () => {
    queueTableRows(schemaMock.workflowMcpServer, [server])
    mocks.updateServer.mockResolvedValueOnce({
      success: false,
      error: 'postgres password=secret',
      errorCode: 'internal',
    })

    await expect(
      updateWorkflowMcpDeploymentServer.execute({
        principal,
        input: { serverId: server.id, name: 'Renamed MCP' },
      })
    ).rejects.toThrow('Failed to update workflow MCP server')

    expect(mocks.audit).not.toHaveBeenCalled()
  })
})
