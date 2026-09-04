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
  mockRunHeadlessCopilotLifecycle,
  mockAppendCopilotChatMessages,
  mockAcquirePendingChatStream,
  mockReleasePendingChatStream,
  mockPublishStatusChanged,
  mockCheckWorkspaceAccess,
  mockGetActivelyBannedUserIds,
} = vi.hoisted(() => ({
  mockRunHeadlessCopilotLifecycle: vi.fn(),
  mockAppendCopilotChatMessages: vi.fn(),
  mockAcquirePendingChatStream: vi.fn(),
  mockReleasePendingChatStream: vi.fn(),
  mockPublishStatusChanged: vi.fn(),
  mockCheckWorkspaceAccess: vi.fn(),
  mockGetActivelyBannedUserIds: vi.fn(),
}))

vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))
vi.mock('@/lib/auth/ban', () => ({ getActivelyBannedUserIds: mockGetActivelyBannedUserIds }))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveBillingAttribution: vi.fn().mockResolvedValue({}),
}))
vi.mock('@/lib/mothership/chat/messages-store', () => ({
  appendCopilotChatMessages: mockAppendCopilotChatMessages,
}))
vi.mock('@/lib/mothership/chat/payload', () => ({
  buildIntegrationToolSchemas: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/mothership/chat-status', () => ({
  chatPubSub: { publishStatusChanged: mockPublishStatusChanged },
}))
vi.mock('@/lib/mothership/request/lifecycle/headless', () => ({
  runHeadlessCopilotLifecycle: mockRunHeadlessCopilotLifecycle,
}))
vi.mock('@/lib/mothership/request/session/abort', () => ({
  acquirePendingChatStream: mockAcquirePendingChatStream,
  releasePendingChatStream: mockReleasePendingChatStream,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
}))

import { resolveTaskPill, runWakeTurn, validateWake } from './wake'

const WAKE = {
  taskId: '22222222-2222-4222-8222-222222222222',
  chatId: 'chat-1',
  workspaceId: 'ws-1',
  userId: 'user-1',
  message:
    '[Background task notification — automated, not the user.]\nTask x completed: Timer elapsed',
}

describe('copilot task wake', () => {
  beforeEach(() => {
    resetDbChainMock()
    vi.clearAllMocks()
    mockGetActivelyBannedUserIds.mockResolvedValue([])
    mockCheckWorkspaceAccess.mockResolvedValue({ permission: 'admin' })
    mockAcquirePendingChatStream.mockResolvedValue(true)
    mockRunHeadlessCopilotLifecycle.mockResolvedValue({
      success: true,
      content: 'TIMER FIRED',
      contentBlocks: [],
    })
  })

  it('refuses a chat that belongs to another user', async () => {
    queueTableRows(schemaMock.copilotChats, [{ userId: 'someone-else', workspaceId: 'ws-1' }])
    expect(await validateWake(WAKE)).toEqual({
      ok: false,
      status: 404,
      error: 'Chat not found for this user and workspace',
    })
  })

  it('refuses a suspended user', async () => {
    queueTableRows(schemaMock.copilotChats, [{ userId: 'user-1', workspaceId: 'ws-1' }])
    mockGetActivelyBannedUserIds.mockResolvedValue(['user-1'])
    expect((await validateWake(WAKE)).ok).toBe(false)
  })

  it('runs the headless turn under the task id, persists both messages with the task origin, and announces it', async () => {
    await runWakeTurn(WAKE)
    expect(mockAcquirePendingChatStream).toHaveBeenCalledWith('chat-1', WAKE.taskId)
    expect(mockPublishStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'started', chatId: 'chat-1', streamId: WAKE.taskId })
    )
    const [payload, options] = mockRunHeadlessCopilotLifecycle.mock.calls[0]
    expect(payload).toEqual(
      expect.objectContaining({
        message: WAKE.message,
        messageId: WAKE.taskId,
        origin: 'task',
        chatId: 'chat-1',
      })
    )
    expect(options).toEqual(
      expect.objectContaining({ interactive: false, chatId: 'chat-1', userPermission: 'admin' })
    )
    const [chatId, messages, opts] = mockAppendCopilotChatMessages.mock.calls[0]
    expect(chatId).toBe('chat-1')
    expect(messages[0]).toEqual(
      expect.objectContaining({ role: 'user', id: WAKE.taskId, origin: 'task' })
    )
    expect(messages[1]).toEqual(
      expect.objectContaining({ role: 'assistant', content: 'TIMER FIRED' })
    )
    expect(opts).toEqual({ streamId: WAKE.taskId })
    expect(mockReleasePendingChatStream).toHaveBeenCalledWith('chat-1', WAKE.taskId)
    expect(mockPublishStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'completed', chatId: 'chat-1', streamId: WAKE.taskId })
    )
  })

  it('resolves the pill in the arming message before the wake turn lands', async () => {
    queueTableRows(schemaMock.copilotMessages, [
      {
        id: 'row-1',
        content: {
          id: 'assistant-1',
          role: 'assistant',
          contentBlocks: [
            { type: 'text', content: 'armed' },
            {
              type: 'task',
              task: {
                taskId: WAKE.taskId,
                kind: 'timer',
                target: {},
                note: 'n',
                status: 'pending',
              },
            },
          ],
        },
      },
    ])
    await resolveTaskPill('chat-1', WAKE.taskId, 'completed', 'Timer elapsed')
    expect(dbChainMockFns.update).toHaveBeenCalledWith(schemaMock.copilotMessages)
    const [setArg] = dbChainMockFns.set.mock.calls[0] as [
      {
        content: {
          contentBlocks: Array<{ type: string; task?: { status?: string; summary?: string } }>
        }
      },
    ]
    expect(setArg.content.contentBlocks[1]?.task).toMatchObject({
      status: 'completed',
      summary: 'Timer elapsed',
    })
  })

  it('skips the turn when another stream holds the chat', async () => {
    mockAcquirePendingChatStream.mockResolvedValue(false)
    await runWakeTurn(WAKE)
    expect(mockRunHeadlessCopilotLifecycle).not.toHaveBeenCalled()
    expect(mockPublishStatusChanged).not.toHaveBeenCalled()
  })
})
