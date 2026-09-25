/**
 * Tests for the internal chat collection route.
 *
 * `POST` is an adapter over the `workflows.chat.deploy` use case, so its seams
 * are the canonical workflow load, the workspace permission resolver, and the
 * deploy orchestration.
 */
import {
  auditMock,
  authMockFns,
  resetDbChainMock,
  resetEnvMock,
  setEnv,
  workflowsApiUtilsMock,
  workflowsApiUtilsMockFns,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PermissionGroupCapabilityError } from '@/lib/permission-groups/capability-error'

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
vi.mock('@/ee/access-control/utils/permission-check', () => ({
  validateChatDeployAuth: mocks.validateChatDeployAuth,
}))

import { POST } from '@/app/api/chat/route'

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

  describe('POST', () => {
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
      mocks.validateChatDeployAuth.mockRejectedValue(
        new PermissionGroupCapabilityError(
          'deploy.chat.auth_mode',
          'CHAT_AUTH_MODE_NOT_PERMITTED',
          "This chat authentication mode is not available under your organization's permission group"
        )
      )

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

    /** A retryable in-flight deployment is a conflict, not a malformed request. */
    it('surfaces an in-flight workflow deployment as a 409', async () => {
      queueChatLookups(null, null)
      mocks.performChatDeploy.mockResolvedValue({
        success: false,
        errorCode: 'conflict',
        error:
          'A workflow deployment is still preparing. Retry chat deployment after it becomes active.',
      })

      const response = await post(validBody)

      expect(response.status).toBe(409)
      expect((await response.json()).error).toContain('still preparing')
    })
  })
})
