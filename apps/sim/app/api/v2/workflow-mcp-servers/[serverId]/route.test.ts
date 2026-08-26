/**
 * @vitest-environment node
 */
import {
  MockV2ApiKeyUnauthenticatedError,
  resetDbChainMock,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolvePermission: vi.fn(),
  loadWorkspaceContext: vi.fn(),
  getServer: vi.fn(),
  updateServer: vi.fn(),
  deleteServer: vi.fn(),
  audit: vi.fn(),
  publishToolsChanged: vi.fn(),
}))

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
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.loadWorkspaceContext,
}))
vi.mock('@/lib/mcp/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp/queries')>()),
  getWorkflowMcpServerById: mocks.getServer,
}))
vi.mock('@/lib/mcp/orchestration', () => ({
  performCreateWorkflowMcpServer: vi.fn(),
  performUpdateWorkflowMcpServer: mocks.updateServer,
  performDeleteWorkflowMcpServer: mocks.deleteServer,
  performCreateWorkflowMcpTool: vi.fn(),
  performUpdateWorkflowMcpTool: vi.fn(),
  performDeleteWorkflowMcpTool: vi.fn(),
}))
vi.mock('@/lib/mcp/pubsub', () => ({
  mcpPubSub: { publishWorkflowToolsChanged: mocks.publishToolsChanged },
}))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { DELETE, GET, PATCH } from '@/app/api/v2/workflow-mcp-servers/[serverId]/route'

const WORKSPACE_ID = 'workspace-1'
const SERVER_ID = 'wfmcp-1'

const personalKeyAuth = {
  principal: { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'personal-key-1' },
  rateLimitSubjectIds: ['api-key:personal-key-1', 'user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}

const workspaceContext = {
  workspaceId: WORKSPACE_ID,
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const serverRow = {
  id: SERVER_ID,
  workspaceId: WORKSPACE_ID,
  createdBy: 'user-1',
  name: 'Support agents',
  description: 'Ticket triage',
  isPublic: false,
  deletedAt: null,
  createdAt: new Date('2026-06-12T10:30:00.000Z'),
  updatedAt: new Date('2026-06-12T10:35:00.000Z'),
}

/** The canonical server lookup the use case performs before authorizing. */
function queueServerLookup(row: unknown = serverRow) {
  mocks.getServer.mockResolvedValue(row)
}

async function patch(body: unknown) {
  const request = new NextRequest(`http://localhost/api/v2/workflow-mcp-servers/${SERVER_ID}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return PATCH(request, { params: Promise.resolve({ serverId: SERVER_ID }) })
}

async function get() {
  const request = new NextRequest(`http://localhost/api/v2/workflow-mcp-servers/${SERVER_ID}`)
  return GET(request, { params: Promise.resolve({ serverId: SERVER_ID }) })
}

async function del() {
  const request = new NextRequest(`http://localhost/api/v2/workflow-mcp-servers/${SERVER_ID}`, {
    method: 'DELETE',
  })
  return DELETE(request, { params: Promise.resolve({ serverId: SERVER_ID }) })
}

describe('/api/v2/workflow-mcp-servers/[serverId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    v2RouteMocks.authenticate.mockResolvedValue(personalKeyAuth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.loadWorkspaceContext.mockResolvedValue(workspaceContext)
    mocks.updateServer.mockResolvedValue({
      success: true,
      server: { ...serverRow, isPublic: true },
      updatedFields: ['isPublic'],
    })
    mocks.deleteServer.mockResolvedValue({ success: true, server: serverRow })
  })

  describe('PATCH', () => {
    it('updates the server and records one semantic audit entry', async () => {
      queueServerLookup()

      const response = await patch({ isPublic: true })

      expect(response.status).toBe(200)
      expect((await response.json()).data).toMatchObject({ id: SERVER_ID, isPublic: true })
      expect(mocks.updateServer).toHaveBeenCalledWith(
        expect.objectContaining({ serverId: SERVER_ID, isPublic: true })
      )
      expect(mocks.audit).toHaveBeenCalledTimes(1)
    })

    it('rejects a body that would change nothing', async () => {
      const response = await patch({})

      expect(response.status).toBe(400)
      expect(JSON.stringify(await response.json())).toContain(
        'At least one of name, description, or isPublic must be provided'
      )
      expect(mocks.updateServer).not.toHaveBeenCalled()
    })

    it('conceals a server from another workspace as 404', async () => {
      queueServerLookup(null)

      const response = await patch({ isPublic: true })

      expect(response.status).toBe(404)
      expect((await response.json()).error.message).toBe('MCP server not found')
      expect(mocks.updateServer).not.toHaveBeenCalled()
    })

    it('refuses a caller below workspace write with 403', async () => {
      queueServerLookup()
      mocks.resolvePermission.mockResolvedValue('read')

      const response = await patch({ isPublic: true })

      expect(response.status).toBe(403)
      expect((await response.json()).error.details.code).toBe('INSUFFICIENT_WORKSPACE_ROLE')
      expect(mocks.updateServer).not.toHaveBeenCalled()
    })
  })

  describe('DELETE', () => {
    it('unpublishes the server and notifies connected clients', async () => {
      queueServerLookup()

      const response = await del()

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ data: { id: SERVER_ID, deleted: true } })
      expect(mocks.publishToolsChanged).toHaveBeenCalledWith({
        serverId: SERVER_ID,
        workspaceId: WORKSPACE_ID,
      })
      expect(mocks.audit).toHaveBeenCalledTimes(1)
    })

    it('refuses a caller below workspace admin with 403', async () => {
      queueServerLookup()
      mocks.resolvePermission.mockResolvedValue('write')

      const response = await del()

      expect(response.status).toBe(403)
      expect(mocks.deleteServer).not.toHaveBeenCalled()
    })

    it('rejects an unauthenticated request', async () => {
      v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

      const response = await del()

      expect(response.status).toBe(401)
      expect((await response.json()).error.code).toBe('UNAUTHORIZED')
    })
  })

  /**
   * Without this read a caller holding a server id had to page the whole
   * collection and filter client-side — the server could be renamed and deleted
   * through this same path, but never simply read.
   */
  describe('GET', () => {
    it('returns the server', async () => {
      queueServerLookup()

      const response = await get()

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        data: expect.objectContaining({ id: SERVER_ID, name: 'Support agents', isPublic: false }),
      })
    })

    it('conceals a server in another workspace as not found', async () => {
      queueServerLookup(null)

      const response = await get()

      expect(response.status).toBe(404)
    })

    it('records no audit entry for a read', async () => {
      queueServerLookup()

      await get()

      expect(mocks.audit).not.toHaveBeenCalled()
    })

    /** The family denies workspace API keys throughout; a read must not be the wide door. */
    it('refuses a workspace API key', async () => {
      queueServerLookup()
      v2RouteMocks.authenticate.mockResolvedValue({
        ...personalKeyAuth,
        principal: { kind: 'workspace_api_key', workspaceId: WORKSPACE_ID, keyId: 'ws-key-1' },
        keyType: 'workspace',
      })

      const response = await get()

      expect(response.status).toBe(403)
    })
  })
})
