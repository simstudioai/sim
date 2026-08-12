/**
 * @vitest-environment node
 */
import type { Principal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    /** Mutable so a test can decide whether the server is already public. */
    currentServer: {
      id: 'srv-1',
      name: 'srv',
      workspaceId: 'workspace-1',
      isPublic: false,
    } as Record<string, unknown>,
    getUserEntityPermissions: vi.fn(),
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

/**
 * Mocked one level below `canExposePublicly` so both it and the real
 * `increasesPublicExposure` transition rule run — stubbing the whole module
 * would let the transition logic drift without failing anything here.
 */
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mocks.getUserEntityPermissions,
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

/**
 * `resolveServerContext` reads the server row directly. The chainable stub
 * resolves to `mocks.currentServer`, so a test can decide whether the server
 * being updated is already public.
 */
vi.mock('@sim/db', () => {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'from', 'where', 'limit', 'orderBy']) {
    chain[method] = vi.fn(() => chain)
  }
  ;(chain as { then?: unknown }).then = (resolve: (rows: unknown[]) => unknown) =>
    resolve([mocks.currentServer])
  return {
    db: chain,
    workflow: {},
    workflowMcpServer: { id: {}, deletedAt: {}, workspaceId: {} },
    workflowMcpTool: {},
  }
})

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  asc: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
}))

import {
  createWorkflowMcpDeploymentServer,
  updateWorkflowMcpDeploymentServer,
} from '@/lib/mcp/application/workflow-deployments'

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
    mocks.getUserEntityPermissions.mockResolvedValue('write')

    await expect(
      createWorkflowMcpDeploymentServer.execute({
        principal: WRITE_PRINCIPAL,
        input: { workspaceId: 'workspace-1', name: 'srv', isPublic: true },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.createServer).not.toHaveBeenCalled()
  })

  it('allows a write member creating a private server', async () => {
    mocks.getUserEntityPermissions.mockResolvedValue('write')

    await createWorkflowMcpDeploymentServer.execute({
      principal: WRITE_PRINCIPAL,
      input: { workspaceId: 'workspace-1', name: 'srv', isPublic: false },
    })

    expect(mocks.createServer).toHaveBeenCalled()
    expect(mocks.getUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('allows an admin creating a public server', async () => {
    mocks.getUserEntityPermissions.mockResolvedValue('admin')

    await createWorkflowMcpDeploymentServer.execute({
      principal: WRITE_PRINCIPAL,
      input: { workspaceId: 'workspace-1', name: 'srv', isPublic: true },
    })

    expect(mocks.createServer).toHaveBeenCalledWith(expect.objectContaining({ isPublic: true }))
  })
})

/**
 * The edit form submits every field, so an unchanged `isPublic: true` rides
 * along with a rename. Gating the value instead of the transition would lock a
 * `write` member out of editing any public server at all.
 */
describe('updating a workflow MCP server gates the transition, not the value', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.currentServer.isPublic = false
    mocks.loadWorkspace.mockResolvedValue({
      workspaceId: 'workspace-1',
      billedAccountUserId: 'billing-1',
    })
    mocks.updateServer.mockResolvedValue({
      success: true,
      server: { id: 'srv-1', name: 'renamed', isPublic: false },
      updatedFields: ['name'],
    })
  })

  it('rejects a write member flipping a private server to public', async () => {
    mocks.getUserEntityPermissions.mockResolvedValue('write')

    await expect(
      updateWorkflowMcpDeploymentServer.execute({
        principal: WRITE_PRINCIPAL,
        input: { serverId: 'srv-1', isPublic: true },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.updateServer).not.toHaveBeenCalled()
  })

  it('allows a write member renaming an already-public server', async () => {
    mocks.currentServer.isPublic = true
    mocks.getUserEntityPermissions.mockResolvedValue('write')

    await updateWorkflowMcpDeploymentServer.execute({
      principal: WRITE_PRINCIPAL,
      input: { serverId: 'srv-1', name: 'renamed', isPublic: true },
    })

    expect(mocks.updateServer).toHaveBeenCalledWith(expect.objectContaining({ name: 'renamed' }))
  })

  it('allows a write member making a public server private', async () => {
    mocks.currentServer.isPublic = true
    mocks.getUserEntityPermissions.mockResolvedValue('write')

    await updateWorkflowMcpDeploymentServer.execute({
      principal: WRITE_PRINCIPAL,
      input: { serverId: 'srv-1', isPublic: false },
    })

    expect(mocks.updateServer).toHaveBeenCalled()
    expect(mocks.getUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('allows an admin flipping a private server to public', async () => {
    mocks.getUserEntityPermissions.mockResolvedValue('admin')

    await updateWorkflowMcpDeploymentServer.execute({
      principal: WRITE_PRINCIPAL,
      input: { serverId: 'srv-1', isPublic: true },
    })

    expect(mocks.updateServer).toHaveBeenCalledWith(expect.objectContaining({ isPublic: true }))
  })
})
