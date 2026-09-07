/**
 * Tests for the workflow chat-deployment status route.
 *
 * The route is an adapter over `chat_deployments.list`, so the seams mocked here
 * are the canonical workflow/deployment reads and the workspace permission
 * resolver — not a route-local access helper.
 *
 * @vitest-environment node
 */
import {
  authMockFns,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  resetEnvMock,
  schemaMock,
  setEnv,
  setEnvFlags,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolvePermission: vi.fn(),
  loadWorkspaceContext: vi.fn(),
  getLiveChatDeploymentForWorkflow: vi.fn(),
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
  getLiveChatDeploymentForWorkflow: mocks.getLiveChatDeploymentForWorkflow,
  getChatDeploymentWithWorkspace: vi.fn(),
  getChatDeploymentIdOwningIdentifier: vi.fn(),
  updateChatDeploymentRow: vi.fn(),
  listWorkspaceChatDeployments: vi.fn(),
}))

import { chatDeploymentOperations } from '@/lib/chat-deployments/application'
import { GET } from '@/app/api/workflows/[id]/chat/status/route'

const WORKFLOW_ID = 'workflow-1'
const WORKSPACE_ID = 'workspace-1'
const CHAT_ID = 'chat-123'

const params = { params: Promise.resolve({ id: WORKFLOW_ID }) }

function request() {
  return new NextRequest(`http://localhost:3000/api/workflows/${WORKFLOW_ID}/chat/status`)
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
    vi.clearAllMocks()
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

  it('returns 401 when there is no session', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)

    const response = await GET(request(), params)

    expect(response.status).toBe(401)
    expect(mocks.getLiveChatDeploymentForWorkflow).not.toHaveBeenCalled()
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

  it('reports an inactive deployment as not deployed while still naming it', async () => {
    mocks.getLiveChatDeploymentForWorkflow.mockResolvedValue(chatRow({ isActive: false }))

    const body = await (await GET(request(), params)).json()

    expect(body).toEqual({
      isDeployed: false,
      deployment: { id: CHAT_ID, identifier: 'victim-support' },
    })
  })

  it('reports a workflow with no chat as not deployed', async () => {
    mocks.getLiveChatDeploymentForWorkflow.mockResolvedValue(null)

    const body = await (await GET(request(), params)).json()

    expect(body).toEqual({ isDeployed: false, deployment: null })
  })

  /**
   * The projection above is only safe because the fields it omits stay behind
   * an admin operation. If `chat_deployments.read` were ever relaxed, this
   * route would no longer be the narrower of the two.
   */
  it('keeps the detail read admin-gated and discovery capability-gated', () => {
    expect(chatDeploymentOperations.read.minimumRole).toBe('admin')
    expect(chatDeploymentOperations.list.minimumRole).toBe('read')
    expect(chatDeploymentOperations.list.capability).toBe('deploy.chat')
  })
})
