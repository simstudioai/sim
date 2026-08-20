/**
 * Tests for the internal chat collection route.
 *
 * `GET` is still a hand-written per-creator list — see the route's own note on
 * why it was not migrated with the rest of the surface. `POST` is an adapter
 * over the `workflows.chat.deploy` use case, so its seams are the canonical
 * workflow load, the workspace permission resolver, and the deploy
 * orchestration.
 *
 * @vitest-environment node
 */
import {
  auditMock,
  authMockFns,
  dbChainMockFns,
  resetDbChainMock,
  resetEnvMock,
  setEnv,
  workflowsApiUtilsMock,
  workflowsApiUtilsMockFns,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolvePermission: vi.fn(),
  resolveWorkflowContext: vi.fn(),
  performChatDeploy: vi.fn(),
  validateChatDeployAuth: vi.fn(),
  getLiveChatDeployment: vi.fn(),
  getIdentifierOwner: vi.fn(),
}))

const mockCreateSuccessResponse = workflowsApiUtilsMockFns.mockCreateSuccessResponse
const mockCreateErrorResponse = workflowsApiUtilsMockFns.mockCreateErrorResponse

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/app/api/workflows/utils', () => workflowsApiUtilsMock)
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))
vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowApplicationContext: mocks.resolveWorkflowContext,
}))
vi.mock('@/lib/chat-deployments/queries', () => ({
  getLiveChatDeploymentForWorkflow: mocks.getLiveChatDeployment,
  getChatDeploymentIdOwningIdentifier: mocks.getIdentifierOwner,
}))
vi.mock('@/lib/workflows/orchestration', () => ({
  performChatDeploy: mocks.performChatDeploy,
  performChatUndeploy: vi.fn(),
}))
vi.mock('@/ee/access-control/utils/permission-check', () => {
  class ChatDeployAuthNotAllowedError extends Error {
    constructor() {
      super('This chat authentication mode is not allowed based on your permission group settings')
      this.name = 'ChatDeployAuthNotAllowedError'
    }
  }
  return { validateChatDeployAuth: mocks.validateChatDeployAuth, ChatDeployAuthNotAllowedError }
})

import { GET, POST } from '@/app/api/chat/route'
import { ChatDeployAuthNotAllowedError } from '@/ee/access-control/utils/permission-check'

const WORKFLOW_ID = 'workflow-1'
const WORKSPACE_ID = 'workspace-1'

const validBody = {
  workflowId: WORKFLOW_ID,
  identifier: 'support',
  title: 'Support chat',
  customizations: { primaryColor: '#000', welcomeMessage: 'Hi' },
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function post(body: unknown) {
  return POST(postRequest(body), { params: Promise.resolve({}) })
}

const settledRow = {
  id: 'chat-1',
  workflowId: WORKFLOW_ID,
  userId: 'admin-1',
  identifier: 'support',
  title: 'Support chat',
  description: null,
  isActive: true,
  customizations: {},
  authType: 'public',
  password: null,
  allowedEmails: [],
  outputConfigs: [],
  includeThinking: false,
  includeToolCalls: false,
  archivedAt: null,
  createdAt: new Date('2026-06-12T10:30:00.000Z'),
  updatedAt: new Date('2026-06-12T10:30:00.000Z'),
}

/**
 * The canonical chat reads `deployWorkflowChat` performs: the existing
 * deployment before the write, the identifier owner, and the settled row it
 * re-reads afterwards.
 */
function queueChatLookups(existing: unknown | null, identifierOwnerId: string | null) {
  mocks.getLiveChatDeployment.mockResolvedValue(existing)
  mocks.getIdentifierOwner.mockResolvedValue(identifierOwnerId)
  mocks.performChatDeploy.mockImplementation(async () => {
    mocks.getLiveChatDeployment.mockResolvedValue(settledRow)
    return {
      success: true,
      chatId: 'chat-1',
      chatUrl: 'http://localhost:3000/chat/support',
      isUpdate: false,
    }
  })
}

describe('Chat API Route', () => {
  afterAll(() => {
    resetEnvMock()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnv({ NODE_ENV: 'development', NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'admin-1', name: 'Admin' },
      session: { id: 'session-1' },
    })
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.resolveWorkflowContext.mockResolvedValue({
      workflowId: WORKFLOW_ID,
      workflow: { id: WORKFLOW_ID, name: 'Support', workspaceId: WORKSPACE_ID },
      workspaceId: WORKSPACE_ID,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    mocks.validateChatDeployAuth.mockResolvedValue(undefined)
    mocks.performChatDeploy.mockResolvedValue({
      success: true,
      chatId: 'chat-1',
      chatUrl: 'http://localhost:3000/chat/support',
      isUpdate: false,
    })

    mockCreateSuccessResponse.mockImplementation((data) => {
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    mockCreateErrorResponse.mockImplementation((message, status = 500) => {
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    })
  })

  describe('GET', () => {
    it('should return 401 when user is not authenticated', async () => {
      authMockFns.mockGetSession.mockResolvedValue(null)

      const response = await GET(new NextRequest('http://localhost:3000/api/chat'))

      expect(response.status).toBe(401)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Unauthorized', 401)
    })

    it('should return chat deployments for authenticated user', async () => {
      const mockDeployments = [{ id: 'deployment-1' }, { id: 'deployment-2' }]
      dbChainMockFns.where.mockResolvedValueOnce(mockDeployments)

      const response = await GET(new NextRequest('http://localhost:3000/api/chat'))

      expect(response.status).toBe(200)
      // Each row is normalized so a missing tool policy reads as off.
      expect(mockCreateSuccessResponse).toHaveBeenCalledWith({
        deployments: mockDeployments.map((deployment) => ({
          ...deployment,
          includeToolCalls: false,
        })),
      })
    })

    it('should handle errors when fetching deployments', async () => {
      dbChainMockFns.where.mockRejectedValueOnce(new Error('Database error'))

      const response = await GET(new NextRequest('http://localhost:3000/api/chat'))

      expect(response.status).toBe(500)
      expect(mockCreateErrorResponse).toHaveBeenCalledWith('Database error', 500)
    })
  })

  describe('POST', () => {
    it('returns 401 when there is no session', async () => {
      authMockFns.mockGetSession.mockResolvedValue(null)

      const response = await post(validBody)

      expect(response.status).toBe(401)
      expect(mocks.resolveWorkflowContext).not.toHaveBeenCalled()
    })

    it('validates the request body before touching the workflow', async () => {
      const response = await post({ workflowId: WORKFLOW_ID })

      expect(response.status).toBe(400)
      expect(mocks.resolveWorkflowContext).not.toHaveBeenCalled()
    })

    it('deploys the chat through the shared use case', async () => {
      queueChatLookups(null, null)

      const response = await post(validBody)

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        id: 'chat-1',
        chatId: 'chat-1',
        chatUrl: 'http://localhost:3000/chat/support',
        message: 'Chat deployment created successfully',
      })
      expect(mocks.performChatDeploy).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowId: WORKFLOW_ID,
          identifier: 'support',
          title: 'Support chat',
          workspaceId: WORKSPACE_ID,
          userId: 'admin-1',
          projectLegacyAudit: false,
        })
      )
    })

    it('passes customizations and output configs through unchanged', async () => {
      queueChatLookups(null, null)

      await post({
        ...validBody,
        customizations: {
          primaryColor: '#ff0000',
          welcomeMessage: 'Welcome',
          imageUrl: 'https://example.com/logo.png',
        },
        outputConfigs: [{ blockId: 'block-1', path: 'result' }],
      })

      expect(mocks.performChatDeploy).toHaveBeenCalledWith(
        expect.objectContaining({
          customizations: {
            primaryColor: '#ff0000',
            welcomeMessage: 'Welcome',
            imageUrl: 'https://example.com/logo.png',
          },
          outputConfigs: [{ blockId: 'block-1', path: 'result' }],
        })
      )
    })

    it('rejects an identifier another live deployment already holds', async () => {
      queueChatLookups(null, 'other-chat')

      const response = await post(validBody)

      expect(response.status).toBe(400)
      expect((await response.json()).error).toBe('Identifier already in use')
      expect(mocks.performChatDeploy).not.toHaveBeenCalled()
    })

    it('conceals a workflow the caller cannot reach', async () => {
      mocks.resolvePermission.mockResolvedValue(null)

      const response = await post(validBody)

      expect(response.status).toBe(404)
      expect(mocks.performChatDeploy).not.toHaveBeenCalled()
    })

    it('refuses a workspace member below admin', async () => {
      mocks.resolvePermission.mockResolvedValue('write')

      const response = await post(validBody)

      expect(response.status).toBe(403)
      expect(mocks.performChatDeploy).not.toHaveBeenCalled()
    })

    it('refuses an auth mode the permission group blocks', async () => {
      queueChatLookups(null, null)
      mocks.validateChatDeployAuth.mockRejectedValue(new ChatDeployAuthNotAllowedError())

      const response = await post({
        ...validBody,
        authType: 'email',
        allowedEmails: ['a@example.com'],
      })

      expect(response.status).toBe(403)
      expect(mocks.performChatDeploy).not.toHaveBeenCalled()
    })

    /**
     * An email- or SSO-gated chat with an empty allow-list is unenterable, so
     * it is refused in the use case rather than only at this boundary.
     */
    it.each([
      ['email', 'At least one email or domain is required when using email access control'],
      ['sso', 'At least one email or domain is required when using SSO access control'],
    ])('refuses %s gating with an empty allow-list', async (authType, message) => {
      queueChatLookups(null, null)

      const response = await post({ ...validBody, authType, allowedEmails: [] })

      expect(response.status).toBe(400)
      expect((await response.json()).error).toBe(message)
      expect(mocks.performChatDeploy).not.toHaveBeenCalled()
    })

    it('surfaces a deploy failure as a validation error rather than a 500', async () => {
      queueChatLookups(null, null)
      mocks.performChatDeploy.mockResolvedValue({
        success: false,
        error: 'Password is required when using password protection',
      })

      const response = await post(validBody)

      expect(response.status).toBe(400)
      expect((await response.json()).error).toBe(
        'Password is required when using password protection'
      )
    })
  })
})
