/**
 * @vitest-environment node
 */
import { copilotHttpMock, copilotHttpMockFns, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
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
  mockRemoveChatResources,
} = vi.hoisted(() => ({
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
  mockRemoveChatResources: vi.fn(),
}))

vi.mock('@/lib/copilot/resources/persistence', () => ({
  removeChatResources: mockRemoveChatResources,
}))

vi.mock('@/lib/copilot/request/http', () => copilotHttpMock)

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
    resetDbChainMock()
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: 'user-1',
      isAuthenticated: true,
    })
    dbChainMockFns.limit.mockResolvedValue([parentRow])
    dbChainMockFns.returning.mockResolvedValue([{ id: 'row-id', workspaceId: 'ws-1' }])
    mockListForkableChatFiles.mockResolvedValue([])
    mockLoadCopilotChatMessages.mockResolvedValue(threeMessages)
    mockPlanChatFileCopies.mockResolvedValue({
      idMap: new Map(),
      keyMap: new Map(),
      blobTasks: [],
    })
    mockExecuteChatFileBlobCopies.mockResolvedValue({ copied: 0, failed: 0, failedCopyIds: [] })
    mockAppendCopilotChatMessages.mockResolvedValue(undefined)
    mockRemoveChatResources.mockResolvedValue(undefined)
    mockAssertActiveWorkspaceAccess.mockResolvedValue(undefined)
    mockFetchGo.mockResolvedValue({ ok: true })
  })

  afterAll(() => {
    resetDbChainMock()
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
    dbChainMockFns.limit.mockResolvedValue([{ ...parentRow, userId: 'someone-else' }])
    const res = await POST(createRequest('chat-1'), makeContext('chat-1'))
    expect(res.status).toBe(404)
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })

  it('404s for non-mothership chats', async () => {
    dbChainMockFns.limit.mockResolvedValue([{ ...parentRow, type: 'copilot' }])
    const res = await POST(createRequest('chat-1'), makeContext('chat-1'))
    expect(res.status).toBe(404)
  })

  it('400s when upToMessageId is missing', async () => {
    const res = await POST(createRequest('chat-1', {}), makeContext('chat-1'))
    expect(res.status).toBe(400)
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })

  it('400s when upToMessageId is an empty string', async () => {
    const res = await POST(createRequest('chat-1', { upToMessageId: '' }), makeContext('chat-1'))
    expect(res.status).toBe(400)
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })

  it('400s when the message is not in the chat', async () => {
    const res = await POST(
      createRequest('chat-1', { upToMessageId: 'msg-unknown' }),
      makeContext('chat-1')
    )
    expect(res.status).toBe(400)
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
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

    // The real rewriter runs: the kept message's view-URL points at the copy.
    const appended = mockAppendCopilotChatMessages.mock.calls[0]
    expect(appended[0]).toBe(body.id)
    expect(appended[1][0].content).toBe(`See ![cat](/api/files/view/${NEW_FILE_ID})`)

    expect(mockExecuteChatFileBlobCopies).toHaveBeenCalledWith(blobTasks)

    const goCall = mockFetchGo.mock.calls[0]
    expect(goCall[0]).toBe('http://mothership.test/api/chats/fork')
    const goBody = JSON.parse(goCall[1].body)
    // The copilot service only knows USER message ids, so the clone cut is the
    // kept slice's last user message (msg-1), not the clicked assistant (msg-2).
    expect(goBody).toEqual({
      sourceChatId: 'chat-1',
      newChatId: body.id,
      upToMessageId: 'msg-1',
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
    expect(dbChainMockFns.values.mock.calls[0][0].title).toBe('Fork | Generate Logs')
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
    expect(dbChainMockFns.where).toHaveBeenCalledWith({
      type: 'inArray',
      column: 'id',
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
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    expect(mockRemoveChatResources).not.toHaveBeenCalled()
  })

  it('copies pre-cut uploads and drops only post-cut ghosts', async () => {
    // The source chat owns two more uploads (apple pre-cut, banana post-cut)
    // beside the kept one, plus one shared workspace-file resource. The fork
    // copies the kept upload AND the pre-cut apple; only the post-cut banana
    // stays behind, so only its resource is dropped — not left pointing at
    // the source chat.
    dbChainMockFns.limit.mockResolvedValue([
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
    expect(dbChainMockFns.set).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.set.mock.calls[0][0].resources).toEqual([
      { type: 'file', id: NEW_FILE_ID, title: 'cat.png' },
      { type: 'file', id: 'wf_apple_copy', title: 'apple.png' },
      { type: 'file', id: 'wf_shared', title: 'shared.pdf' },
      { type: 'workflow', id: 'wflow-1', title: 'My flow' },
    ])
  })

  it('drops ghosts even when the fork copies no files at all', async () => {
    // Fork cut before the chat's only upload arrived: a guard that skips the
    // resources update when idMap is empty would leave the ghost in place.
    dbChainMockFns.limit.mockResolvedValue([
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
    expect(dbChainMockFns.set).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.set.mock.calls[0][0].resources).toEqual([])
  })
})
