/**
 * @vitest-environment node
 */
import type { Principal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    canSetPublicChatAuth: vi.fn(),
    validateChatDeployAuth: vi.fn(),
    resolveContext: vi.fn(),
    resolvePermission: vi.fn(),
    chatDeploy: vi.fn(),
    chatUndeploy: vi.fn(),
    audit: vi.fn(),
  },
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { CHAT_DEPLOYED: 'chat.deployed', CHAT_UNDEPLOYED: 'chat.undeployed' },
  AuditResourceType: { WORKFLOW: 'workflow' },
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

vi.mock('@sim/db', () => {
  // Chainable stub: every existing-deployment lookup resolves to no rows, so the
  // use case takes the "new chat" path where authType defaults to public.
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'from', 'where', 'limit']) {
    chain[method] = vi.fn(() => chain)
  }
  ;(chain as { then?: unknown }).then = (resolve: (rows: unknown[]) => unknown) => resolve([])
  return { db: chain, chat: { workflowId: {}, identifier: {}, archivedAt: {}, id: {} } }
})

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
}))

vi.mock('@/lib/chat/permissions', () => ({
  canSetPublicChatAuth: mocks.canSetPublicChatAuth,
}))

vi.mock('@/ee/access-control/utils/permission-check', () => {
  class ChatDeployAuthNotAllowedError extends Error {}
  return { validateChatDeployAuth: mocks.validateChatDeployAuth, ChatDeployAuthNotAllowedError }
})

vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowApplicationContext: mocks.resolveContext,
}))

vi.mock('@/lib/workflows/orchestration', () => ({
  performChatDeploy: mocks.chatDeploy,
  performChatUndeploy: mocks.chatUndeploy,
}))

import { deployWorkflowChat } from '@/lib/workflows/application/chat-deployments'

const WRITE_PRINCIPAL: Principal = {
  kind: 'delegated',
  serviceId: 'copilot',
  subjectUserId: 'editor-1',
  workspaceId: 'workspace-1',
  delegationId: 'copilot-1',
  audience: 'sim:workflows',
  issuedAt: new Date('2026-08-08T00:00:00Z'),
  expiresAt: new Date('2999-08-08T00:00:00Z'),
}

/**
 * Chat deployment is `write`, but a public chat is invocable by anyone with the
 * URL and no auth, so the exposure is admin-only. This use case is the copilot
 * path and it defaults `authType` to `public`, which makes it the easiest place
 * for the boundary to be silently bypassed — the REST routes enforce it
 * separately.
 */
describe('copilot chat deploy cannot bypass the public-chat admin gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.resolveContext.mockResolvedValue({
      workflowId: 'workflow-1',
      workflow: { id: 'workflow-1', name: 'wf', userId: 'owner-1', workspaceId: 'workspace-1' },
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    mocks.chatDeploy.mockResolvedValue({
      success: true,
      chatId: 'chat-1',
      chatUrl: 'http://localhost:3000/chat/x',
    })
  })

  it('rejects a write principal defaulting to public', async () => {
    mocks.canSetPublicChatAuth.mockResolvedValue(false)

    await expect(
      deployWorkflowChat.execute({
        principal: WRITE_PRINCIPAL,
        input: {
          workflowId: 'workflow-1',
          identifier: 'my-chat',
          title: 'My Chat',
          versionName: 'v1',
          versionDescription: 'first',
          requestId: 'req-1',
        },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.chatDeploy).not.toHaveBeenCalled()
  })

  it('allows a write principal to deploy a password-protected chat', async () => {
    mocks.canSetPublicChatAuth.mockResolvedValue(false)

    await deployWorkflowChat.execute({
      principal: WRITE_PRINCIPAL,
      input: {
        workflowId: 'workflow-1',
        identifier: 'my-chat',
        title: 'My Chat',
        authType: 'password',
        password: 'placeholder-value',
        versionName: 'v1',
        versionDescription: 'first',
        requestId: 'req-1',
      },
    })

    expect(mocks.chatDeploy).toHaveBeenCalled()
    expect(mocks.canSetPublicChatAuth).not.toHaveBeenCalled()
  })

  it('allows an admin principal to deploy a public chat', async () => {
    mocks.canSetPublicChatAuth.mockResolvedValue(true)

    await deployWorkflowChat.execute({
      principal: WRITE_PRINCIPAL,
      input: {
        workflowId: 'workflow-1',
        identifier: 'my-chat',
        title: 'My Chat',
        authType: 'public',
        versionName: 'v1',
        versionDescription: 'first',
        requestId: 'req-1',
      },
    })

    expect(mocks.chatDeploy).toHaveBeenCalledWith(expect.objectContaining({ authType: 'public' }))
  })
})
