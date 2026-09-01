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
  resolveWorkflowContext: vi.fn(),
  listDeployments: vi.fn(),
  getLiveChatDeployment: vi.fn(),
  getIdentifierOwner: vi.fn(),
  performChatDeploy: vi.fn(),
  validateChatDeployAuth: vi.fn(),
  audit: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { CHAT_DEPLOYED: 'chat.deployed', CHAT_DELETED: 'chat.deleted' },
  AuditResourceType: { CHAT: 'chat' },
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
  resolveActiveWorkspaceApplicationContext: async (workspaceId: string) => {
    const context = await mocks.loadWorkspaceContext(workspaceId)
    if (!context) throw new Error('Workspace not found')
    return context
  },
}))
vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowApplicationContext: mocks.resolveWorkflowContext,
}))
vi.mock('@/lib/chat-deployments/queries', () => ({
  listWorkspaceChatDeployments: mocks.listDeployments,
  getLiveChatDeploymentForWorkflow: mocks.getLiveChatDeployment,
  getChatDeploymentIdOwningIdentifier: mocks.getIdentifierOwner,
  getChatDeploymentWithWorkspace: vi.fn(),
  updateChatDeploymentRow: vi.fn(),
}))
vi.mock('@/lib/workflows/orchestration', () => ({
  performChatDeploy: mocks.performChatDeploy,
  performChatUndeploy: vi.fn(),
}))
vi.mock('@/ee/access-control/utils/permission-check', () => ({
  validateChatDeployAuth: mocks.validateChatDeployAuth,
}))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { GET } from '@/app/api/v2/chat-deployments/route'

const WORKSPACE_ID = 'workspace-1'
const WORKFLOW_ID = 'workflow-1'

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

function chatRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'chat-1',
    workflowId: WORKFLOW_ID,
    userId: 'owner-1',
    identifier: 'support',
    title: 'Support chat',
    description: 'Ask us anything',
    isActive: true,
    customizations: { primaryColor: '#000', welcomeMessage: 'Hi' },
    authType: 'public',
    password: null,
    allowedEmails: [],
    outputConfigs: [],
    includeThinking: false,
    includeToolCalls: null,
    archivedAt: null,
    createdAt: new Date('2026-06-12T10:30:00.000Z'),
    updatedAt: new Date('2026-06-12T10:30:00.000Z'),
    ...overrides,
  }
}

async function get(search = `?workspaceId=${WORKSPACE_ID}`) {
  return GET(new NextRequest(`http://localhost/api/v2/chat-deployments${search}`), {
    params: Promise.resolve({}),
  })
}

describe('/api/v2/chat-deployments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    v2RouteMocks.authenticate.mockResolvedValue(personalKeyAuth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.loadWorkspaceContext.mockResolvedValue(workspaceContext)
    mocks.resolveWorkflowContext.mockResolvedValue({
      ...workspaceContext,
      workflowId: WORKFLOW_ID,
      workflow: { id: WORKFLOW_ID, name: 'Support', workspaceId: WORKSPACE_ID },
    })
    mocks.listDeployments.mockResolvedValue({
      data: [{ chat: chatRow(), isWorkflowDeployed: true }],
      nextCursorKeys: null,
    })
    mocks.getLiveChatDeployment.mockResolvedValue(null)
    mocks.getIdentifierOwner.mockResolvedValue(null)
    mocks.validateChatDeployAuth.mockResolvedValue(undefined)
    mocks.performChatDeploy.mockImplementation(async () => {
      mocks.getLiveChatDeployment.mockResolvedValue(chatRow())
      return {
        success: true,
        chatId: 'chat-1',
        chatUrl: 'http://localhost:3000/chat/support',
        isUpdate: false,
      }
    })
  })

  describe('GET', () => {
    it('publishes the deployment with its public URL and no password', async () => {
      const response = await get()

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.data).toHaveLength(1)
      expect(body.data[0]).toMatchObject({
        id: 'chat-1',
        workflowId: WORKFLOW_ID,
        workspaceId: WORKSPACE_ID,
        identifier: 'support',
        url: expect.stringContaining('/chat/support'),
        includeToolCalls: false,
      })
      expect(body.data[0]).not.toHaveProperty('password')
      expect(body.nextCursor).toBeNull()
    })

    /** `url` must be a path, not a host: there is no chat subdomain to publish. */
    it('never publishes a per-deployment host', async () => {
      const body = await (await get()).json()

      expect(new URL(body.data[0].url).hostname).not.toContain('support')
      expect(body.data[0]).not.toHaveProperty('subdomain')
    })

    /**
     * The list is a `read` operation reachable by a workspace API key, so it
     * must not carry what the admin-gated detail read exists to gate. Asserted
     * against the serialized body rather than the parsed keys, so a field
     * reintroduced at any depth — nested under a future wrapper, say — is still
     * caught.
     */
    it('omits the fields the admin-gated detail read carries', async () => {
      mocks.listDeployments.mockResolvedValue({
        data: [
          {
            chat: chatRow({
              authType: 'password',
              password: 'encrypted-secret',
              allowedEmails: ['gated@example.com'],
              customizations: { primaryColor: '#gated', welcomeMessage: 'gated-welcome' },
            }),
            isWorkflowDeployed: true,
          },
        ],
        nextCursorKeys: null,
      })

      const response = await get()
      const body = await response.json()
      const serialized = JSON.stringify(body)

      expect(response.status).toBe(200)
      expect(serialized).not.toContain('allowedEmails')
      expect(serialized).not.toContain('hasPassword')
      expect(serialized).not.toContain('customizations')
      expect(serialized).not.toContain('gated@example.com')
      expect(serialized).not.toContain('gated-welcome')
      expect(serialized).not.toContain('encrypted-secret')
    })

    /** Narrowing must not cost discovery: the mode label and identity stay. */
    it('still carries what a caller needs to decide whether to fetch the detail', async () => {
      mocks.listDeployments.mockResolvedValue({
        data: [
          {
            chat: chatRow({ authType: 'password', password: 'encrypted-secret' }),
            isWorkflowDeployed: true,
          },
        ],
        nextCursorKeys: null,
      })

      const body = await (await get()).json()

      expect(body.data[0]).toMatchObject({
        id: 'chat-1',
        identifier: 'support',
        title: 'Support chat',
        authType: 'password',
        isActive: true,
        url: expect.stringContaining('/chat/support'),
        createdAt: '2026-06-12T10:30:00.000Z',
      })
    })

    it('reports a configured chat inactive when its workflow is undeployed', async () => {
      mocks.listDeployments.mockResolvedValue({
        data: [{ chat: chatRow({ isActive: true }), isWorkflowDeployed: false }],
        nextCursorKeys: null,
      })

      const body = await (await get()).json()

      expect(body.data[0].isActive).toBe(false)
    })

    it('passes the workflow and active filters to the read', async () => {
      await get(`?workspaceId=${WORKSPACE_ID}&workflowId=${WORKFLOW_ID}&isActive=false`)

      expect(mocks.listDeployments).toHaveBeenCalledWith(
        expect.objectContaining({ workflowId: WORKFLOW_ID, isActive: false })
      )
    })

    it('rejects a cursor minted under different filters', async () => {
      mocks.listDeployments.mockResolvedValue({
        data: [{ chat: chatRow(), isWorkflowDeployed: true }],
        nextCursorKeys: [{ key: 'createdAt', value: '2026-06-12T10:30:00.000Z' }],
      })
      const cursor = (await (await get()).json()).nextCursor
      expect(cursor).toEqual(expect.any(String))

      const response = await get(
        `?workspaceId=${WORKSPACE_ID}&isActive=true&cursor=${encodeURIComponent(cursor)}`
      )

      expect(response.status).toBe(400)
      expect((await response.json()).error.code).toBe('BAD_REQUEST')
    })

    it('accepts a workspace API key for the read', async () => {
      v2RouteMocks.authenticate.mockResolvedValue(workspaceKeyAuth)

      const response = await get()

      expect(response.status).toBe(200)
    })

    /**
     * The list addresses a workspace, so the concealed denial must name the
     * workspace. Naming a chat deployment reported a resource the caller never
     * asked for. Concealment itself is unchanged: still 404, still no signal
     * about whether the workspace holds any deployment.
     */
    it('conceals a workspace the caller cannot reach as a missing workspace', async () => {
      mocks.resolvePermission.mockResolvedValue(null)

      const response = await get()

      expect(response.status).toBe(404)
      const body = await response.json()
      expect(body.error.code).toBe('NOT_FOUND')
      expect(body.error.message).toBe('Workspace not found')
      expect(mocks.listDeployments).not.toHaveBeenCalled()
    })

    it('rejects an unauthenticated request', async () => {
      v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

      expect((await get()).status).toBe(401)
    })
  })
})
