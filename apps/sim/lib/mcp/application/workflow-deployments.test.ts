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
  performDeleteWorkflowMcpTool: vi.fn(),
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

import { updateWorkflowMcpDeploymentServer } from '@/lib/mcp/application/workflow-deployments'

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
    mocks.permission.mockResolvedValue('write')
    mocks.updateServer.mockResolvedValue({
      success: true,
      server: { ...server, name: 'Renamed MCP' },
      updatedFields: ['name'],
    })
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
