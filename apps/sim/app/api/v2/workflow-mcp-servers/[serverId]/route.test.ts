import {
  resetDbChainMock,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import {
  createPersonalApiKeyPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { createRouteContext } from '@sim/testing/helpers/http'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { mcpPubsubMock, mcpPubsubMockFns } from '@sim/testing/mocks/mcp-pubsub.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getServer: vi.fn(),
  updateServer: vi.fn(),
  deleteServer: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
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
vi.mock('@/lib/mcp/pubsub', () => mcpPubsubMock)
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { DELETE, GET, PATCH } from '@/app/api/v2/workflow-mcp-servers/[serverId]/route'

const { mockPublishWorkflowToolsChanged } = mcpPubsubMockFns

const WORKSPACE_ID = 'workspace-1'
const SERVER_ID = 'wfmcp-1'

const personalKeyAuth = {
  principal: createPersonalApiKeyPrincipal({ keyId: 'personal-key-1' }),
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
  const request = createMockRequest({
    method: 'PATCH',
    url: `http://localhost/api/v2/workflow-mcp-servers/${SERVER_ID}`,
    body,
  })
  return PATCH(request, createRouteContext({ serverId: SERVER_ID }))
}

async function get() {
  const request = createMockRequest({
    url: `http://localhost/api/v2/workflow-mcp-servers/${SERVER_ID}`,
  })
  return GET(request, createRouteContext({ serverId: SERVER_ID }))
}

async function del() {
  const request = createMockRequest({
    method: 'DELETE',
    url: `http://localhost/api/v2/workflow-mcp-servers/${SERVER_ID}`,
  })
  return DELETE(request, createRouteContext({ serverId: SERVER_ID }))
}

describe('/api/v2/workflow-mcp-servers/[serverId]', () => {
  beforeEach(() => {
    resetDbChainMock()
    v2RouteMocks.authenticate.mockResolvedValue(personalKeyAuth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('admin')
    workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext.mockResolvedValue(
      workspaceContext
    )
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
      expect(auditMockFns.mockRecordAudit).toHaveBeenCalledTimes(1)
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
      workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('read')

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
      expect(mockPublishWorkflowToolsChanged).toHaveBeenCalledWith({
        serverId: SERVER_ID,
        workspaceId: WORKSPACE_ID,
      })
      expect(auditMockFns.mockRecordAudit).toHaveBeenCalledTimes(1)
    })

    it('refuses a caller below workspace admin with 403', async () => {
      queueServerLookup()
      workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('write')

      const response = await del()

      expect(response.status).toBe(403)
      expect(mocks.deleteServer).not.toHaveBeenCalled()
    })
  })

  /**
   * Without this read a caller holding a server id had to page the whole
   * collection and filter client-side — the server could be renamed and deleted
   * through this same path, but never simply read.
   */
  describe('GET', () => {
    /** The family denies workspace API keys throughout; a read must not be the wide door. */
    it('refuses a workspace API key', async () => {
      queueServerLookup()
      v2RouteMocks.authenticate.mockResolvedValue({
        ...personalKeyAuth,
        principal: createWorkspaceApiKeyPrincipal({ workspaceId: WORKSPACE_ID, keyId: 'ws-key-1' }),
        keyType: 'workspace',
      })

      const response = await get()

      expect(response.status).toBe(403)
    })
  })
})
