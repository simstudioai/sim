/**
 * @vitest-environment node
 */
import type { Principal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    canExposePublicly: vi.fn(),
    resolvePermission: vi.fn(),
    createServer: vi.fn(),
    updateServer: vi.fn(),
    loadWorkspace: vi.fn(),
    audit: vi.fn(),
  },
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { MCP_SERVER_ADDED: 'mcp.added', MCP_SERVER_UPDATED: 'mcp.updated' },
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
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

// The delegation policy revalidates the copilot grant against live state; this
// test is about the public-exposure gate, not that plumbing.
vi.mock('@/lib/mcp/application/authorization', () => ({
  MCP_SERVER_DELEGATION_AUDIENCE: 'sim:mcp-servers',
  mcpServerDelegationPolicy: { audience: 'sim:mcp-servers', isWithinScope: () => true },
}))

vi.mock('@/lib/deployments/public-exposure', () => ({
  canExposePublicly: mocks.canExposePublicly,
}))

vi.mock('@/lib/mcp/orchestration', () => ({
  performCreateWorkflowMcpServer: mocks.createServer,
  performCreateWorkflowMcpTool: vi.fn(),
  performDeleteWorkflowMcpServer: vi.fn(),
  performDeleteWorkflowMcpTool: vi.fn(),
  performUpdateWorkflowMcpServer: mocks.updateServer,
  performUpdateWorkflowMcpTool: vi.fn(),
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.loadWorkspace,
}))

vi.mock('@/lib/mcp/pubsub', () => ({ mcpPubSub: undefined }))

import { createWorkflowMcpDeploymentServer } from '@/lib/mcp/application/workflow-deployments'

// This operation only accepts delegated copilot principals.
const WRITE_PRINCIPAL: Principal = {
  kind: 'delegated',
  serviceId: 'copilot',
  subjectUserId: 'editor-1',
  workspaceId: 'workspace-1',
  delegationId: 'copilot-1',
  audience: 'sim:mcp-servers',
  issuedAt: new Date('2026-08-08T00:00:00Z'),
  expiresAt: new Date('2999-08-08T00:00:00Z'),
}

/**
 * A public workflow MCP server skips authentication on the serve path, so
 * anyone with the URL can invoke every workflow published on it. Creating the
 * server is `write`; making it public is admin-only.
 */
describe('workflow MCP server public exposure is admin-only', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.loadWorkspace.mockResolvedValue({
      workspaceId: 'workspace-1',
      billedAccountUserId: 'billing-1',
    })
    mocks.createServer.mockResolvedValue({
      success: true,
      server: { id: 'srv-1', name: 'srv', isPublic: true },
      addedTools: [],
    })
  })

  it('rejects a write member creating a public server', async () => {
    mocks.canExposePublicly.mockResolvedValue(false)

    await expect(
      createWorkflowMcpDeploymentServer.execute({
        principal: WRITE_PRINCIPAL,
        input: { workspaceId: 'workspace-1', name: 'srv', isPublic: true },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.createServer).not.toHaveBeenCalled()
  })

  it('allows a write member creating a private server', async () => {
    mocks.canExposePublicly.mockResolvedValue(false)

    await createWorkflowMcpDeploymentServer.execute({
      principal: WRITE_PRINCIPAL,
      input: { workspaceId: 'workspace-1', name: 'srv', isPublic: false },
    })

    expect(mocks.createServer).toHaveBeenCalled()
    expect(mocks.canExposePublicly).not.toHaveBeenCalled()
  })

  it('allows an admin creating a public server', async () => {
    mocks.canExposePublicly.mockResolvedValue(true)

    await createWorkflowMcpDeploymentServer.execute({
      principal: WRITE_PRINCIPAL,
      input: { workspaceId: 'workspace-1', name: 'srv', isPublic: true },
    })

    expect(mocks.createServer).toHaveBeenCalledWith(expect.objectContaining({ isPublic: true }))
  })
})
