import {
  environmentUtilsMockFns,
  resetDbChainMock,
  resetEnvironmentUtilsMock,
  resetEnvMock,
  setEnv,
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
import {
  permissionCheckMock,
  permissionCheckMockFns,
} from '@sim/testing/mocks/permission-check.mock'
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
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PermissionGroupCapabilityError } from '@/lib/permission-groups/capability-error'

const mocks = vi.hoisted(() => ({
  getLiveChatDeployment: vi.fn(),
  getIdentifierOwner: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@/lib/workflows/application/context', () => workflowContextMock)
vi.mock('@/lib/chat-deployments/queries', () => ({
  listWorkspaceChatDeployments: vi.fn(),
  getLiveChatDeploymentForWorkflow: mocks.getLiveChatDeployment,
  getChatDeploymentIdOwningIdentifier: mocks.getIdentifierOwner,
  getChatDeploymentWithWorkspace: vi.fn(),
  updateChatDeploymentRow: vi.fn(),
}))
vi.mock('@/lib/workflows/orchestration', () => workflowsOrchestrationMock)
vi.mock('@/ee/access-control/utils/permission-check', () => permissionCheckMock)
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { markCopilotRequest } from '@/lib/api/server/routes/copilot-request'
import { performChatDeploy as realPerformChatDeploy } from '@/lib/workflows/orchestration/chat-deploy'
import { DELETE, GET, PUT } from '@/app/api/v2/workflows/[workflowId]/deployments/chat/route'

const { mockPerformChatDeploy, mockPerformChatUndeploy } = workflowsOrchestrationMockFns

const WORKSPACE_ID = 'workspace-1'
const WORKFLOW_ID = 'workflow-1'
const PATH = `http://localhost/api/v2/workflows/${WORKFLOW_ID}/deployments/chat`

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

const routeContext = createRouteContext({ workflowId: WORKFLOW_ID })

const get = () => GET(new NextRequest(PATH), routeContext)
const del = () => DELETE(new NextRequest(PATH, { method: 'DELETE' }), routeContext)
const put = (body: unknown) =>
  PUT(
    new NextRequest(PATH, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    routeContext
  )

/** The shape the `postgres` driver throws when a partial unique index rejects a write. */
function uniqueViolation(constraint: string) {
  return Object.assign(
    new Error(`duplicate key value violates unique constraint "${constraint}"`),
    { code: '23505', constraint_name: constraint }
  )
}

const validBody = { identifier: 'support', title: 'Support chat' }

describe('/api/v2/workflows/[workflowId]/deployments/chat', () => {
  afterEach(resetEnvMock)
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
      workflow: {
        id: WORKFLOW_ID,
        name: 'Support',
        workspaceId: WORKSPACE_ID,
        isDeployed: true,
      },
    })
    mocks.getLiveChatDeployment.mockResolvedValue(chatRow())
    mocks.getIdentifierOwner.mockResolvedValue(null)
    permissionCheckMockFns.mockValidateChatDeployAuth.mockResolvedValue(undefined)
    mockPerformChatDeploy.mockResolvedValue({
      success: true,
      chatId: 'chat-1',
      chatUrl: 'http://localhost:3000/chat/support',
      isUpdate: false,
    })
    mockPerformChatUndeploy.mockResolvedValue({ success: true })
  })

  describe('GET', () => {
    it("publishes the workflow's chat with its public URL and no password", async () => {
      mocks.getLiveChatDeployment.mockResolvedValue(
        chatRow({ authType: 'password', password: 'encrypted-secret' })
      )

      const response = await get()

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.data).toMatchObject({
        id: 'chat-1',
        workflowId: WORKFLOW_ID,
        workspaceId: WORKSPACE_ID,
        identifier: 'support',
        url: expect.stringContaining('/chat/support'),
        hasPassword: true,
      })
      expect(JSON.stringify(body)).not.toContain('encrypted-secret')
    })

    it('answers 404 when the workflow publishes no chat', async () => {
      mocks.getLiveChatDeployment.mockResolvedValue(null)

      const response = await get()

      expect(response.status).toBe(404)
      expect((await response.json()).error.code).toBe('NOT_FOUND')
    })

    it('reports the chat inactive when its workflow is undeployed', async () => {
      workflowContextMockFns.mockResolveActiveWorkflowApplicationContext.mockResolvedValue({
        ...workspaceContext,
        workflowId: WORKFLOW_ID,
        workflow: {
          id: WORKFLOW_ID,
          name: 'Support',
          workspaceId: WORKSPACE_ID,
          isDeployed: false,
        },
      })

      const body = await (await get()).json()

      expect(body.data.isActive).toBe(false)
    })

    /** The gate configuration it carries is admin-only, unlike the workspace list. */
    it('refuses a caller below workspace admin with 403', async () => {
      workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('write')

      const response = await get()

      expect(response.status).toBe(403)
      expect((await response.json()).error.details.code).toBe('INSUFFICIENT_WORKSPACE_ROLE')
    })
  })

  describe('PUT', () => {
    it('returns the configured www chat URL to CLI callers on deploy and read', async () => {
      setEnv({ NEXT_PUBLIC_APP_URL: 'https://www.dev.sim.ai' })
      mocks.getLiveChatDeployment.mockResolvedValueOnce(null).mockResolvedValue(chatRow())

      for (const response of [await put(validBody), await get()]) {
        expect(response.status).toBe(200)
        expect((await response.json()).data.url).toBe('https://www.dev.sim.ai/chat/support')
      }
    })

    it('creates the chat when the workflow publishes none', async () => {
      mocks.getLiveChatDeployment.mockResolvedValueOnce(null).mockResolvedValue(chatRow())

      const response = await put(validBody)

      expect(response.status).toBe(200)
      expect((await response.json()).data).toMatchObject({
        id: 'chat-1',
        workspaceId: WORKSPACE_ID,
        identifier: 'support',
        url: expect.stringContaining('/chat/support'),
      })
      expect(auditMockFns.mockRecordAudit).toHaveBeenCalledTimes(1)
    })

    /**
     * The defining property of the verb, and the one a merge-shaped
     * implementation would silently break: an omitted optional field must take
     * its platform default, never the value the previous deployment carried.
     */
    it('replaces wholesale rather than merging the previous deployment', async () => {
      mocks.getLiveChatDeployment.mockResolvedValue(
        chatRow({
          authType: 'email',
          password: 'encrypted-secret',
          allowedEmails: ['old@example.com'],
          outputConfigs: [{ blockId: 'block-1', path: 'content' }],
          includeThinking: true,
          includeToolCalls: true,
          description: 'Previous description',
        })
      )

      await put(validBody)

      expect(mockPerformChatDeploy).toHaveBeenCalledWith(
        expect.objectContaining({
          authType: 'public',
          password: null,
          allowedEmails: [],
          outputConfigs: [],
          includeThinking: false,
          includeToolCalls: false,
          description: '',
        })
      )
    })

    it('is idempotent: the same body twice asks for the same stored state', async () => {
      await put(validBody)
      const first = mockPerformChatDeploy.mock.calls[0][0]
      mockPerformChatDeploy.mockClear()
      await put(validBody)

      expect(mockPerformChatDeploy.mock.calls[0][0]).toEqual(first)
    })

    /**
     * `password` is write-only, so a caller cannot read one back to re-send it.
     * Requiring it is what stops replace quietly carrying a secret over.
     */
    it('requires a password whenever the result is password-gated', async () => {
      const response = await put({ ...validBody, authType: 'password' })

      expect(response.status).toBe(400)
      expect((await response.json()).error.message).toBe(
        'password is required when authType is "password"'
      )
      expect(mockPerformChatDeploy).not.toHaveBeenCalled()
    })

    it('rejects a password the resulting mode would not store', async () => {
      const response = await put({ ...validBody, authType: 'email', password: 'hunter2' })

      expect(response.status).toBe(400)
      expect(JSON.stringify(await response.json())).toContain('password cannot be set')
      expect(mockPerformChatDeploy).not.toHaveBeenCalled()
    })

    it.each(['email', 'sso'])('refuses %s gating with an empty allow-list', async (authType) => {
      const response = await put({ ...validBody, authType })

      expect(response.status).toBe(400)
      expect(JSON.stringify(await response.json())).toContain('allowedEmails must contain at least')
      expect(mockPerformChatDeploy).not.toHaveBeenCalled()
    })

    it('rejects an allow-list the resulting mode would not admit', async () => {
      const response = await put({ ...validBody, allowedEmails: ['a@example.com'] })

      expect(response.status).toBe(400)
      expect(JSON.stringify(await response.json())).toContain('allowedEmails cannot be set')
      expect(mockPerformChatDeploy).not.toHaveBeenCalled()
    })

    it('reports an identifier the pre-check finds taken as 409', async () => {
      mocks.getIdentifierOwner.mockResolvedValue('other-chat')

      const response = await put(validBody)

      expect(response.status).toBe(409)
      expect((await response.json()).error.message).toBe('Identifier already in use')
      expect(mockPerformChatDeploy).not.toHaveBeenCalled()
    })

    /**
     * The race the pre-check cannot close: another caller claims the identifier
     * between the check and the write, so the partial unique index rejects this
     * one. Unclassified that surfaced as a caller-reachable `500`, which is the
     * highest-severity defect class on this surface — it is the same condition
     * the pre-check reports, so it answers the same `409`.
     */
    it('reports losing the identifier race as 409, not 500', async () => {
      mockPerformChatDeploy.mockRejectedValue(uniqueViolation('identifier_idx'))

      const response = await put(validBody)

      expect(response.status).toBe(409)
      const body = await response.json()
      expect(body.error.code).toBe('CONFLICT')
      expect(body.error.message).toContain('support')
      expect(body.error.message).toContain('choose a different identifier')
      expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
    })

    /** Only that index is the caller's conflict; any other violation is a real fault. */
    it('keeps a unique violation on a different constraint a 500', async () => {
      mockPerformChatDeploy.mockRejectedValue(uniqueViolation('chat_pkey'))

      const response = await put(validBody)

      expect(response.status).toBe(500)
      expect((await response.json()).error.code).toBe('INTERNAL_ERROR')
    })

    it('reports an in-flight workflow deployment as a conflict', async () => {
      mockPerformChatDeploy.mockResolvedValue({
        success: false,
        errorCode: 'conflict',
        error: 'A workflow deployment is still preparing.',
      })

      const response = await put(validBody)

      expect(response.status).toBe(409)
      expect((await response.json()).error.message).toContain('still preparing')
      expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
    })

    it('keeps an internal invariant failure a 500 with a generic message', async () => {
      mockPerformChatDeploy.mockResolvedValue({
        success: false,
        errorCode: 'internal',
        error: 'Workflow deployment reported active without a live deployment version.',
      })

      const response = await put(validBody)

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error.code).toBe('INTERNAL_ERROR')
      expect(JSON.stringify(body)).not.toContain('live deployment version')
    })

    it('rejects a workspace API key before canonical loading', async () => {
      v2RouteMocks.authenticate.mockResolvedValue(workspaceKeyAuth)

      const response = await put(validBody)

      expect(response.status).toBe(403)
      expect(
        workflowContextMockFns.mockResolveActiveWorkflowApplicationContext
      ).not.toHaveBeenCalled()
    })

    it('refuses a caller below workspace admin with 403', async () => {
      workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('write')

      const response = await put(validBody)

      expect(response.status).toBe(403)
      expect((await response.json()).error.details.code).toBe('INSUFFICIENT_WORKSPACE_ROLE')
      expect(mockPerformChatDeploy).not.toHaveBeenCalled()
    })

    it('names a blocked auth mode with an actionable forbidden code', async () => {
      permissionCheckMockFns.mockValidateChatDeployAuth.mockRejectedValue(
        new PermissionGroupCapabilityError(
          'deploy.chat.auth_mode',
          'CHAT_AUTH_MODE_NOT_PERMITTED',
          "This chat authentication mode is not available under your organization's permission group"
        )
      )

      const response = await put({
        ...validBody,
        authType: 'email',
        allowedEmails: ['a@example.com'],
      })

      expect(response.status).toBe(403)
      expect((await response.json()).error.details.code).toBe('CHAT_AUTH_MODE_NOT_PERMITTED')
      expect(mockPerformChatDeploy).not.toHaveBeenCalled()
    })

    /** A mode already stored can be re-saved without re-clearing the allow-list check. */
    it('does not re-check an auth mode the chat already carries', async () => {
      mocks.getLiveChatDeployment.mockResolvedValue(chatRow({ authType: 'public' }))

      await put(validBody)

      expect(permissionCheckMockFns.mockValidateChatDeployAuth).not.toHaveBeenCalled()
    })

    describe('password references', () => {
      const passwordBody = (password: string) => ({ ...validBody, authType: 'password', password })

      /** Admitted exactly as the Sim agent's in-process CLI transport admits its calls. */
      const agentPut = (body: unknown) => {
        const request = new NextRequest(PATH, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        markCopilotRequest(request, { userId: 'user-1', workspaceId: WORKSPACE_ID, chatId: 'c-1' })
        return PUT(request, routeContext)
      }

      const environment = (variables: Record<string, string>) =>
        environmentUtilsMockFns.mockResolveEffectiveEnvironmentVariables.mockResolvedValueOnce(
          Object.fromEntries(
            Object.entries(variables).map(([name, value]) => [
              name,
              { value, scope: 'workspace', visible: false },
            ])
          )
        )

      afterEach(resetEnvironmentUtilsMock)

      it("deploys with the value of the agent's referenced variable", async () => {
        environment({ CHAT_PW: 'resolved-chat-password' })

        const response = await agentPut(passwordBody('{{CHAT_PW}}'))

        expect(response.status).toBe(200)
        expect(
          environmentUtilsMockFns.mockResolveEffectiveEnvironmentVariables
        ).toHaveBeenCalledWith('user-1', WORKSPACE_ID, ['CHAT_PW'])
        expect(mockPerformChatDeploy.mock.calls[0][0].password).toBe('resolved-chat-password')
      })

      it('refuses an unset variable by name instead of deploying the placeholder', async () => {
        const response = await agentPut(passwordBody('{{CHAT_PW}}'))

        expect(response.status).toBe(400)
        expect((await response.json()).error.message).toBe(
          'Environment variable "CHAT_PW" referenced by password is not set for this workspace or user. Set it first, or pass the raw value.'
        )
        expect(mockPerformChatDeploy).not.toHaveBeenCalled()
      })

      it('holds the resolved value to the chat password rules', async () => {
        mockPerformChatDeploy.mockImplementation(realPerformChatDeploy)
        environment({ CHAT_PW: 'short' })

        const response = await agentPut(passwordBody('{{CHAT_PW}}'))

        expect(response.status).toBe(400)
        expect((await response.json()).error.message).toBe(
          'Password must be at least 15 characters'
        )
      })

      it('keeps a reference literal for an API key caller, under the same rules', async () => {
        mockPerformChatDeploy.mockImplementation(realPerformChatDeploy)

        const response = await put(passwordBody('{{SHORT}}'))

        expect(response.status).toBe(400)
        expect((await response.json()).error.message).toBe(
          'Password must be at least 15 characters'
        )
        expect(
          environmentUtilsMockFns.mockResolveEffectiveEnvironmentVariables
        ).not.toHaveBeenCalled()
      })

      it('stores a long literal reference verbatim for an API key caller', async () => {
        const response = await put(passwordBody('{{A_LONG_LITERAL_NAME}}'))

        expect(response.status).toBe(200)
        expect(mockPerformChatDeploy.mock.calls[0][0].password).toBe('{{A_LONG_LITERAL_NAME}}')
        expect(
          environmentUtilsMockFns.mockResolveEffectiveEnvironmentVariables
        ).not.toHaveBeenCalled()
      })
    })
  })

  describe('DELETE', () => {
    it('stops the chat serving and leaves the workflow deployment alone', async () => {
      const response = await del()

      expect(response.status).toBe(200)
      expect((await response.json()).data).toEqual({ id: 'chat-1', deleted: true })
      expect(mockPerformChatUndeploy).toHaveBeenCalledWith(
        expect.objectContaining({ chatId: 'chat-1', workspaceId: WORKSPACE_ID })
      )
    })

    it('answers 404 when the workflow publishes no chat', async () => {
      mocks.getLiveChatDeployment.mockResolvedValue(null)

      expect((await del()).status).toBe(404)
      expect(mockPerformChatUndeploy).not.toHaveBeenCalled()
    })

    /** An infrastructure failure must not read as "the chat is already gone". */
    it('keeps a non-not-found undeploy failure a 500', async () => {
      mockPerformChatUndeploy.mockResolvedValue({
        success: false,
        errorCode: 'internal',
        error: 'storage unavailable',
      })

      expect((await del()).status).toBe(500)
    })

    it('refuses a caller below workspace admin with 403', async () => {
      workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('write')

      expect((await del()).status).toBe(403)
      expect(mockPerformChatUndeploy).not.toHaveBeenCalled()
    })
  })
})
