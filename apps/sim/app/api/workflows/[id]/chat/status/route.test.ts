/**
 * Tests for the workflow chat-deployment status route.
 *
 * The route is an adapter over `chat_deployments.list`, so the seams mocked here
 * are the canonical workflow/deployment reads and the workspace permission
 * resolver — not a route-local access helper.
 */
import { createRouteContext } from '@sim/testing/helpers/http'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { resetEnvMock, setEnv } from '@sim/testing/mocks/env.mock'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { schemaMock } from '@sim/testing/mocks/schema.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  getLiveChatDeploymentForWorkflow: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@/lib/chat-deployments/queries', () => ({
  getLiveChatDeploymentForWorkflow: hoisted.getLiveChatDeploymentForWorkflow,
  getChatDeploymentWithWorkspace: vi.fn(),
  getChatDeploymentIdOwningIdentifier: vi.fn(),
  updateChatDeploymentRow: vi.fn(),
  listWorkspaceChatDeployments: vi.fn(),
}))

import { GET } from '@/app/api/workflows/[id]/chat/status/route'

const mocks = {
  ...hoisted,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  loadWorkspaceContext: workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext,
}

const WORKFLOW_ID = 'workflow-1'
const WORKSPACE_ID = 'workspace-1'
const CHAT_ID = 'chat-123'

const params = createRouteContext({ id: WORKFLOW_ID })

function request() {
  return createMockRequest({ url: `/api/workflows/${WORKFLOW_ID}/chat/status` })
}

/** A deployment configured with every field the admin-gated read serves. */
function chatRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CHAT_ID,
    workflowId: WORKFLOW_ID,
    userId: 'owner-1',
    identifier: 'victim-support',
    title: 'Support',
    description: 'Ask us anything',
    isActive: true,
    customizations: { primaryColor: '#000', welcomeMessage: 'Hi' },
    authType: 'email',
    password: 'encrypted-secret',
    allowedEmails: ['ceo@victim-corp.com', '@victim-corp.com'],
    outputConfigs: [{ blockId: 'block-1', path: 'output' }],
    includeThinking: true,
    includeToolCalls: null,
    archivedAt: null,
    createdAt: new Date('2026-06-12T10:30:00.000Z'),
    updatedAt: new Date('2026-06-12T10:30:00.000Z'),
    ...overrides,
  }
}

beforeAll(() => {
  setEnvFlags({ isDev: true })
  setEnv({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })
})

afterAll(() => {
  resetEnvFlagsMock()
  resetEnvMock()
})

describe('workflow chat deployment status route', () => {
  beforeEach(() => {
    resetDbChainMock()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'member-1', name: 'Member', email: 'member@example.com' },
      session: { id: 'session-1' },
    })
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.loadWorkspaceContext.mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    mocks.getLiveChatDeploymentForWorkflow.mockResolvedValue(chatRow())
    queueTableRows(schemaMock.workflow, [
      { workflowId: WORKFLOW_ID, workflow: { id: WORKFLOW_ID }, workspaceId: WORKSPACE_ID },
    ])
  })

  /**
   * The regression this route was: it re-implemented the admin-gated detail
   * projection inline at workflow `read`, so any workspace viewer could read
   * the `allowedEmails` allow-list, `hasPassword`, and the customization blob
   * of a chat exposed to the open internet. The exact-shape assertion is the
   * guard — the projection must not widen for any role.
   */
  it.each(['read', 'admin'])('withholds the gated fields from a %s member', async (role) => {
    mocks.resolvePermission.mockResolvedValue(role)

    const response = await GET(request(), params)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      isDeployed: true,
      deployment: { id: CHAT_ID, identifier: 'victim-support' },
    })
  })

  /**
   * Concealed as a not-found rather than the route's previous `403`: this is the
   * domain's shared concealment policy, so an outsider cannot use the status
   * code to learn that the workflow exists.
   */
  it('refuses a caller with no permission on the workspace', async () => {
    mocks.resolvePermission.mockResolvedValue(null)

    const response = await GET(request(), params)

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: 'Chat not found or access denied' })
  })
})
