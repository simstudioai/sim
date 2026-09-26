import {
  resetDbChainMock,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { createPersonalApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
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
  listTools: vi.fn(),
  getLiveTool: vi.fn(),
  getWorkflow: vi.fn(),
  createTool: vi.fn(),
  updateTool: vi.fn(),
  deleteTool: vi.fn(),
  inputFormat: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@/lib/mcp/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp/queries')>()),
  getWorkflowMcpServerById: mocks.getServer,
  getLiveWorkflowMcpTool: mocks.getLiveTool,
  getWorkflowMcpToolIncludingArchived: mocks.getLiveTool,
  listWorkflowMcpToolsIncludingArchived: mocks.listTools,
  getWorkflowMcpPublishableWorkflow: mocks.getWorkflow,
}))
vi.mock('@/lib/mcp/orchestration', () => ({
  performCreateWorkflowMcpServer: vi.fn(),
  performUpdateWorkflowMcpServer: vi.fn(),
  performDeleteWorkflowMcpServer: vi.fn(),
  performCreateWorkflowMcpTool: mocks.createTool,
  performUpdateWorkflowMcpTool: mocks.updateTool,
  performDeleteWorkflowMcpTool: mocks.deleteTool,
}))
vi.mock('@/lib/mcp/pubsub', () => mcpPubsubMock)
vi.mock('@/lib/mcp/workflow-mcp-sync', () => ({
  getDeployedWorkflowInputFormat: mocks.inputFormat,
}))
vi.mock('@/lib/mcp/workflow-tool-schema', () => ({
  applyDescriptionOverrides: (schema: unknown) => schema,
  generateToolInputSchema: () => ({ type: 'object', properties: {} }),
  sanitizeToolName: (name: string) => name.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
}))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { DELETE } from '@/app/api/v2/workflow-mcp-servers/[serverId]/tools/[workflowId]/route'
import { GET, POST } from '@/app/api/v2/workflow-mcp-servers/[serverId]/tools/route'

const { mockPublishWorkflowToolsChanged } = mcpPubsubMockFns

const WORKSPACE_ID = 'workspace-1'
const SERVER_ID = 'wfmcp-1'
const WORKFLOW_ID = 'workflow-1'

const personalKeyAuth = {
  principal: createPersonalApiKeyPrincipal({ keyId: 'personal-key-1' }),
  rateLimitSubjectIds: ['api-key:personal-key-1', 'user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}

const serverRow = {
  id: SERVER_ID,
  workspaceId: WORKSPACE_ID,
  createdBy: 'user-1',
  name: 'Support agents',
  description: null,
  isPublic: false,
  deletedAt: null,
  createdAt: new Date('2026-06-12T10:30:00.000Z'),
  updatedAt: new Date('2026-06-12T10:30:00.000Z'),
}

const toolRow = {
  id: 'wfmcptool-1',
  serverId: SERVER_ID,
  workflowId: WORKFLOW_ID,
  toolName: 'triage_ticket',
  toolDescription: 'Execute Ticket triage workflow',
  parameterSchema: {},
  parameterDescriptionOverrides: {},
  archivedAt: null,
  createdAt: new Date('2026-06-12T10:30:00.000Z'),
  updatedAt: new Date('2026-06-12T10:30:00.000Z'),
}

/** The workflow row `resolveWorkflowToolContext` loads inside the server's workspace. */
function queueWorkflowLookup(
  row: unknown = { id: WORKFLOW_ID, name: 'Ticket triage', isDeployed: true }
) {
  mocks.getWorkflow.mockResolvedValue(row)
}

async function get() {
  const request = createMockRequest({
    url: `http://localhost/api/v2/workflow-mcp-servers/${SERVER_ID}/tools`,
  })
  return GET(request, createRouteContext({ serverId: SERVER_ID }))
}

async function post(body: unknown) {
  const request = createMockRequest({
    method: 'POST',
    url: `http://localhost/api/v2/workflow-mcp-servers/${SERVER_ID}/tools`,
    body,
  })
  return POST(request, createRouteContext({ serverId: SERVER_ID }))
}

async function del() {
  const request = createMockRequest({
    method: 'DELETE',
    url: `http://localhost/api/v2/workflow-mcp-servers/${SERVER_ID}/tools/${WORKFLOW_ID}`,
  })
  return DELETE(request, createRouteContext({ serverId: SERVER_ID, workflowId: WORKFLOW_ID }))
}

describe('/api/v2/workflow-mcp-servers/[serverId]/tools', () => {
  beforeEach(() => {
    resetDbChainMock()
    v2RouteMocks.authenticate.mockResolvedValue(personalKeyAuth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('admin')
    workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext.mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    mocks.getServer.mockResolvedValue(serverRow)
    mocks.getLiveTool.mockResolvedValue(null)
    mocks.inputFormat.mockResolvedValue([])
    mocks.createTool.mockResolvedValue({ success: true, tool: toolRow })
    mocks.updateTool.mockResolvedValue({ success: true, tool: toolRow })
    mocks.deleteTool.mockResolvedValue({ success: true, tool: toolRow })
  })

  describe('POST', () => {
    /** Publishing is idempotent per workflow — a repeat replaces rather than conflicts. */
    it('replaces an existing tool and reports updated', async () => {
      queueWorkflowLookup()
      mocks.getLiveTool.mockResolvedValue(toolRow)

      const body = await (await post({ workflowId: WORKFLOW_ID })).json()

      expect(body.data.updated).toBe(true)
      expect(mocks.updateTool).toHaveBeenCalled()
      expect(mocks.createTool).not.toHaveBeenCalled()
    })

    it('refuses an undeployed workflow with 400 rather than publishing an empty schema', async () => {
      queueWorkflowLookup({ id: WORKFLOW_ID, name: 'Ticket triage', isDeployed: false })

      const response = await post({ workflowId: WORKFLOW_ID })

      expect(response.status).toBe(400)
      expect((await response.json()).error.message).toContain('must be deployed')
      expect(mocks.createTool).not.toHaveBeenCalled()
      expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
    })

    it('conceals a workflow outside the server workspace as 404', async () => {
      queueWorkflowLookup(null)

      const response = await post({ workflowId: WORKFLOW_ID })

      expect(response.status).toBe(404)
      expect((await response.json()).error.message).toBe('Workflow not found')
    })

    it('rejects more parameter descriptions than the domain accepts', async () => {
      const response = await post({
        workflowId: WORKFLOW_ID,
        parameterDescriptions: Array.from({ length: 101 }, (_, index) => ({
          name: `field${index}`,
          description: 'x',
        })),
      })

      expect(response.status).toBe(400)
      expect(JSON.stringify(await response.json())).toContain('at most 100 entries')
      expect(mocks.getServer).not.toHaveBeenCalled()
    })

    it('refuses a caller below workspace admin with 403', async () => {
      queueWorkflowLookup()
      workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('write')

      const response = await post({ workflowId: WORKFLOW_ID })

      expect(response.status).toBe(403)
      expect(mocks.createTool).not.toHaveBeenCalled()
    })
  })

  describe('DELETE', () => {
    it('removes the tool addressed by workflow', async () => {
      queueWorkflowLookup()
      mocks.getLiveTool.mockResolvedValue(toolRow)

      const response = await del()

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        data: {
          id: 'wfmcptool-1',
          serverId: SERVER_ID,
          workflowId: WORKFLOW_ID,
          deleted: true,
        },
      })
      expect(mockPublishWorkflowToolsChanged).toHaveBeenCalledWith({
        serverId: SERVER_ID,
        workspaceId: WORKSPACE_ID,
      })
    })

    it('answers 404 when the workflow is not published on this server', async () => {
      queueWorkflowLookup()
      mocks.getLiveTool.mockResolvedValue(null)

      const response = await del()

      expect(response.status).toBe(404)
      expect((await response.json()).error.message).toBe(
        'Workflow is not deployed to this MCP server'
      )
      expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
    })
  })

  /**
   * The server list reports tool NAMES only, so before this read nothing
   * published the `workflowId` that `DELETE .../tools/{workflowId}` addresses —
   * a caller that lost the publish response could not reconcile a server.
   */
  describe('GET', () => {
    /**
     * An undeploy archives the workflow's registrations rather than deleting
     * them. Omitting those rows made `tools list` answer `[]` for a server whose
     * only workflow was undeployed, with nothing to say the tool still existed.
     */
    it('lists an archived registration as inactive rather than omitting it', async () => {
      mocks.getServer.mockResolvedValue(serverRow)
      mocks.listTools.mockResolvedValue({
        tools: [
          toolRow,
          {
            ...toolRow,
            id: 'wfmcptool-2',
            workflowId: 'workflow-2',
            toolName: 'close_ticket',
            archivedAt: new Date('2026-06-13T10:30:00.000Z'),
          },
        ],
        truncated: false,
      })

      const body = await (await get()).json()

      expect(
        body.data.map((tool: { toolName: string; status: string }) => [tool.toolName, tool.status])
      ).toEqual([
        ['triage_ticket', 'active'],
        ['close_ticket', 'inactive'],
      ])
      expect(body.data[1]).not.toHaveProperty('archivedAt')
    })

    /**
     * `nextCursor` is null whether or not the ceiling cut the set, and this list
     * takes no `cursor`, so a truncated inventory cannot be paged past. Without
     * this flag a reconciling caller read a partial set as the whole published
     * inventory — and the use case had been computing it all along.
     */
    it('says when the ceiling cut the inventory short', async () => {
      mocks.getServer.mockResolvedValue(serverRow)
      mocks.listTools.mockResolvedValue({ tools: [toolRow], truncated: true })

      const body = await (await get()).json()

      expect(body.truncated).toBe(true)
      expect(body.nextCursor).toBeNull()
    })

    it('conceals a server in another workspace as not found', async () => {
      mocks.getServer.mockResolvedValue(null)

      expect((await get()).status).toBe(404)
      expect(mocks.listTools).not.toHaveBeenCalled()
    })
  })
})
