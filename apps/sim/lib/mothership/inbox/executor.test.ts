/**
 * @vitest-environment node
 */
import {
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckWorkspaceAccess,
  mockGetUserEntityPermissions,
  mockResolveOrCreateChat,
  mockRunHeadlessCopilotLifecycle,
  mockSendInboxResponse,
} = vi.hoisted(() => ({
  mockCheckWorkspaceAccess: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockResolveOrCreateChat: vi.fn(),
  mockRunHeadlessCopilotLifecycle: vi.fn(),
  mockSendInboxResponse: vi.fn(),
}))

vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))

vi.mock('@/lib/auth/ban', () => ({
  getActivelyBannedUserIds: vi.fn().mockResolvedValue([]),
  isEmailBlocked: vi.fn().mockResolvedValue(false),
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveBillingAttribution: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/mothership/chat/lifecycle', () => ({
  resolveOrCreateChat: mockResolveOrCreateChat,
}))

vi.mock('@/lib/mothership/chat/messages-store', () => ({
  appendCopilotChatMessages: vi.fn(),
}))

vi.mock('@/lib/mothership/chat/payload', () => ({
  buildIntegrationToolSchemas: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/mothership/chat/persisted-message', () => ({
  buildPersistedAssistantMessage: vi.fn().mockReturnValue({ id: 'assistant-message' }),
  buildPersistedUserMessage: vi.fn().mockReturnValue({ id: 'user-message' }),
}))

vi.mock('@/lib/mothership/chat/workspace-context', () => ({
  generateWorkspaceContext: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/mothership/chat-status', () => ({
  chatPubSub: { publishStatusChanged: vi.fn() },
}))

vi.mock('@/lib/mothership/entitlements', () => ({
  computeWorkspaceEntitlements: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/mothership/request/lifecycle/headless', () => ({
  runHeadlessCopilotLifecycle: mockRunHeadlessCopilotLifecycle,
}))

vi.mock('@/lib/mothership/request/lifecycle/start', () => ({
  requestChatTitle: vi.fn(),
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  isDocSandboxEnabled: false,
  isHosted: true,
}))

vi.mock('@/lib/mothership/inbox/agentmail-client', () => ({}))

vi.mock('@/lib/mothership/inbox/response', () => ({
  sendInboxResponse: mockSendInboxResponse,
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  uploadFile: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('@/lib/workspaces/utils', () => ({
  getWorkspaceBilledAccountUserId: vi.fn().mockResolvedValue('owner-1'),
}))

import { MOTHERSHIP_CHAT_DEFAULT_MODEL } from '@/lib/mothership/constants'
import { executeInboxTask } from '@/lib/mothership/inbox/executor'

const INBOX_TASK = {
  id: 'task-1',
  workspaceId: 'workspace-1',
  status: 'received',
  fromEmail: 'sender@example.com',
  fromName: 'Sender',
  subject: 'Task',
  bodyPreview: 'Please do this',
  bodyText: 'Please do this',
  bodyHtml: null,
  hasAttachments: false,
  agentmailMessageId: null,
  chatId: 'chat-1',
}

const WORKSPACE = {
  id: 'workspace-1',
  ownerId: 'owner-1',
  inboxProviderId: 'provider-1',
  inboxSecretScope: 'selected',
  inboxMountedSecrets: ['INBOX_KEY'],
}

describe('Inbox execution actor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockCheckWorkspaceAccess.mockResolvedValue({ permission: 'write' })
    mockRunHeadlessCopilotLifecycle.mockResolvedValue({
      success: true,
      content: 'done',
      contentBlocks: [],
      toolCalls: [],
      chatId: 'chat-1',
    })
    mockSendInboxResponse.mockResolvedValue('response-1')
    mockResolveOrCreateChat.mockResolvedValue({
      chatId: 'chat-1',
      chat: { id: 'chat-1' },
      conversationHistory: [],
      isNew: true,
    })
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ id: 'task-1' }])
      .mockResolvedValueOnce([{ model: 'claude-opus-4-8' }])
  })

  it('gives a workspace member their own raw-secret authority', async () => {
    queueTableRows(schemaMock.mothershipInboxTask, [INBOX_TASK])
    queueTableRows(schemaMock.workspace, [WORKSPACE])
    queueTableRows(schemaMock.user, [{ id: 'member-1' }])
    mockGetUserEntityPermissions.mockResolvedValue('write')

    await executeInboxTask('task-1')

    expect(mockRunHeadlessCopilotLifecycle).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        userId: 'member-1',
        secretActorUserId: 'member-1',
        /** Their own, so an emailed request reaches exactly what they could in the app. */
        userPermission: 'write',
        secretMountPolicy: {
          secretScope: 'selected',
          mountedSecrets: ['INBOX_KEY'],
        },
      })
    )
  })

  it('does not lend a read-only member write authority', async () => {
    queueTableRows(schemaMock.mothershipInboxTask, [INBOX_TASK])
    queueTableRows(schemaMock.workspace, [WORKSPACE])
    queueTableRows(schemaMock.user, [{ id: 'member-1' }])
    mockCheckWorkspaceAccess.mockResolvedValue({ permission: 'read' })
    mockGetUserEntityPermissions.mockResolvedValue('read')

    await executeInboxTask('task-1')

    expect(mockRunHeadlessCopilotLifecycle).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ userId: 'member-1', userPermission: 'read' })
    )
  })

  /**
   * The owner identity is there for billing and workspace reads, not to lend an unknown
   * sender the owner's authority. Without the read ceiling the write-gated workflow tools
   * would let an allowlisted external correspondent build and run a workflow as the owner,
   * which resolves the owner's workspace and personal secrets — the same reach the null
   * secret actor already refuses for a direct mount.
   */
  it('caps an external sender at read even when the owner is an admin', async () => {
    queueTableRows(schemaMock.mothershipInboxTask, [INBOX_TASK])
    queueTableRows(schemaMock.workspace, [WORKSPACE])
    queueTableRows(schemaMock.user, [])
    mockCheckWorkspaceAccess.mockResolvedValue({ permission: 'admin' })

    await executeInboxTask('task-1')

    expect(mockRunHeadlessCopilotLifecycle).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        userId: 'owner-1',
        secretActorUserId: null,
        userPermission: 'read',
        secretMountPolicy: {
          secretScope: 'selected',
          mountedSecrets: ['INBOX_KEY'],
        },
      })
    )
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('stamps the shared mothership model on the chat it creates for a task', async () => {
    queueTableRows(schemaMock.mothershipInboxTask, [{ ...INBOX_TASK, chatId: null }])
    queueTableRows(schemaMock.workspace, [WORKSPACE])
    queueTableRows(schemaMock.user, [{ id: 'member-1' }])
    mockGetUserEntityPermissions.mockResolvedValue('write')

    await executeInboxTask('task-1')

    expect(mockResolveOrCreateChat).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        type: 'mothership',
        model: MOTHERSHIP_CHAT_DEFAULT_MODEL,
      })
    )
  })

  it('leaves an external sender with no permission at none rather than promoting to read', async () => {
    queueTableRows(schemaMock.mothershipInboxTask, [INBOX_TASK])
    queueTableRows(schemaMock.workspace, [WORKSPACE])
    queueTableRows(schemaMock.user, [])
    mockCheckWorkspaceAccess.mockResolvedValue({ permission: null })

    await executeInboxTask('task-1')

    const [, options] = mockRunHeadlessCopilotLifecycle.mock.calls[0]
    expect(options.userPermission).toBeUndefined()
  })
})
