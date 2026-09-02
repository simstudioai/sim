/**
 * Tests for the internal chat-deployment management routes.
 *
 * These are adapters over `lib/chat-deployments/application`, so the seams
 * mocked here are the canonical reads, the workspace permission resolver, and
 * the deployment orchestration — not a route-local access helper.
 *
 * @vitest-environment node
 */
import {
  auditMock,
  auditMockFns,
  authMockFns,
  encryptionMock,
  encryptionMockFns,
  resetDbChainMock,
  resetEnvFlagsMock,
  resetEnvMock,
  setEnv,
  setEnvFlags,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PermissionGroupCapabilityError } from '@/lib/permission-groups/capability-error'

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
}))

vi.mock('@sim/audit', () => auditMock)
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
vi.mock('@/ee/access-control/utils/permission-check', () => ({
  validateChatDeployAuth: mocks.validateChatDeployAuth,
}))

import { chatDeploymentOperations } from '@/lib/chat-deployments/application'
import { DELETE, GET, PATCH } from '@/app/api/chat/manage/[id]/route'

const CHAT_ID = 'chat-123'
const WORKFLOW_ID = 'workflow-1'
const WORKSPACE_ID = 'workspace-1'

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
    outputConfigs: [{ blockId: 'block-1', path: 'output' }],
    includeThinking: false,
    includeToolCalls: false,
    archivedAt: null,
    createdAt: new Date('2026-06-12T10:30:00.000Z'),
    updatedAt: new Date('2026-06-12T10:30:00.000Z'),
    ...overrides,
  }
}

function patchRequest(body: unknown) {
  return new NextRequest(`http://localhost:3000/api/chat/manage/${CHAT_ID}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ id: CHAT_ID }) }

async function patch(body: unknown) {
  return PATCH(patchRequest(body), { params: Promise.resolve({ id: CHAT_ID }) })
}

/** The column values the update use case settled on, as written to the row. */
function writtenValues(): Record<string, unknown> {
  return mocks.updateChatDeploymentRow.mock.calls[0][1]
}

beforeAll(() => {
  setEnvFlags({ isDev: true })
  setEnv({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })
})

afterAll(() => {
  resetEnvFlagsMock()
  resetEnvMock()
})

describe('internal chat deployment routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'admin-1', name: 'Admin', email: 'admin@example.com' },
      session: { id: 'session-1' },
    })
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

  /**
   * The read serves the visitor gate — `allowedEmails`, `authType`,
   * `hasPassword`, and the customization blob — which this surface has always
   * required workspace admin for. Its siblings pin their role; this one did not,
   * which is why a demotion to `read` went unnoticed.
   */
  it('keeps every chat-deployment operation an admin operation', () => {
    expect(chatDeploymentOperations.read.minimumRole).toBe('admin')
    expect(chatDeploymentOperations.update.minimumRole).toBe('admin')
    expect(chatDeploymentOperations.delete.minimumRole).toBe('admin')
  })

  describe('GET', () => {
    it('returns 401 when there is no session', async () => {
      authMockFns.mockGetSession.mockResolvedValue(null)

      const response = await GET(
        new NextRequest(`http://localhost:3000/api/chat/manage/${CHAT_ID}`),
        params
      )

      expect(response.status).toBe(401)
      expect(mocks.getChatDeploymentWithWorkspace).not.toHaveBeenCalled()
    })

    it('serves the deployment without its password and with the public URL', async () => {
      mocks.getChatDeploymentWithWorkspace.mockResolvedValue({
        chat: chatRow({ password: 'encrypted', authType: 'password' }),
        workspaceId: WORKSPACE_ID,
      })

      const response = await GET(
        new NextRequest(`http://localhost:3000/api/chat/manage/${CHAT_ID}`),
        params
      )
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toMatchObject({
        id: CHAT_ID,
        identifier: 'support',
        title: 'Support chat',
        hasPassword: true,
        chatUrl: 'http://localhost:3000/chat/support',
        isActive: true,
      })
      expect(body).not.toHaveProperty('password')
    })

    it('answers 404 for a deployment the caller cannot reach', async () => {
      mocks.resolvePermission.mockResolvedValue(null)

      const response = await GET(
        new NextRequest(`http://localhost:3000/api/chat/manage/${CHAT_ID}`),
        params
      )

      expect(response.status).toBe(404)
    })

    it('answers 404 for a deployment that does not exist', async () => {
      mocks.getChatDeploymentWithWorkspace.mockResolvedValue(null)

      const response = await GET(
        new NextRequest(`http://localhost:3000/api/chat/manage/${CHAT_ID}`),
        params
      )

      expect(response.status).toBe(404)
    })

    /**
     * Both tests above assert only the status, which is what let the two 404s
     * drift apart: the domain answered an absent deployment with its own
     * wording while the concealment policy rewrote an unreachable one, so the
     * body — and the `code` derived from it — told a caller which of the two it
     * had hit. Comparing the responses is the assertion that keeps them one
     * answer.
     */
    it('answers a missing and an unreachable deployment identically', async () => {
      mocks.getChatDeploymentWithWorkspace.mockResolvedValue(null)
      const missing = await GET(
        new NextRequest(`http://localhost:3000/api/chat/manage/${CHAT_ID}`),
        params
      )
      const missingBody = await missing.json()

      mocks.getChatDeploymentWithWorkspace.mockResolvedValue({
        chat: chatRow(),
        workspaceId: WORKSPACE_ID,
      })
      mocks.resolvePermission.mockResolvedValue(null)
      const unreachable = await GET(
        new NextRequest(`http://localhost:3000/api/chat/manage/${CHAT_ID}`),
        params
      )
      const unreachableBody = await unreachable.json()

      expect(missing.status).toBe(unreachable.status)
      expect(missingBody).toEqual(unreachableBody)
      expect(missingBody.error).toBe('Chat not found or access denied')
    })

    it('refuses a workspace member below admin the gate configuration', async () => {
      mocks.resolvePermission.mockResolvedValue('read')

      const response = await GET(
        new NextRequest(`http://localhost:3000/api/chat/manage/${CHAT_ID}`),
        params
      )

      expect(response.status).toBe(403)
    })
  })

  describe('PATCH', () => {
    it('returns 401 when there is no session', async () => {
      authMockFns.mockGetSession.mockResolvedValue(null)

      const response = await patch({ title: 'New title' })

      expect(response.status).toBe(401)
      expect(mocks.updateChatDeploymentRow).not.toHaveBeenCalled()
    })

    it('updates the deployment and returns its public URL', async () => {
      const response = await patch({ title: 'New title', identifier: 'support-v2' })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        id: CHAT_ID,
        chatUrl: 'http://localhost:3000/chat/support-v2',
        message: 'Chat deployment updated successfully',
      })
      expect(writtenValues()).toMatchObject({ title: 'New title', identifier: 'support-v2' })
    })

    /**
     * Restored verbatim from the pre-extraction suite: the editor renders
     * `error` directly, so a contract refusal has to name the field it refused
     * rather than the generic "Validation error" the route builder renders by
     * default — and body validation runs before anything reads or encrypts.
     */
    it('rejects a whitespace-only replacement password', async () => {
      const response = await patch({ authType: 'password', password: '   ' })

      expect(response.status).toBe(400)
      expect((await response.json()).error).toBe('Password cannot contain only whitespace')
      expect(mocks.getChatDeploymentWithWorkspace).not.toHaveBeenCalled()
      expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
    })

    it('names the field an identifier refusal rejected', async () => {
      const response = await patch({ identifier: 'Support Chat' })

      expect(response.status).toBe(400)
      expect((await response.json()).error).toBe(
        'Identifier can only contain lowercase letters, numbers, and hyphens'
      )
      expect(mocks.getChatDeploymentWithWorkspace).not.toHaveBeenCalled()
    })

    it('refuses to re-point the deployment at a different workflow', async () => {
      const response = await patch({ workflowId: 'workflow-2' })

      expect(response.status).toBe(400)
      expect((await response.json()).error).toBe(
        'Changing the workflow of a chat deployment is not allowed'
      )
      expect(mocks.updateChatDeploymentRow).not.toHaveBeenCalled()
    })

    it('answers 404 for a deployment the caller cannot reach', async () => {
      mocks.resolvePermission.mockResolvedValue(null)

      const response = await patch({ title: 'New title' })

      expect(response.status).toBe(404)
      expect(mocks.updateChatDeploymentRow).not.toHaveBeenCalled()
    })

    it('refuses a workspace member below admin', async () => {
      mocks.resolvePermission.mockResolvedValue('write')

      const response = await patch({ title: 'New title' })

      expect(response.status).toBe(403)
      expect(mocks.updateChatDeploymentRow).not.toHaveBeenCalled()
    })

    describe('auth-type field-clearing matrix', () => {
      /**
       * Each mode owns exactly one gate column, so switching must clear the
       * other. A leftover password on an email-gated chat, or a leftover
       * allow-list on a public one, is a stale gate nothing else erases.
       */
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

        await patch({ authType: 'password', password: 'valid-password-secret' })

        const values = writtenValues()
        expect(values.authType).toBe('password')
        expect(values.allowedEmails).toEqual([])
        expect(values.password).toBe('encrypted-password')
      })

      it.each(['email', 'sso'] as const)(
        'clears the password when switching to %s',
        async (authType) => {
          mocks.getChatDeploymentWithWorkspace.mockResolvedValue({
            chat: chatRow({ authType: 'password', password: 'encrypted' }),
            workspaceId: WORKSPACE_ID,
          })

          await patch({ authType, allowedEmails: ['a@example.com'] })

          expect(writtenValues()).toMatchObject({
            authType,
            password: null,
            allowedEmails: ['a@example.com'],
          })
        }
      )

      /**
       * The regression this matrix exists for: a password sent alongside a
       * non-password mode used to re-arm the secret the matrix had just
       * cleared.
       */
      it('never stores a supplied password on a chat that is not password-gated', async () => {
        mocks.getChatDeploymentWithWorkspace.mockResolvedValue({
          chat: chatRow({ authType: 'password', password: 'encrypted' }),
          workspaceId: WORKSPACE_ID,
        })

        await patch({
          authType: 'email',
          allowedEmails: ['a@example.com'],
          password: 'valid-password-secret',
        })

        expect(writtenValues().password).toBeNull()
        expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
      })

      it('leaves the stored password untouched when nothing about it changes', async () => {
        mocks.getChatDeploymentWithWorkspace.mockResolvedValue({
          chat: chatRow({ authType: 'password', password: 'encrypted' }),
          workspaceId: WORKSPACE_ID,
        })

        await patch({ title: 'New title' })

        expect(writtenValues()).not.toHaveProperty('password')
        expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
      })

      it('re-encrypts a replacement password for a password-gated chat', async () => {
        mocks.getChatDeploymentWithWorkspace.mockResolvedValue({
          chat: chatRow({ authType: 'password', password: 'old-encrypted' }),
          workspaceId: WORKSPACE_ID,
        })

        await patch({ password: 'new-valid-password' })

        expect(encryptionMockFns.mockEncryptSecret).toHaveBeenCalledWith('new-valid-password')
        expect(writtenValues().password).toBe('encrypted-password')
      })

      it('refuses password protection with nothing to protect it with', async () => {
        const response = await patch({ authType: 'password' })

        expect(response.status).toBe(400)
        expect((await response.json()).error).toBe(
          'Password is required when using password protection'
        )
        expect(mocks.updateChatDeploymentRow).not.toHaveBeenCalled()
      })
    })

    it('checks the auth-mode allow-list only when the mode changes', async () => {
      await patch({ authType: 'public', title: 'New title' })

      expect(mocks.validateChatDeployAuth).not.toHaveBeenCalled()
    })

    it('refuses a mode the permission group blocks', async () => {
      mocks.validateChatDeployAuth.mockRejectedValue(
        new PermissionGroupCapabilityError(
          'deploy.chat.auth_mode',
          'CHAT_AUTH_MODE_NOT_PERMITTED',
          "This chat authentication mode is not available under your organization's permission group"
        )
      )

      const response = await patch({ authType: 'email', allowedEmails: ['a@example.com'] })

      expect(response.status).toBe(403)
      expect(mocks.updateChatDeploymentRow).not.toHaveBeenCalled()
      expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
    })

    /**
     * A uniqueness conflict, reported to this surface as the `400` its client
     * has always recognised. The public API reports the same domain error as a
     * `409`.
     */
    it('reports an identifier collision as 400', async () => {
      mocks.getIdentifierOwner.mockResolvedValue('other-chat')

      const response = await patch({ identifier: 'taken' })

      expect(response.status).toBe(400)
      expect((await response.json()).error).toBe('Identifier already in use')
      expect(mocks.updateChatDeploymentRow).not.toHaveBeenCalled()
    })

    it('allows re-saving the identifier the deployment already holds', async () => {
      mocks.getIdentifierOwner.mockResolvedValue('other-chat')

      const response = await patch({ identifier: 'support' })

      expect(response.status).toBe(200)
      expect(mocks.getIdentifierOwner).not.toHaveBeenCalled()
    })

    describe('redeploy gating', () => {
      it('refuses with 409 while a deployment attempt is in flight, admitting no new version', async () => {
        mocks.getWorkflowDeploymentSummary.mockResolvedValue({
          activeDeployment: null,
          latestDeploymentAttempt: { status: 'preparing' },
          warnings: [],
        })

        const response = await patch({ title: 'New title' })

        expect(response.status).toBe(409)
        expect((await response.json()).error).toBe(
          'A workflow deployment is still preparing. Retry the chat update after it becomes active.'
        )
        expect(mocks.performFullDeploy).not.toHaveBeenCalled()
        expect(mocks.updateChatDeploymentRow).not.toHaveBeenCalled()
      })

      /**
       * A deploy settles asynchronously, so `success` only admits the attempt.
       * Advancing the chat row before cutover would strand it on the previous
       * version with no error.
       */
      it('refuses with 409 when the admitted deploy has not cut over, leaving the row untouched', async () => {
        mocks.checkNeedsRedeployment.mockResolvedValue(true)
        mocks.performFullDeploy.mockResolvedValue({
          success: true,
          version: 2,
          warnings: ['Webhook sync still pending'],
          latestDeploymentAttempt: { status: 'preparing' },
        })

        const response = await patch({ title: 'New title' })

        expect(response.status).toBe(409)
        expect((await response.json()).error).toBe('Webhook sync still pending')
        expect(mocks.updateChatDeploymentRow).not.toHaveBeenCalled()
        expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
      })

      it('skips redeploying when the live version already matches the draft', async () => {
        const response = await patch({ title: 'New title' })

        expect(response.status).toBe(200)
        expect(mocks.performFullDeploy).not.toHaveBeenCalled()
      })

      it('redeploys when the draft has drifted', async () => {
        mocks.checkNeedsRedeployment.mockResolvedValue(true)

        const response = await patch({ title: 'New title' })

        expect(response.status).toBe(200)
        expect(mocks.performFullDeploy).toHaveBeenCalledWith({
          workflowId: WORKFLOW_ID,
          userId: 'admin-1',
        })
      })

      it('surfaces a redeploy validation failure as 400', async () => {
        mocks.checkNeedsRedeployment.mockResolvedValue(true)
        mocks.performFullDeploy.mockResolvedValue({
          success: false,
          errorCode: 'validation',
          error: 'Workflow has no start block',
        })

        const response = await patch({ title: 'New title' })

        expect(response.status).toBe(400)
        expect((await response.json()).error).toBe('Workflow has no start block')
      })
    })

    it('records one audit entry derived from the authoritative row', async () => {
      await patch({ title: 'New title', identifier: 'support-v2' })

      expect(auditMockFns.mockRecordAudit).toHaveBeenCalledTimes(1)
      expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: WORKSPACE_ID,
          resourceId: CHAT_ID,
          resourceName: 'New title',
          metadata: expect.objectContaining({
            identifier: 'support-v2',
            chatUrl: 'http://localhost:3000/chat/support-v2',
          }),
        })
      )
    })
  })

  describe('DELETE', () => {
    it('returns 401 when there is no session', async () => {
      authMockFns.mockGetSession.mockResolvedValue(null)

      const response = await DELETE(
        new NextRequest(`http://localhost:3000/api/chat/manage/${CHAT_ID}`, { method: 'DELETE' }),
        params
      )

      expect(response.status).toBe(401)
      expect(mocks.performChatUndeploy).not.toHaveBeenCalled()
    })

    it('undeploys the chat within its derived workspace', async () => {
      const response = await DELETE(
        new NextRequest(`http://localhost:3000/api/chat/manage/${CHAT_ID}`, { method: 'DELETE' }),
        params
      )

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        message: 'Chat deployment deleted successfully',
      })
      expect(mocks.performChatUndeploy).toHaveBeenCalledWith({
        chatId: CHAT_ID,
        userId: 'admin-1',
        workspaceId: WORKSPACE_ID,
        projectLegacyAudit: false,
      })
      expect(auditMockFns.mockRecordAudit).toHaveBeenCalledTimes(1)
    })

    it('answers 404 for a deployment the caller cannot reach', async () => {
      mocks.resolvePermission.mockResolvedValue(null)

      const response = await DELETE(
        new NextRequest(`http://localhost:3000/api/chat/manage/${CHAT_ID}`, { method: 'DELETE' }),
        params
      )

      expect(response.status).toBe(404)
      expect(mocks.performChatUndeploy).not.toHaveBeenCalled()
    })

    it('refuses a workspace member below admin', async () => {
      mocks.resolvePermission.mockResolvedValue('write')

      const response = await DELETE(
        new NextRequest(`http://localhost:3000/api/chat/manage/${CHAT_ID}`, { method: 'DELETE' }),
        params
      )

      expect(response.status).toBe(403)
      expect(mocks.performChatUndeploy).not.toHaveBeenCalled()
    })

    /** An infrastructure fault must not be concealed as a missing deployment. */
    it('propagates an undeploy infrastructure failure as a 500', async () => {
      mocks.performChatUndeploy.mockResolvedValue({
        success: false,
        error: 'delete from "chat" failed: connection terminated',
      })

      const response = await DELETE(
        new NextRequest(`http://localhost:3000/api/chat/manage/${CHAT_ID}`, { method: 'DELETE' }),
        params
      )

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error).toBe('Failed to delete chat deployment')
      expect(JSON.stringify(body)).not.toContain('connection terminated')
      expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
    })
  })
})
