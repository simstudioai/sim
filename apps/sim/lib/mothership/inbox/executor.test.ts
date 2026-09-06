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
  mockGetMessage,
  mockGetAttachment,
  mockTrackChatUpload,
  mockUploadFile,
  mockDeleteFile,
  mockDeleteFileMetadata,
  mockResolveOrCreateChat,
  mockRunHeadlessCopilotLifecycle,
  mockSendInboxResponse,
} = vi.hoisted(() => ({
  mockCheckWorkspaceAccess: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockGetMessage: vi.fn(),
  mockGetAttachment: vi.fn(),
  mockTrackChatUpload: vi.fn(),
  mockUploadFile: vi.fn(),
  mockDeleteFile: vi.fn(),
  mockDeleteFileMetadata: vi.fn(),
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

vi.mock('@/lib/mothership/inbox/agentmail-client', () => ({
  getMessage: mockGetMessage,
  getAttachment: mockGetAttachment,
}))

vi.mock('@/lib/mothership/inbox/response', () => ({
  sendInboxResponse: mockSendInboxResponse,
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  uploadFile: mockUploadFile,
  deleteFile: mockDeleteFile,
}))

vi.mock('@/lib/uploads/server/metadata', () => ({
  deleteFileMetadata: mockDeleteFileMetadata,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  generateWorkspaceFileKey: (workspaceId: string, filename: string) =>
    `workspace/${workspaceId}/generated-${filename}`,
  trackChatUpload: mockTrackChatUpload,
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

  it.each(['member', 'external'])(
    'makes inbox attachments readable without increasing %s tool authority',
    async (actor) => {
      queueTableRows(schemaMock.mothershipInboxTask, [
        { ...INBOX_TASK, hasAttachments: true, agentmailMessageId: 'mail-1' },
      ])
      queueTableRows(schemaMock.workspace, [WORKSPACE])
      queueTableRows(schemaMock.user, actor === 'member' ? [{ id: 'member-1' }] : [])
      mockGetUserEntityPermissions.mockResolvedValue('write')
      const attachments = [
        { attachment_id: 'csv-1', filename: 'report %.csv', content_type: 'text/csv', size: 12 },
        {
          attachment_id: 'zip-1',
          filename: 'archive.zip',
          content_type: 'application/zip',
          size: 12,
        },
      ]
      mockGetMessage.mockResolvedValue({ attachments })
      mockGetAttachment.mockResolvedValue(Buffer.from('audit-bytes'))
      mockUploadFile.mockImplementation(async ({ customKey }: { customKey: string }) => ({
        key: customKey,
      }))
      mockTrackChatUpload.mockImplementation(
        async (
          _workspace: string,
          _user: string,
          _chat: string,
          _key: string,
          filename: string
        ) => ({ displayName: filename })
      )

      await executeInboxTask('task-1')

      const [payload, options] = mockRunHeadlessCopilotLifecycle.mock.calls[0]
      expect(payload.context).toHaveLength(2)
      expect(payload.context[0].content).toContain('uploads/report%20%25.csv')
      expect(payload.context[1].content).toContain('archive.zip')
      expect(payload.context[1].content).toContain('unzip')
      expect(payload).not.toHaveProperty('fileAttachments')
      expect(options.userPermission).toBe(actor === 'member' ? 'write' : 'read')
      expect(options.secretActorUserId).toBe(actor === 'member' ? 'member-1' : null)
      expect(mockUploadFile).toHaveBeenCalledTimes(2)
      expect(mockTrackChatUpload).toHaveBeenCalledTimes(2)
      expect(mockTrackChatUpload.mock.invocationCallOrder.at(-1)).toBeLessThan(
        mockRunHeadlessCopilotLifecycle.mock.invocationCallOrder[0]
      )
      for (const [upload] of mockUploadFile.mock.calls) {
        expect(upload).toMatchObject({
          context: 'mothership',
          metadata: { workspaceId: 'workspace-1', userId: options.userId },
        })
        expect(upload.file).toEqual(Buffer.from('audit-bytes'))
      }
    }
  )

  it.each(['download', 'binding', 'declared-size', 'actual-size'])(
    'keeps a valid sibling readable when an attachment fails during %s',
    async (failure) => {
      queueTableRows(schemaMock.mothershipInboxTask, [
        { ...INBOX_TASK, hasAttachments: true, agentmailMessageId: 'mail-1' },
      ])
      queueTableRows(schemaMock.workspace, [WORKSPACE])
      queueTableRows(schemaMock.user, [{ id: 'member-1' }])
      mockGetUserEntityPermissions.mockResolvedValue('write')
      mockGetMessage.mockResolvedValue({
        attachments: [
          {
            attachment_id: 'failed',
            filename: 'failed.csv',
            content_type: 'text/csv',
            size: failure === 'declared-size' ? 11 * 1024 * 1024 : 3,
          },
          { attachment_id: 'valid', filename: 'valid.csv', content_type: 'text/csv', size: 3 },
        ],
      })
      mockGetAttachment.mockImplementation(async (_inbox: string, _message: string, id: string) => {
        if (id === 'failed' && failure === 'download') throw new Error('Download unavailable')
        return id === 'failed' && failure === 'actual-size'
          ? Buffer.alloc(10 * 1024 * 1024 + 1)
          : Buffer.from('csv')
      })
      mockUploadFile.mockImplementation(async ({ customKey }: { customKey: string }) => ({
        key: customKey,
      }))
      mockTrackChatUpload.mockImplementation(
        async (
          _workspace: string,
          _user: string,
          _chat: string,
          _key: string,
          filename: string
        ) => {
          if (filename === 'failed.csv' && failure === 'binding')
            throw new Error('Binding unavailable')
          return { displayName: filename }
        }
      )

      await executeInboxTask('task-1')

      const [payload] = mockRunHeadlessCopilotLifecycle.mock.calls[0]
      expect(payload.context).toHaveLength(2)
      expect(payload.context[0].content).toContain(
        '"failed.csv" could not be prepared and is unavailable'
      )
      expect(payload.context[1].content).toContain('uploads/valid.csv')
      expect(mockUploadFile).toHaveBeenCalledTimes(failure === 'binding' ? 2 : 1)
      if (failure === 'binding') {
        expect(mockDeleteFile).toHaveBeenCalledExactlyOnceWith({
          key: 'workspace/workspace-1/generated-failed.csv',
          context: 'mothership',
        })
        expect(mockDeleteFileMetadata).toHaveBeenCalledExactlyOnceWith(
          'workspace/workspace-1/generated-failed.csv'
        )
      } else {
        expect(mockDeleteFile).not.toHaveBeenCalled()
        expect(mockDeleteFileMetadata).not.toHaveBeenCalled()
      }
      expect(mockSendInboxResponse).toHaveBeenCalledTimes(1)
    }
  )

  it('does not promise readable attachments when metadata cannot be loaded', async () => {
    queueTableRows(schemaMock.mothershipInboxTask, [
      { ...INBOX_TASK, hasAttachments: true, agentmailMessageId: 'mail-1' },
    ])
    queueTableRows(schemaMock.workspace, [WORKSPACE])
    queueTableRows(schemaMock.user, [{ id: 'member-1' }])
    mockGetUserEntityPermissions.mockResolvedValue('write')
    mockGetMessage.mockRejectedValueOnce(new Error('Metadata unavailable'))

    await executeInboxTask('task-1')

    const [payload] = mockRunHeadlessCopilotLifecycle.mock.calls[0]
    expect(payload.message).toContain('their metadata was unavailable')
    expect(payload).not.toHaveProperty('context')
    expect(mockGetAttachment).not.toHaveBeenCalled()
    expect(mockUploadFile).not.toHaveBeenCalled()
  })
})
