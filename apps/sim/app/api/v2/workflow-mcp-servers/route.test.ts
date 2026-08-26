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
  listServers: vi.fn(),
  listToolNames: vi.fn(),
  createServer: vi.fn(),
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
  listWorkspaceWorkflowMcpServers: mocks.listServers,
  listWorkflowMcpToolNames: mocks.listToolNames,
}))
vi.mock('@/lib/mcp/orchestration', () => ({
  performCreateWorkflowMcpServer: mocks.createServer,
  performUpdateWorkflowMcpServer: vi.fn(),
  performDeleteWorkflowMcpServer: vi.fn(),
  performCreateWorkflowMcpTool: vi.fn(),
  performUpdateWorkflowMcpTool: vi.fn(),
  performDeleteWorkflowMcpTool: vi.fn(),
}))
vi.mock('@/lib/mcp/pubsub', () => ({
  mcpPubSub: { publishWorkflowToolsChanged: mocks.publishToolsChanged },
}))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { GET, POST } from '@/app/api/v2/workflow-mcp-servers/route'

const WORKSPACE_ID = 'workspace-1'

const personalKeyAuth = {
  principal: { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'personal-key-1' },
  rateLimitSubjectIds: ['api-key:personal-key-1', 'user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}

const workspaceKeyAuth = {
  principal: {
    kind: 'workspace_api_key' as const,
    workspaceId: WORKSPACE_ID,
    keyId: 'workspace-key-1',
  },
  rateLimitSubjectIds: ['api-key:workspace-key-1'] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

const workspaceContext = {
  workspaceId: WORKSPACE_ID,
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

function serverRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wfmcp-1',
    workspaceId: WORKSPACE_ID,
    createdBy: 'user-1',
    name: 'Support agents',
    description: 'Ticket triage',
    isPublic: false,
    deletedAt: null,
    createdAt: new Date('2026-06-12T10:30:00.000Z'),
    updatedAt: new Date('2026-06-12T10:30:00.000Z'),
    ...overrides,
  }
}

async function get(search = `?workspaceId=${WORKSPACE_ID}`) {
  const request = new NextRequest(`http://localhost/api/v2/workflow-mcp-servers${search}`)
  return GET(request, { params: Promise.resolve({}) })
}

async function post(body: unknown) {
  const request = new NextRequest('http://localhost/api/v2/workflow-mcp-servers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request, { params: Promise.resolve({}) })
}

describe('/api/v2/workflow-mcp-servers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    v2RouteMocks.authenticate.mockResolvedValue(personalKeyAuth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.loadWorkspaceContext.mockResolvedValue(workspaceContext)
    mocks.listServers.mockResolvedValue({ data: [serverRow()], nextCursorKeys: null })
    mocks.listToolNames.mockResolvedValue({ namesByServerId: new Map(), truncated: false })
    mocks.createServer.mockResolvedValue({
      success: true,
      server: serverRow(),
      addedTools: [{ workflowId: 'workflow-1', toolName: 'triage_ticket' }],
    })
  })

  describe('GET', () => {
    it('publishes the served endpoint and tool inventory for each server', async () => {
      mocks.listToolNames.mockResolvedValue({
        namesByServerId: new Map([['wfmcp-1', ['triage_ticket']]]),
        truncated: false,
      })

      const response = await get()

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        data: [
          {
            id: 'wfmcp-1',
            name: 'Support agents',
            description: 'Ticket triage',
            isPublic: false,
            mcpServerUrl: expect.stringContaining('/api/mcp/serve/wfmcp-1'),
            toolCount: 1,
            toolNames: ['triage_ticket'],
            createdAt: '2026-06-12T10:30:00.000Z',
            updatedAt: '2026-06-12T10:30:00.000Z',
          },
        ],
        nextCursor: null,
      })
    })

    /**
     * The row carries `createdBy` and `deletedAt`; the response schema strips
     * them rather than the presenter enumerating what to keep, so a column added
     * later cannot leak by omission.
     */
    it('never publishes the stored row verbatim', async () => {
      const body = await (await get()).json()

      expect(body.data[0]).not.toHaveProperty('createdBy')
      expect(body.data[0]).not.toHaveProperty('deletedAt')
      expect(body.data[0]).not.toHaveProperty('workspaceId')
    })

    it('mints a cursor when the page was cut', async () => {
      mocks.listServers.mockResolvedValue({
        data: [serverRow()],
        nextCursorKeys: [{ key: 'createdAt', value: '2026-06-12T10:30:00.000Z' }],
      })

      const body = await (await get()).json()

      expect(body.nextCursor).toEqual(expect.any(String))
    })

    it('rejects a cursor minted under a different ordering', async () => {
      mocks.listServers.mockResolvedValue({
        data: [serverRow()],
        nextCursorKeys: [{ key: 'createdAt', value: '2026-06-12T10:30:00.000Z' }],
      })
      const cursor = (await (await get()).json()).nextCursor

      const response = await get(
        `?workspaceId=${WORKSPACE_ID}&sortBy=name&cursor=${encodeURIComponent(cursor)}`
      )

      expect(response.status).toBe(400)
      expect((await response.json()).error.code).toBe('BAD_REQUEST')
    })

    it('requires a workspace', async () => {
      const response = await get('')

      expect(response.status).toBe(400)
      expect(mocks.loadWorkspaceContext).not.toHaveBeenCalled()
    })

    it('rejects a workspace API key before canonical loading', async () => {
      v2RouteMocks.authenticate.mockResolvedValue(workspaceKeyAuth)

      const response = await get()

      expect(response.status).toBe(403)
      expect(mocks.loadWorkspaceContext).not.toHaveBeenCalled()
      expect(mocks.listServers).not.toHaveBeenCalled()
    })

    it('conceals a workspace the caller cannot reach as 404', async () => {
      mocks.resolvePermission.mockResolvedValue(null)

      const response = await get()

      expect(response.status).toBe(404)
      expect(mocks.listServers).not.toHaveBeenCalled()
    })

    it('rejects an unauthenticated request', async () => {
      v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

      const response = await get()

      expect(response.status).toBe(401)
      expect((await response.json()).error.code).toBe('UNAUTHORIZED')
    })
  })

  describe('POST', () => {
    it('publishes a server and records one semantic audit entry', async () => {
      const response = await post({ workspaceId: WORKSPACE_ID, name: 'Support agents' })

      expect(response.status).toBe(201)
      expect((await response.json()).data).toMatchObject({
        id: 'wfmcp-1',
        name: 'Support agents',
        mcpServerUrl: expect.stringContaining('/api/mcp/serve/wfmcp-1'),
      })
      expect(mocks.createServer).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: WORKSPACE_ID, name: 'Support agents' })
      )
      expect(mocks.audit).toHaveBeenCalledTimes(1)
      expect(mocks.publishToolsChanged).toHaveBeenCalledWith({
        serverId: 'wfmcp-1',
        workspaceId: WORKSPACE_ID,
      })
    })

    /** The create response has no tool inventory to report, so it must not claim one. */
    it('omits the tool inventory the write never read', async () => {
      const body = await (await post({ workspaceId: WORKSPACE_ID, name: 'Support agents' })).json()

      expect(body.data).not.toHaveProperty('toolCount')
      expect(body.data).not.toHaveProperty('toolNames')
    })

    it('rejects an unknown field rather than storing it', async () => {
      const response = await post({
        workspaceId: WORKSPACE_ID,
        name: 'Support agents',
        transport: 'streamable-http',
      })

      expect(response.status).toBe(400)
      expect(mocks.createServer).not.toHaveBeenCalled()
    })

    it('refuses a caller below workspace admin with 403', async () => {
      mocks.resolvePermission.mockResolvedValue('write')

      const response = await post({ workspaceId: WORKSPACE_ID, name: 'Support agents' })

      expect(response.status).toBe(403)
      expect((await response.json()).error.details.code).toBe('INSUFFICIENT_WORKSPACE_ROLE')
      expect(mocks.createServer).not.toHaveBeenCalled()
    })

    it('surfaces an undeployed workflow as a validation error, not a 500', async () => {
      mocks.createServer.mockResolvedValue({
        success: false,
        errorCode: 'validation',
        error: 'Workflow must be deployed before adding as an MCP tool',
      })

      const response = await post({
        workspaceId: WORKSPACE_ID,
        name: 'Support agents',
        workflowIds: ['workflow-1'],
      })

      expect(response.status).toBe(400)
      expect((await response.json()).error.message).toBe(
        'Workflow must be deployed before adding as an MCP tool'
      )
      expect(mocks.audit).not.toHaveBeenCalled()
    })

    it('does not expose an internal orchestration failure message', async () => {
      mocks.createServer.mockResolvedValue({
        success: false,
        errorCode: 'internal',
        error: 'driver connection string',
      })

      const response = await post({ workspaceId: WORKSPACE_ID, name: 'Support agents' })

      expect(response.status).toBe(500)
      expect(JSON.stringify(await response.json())).not.toContain('driver connection string')
    })
  })
})
