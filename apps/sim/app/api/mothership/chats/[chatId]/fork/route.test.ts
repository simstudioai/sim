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
  mockFilterForkableChatFiles,
  mockListForkableChatFiles,
  mockPlanChatFileCopies,
  mockExecuteChatFileBlobCopies,
  mockLoadCopilotChatMessages,
  mockAppendCopilotChatMessages,
  mockAssertActiveWorkspaceAccess,
  mockFetchGo,
  mockPublishStatusChanged,
  mockCaptureServerEvent,
  mockDeleteWhere,
  mockRemoveChatResources,
} = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockSelectRows: vi.fn(),
  mockCheckStorageQuota: vi.fn(),
  // Real (pure) cut semantics so tests drive selection through row.messageId:
  // rows with a NULL/undefined messageId are kept in every fork.
  mockFilterForkableChatFiles: vi.fn(
    (rows: Array<{ messageId?: string | null }>, kept: ReadonlySet<string>) =>
      rows.filter((row) => !row.messageId || kept.has(row.messageId))
  ),
  mockListForkableChatFiles: vi.fn(),
  mockPlanChatFileCopies: vi.fn(),
  mockExecuteChatFileBlobCopies: vi.fn(),
  mockLoadCopilotChatMessages: vi.fn(),
  mockAppendCopilotChatMessages: vi.fn(),
  mockAssertActiveWorkspaceAccess: vi.fn(),
  mockFetchGo: vi.fn(),
  mockPublishStatusChanged: vi.fn(),
  mockCaptureServerEvent: vi.fn(),
  mockDeleteWhere: vi.fn(),
  mockRemoveChatResources: vi.fn(),
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
    delete: () => ({
      where: mockDeleteWhere,
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
  workspaceFiles: {
    id: 'workspaceFiles.id',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ type: 'eq', field, value })),
  inArray: vi.fn((field: unknown, values: unknown) => ({ type: 'inArray', field, values })),
}))

vi.mock('@/lib/copilot/resources/persistence', () => ({
  removeChatResources: mockRemoveChatResources,
}))

vi.mock('@/lib/copilot/request/http', () => copilotHttpMock)

vi.mock('@/lib/billing/storage', () => ({
  checkStorageQuota: mockCheckStorageQuota,
}))

vi.mock('@/lib/copilot/chat/fork-chat-files', () => ({
  filterForkableChatFiles: mockFilterForkableChatFiles,
  listForkableChatFiles: mockListForkableChatFiles,
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

import { POST } from '@/app/api/mothership/chats/[chatId]/fork/route'

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

const threeMessages = [
  {
    id: 'msg-1',
    role: 'user',
    content: `See ![cat](/api/files/view/${OLD_FILE_ID})`,
    timestamp: '2026-07-01T00:00:00.000Z',
  },
  {
    id: 'msg-2',
    role: 'assistant',
    content: 'Nice cat.',
    timestamp: '2026-07-01T00:00:01.000Z',
  },
  {
    id: 'msg-3',
    role: 'user',
    content: 'A later message the fork must not keep.',
    timestamp: '2026-07-01T00:00:02.000Z',
  },
]

/** Chat rows inserted through the mock transaction, captured for title assertions. */
let insertedChatRows: Array<Record<string, unknown>> = []
/** tx.update(...).set(...) payloads, captured for resource-rewrite assertions. */
let updatedChatRows: Array<Record<string, unknown>> = []

function makeTx() {
  return {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        insertedChatRows.push(v)
        return {
          returning: async () => [{ id: 'row-id', workspaceId: 'ws-1' }],
        }
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        updatedChatRows.push(v)
        return { where: async () => undefined }
      },
    }),
  }
}

function createRequest(chatId: string, body?: unknown) {
  return new NextRequest(`http://localhost:3000/api/mothership/chats/${chatId}/fork`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? { upToMessageId: 'msg-2' }),
  })
}

function makeContext(chatId: string) {
  return { params: Promise.resolve({ chatId }) }
}

describe('POST /api/mothership/chats/[chatId]/fork', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    insertedChatRows = []
    updatedChatRows = []
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: 'user-1',
      isAuthenticated: true,
    })
    mockSelectRows.mockResolvedValue([parentRow])
    mockListForkableChatFiles.mockResolvedValue([])
    mockCheckStorageQuota.mockResolvedValue({ allowed: true })
    mockLoadCopilotChatMessages.mockResolvedValue(threeMessages)
    mockPlanChatFileCopies.mockResolvedValue({
      idMap: new Map(),
      keyMap: new Map(),
      blobTasks: [],
    })
    mockExecuteChatFileBlobCopies.mockResolvedValue({ copied: 0, failed: 0, failedCopyIds: [] })
    mockAppendCopilotChatMessages.mockResolvedValue(undefined)
    mockDeleteWhere.mockResolvedValue(undefined)
    mockRemoveChatResources.mockResolvedValue(undefined)
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

  it('400s when upToMessageId is missing', async () => {
    const res = await POST(createRequest('chat-1', {}), makeContext('chat-1'))
    expect(res.status).toBe(400)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('400s when upToMessageId is an empty string', async () => {
    const res = await POST(createRequest('chat-1', { upToMessageId: '' }), makeContext('chat-1'))
    expect(res.status).toBe(400)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('400s when the message is not in the chat', async () => {
    const res = await POST(
      createRequest('chat-1', { upToMessageId: 'msg-unknown' }),
      makeContext('chat-1')
    )
    expect(res.status).toBe(400)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('applies the timeline cut: kept message ids drive the file selection', async () => {
    // Two uploads born pre-cut, one born post-cut, and one legacy row with no
    // birth message. The single chat-owned read is cut in memory: everything
    // but the post-cut row.
    const preCutUpload = { id: 'wf_up', size: 1, context: 'mothership', messageId: 'msg-1' }
    const secondPreCut = { id: 'wf_up2', size: 1, context: 'mothership', messageId: 'msg-2' }
    const postCutUpload = { id: 'wf_late', size: 1, context: 'mothership', messageId: 'msg-3' }
    const legacyRow = { id: 'wf_legacy', size: 1, context: 'mothership', messageId: null }
    mockListForkableChatFiles.mockResolvedValue([
      preCutUpload,
      secondPreCut,
      postCutUpload,
      legacyRow,
    ])

    const res = await POST(createRequest('chat-1'), makeContext('chat-1'))
    expect(res.status).toBe(200)

    // The cut runs over the single read with the kept slice (inclusive of
    // msg-2, excluding msg-3).
    expect(mockListForkableChatFiles).toHaveBeenCalledTimes(1)
    const filterCall = mockFilterForkableChatFiles.mock.calls[0]
    expect(filterCall[1]).toEqual(new Set(['msg-1', 'msg-2']))

    // The copy plan receives the cut set — the pre-cut uploads plus the
    // legacy no-birthdate row; the post-cut upload stays behind.
    expect(mockPlanChatFileCopies.mock.calls[0][0].rows).toEqual([
      preCutUpload,
      secondPreCut,
      legacyRow,
    ])

    // The appended transcript is the same inclusive slice.
    const appended = mockAppendCopilotChatMessages.mock.calls[0]
    expect(appended[1].map((m: { id: string }) => m.id)).toEqual(['msg-1', 'msg-2'])
  })

  it('fails up front with the quota error when copied bytes would exceed the limit', async () => {
    mockListForkableChatFiles.mockResolvedValue([
      { size: 600, workspaceId: 'ws-1' },
      { size: 400, workspaceId: 'ws-1' },
    ])
    mockCheckStorageQuota.mockResolvedValue({ allowed: false, error: 'Storage limit exceeded' })

    const res = await POST(createRequest('chat-1'), makeContext('chat-1'))

    expect(res.status).toBe(400)
    expect(mockCheckStorageQuota).toHaveBeenCalledWith('user-1', 1000)
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(mockExecuteChatFileBlobCopies).not.toHaveBeenCalled()
  })

  it('excludes uncopyable rows (no workspaceId) from the quota sum', async () => {
    // planChatFileCopies skips workspaceId-less legacy rows, so their bytes
    // must not count against the gate.
    mockListForkableChatFiles.mockResolvedValue([{ size: 600, workspaceId: 'ws-1' }, { size: 400 }])

    const res = await POST(createRequest('chat-1'), makeContext('chat-1'))

    expect(res.status).toBe(200)
    expect(mockCheckStorageQuota).toHaveBeenCalledWith('user-1', 600)
  })

  it('skips the quota check entirely when no chat-owned rows are in the cut', async () => {
    // The chat owns one file, but it was born after the fork point.
    mockListForkableChatFiles.mockResolvedValue([
      { id: 'wf_late', size: 500, context: 'mothership', messageId: 'msg-3' },
    ])
    const res = await POST(createRequest('chat-1'), makeContext('chat-1'))
    expect(res.status).toBe(200)
    expect(mockCheckStorageQuota).not.toHaveBeenCalled()
  })

  it('forks the chat: copies kept uploads, rewrites references, clones agent state', async () => {
    const blobTasks = [
      {
        sourceKey: 'workspace/ws-1/old-cat.png',
        targetKey: 'workspace/ws-1/new-cat.png',
        context: 'mothership',
        fileName: 'cat.png',
        contentType: 'image/png',
      },
    ]
    mockListForkableChatFiles.mockResolvedValue([
      { size: 100, messageId: 'msg-1', workspaceId: 'ws-1' },
    ])
    mockPlanChatFileCopies.mockResolvedValue({
      idMap: new Map([[OLD_FILE_ID, NEW_FILE_ID]]),
      keyMap: new Map([['workspace/ws-1/old-cat.png', 'workspace/ws-1/new-cat.png']]),
      blobTasks,
    })

    const res = await POST(createRequest('chat-1'), makeContext('chat-1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(typeof body.id).toBe('string')

    expect(mockCheckStorageQuota).toHaveBeenCalledWith('user-1', 100)

    // The real rewriter runs: the kept message's view-URL points at the copy.
    const appended = mockAppendCopilotChatMessages.mock.calls[0]
    expect(appended[0]).toBe(body.id)
    expect(appended[1][0].content).toBe(`See ![cat](/api/files/view/${NEW_FILE_ID})`)

    expect(mockExecuteChatFileBlobCopies).toHaveBeenCalledWith(blobTasks, {
      userId: 'user-1',
      workspaceId: 'ws-1',
    })

    const goCall = mockFetchGo.mock.calls[0]
    expect(goCall[0]).toBe('http://mothership.test/api/chats/fork')
    const goBody = JSON.parse(goCall[1].body)
    expect(goBody).toEqual({
      sourceChatId: 'chat-1',
      newChatId: body.id,
      upToMessageId: 'msg-2',
      userId: 'user-1',
    })

    expect(mockPublishStatusChanged).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      chatId: body.id,
      type: 'created',
    })
    expect(mockCaptureServerEvent).toHaveBeenCalledWith(
      'user-1',
      'task_forked',
      { workspace_id: 'ws-1', source_chat_id: 'chat-1' },
      { groups: { workspace: 'ws-1' } }
    )

    // Forks are titled "Fork | <name>".
    expect(insertedChatRows[0].title).toBe('Fork | Generate Logs')
  })

  it('still succeeds when the copilot-service clone fails (best-effort)', async () => {
    mockFetchGo.mockRejectedValue(new Error('mothership unreachable'))
    const res = await POST(createRequest('chat-1'), makeContext('chat-1'))
    expect(res.status).toBe(200)
  })

  it('surfaces failed blob copies and cleans up their dead rows + resource chips', async () => {
    mockExecuteChatFileBlobCopies.mockResolvedValue({
      copied: 1,
      failed: 2,
      failedCopyIds: ['wf_dead1', 'wf_dead2'],
    })

    const failedRes = await POST(createRequest('chat-1'), makeContext('chat-1'))
    const body = await failedRes.json()

    expect(body.failedFileCopies).toBe(2)

    // The dead rows (committed, but no bytes behind them) are hard-deleted so
    // they vanish from VFS listings and name resolution…
    expect(mockDeleteWhere).toHaveBeenCalledWith({
      type: 'inArray',
      field: 'workspaceFiles.id',
      values: ['wf_dead1', 'wf_dead2'],
    })
    // …and their resource chips are dropped from the new chat.
    expect(mockRemoveChatResources).toHaveBeenCalledWith(body.id, [
      { type: 'file', id: 'wf_dead1', title: '' },
      { type: 'file', id: 'wf_dead2', title: '' },
    ])
  })

  it('omits failedFileCopies and skips cleanup when every blob copies', async () => {
    mockExecuteChatFileBlobCopies.mockResolvedValue({ copied: 3, failed: 0, failedCopyIds: [] })

    const cleanRes = await POST(createRequest('chat-1'), makeContext('chat-1'))

    expect('failedFileCopies' in (await cleanRes.json())).toBe(false)
    expect(mockDeleteWhere).not.toHaveBeenCalled()
    expect(mockRemoveChatResources).not.toHaveBeenCalled()
  })

  it('copies pre-cut uploads and drops only post-cut ghosts', async () => {
    // The source chat owns two more uploads (apple pre-cut, banana post-cut)
    // beside the kept one, plus one shared workspace-file resource. The fork
    // copies the kept upload AND the pre-cut apple; only the post-cut banana
    // stays behind, so only its resource is dropped — not left pointing at
    // the source chat.
    mockSelectRows.mockResolvedValue([
      {
        ...parentRow,
        resources: [
          { type: 'file', id: OLD_FILE_ID, title: 'cat.png' },
          { type: 'file', id: 'wf_apple', title: 'apple.png' },
          { type: 'file', id: 'wf_banana', title: 'banana.png' },
          { type: 'file', id: 'wf_shared', title: 'shared.pdf' },
          { type: 'workflow', id: 'wflow-1', title: 'My flow' },
        ],
      },
    ])
    // Every chat-owned file of the source chat in the single read; messageId
    // drives the in-memory cut.
    mockListForkableChatFiles.mockResolvedValue([
      { id: OLD_FILE_ID, size: 100, context: 'mothership', messageId: 'msg-1' },
      { id: 'wf_apple', size: 50, context: 'mothership', messageId: 'msg-1' },
      { id: 'wf_banana', size: 50, context: 'mothership', messageId: 'msg-3' },
    ])
    mockPlanChatFileCopies.mockResolvedValue({
      idMap: new Map([
        [OLD_FILE_ID, NEW_FILE_ID],
        ['wf_apple', 'wf_apple_copy'],
      ]),
      keyMap: new Map(),
      blobTasks: [],
    })

    const res = await POST(createRequest('chat-1'), makeContext('chat-1'))

    expect(res.status).toBe(200)
    // The plan received the cut set: the kept upload + pre-cut apple only.
    expect(mockPlanChatFileCopies.mock.calls[0][0].rows.map((r: { id: string }) => r.id)).toEqual([
      OLD_FILE_ID,
      'wf_apple',
    ])
    expect(updatedChatRows).toHaveLength(1)
    expect(updatedChatRows[0].resources).toEqual([
      { type: 'file', id: NEW_FILE_ID, title: 'cat.png' },
      { type: 'file', id: 'wf_apple_copy', title: 'apple.png' },
      { type: 'file', id: 'wf_shared', title: 'shared.pdf' },
      { type: 'workflow', id: 'wflow-1', title: 'My flow' },
    ])
  })

  it('drops ghosts even when the fork copies no files at all', async () => {
    // Fork cut before the chat's only upload arrived: a guard that skips the
    // resources update when idMap is empty would leave the ghost in place.
    mockSelectRows.mockResolvedValue([
      {
        ...parentRow,
        resources: [{ type: 'file', id: 'wf_banana', title: 'banana.png' }],
      },
    ])
    mockListForkableChatFiles.mockResolvedValue([
      { id: 'wf_banana', size: 50, context: 'mothership', messageId: 'msg-3' },
    ])

    const res = await POST(createRequest('chat-1'), makeContext('chat-1'))

    expect(res.status).toBe(200)
    expect(updatedChatRows).toHaveLength(1)
    expect(updatedChatRows[0].resources).toEqual([])
  })
})
