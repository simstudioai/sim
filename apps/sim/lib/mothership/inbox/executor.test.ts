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
  mockRunHeadlessCopilotLifecycle,
  mockSendInboxResponse,
} = vi.hoisted(() => ({
  mockCheckWorkspaceAccess: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
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

vi.mock('@/lib/copilot/chat/lifecycle', () => ({
  resolveOrCreateChat: vi.fn(),
}))

vi.mock('@/lib/copilot/chat/messages-store', () => ({
  appendCopilotChatMessages: vi.fn(),
}))

vi.mock('@/lib/copilot/chat/payload', () => ({
  buildIntegrationToolSchemas: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/copilot/chat/persisted-message', () => ({
  buildPersistedAssistantMessage: vi.fn().mockReturnValue({ id: 'assistant-message' }),
  buildPersistedUserMessage: vi.fn().mockReturnValue({ id: 'user-message' }),
}))

vi.mock('@/lib/copilot/chat/workspace-context', () => ({
  generateWorkspaceContext: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/copilot/chat-status', () => ({
  chatPubSub: { publishStatusChanged: vi.fn() },
}))

vi.mock('@/lib/copilot/entitlements', () => ({
  computeWorkspaceEntitlements: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/copilot/request/lifecycle/headless', () => ({
  runHeadlessCopilotLifecycle: mockRunHeadlessCopilotLifecycle,
}))

vi.mock('@/lib/copilot/request/lifecycle/start', () => ({
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

describe('Inbox raw-secret actor', () => {
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
        secretMountPolicy: {
          secretScope: 'selected',
          mountedSecrets: ['INBOX_KEY'],
        },
      })
    )
  })

  it('keeps owner execution fallback but removes raw-secret authority for an external sender', async () => {
    queueTableRows(schemaMock.mothershipInboxTask, [INBOX_TASK])
    queueTableRows(schemaMock.workspace, [WORKSPACE])
    queueTableRows(schemaMock.user, [])

    await executeInboxTask('task-1')

    expect(mockRunHeadlessCopilotLifecycle).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        userId: 'owner-1',
        secretActorUserId: null,
        secretMountPolicy: {
          secretScope: 'selected',
          mountedSecrets: ['INBOX_KEY'],
        },
      })
    )
    expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })
})
