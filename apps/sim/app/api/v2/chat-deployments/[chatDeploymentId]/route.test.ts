/**
 * @vitest-environment node
 */
import {
  encryptionMock,
  encryptionMockFns,
  MockV2ApiKeyUnauthenticatedError,
  resetDbChainMock,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2GateModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolvePermission: vi.fn(),
  loadWorkspaceContext: vi.fn(),
  getChatDeploymentWithWorkspace: vi.fn(),
  getIdentifierOwner: vi.fn(),
  updateChatDeploymentRow: vi.fn(),
  getWorkflowDeploymentSummary: vi.fn(),
  performFullDeploy: vi.fn(),
  performChatUndeploy: vi.fn(),
  checkNeedsRedeployment: vi.fn(),
  validateChatDeployAuth: vi.fn(),
  audit: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { CHAT_UPDATED: 'chat.updated', CHAT_DELETED: 'chat.deleted' },
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
}))
vi.mock('@/lib/chat-deployments/queries', () => ({
  getChatDeploymentWithWorkspace: mocks.getChatDeploymentWithWorkspace,
  getChatDeploymentIdOwningIdentifier: mocks.getIdentifierOwner,
  updateChatDeploymentRow: mocks.updateChatDeploymentRow,
  listWorkspaceChatDeployments: vi.fn(),
}))
vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/lib/workflows/orchestration', () => ({
  getWorkflowDeploymentSummary: mocks.getWorkflowDeploymentSummary,
  performFullDeploy: mocks.performFullDeploy,
  performChatUndeploy: mocks.performChatUndeploy,
  performChatDeploy: vi.fn(),
}))
vi.mock('@/lib/workflows/deployment-status', () => ({
  checkNeedsRedeployment: mocks.checkNeedsRedeployment,
}))
vi.mock('@/ee/access-control/utils/permission-check', () => {
  class ChatDeployAuthNotAllowedError extends Error {
    constructor() {
      super('This chat authentication mode is not allowed')
      this.name = 'ChatDeployAuthNotAllowedError'
    }
  }
  return { validateChatDeployAuth: mocks.validateChatDeployAuth, ChatDeployAuthNotAllowedError }
})
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)

import { DELETE, GET, PATCH } from '@/app/api/v2/chat-deployments/[chatDeploymentId]/route'
import { ChatDeployAuthNotAllowedError } from '@/ee/access-control/utils/permission-check'

const WORKSPACE_ID = 'workspace-1'
const CHAT_ID = 'chat-1'
const WORKFLOW_ID = 'workflow-1'

const personalKeyAuth = {
  principal: { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'personal-key-1' },
  rolloutUserId: 'user-1',
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
  rolloutUserId: 'user-1',
  rateLimitSubjectIds: ['api-key:workspace-key-1'] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

function chatRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CHAT_ID,
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
    includeToolCalls: false,
    archivedAt: null,
    createdAt: new Date('2026-06-12T10:30:00.000Z'),
    updatedAt: new Date('2026-06-12T10:30:00.000Z'),
    ...overrides,
  }
}

const params = { params: Promise.resolve({ chatDeploymentId: CHAT_ID }) }

async function get() {
  return GET(new NextRequest(`http://localhost/api/v2/chat-deployments/${CHAT_ID}`), params)
}

async function patch(body: unknown) {
  return PATCH(
    new NextRequest(`http://localhost/api/v2/chat-deployments/${CHAT_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ chatDeploymentId: CHAT_ID }) }
  )
}

async function del() {
  return DELETE(
    new NextRequest(`http://localhost/api/v2/chat-deployments/${CHAT_ID}`, { method: 'DELETE' }),
    { params: Promise.resolve({ chatDeploymentId: CHAT_ID }) }
  )
}

function writtenValues(): Record<string, unknown> {
  return mocks.updateChatDeploymentRow.mock.calls[0][1]
}

describe('/api/v2/chat-deployments/[chatDeploymentId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    v2RouteMocks.authenticate.mockResolvedValue(personalKeyAuth)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.loadWorkspaceContext.mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    mocks.getChatDeploymentWithWorkspace.mockResolvedValue({
      chat: chatRow(),
      workspaceId: WORKSPACE_ID,
    })
    mocks.getIdentifierOwner.mockResolvedValue(null)
    mocks.updateChatDeploymentRow.mockImplementation(async (_id, values) => chatRow({ ...values }))
    mocks.getWorkflowDeploymentSummary.mockResolvedValue({
      activeDeployment: { deploymentVersionId: 'dv-1', version: 1, deployedAt: null },
      latestDeploymentAttempt: null,
      warnings: [],
    })
    mocks.checkNeedsRedeployment.mockResolvedValue(false)
    mocks.performFullDeploy.mockResolvedValue({
      success: true,
      version: 2,
      latestDeploymentAttempt: { status: 'active' },
    })
    mocks.performChatUndeploy.mockResolvedValue({ success: true })
    mocks.validateChatDeployAuth.mockResolvedValue(undefined)
    encryptionMockFns.mockEncryptSecret.mockResolvedValue({ encrypted: 'encrypted-password' })
  })

  describe('GET', () => {
    it('serves the deployment without its password', async () => {
      mocks.getChatDeploymentWithWorkspace.mockResolvedValue({
        chat: chatRow({ authType: 'password', password: 'encrypted-secret' }),
        workspaceId: WORKSPACE_ID,
      })

      const response = await get()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data).toMatchObject({ id: CHAT_ID, hasPassword: true })
      expect(JSON.stringify(body)).not.toContain('encrypted-secret')
    })

    it('conceals a deployment in another workspace as 404', async () => {
      mocks.resolvePermission.mockResolvedValue(null)

      const response = await get()

      expect(response.status).toBe(404)
      expect((await response.json()).error.message).toBe('Chat deployment not found')
    })

    it('rejects an unauthenticated request', async () => {
      v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

      expect((await get()).status).toBe(401)
    })
  })

  describe('PATCH', () => {
    it('returns the settled deployment', async () => {
      const response = await patch({ title: 'Billing support' })

      expect(response.status).toBe(200)
      expect((await response.json()).data).toMatchObject({
        id: CHAT_ID,
        title: 'Billing support',
        workspaceId: WORKSPACE_ID,
      })
      expect(mocks.audit).toHaveBeenCalledTimes(1)
    })

    it('rejects a body that would change nothing', async () => {
      const response = await patch({})

      expect(response.status).toBe(400)
      expect(JSON.stringify(await response.json())).toContain('At least one field must be provided')
      expect(mocks.updateChatDeploymentRow).not.toHaveBeenCalled()
    })

    /** The deployment is bound to its workflow, so the body offers no way to move it. */
    it('rejects an attempt to re-point the deployment at another workflow', async () => {
      const response = await patch({ workflowId: 'workflow-2' })

      expect(response.status).toBe(400)
      expect(mocks.updateChatDeploymentRow).not.toHaveBeenCalled()
    })

    describe('auth-type field-clearing matrix', () => {
      it('clears both gates when switching to public', async () => {
        mocks.getChatDeploymentWithWorkspace.mockResolvedValue({
          chat: chatRow({ authType: 'email', allowedEmails: ['a@example.com'] }),
          workspaceId: WORKSPACE_ID,
        })

        await patch({ authType: 'public' })

        expect(writtenValues()).toMatchObject({
          authType: 'public',
          password: null,
          allowedEmails: [],
        })
      })

      it('clears the allow-list when switching to password', async () => {
        mocks.getChatDeploymentWithWorkspace.mockResolvedValue({
          chat: chatRow({ authType: 'email', allowedEmails: ['a@example.com'] }),
          workspaceId: WORKSPACE_ID,
        })

        await patch({ authType: 'password', password: 'secret' })

        expect(writtenValues()).toMatchObject({
          authType: 'password',
          allowedEmails: [],
          password: 'encrypted-password',
        })
      })

      it.each(['email', 'sso'] as const)(
        'clears the password when switching to %s',
        async (authType) => {
          mocks.getChatDeploymentWithWorkspace.mockResolvedValue({
            chat: chatRow({ authType: 'password', password: 'encrypted' }),
            workspaceId: WORKSPACE_ID,
          })

          await patch({ authType, allowedEmails: ['a@example.com'] })

          expect(writtenValues()).toMatchObject({ authType, password: null })
        }
      )

      it('never stores a password on a chat that is not password-gated', async () => {
        mocks.getChatDeploymentWithWorkspace.mockResolvedValue({
          chat: chatRow({ authType: 'password', password: 'encrypted' }),
          workspaceId: WORKSPACE_ID,
        })

        await patch({ authType: 'email', allowedEmails: ['a@example.com'], password: 'secret' })

        expect(writtenValues().password).toBeNull()
        expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
      })

      it('refuses password protection with nothing to protect it with', async () => {
        const response = await patch({ authType: 'password' })

        expect(response.status).toBe(400)
        expect((await response.json()).error.message).toBe(
          'Password is required when using password protection'
        )
      })
    })

    it('names a blocked auth mode with an actionable forbidden code', async () => {
      mocks.validateChatDeployAuth.mockRejectedValue(new ChatDeployAuthNotAllowedError())

      const response = await patch({ authType: 'email', allowedEmails: ['a@example.com'] })

      expect(response.status).toBe(403)
      expect((await response.json()).error.details.code).toBe('CHAT_AUTH_MODE_NOT_PERMITTED')
      expect(mocks.updateChatDeploymentRow).not.toHaveBeenCalled()
    })

    /** The internal editor answers 400 for the same domain error; the public API says 409. */
    it('reports an identifier collision as 409', async () => {
      mocks.getIdentifierOwner.mockResolvedValue('other-chat')

      const response = await patch({ identifier: 'taken' })

      expect(response.status).toBe(409)
      expect((await response.json()).error.message).toBe('Identifier already in use')
    })

    describe('redeploy gating', () => {
      it('answers 409 while a deployment attempt is in flight, admitting no new version', async () => {
        mocks.getWorkflowDeploymentSummary.mockResolvedValue({
          activeDeployment: null,
          latestDeploymentAttempt: { status: 'activating' },
          warnings: [],
        })

        const response = await patch({ title: 'Billing support' })

        expect(response.status).toBe(409)
        expect(mocks.performFullDeploy).not.toHaveBeenCalled()
        expect(mocks.updateChatDeploymentRow).not.toHaveBeenCalled()
      })

      it('answers 409 when the admitted deploy has not cut over, leaving the row untouched', async () => {
        mocks.checkNeedsRedeployment.mockResolvedValue(true)
        mocks.performFullDeploy.mockResolvedValue({
          success: true,
          version: 2,
          warnings: ['Webhook sync still pending'],
          latestDeploymentAttempt: { status: 'preparing' },
        })

        const response = await patch({ title: 'Billing support' })

        expect(response.status).toBe(409)
        expect((await response.json()).error.message).toBe('Webhook sync still pending')
        expect(mocks.updateChatDeploymentRow).not.toHaveBeenCalled()
        expect(mocks.audit).not.toHaveBeenCalled()
      })
    })

    it('rejects a workspace API key before canonical loading', async () => {
      v2RouteMocks.authenticate.mockResolvedValue(workspaceKeyAuth)

      const response = await patch({ title: 'Billing support' })

      expect(response.status).toBe(403)
      expect(mocks.getChatDeploymentWithWorkspace).not.toHaveBeenCalled()
    })

    it('refuses a caller below workspace admin with 403', async () => {
      mocks.resolvePermission.mockResolvedValue('write')

      const response = await patch({ title: 'Billing support' })

      expect(response.status).toBe(403)
      expect((await response.json()).error.details.code).toBe('INSUFFICIENT_WORKSPACE_ROLE')
    })
  })

  describe('DELETE', () => {
    it('stops the deployment serving and records one audit entry', async () => {
      const response = await del()

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ data: { id: CHAT_ID, deleted: true } })
      expect(mocks.performChatUndeploy).toHaveBeenCalledWith({
        chatId: CHAT_ID,
        userId: 'user-1',
        workspaceId: WORKSPACE_ID,
        projectLegacyAudit: false,
      })
      expect(mocks.audit).toHaveBeenCalledTimes(1)
    })

    it('conceals a deployment the caller cannot reach as 404', async () => {
      mocks.resolvePermission.mockResolvedValue(null)

      const response = await del()

      expect(response.status).toBe(404)
      expect(mocks.performChatUndeploy).not.toHaveBeenCalled()
    })

    it('rejects a workspace API key before canonical loading', async () => {
      v2RouteMocks.authenticate.mockResolvedValue(workspaceKeyAuth)

      const response = await del()

      expect(response.status).toBe(403)
      expect(mocks.getChatDeploymentWithWorkspace).not.toHaveBeenCalled()
    })
  })
})
