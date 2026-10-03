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
import { auditMock } from '@sim/testing/mocks/audit.mock'
import {
  permissionCheckMock,
  permissionCheckMockFns,
} from '@sim/testing/mocks/permission-check.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import {
  workflowContextMock,
  workflowContextMockFns,
} from '@sim/testing/mocks/workflow-context.mock'
import {
  workflowsOrchestrationMock,
  workflowsOrchestrationMockFns,
} from '@sim/testing/mocks/workflows-orchestration.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listDeployments: vi.fn(),
  getLiveChatDeployment: vi.fn(),
  getIdentifierOwner: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@/lib/workflows/application/context', () => workflowContextMock)
vi.mock('@/lib/chat-deployments/queries', () => ({
  listWorkspaceChatDeployments: mocks.listDeployments,
  getLiveChatDeploymentForWorkflow: mocks.getLiveChatDeployment,
  getChatDeploymentIdOwningIdentifier: mocks.getIdentifierOwner,
  getChatDeploymentWithWorkspace: vi.fn(),
  updateChatDeploymentRow: vi.fn(),
}))
vi.mock('@/lib/workflows/orchestration', () => workflowsOrchestrationMock)
vi.mock('@/ee/access-control/utils/permission-check', () => permissionCheckMock)
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { GET } from '@/app/api/v2/chat-deployments/route'

const { mockPerformChatDeploy } = workflowsOrchestrationMockFns

const WORKSPACE_ID = 'workspace-1'
const WORKFLOW_ID = 'workflow-1'

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
  return GET(
    createMockRequest({ url: `http://localhost/api/v2/chat-deployments${search}` }),
    createRouteContext({})
  )
}

describe('/api/v2/chat-deployments', () => {
  beforeEach(() => {
    resetDbChainMock()
    v2RouteMocks.authenticate.mockResolvedValue(personalKeyAuth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('admin')
    workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext.mockResolvedValue(
      workspaceContext
    )
    workflowContextMockFns.mockResolveActiveWorkflowApplicationContext.mockResolvedValue({
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
    permissionCheckMockFns.mockValidateChatDeployAuth.mockResolvedValue(undefined)
    mockPerformChatDeploy.mockImplementation(async () => {
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

    it('reports a configured chat inactive when its workflow is undeployed', async () => {
      mocks.listDeployments.mockResolvedValue({
        data: [{ chat: chatRow({ isActive: true }), isWorkflowDeployed: false }],
        nextCursorKeys: null,
      })

      const body = await (await get()).json()

      expect(body.data[0].isActive).toBe(false)
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

    /**
     * The list addresses a workspace, so the concealed denial must name the
     * workspace. Naming a chat deployment reported a resource the caller never
     * asked for. Concealment itself is unchanged: still 404, still no signal
     * about whether the workspace holds any deployment.
     */
    it('conceals a workspace the caller cannot reach as a missing workspace', async () => {
      workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue(null)

      const response = await get()

      expect(response.status).toBe(404)
      const body = await response.json()
      expect(body.error.code).toBe('NOT_FOUND')
      expect(body.error.message).toBe('Workspace not found')
      expect(mocks.listDeployments).not.toHaveBeenCalled()
    })
  })
})
