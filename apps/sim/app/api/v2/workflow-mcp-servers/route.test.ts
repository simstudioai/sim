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
  listServers: vi.fn(),
  listToolNames: vi.fn(),
  createServer: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
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
vi.mock('@/lib/mcp/pubsub', () => mcpPubsubMock)
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { GET, POST } from '@/app/api/v2/workflow-mcp-servers/route'

const mockPublishWorkflowToolsChanged = mcpPubsubMockFns.mockPublishWorkflowToolsChanged

const WORKSPACE_ID = 'workspace-1'

const personalKeyAuth = {
  principal: createPersonalApiKeyPrincipal({ keyId: 'personal-key-1' }),
  rateLimitSubjectIds: ['api-key:personal-key-1', 'user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}

const workspaceKeyAuth = {
  principal: createWorkspaceApiKeyPrincipal({
    workspaceId: WORKSPACE_ID,
    keyId: 'workspace-key-1',
  }),
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
  const request = createMockRequest({
    url: `http://localhost/api/v2/workflow-mcp-servers${search}`,
  })
  return GET(request, createRouteContext({}))
}

async function post(body: unknown) {
  const request = createMockRequest({
    method: 'POST',
    url: 'http://localhost/api/v2/workflow-mcp-servers',
    body,
  })
  return POST(request, createRouteContext({}))
}

describe('/api/v2/workflow-mcp-servers', () => {
  beforeEach(() => {
    resetDbChainMock()
    v2RouteMocks.authenticate.mockResolvedValue(personalKeyAuth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('admin')
    workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext.mockResolvedValue(
      workspaceContext
    )
    mocks.listServers.mockResolvedValue({ data: [serverRow()], nextCursorKeys: null })
    mocks.listToolNames.mockResolvedValue({ namesByServerId: new Map(), truncated: false })
    mocks.createServer.mockResolvedValue({
      success: true,
      server: serverRow(),
      addedTools: [{ workflowId: 'workflow-1', toolName: 'triage_ticket' }],
    })
  })

  describe('GET', () => {
    /**
     * `toolNames` and `toolCount` are gathered for the whole page under one
     * ceiling, so a page that trips it under-reports every server's inventory.
     * Publishing only the names left a reconciling caller reading a partial set
     * as the complete one.
     */
    it('says when the tool names it published were cut short', async () => {
      mocks.listToolNames.mockResolvedValue({
        namesByServerId: new Map([['wfmcp-1', ['triage_ticket']]]),
        truncated: true,
      })

      expect((await (await get()).json()).toolNamesTruncated).toBe(true)
    })

    /**
     * A further page is what `nextCursor` says. Folding it into the truncation
     * flag would report an incomplete inventory on every page with a successor,
     * which is most of them.
     */
    it('does not call a paged inventory truncated', async () => {
      mocks.listServers.mockResolvedValue({
        data: [serverRow()],
        nextCursorKeys: [{ key: 'createdAt', value: '2026-06-12T10:30:00.000Z' }],
      })
      mocks.listToolNames.mockResolvedValue({
        namesByServerId: new Map([['wfmcp-1', ['triage_ticket']]]),
        truncated: false,
      })

      const body = await (await get()).json()

      expect(body.nextCursor).not.toBeNull()
      expect(body.toolNamesTruncated).toBe(false)
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

    it('rejects a workspace API key before canonical loading', async () => {
      v2RouteMocks.authenticate.mockResolvedValue(workspaceKeyAuth)

      const response = await get()

      expect(response.status).toBe(403)
      expect(
        workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext
      ).not.toHaveBeenCalled()
      expect(mocks.listServers).not.toHaveBeenCalled()
    })

    it('conceals a workspace the caller cannot reach as 404', async () => {
      workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue(null)

      const response = await get()

      expect(response.status).toBe(404)
      expect(mocks.listServers).not.toHaveBeenCalled()
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
      expect(auditMockFns.mockRecordAudit).toHaveBeenCalledTimes(1)
      expect(mockPublishWorkflowToolsChanged).toHaveBeenCalledWith({
        serverId: 'wfmcp-1',
        workspaceId: WORKSPACE_ID,
      })
    })

    it('refuses a caller below workspace admin with 403', async () => {
      workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('write')

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
      expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
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
