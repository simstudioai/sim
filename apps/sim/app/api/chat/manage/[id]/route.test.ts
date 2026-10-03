/**
 * Tests for the internal chat-deployment management routes.
 *
 * These are adapters over `lib/chat-deployments/application`, so the seams
 * mocked here are the canonical reads, the workspace permission resolver, and
 * the deployment orchestration — not a route-local access helper.
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
import { createRouteContext } from '@sim/testing/helpers/http'
import {
  permissionCheckMock,
  permissionCheckMockFns,
} from '@sim/testing/mocks/permission-check.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import {
  workflowDeploymentStatusMock,
  workflowDeploymentStatusMockFns,
} from '@sim/testing/mocks/workflow-deployment-status.mock'
import {
  workflowsOrchestrationMock,
  workflowsOrchestrationMockFns,
} from '@sim/testing/mocks/workflows-orchestration.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PermissionGroupCapabilityError } from '@/lib/permission-groups/capability-error'

const mocks = vi.hoisted(() => ({
  getChatDeploymentWithWorkspace: vi.fn(),
  getIdentifierOwner: vi.fn(),
  updateChatDeploymentRow: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@/lib/chat-deployments/queries', () => ({
  getChatDeploymentWithWorkspace: mocks.getChatDeploymentWithWorkspace,
  getChatDeploymentIdOwningIdentifier: mocks.getIdentifierOwner,
  updateChatDeploymentRow: mocks.updateChatDeploymentRow,
  listWorkspaceChatDeployments: vi.fn(),
}))
vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/lib/workflows/orchestration', () => workflowsOrchestrationMock)
vi.mock('@/lib/workflows/deployment-status', () => workflowDeploymentStatusMock)
vi.mock('@/ee/access-control/utils/permission-check', () => permissionCheckMock)

import { GET, PATCH } from '@/app/api/chat/manage/[id]/route'

const { mockGetWorkflowDeploymentSummary, mockPerformFullDeploy, mockPerformChatUndeploy } =
  workflowsOrchestrationMockFns
const { mockCheckNeedsRedeployment } = workflowDeploymentStatusMockFns

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
  return createMockRequest({
    method: 'PATCH',
    url: `http://localhost:3000/api/chat/manage/${CHAT_ID}`,
    body,
  })
}

const params = createRouteContext({ id: CHAT_ID })

async function patch(body: unknown) {
  return PATCH(patchRequest(body), createRouteContext({ id: CHAT_ID }))
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
    resetDbChainMock()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'admin-1', name: 'Admin', email: 'admin@example.com' },
      session: { id: 'session-1' },
    })
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('admin')
    workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext.mockResolvedValue({
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
    mockGetWorkflowDeploymentSummary.mockResolvedValue({
      activeDeployment: { deploymentVersionId: 'dv-1', version: 1, deployedAt: null },
      latestDeploymentAttempt: null,
      warnings: [],
    })
    mockCheckNeedsRedeployment.mockResolvedValue(false)
    mockPerformFullDeploy.mockResolvedValue({
      success: true,
      version: 2,
      latestDeploymentAttempt: { status: 'active' },
    })
    mockPerformChatUndeploy.mockResolvedValue({ success: true })
    permissionCheckMockFns.mockValidateChatDeployAuth.mockResolvedValue(undefined)
    encryptionMockFns.mockEncryptSecret.mockResolvedValue({ encrypted: 'encrypted-password' })
  })

  describe('GET', () => {
    it('serves the deployment without its password and with the public URL', async () => {
      mocks.getChatDeploymentWithWorkspace.mockResolvedValue({
        chat: chatRow({ password: 'encrypted', authType: 'password' }),
        workspaceId: WORKSPACE_ID,
      })

      const response = await GET(
        createMockRequest({ url: `http://localhost:3000/api/chat/manage/${CHAT_ID}` }),
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

    /**
     * Asserting only the status is what let the two 404s drift apart: the
     * domain answered an absent deployment with its own wording while the concealment policy rewrote an unreachable one, so the
     * body — and the `code` derived from it — told a caller which of the two it
     * had hit. Comparing the responses is the assertion that keeps them one
     * answer.
     */
    it('answers a missing and an unreachable deployment identically', async () => {
      mocks.getChatDeploymentWithWorkspace.mockResolvedValue(null)
      const missing = await GET(
        createMockRequest({ url: `http://localhost:3000/api/chat/manage/${CHAT_ID}` }),
        params
      )
      const missingBody = await missing.json()

      mocks.getChatDeploymentWithWorkspace.mockResolvedValue({
        chat: chatRow(),
        workspaceId: WORKSPACE_ID,
      })
      workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue(null)
      const unreachable = await GET(
        createMockRequest({ url: `http://localhost:3000/api/chat/manage/${CHAT_ID}` }),
        params
      )
      const unreachableBody = await unreachable.json()

      expect(missing.status).toBe(unreachable.status)
      expect(missingBody).toEqual(unreachableBody)
      expect(missingBody.error).toBe('Chat not found or access denied')
    })

    it('refuses a workspace member below admin the gate configuration', async () => {
      workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('read')

      const response = await GET(
        createMockRequest({ url: `http://localhost:3000/api/chat/manage/${CHAT_ID}` }),
        params
      )

      expect(response.status).toBe(403)
    })
  })

  describe('PATCH', () => {
    it('refuses to re-point the deployment at a different workflow', async () => {
      const response = await patch({ workflowId: 'workflow-2' })

      expect(response.status).toBe(400)
      expect((await response.json()).error).toBe(
        'Changing the workflow of a chat deployment is not allowed'
      )
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

    it('refuses a mode the permission group blocks', async () => {
      permissionCheckMockFns.mockValidateChatDeployAuth.mockRejectedValue(
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

    describe('redeploy gating', () => {
      it('refuses with 409 while a deployment attempt is in flight, admitting no new version', async () => {
        mockGetWorkflowDeploymentSummary.mockResolvedValue({
          activeDeployment: null,
          latestDeploymentAttempt: { status: 'preparing' },
          warnings: [],
        })

        const response = await patch({ title: 'New title' })

        expect(response.status).toBe(409)
        expect((await response.json()).error).toBe(
          'A workflow deployment is still preparing. Retry the chat update after it becomes active.'
        )
        expect(mockPerformFullDeploy).not.toHaveBeenCalled()
        expect(mocks.updateChatDeploymentRow).not.toHaveBeenCalled()
      })

      /**
       * A deploy settles asynchronously, so `success` only admits the attempt.
       * Advancing the chat row before cutover would strand it on the previous
       * version with no error.
       */
      it('refuses with 409 when the admitted deploy has not cut over, leaving the row untouched', async () => {
        mockCheckNeedsRedeployment.mockResolvedValue(true)
        mockPerformFullDeploy.mockResolvedValue({
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
    })
  })
})
