/**
 * @vitest-environment node
 */
import { copilotHttpMock, copilotHttpMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockTransaction,
  mockSelectRows,
  mockCheckStorageQuota,
  mockListDuplicableChatFiles,
  mockPlanChatFileCopies,
  mockExecuteChatFileBlobCopies,
  mockLoadCopilotChatMessages,
  mockAppendCopilotChatMessages,
  mockAssertActiveWorkspaceAccess,
  mockFetchGo,
  mockPublishStatusChanged,
  mockCaptureServerEvent,
} = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockSelectRows: vi.fn(),
  mockCheckStorageQuota: vi.fn(),
  mockListDuplicableChatFiles: vi.fn(),
  mockPlanChatFileCopies: vi.fn(),
  mockExecuteChatFileBlobCopies: vi.fn(),
  mockLoadCopilotChatMessages: vi.fn(),
  mockAppendCopilotChatMessages: vi.fn(),
  mockAssertActiveWorkspaceAccess: vi.fn(),
  mockFetchGo: vi.fn(),
  mockPublishStatusChanged: vi.fn(),
  mockCaptureServerEvent: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => mockSelectRows(),
        }),
      }),
    }),
    transaction: mockTransaction,
  },
}))

vi.mock('@sim/db/schema', () => ({
  copilotChats: {
    id: 'copilotChats.id',
    userId: 'copilotChats.userId',
    type: 'copilotChats.type',
    workspaceId: 'copilotChats.workspaceId',
    title: 'copilotChats.title',
    model: 'copilotChats.model',
    resources: 'copilotChats.resources',
    previewYaml: 'copilotChats.previewYaml',
    planArtifact: 'copilotChats.planArtifact',
    config: 'copilotChats.config',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ type: 'eq', field, value })),
}))

vi.mock('@/lib/copilot/request/http', () => copilotHttpMock)

vi.mock('@/lib/billing/storage', () => ({
  checkStorageQuota: mockCheckStorageQuota,
}))

vi.mock('@/lib/copilot/chat/duplicate-chat-files', () => ({
  listDuplicableChatFiles: mockListDuplicableChatFiles,
  planChatFileCopies: mockPlanChatFileCopies,
  executeChatFileBlobCopies: mockExecuteChatFileBlobCopies,
}))

vi.mock('@/lib/copilot/chat/lifecycle', () => ({
  loadCopilotChatMessages: mockLoadCopilotChatMessages,
}))

vi.mock('@/lib/copilot/chat/messages-store', () => ({
  appendCopilotChatMessages: mockAppendCopilotChatMessages,
}))

vi.mock('@/lib/copilot/chat-status', () => ({
  chatPubSub: { publishStatusChanged: mockPublishStatusChanged },
}))

vi.mock('@/lib/copilot/request/go/fetch', () => ({
  fetchGo: mockFetchGo,
}))

vi.mock('@/lib/copilot/server/agent-url', () => ({
  getMothershipBaseURL: vi.fn().mockResolvedValue('http://mothership.test'),
  getMothershipSourceEnvHeaders: vi.fn().mockReturnValue({}),
}))

vi.mock('@/lib/core/config/env', () => ({ env: {} }))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: mockCaptureServerEvent,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  assertActiveWorkspaceAccess: mockAssertActiveWorkspaceAccess,
  isWorkspaceAccessDeniedError: () => false,
}))

import { POST } from '@/app/api/mothership/chats/[chatId]/duplicate/route'

const OLD_FILE_ID = 'wf_oldfile'
const NEW_FILE_ID = 'wf_newfile'

const parentRow = {
  id: 'chat-1',
  userId: 'user-1',
  type: 'mothership',
  workspaceId: 'ws-1',
  title: 'Generate Logs',
  model: 'claude-opus-4-8',
  resources: [{ type: 'file', id: OLD_FILE_ID, title: 'cat.png' }],
  previewYaml: null,
  planArtifact: null,
  config: null,
}

function makeTx() {
  return {
    insert: () => ({
      values: () => ({
        returning: async () => [{ id: 'row-id', workspaceId: 'ws-1' }],
      }),
    }),
    update: () => ({
      set: vi.fn().mockReturnValue({ where: async () => undefined }),
    }),
  }
}

function createRequest(chatId: string) {
  return new NextRequest(`http://localhost:3000/api/mothership/chats/${chatId}/duplicate`, {
    method: 'POST',
  })
}

function makeContext(chatId: string) {
  return { params: Promise.resolve({ chatId }) }
}

describe('POST /api/mothership/chats/[chatId]/duplicate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: 'user-1',
      isAuthenticated: true,
    })
    mockSelectRows.mockResolvedValue([parentRow])
    mockListDuplicableChatFiles.mockResolvedValue([])
    mockCheckStorageQuota.mockResolvedValue({ allowed: true })
    mockLoadCopilotChatMessages.mockResolvedValue([])
    mockPlanChatFileCopies.mockResolvedValue({
      idMap: new Map(),
      keyMap: new Map(),
      blobTasks: [],
    })
    mockExecuteChatFileBlobCopies.mockResolvedValue({ copied: 0, failed: 0 })
    mockAppendCopilotChatMessages.mockResolvedValue(undefined)
    mockAssertActiveWorkspaceAccess.mockResolvedValue(undefined)
    mockFetchGo.mockResolvedValue({ ok: true })
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb(makeTx())
    )
  })

  it('rejects unauthenticated callers', async () => {
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: null,
      isAuthenticated: false,
    })
    const res = await POST(createRequest('chat-1'), makeContext('chat-1'))
    expect(res.status).toBe(401)
  })

  it('404s when the chat belongs to another user', async () => {
    mockSelectRows.mockResolvedValue([{ ...parentRow, userId: 'someone-else' }])
    const res = await POST(createRequest('chat-1'), makeContext('chat-1'))
    expect(res.status).toBe(404)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('404s for non-mothership chats', async () => {
    mockSelectRows.mockResolvedValue([{ ...parentRow, type: 'copilot' }])
    const res = await POST(createRequest('chat-1'), makeContext('chat-1'))
    expect(res.status).toBe(404)
  })

  it('fails up front with the quota error when copied bytes would exceed the limit', async () => {
    mockListDuplicableChatFiles.mockResolvedValue([{ size: 600 }, { size: 400 }])
    mockCheckStorageQuota.mockResolvedValue({ allowed: false, error: 'Storage limit exceeded' })

    const res = await POST(createRequest('chat-1'), makeContext('chat-1'))

    expect(res.status).toBe(400)
    expect(mockCheckStorageQuota).toHaveBeenCalledWith('user-1', 1000)
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(mockExecuteChatFileBlobCopies).not.toHaveBeenCalled()
  })

  it('skips the quota check entirely for a chat with no files', async () => {
    const res = await POST(createRequest('chat-1'), makeContext('chat-1'))
    expect(res.status).toBe(200)
    expect(mockCheckStorageQuota).not.toHaveBeenCalled()
  })

  it('duplicates the chat: copies files, rewrites references, clones agent state', async () => {
    const blobTasks = [
      {
        sourceKey: 'workspace/ws-1/old-cat.png',
        targetKey: 'workspace/ws-1/new-cat.png',
        context: 'output',
        fileName: 'cat.png',
        contentType: 'image/png',
      },
    ]
    mockListDuplicableChatFiles.mockResolvedValue([{ size: 100 }])
    mockPlanChatFileCopies.mockResolvedValue({
      idMap: new Map([[OLD_FILE_ID, NEW_FILE_ID]]),
      keyMap: new Map([['workspace/ws-1/old-cat.png', 'workspace/ws-1/new-cat.png']]),
      blobTasks,
    })
    mockLoadCopilotChatMessages.mockResolvedValue([
      {
        id: 'msg-1',
        role: 'assistant',
        content: `![cat](/api/files/view/${OLD_FILE_ID})`,
        timestamp: '2026-07-01T00:00:00.000Z',
      },
    ])

    const res = await POST(createRequest('chat-1'), makeContext('chat-1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(typeof body.id).toBe('string')

    expect(mockCheckStorageQuota).toHaveBeenCalledWith('user-1', 100)

    const appended = mockAppendCopilotChatMessages.mock.calls[0]
    expect(appended[0]).toBe(body.id)
    expect(appended[1][0].content).toBe(`![cat](/api/files/view/${NEW_FILE_ID})`)

    expect(mockExecuteChatFileBlobCopies).toHaveBeenCalledWith(blobTasks, {
      userId: 'user-1',
      workspaceId: 'ws-1',
    })

    const goCall = mockFetchGo.mock.calls[0]
    expect(goCall[0]).toBe('http://mothership.test/api/chats/fork')
    const goBody = JSON.parse(goCall[1].body)
    expect(goBody).toEqual({ sourceChatId: 'chat-1', newChatId: body.id, userId: 'user-1' })
    expect(goBody.upToMessageId).toBeUndefined()

    expect(mockPublishStatusChanged).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      chatId: body.id,
      type: 'created',
    })
    expect(mockCaptureServerEvent).toHaveBeenCalledWith(
      'user-1',
      'task_duplicated',
      { workspace_id: 'ws-1', source_chat_id: 'chat-1' },
      { groups: { workspace: 'ws-1' } }
    )
  })

  it('still succeeds when the copilot-service clone fails (best-effort)', async () => {
    mockFetchGo.mockRejectedValue(new Error('mothership unreachable'))
    const res = await POST(createRequest('chat-1'), makeContext('chat-1'))
    expect(res.status).toBe(200)
  })
})
