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
  listTools: vi.fn(),
  getLiveTool: vi.fn(),
  getWorkflow: vi.fn(),
  createTool: vi.fn(),
  updateTool: vi.fn(),
  deleteTool: vi.fn(),
  audit: vi.fn(),
  publishToolsChanged: vi.fn(),
  inputFormat: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { MCP_SERVER_UPDATED: 'mcp_server.updated' },
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
  getLiveWorkflowMcpTool: mocks.getLiveTool,
  listLiveWorkflowMcpTools: mocks.listTools,
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
vi.mock('@/lib/mcp/pubsub', () => ({
  mcpPubSub: { publishWorkflowToolsChanged: mocks.publishToolsChanged },
}))
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

const WORKSPACE_ID = 'workspace-1'
const SERVER_ID = 'wfmcp-1'
const WORKFLOW_ID = 'workflow-1'

const personalKeyAuth = {
  principal: { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'personal-key-1' },
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
  const request = new NextRequest(`http://localhost/api/v2/workflow-mcp-servers/${SERVER_ID}/tools`)
  return GET(request, { params: Promise.resolve({ serverId: SERVER_ID }) })
}

async function post(body: unknown) {
  const request = new NextRequest(
    `http://localhost/api/v2/workflow-mcp-servers/${SERVER_ID}/tools`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  )
  return POST(request, { params: Promise.resolve({ serverId: SERVER_ID }) })
}

async function del() {
  const request = new NextRequest(
    `http://localhost/api/v2/workflow-mcp-servers/${SERVER_ID}/tools/${WORKFLOW_ID}`,
    { method: 'DELETE' }
  )
  return DELETE(request, {
    params: Promise.resolve({ serverId: SERVER_ID, workflowId: WORKFLOW_ID }),
  })
}

describe('/api/v2/workflow-mcp-servers/[serverId]/tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    v2RouteMocks.authenticate.mockResolvedValue(personalKeyAuth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.loadWorkspaceContext.mockResolvedValue({
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
    it('publishes a deployed workflow and reports it as new', async () => {
      queueWorkflowLookup()

      const response = await post({ workflowId: WORKFLOW_ID })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        data: {
          id: 'wfmcptool-1',
          serverId: SERVER_ID,
          workflowId: WORKFLOW_ID,
          toolName: 'triage_ticket',
          toolDescription: 'Execute Ticket triage workflow',
          mcpServerUrl: expect.stringContaining(`/api/mcp/serve/${SERVER_ID}`),
          apiEndpoint: expect.stringContaining(`/api/v2/workflows/${WORKFLOW_ID}/execute`),
          updated: false,
          createdAt: '2026-06-12T10:30:00.000Z',
          updatedAt: '2026-06-12T10:30:00.000Z',
        },
      })
      expect(mocks.createTool).toHaveBeenCalled()
      expect(mocks.updateTool).not.toHaveBeenCalled()
    })

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
      expect(mocks.audit).not.toHaveBeenCalled()
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

    it('rejects a nested unknown key in parameterDescriptions', async () => {
      const response = await post({
        workflowId: WORKFLOW_ID,
        parameterDescriptions: [{ name: 'field', description: 'x', required: true }],
      })

      expect(response.status).toBe(400)
      expect(mocks.getServer).not.toHaveBeenCalled()
    })

    it('refuses a caller below workspace admin with 403', async () => {
      queueWorkflowLookup()
      mocks.resolvePermission.mockResolvedValue('write')

      const response = await post({ workflowId: WORKFLOW_ID })

      expect(response.status).toBe(403)
      expect(mocks.createTool).not.toHaveBeenCalled()
    })

    it('rejects an unauthenticated request', async () => {
      v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

      const response = await post({ workflowId: WORKFLOW_ID })

      expect(response.status).toBe(401)
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
      expect(mocks.publishToolsChanged).toHaveBeenCalledWith({
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
      expect(mocks.audit).not.toHaveBeenCalled()
    })
  })

  /**
   * The server list reports tool NAMES only, so before this read nothing
   * published the `workflowId` that `DELETE .../tools/{workflowId}` addresses —
   * a caller that lost the publish response could not reconcile a server.
   */
  describe('GET', () => {
    it('returns each published tool with the workflowId that addresses it', async () => {
      mocks.getServer.mockResolvedValue(serverRow)
      mocks.listTools.mockResolvedValue({ tools: [toolRow], truncated: false })

      const response = await get()

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.data).toHaveLength(1)
      expect(body.data[0]).toMatchObject({
        id: 'wfmcptool-1',
        serverId: SERVER_ID,
        workflowId: WORKFLOW_ID,
        toolName: 'triage_ticket',
      })
    })

    /** `updated` reports what a publish did; a read has no publish to report. */
    it('omits the publish-only updated flag', async () => {
      mocks.getServer.mockResolvedValue(serverRow)
      mocks.listTools.mockResolvedValue({ tools: [toolRow], truncated: false })

      const body = await (await get()).json()

      expect(body.data[0]).not.toHaveProperty('updated')
    })

    it('is a full set, so nextCursor is always null', async () => {
      mocks.getServer.mockResolvedValue(serverRow)
      mocks.listTools.mockResolvedValue({ tools: [toolRow], truncated: false })

      const body = await (await get()).json()

      expect(body.nextCursor).toBeNull()
    })

    it('conceals a server in another workspace as not found', async () => {
      mocks.getServer.mockResolvedValue(null)

      expect((await get()).status).toBe(404)
      expect(mocks.listTools).not.toHaveBeenCalled()
    })
  })
})
