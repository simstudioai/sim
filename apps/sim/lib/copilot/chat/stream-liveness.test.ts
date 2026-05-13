/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAnd, mockEq, mockGetChatStreamLockOwners, mockSet, mockUpdate, mockWhere } = vi.hoisted(
  () => ({
    mockAnd: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
    mockEq: vi.fn((field: unknown, value: unknown) => ({ type: 'eq', field, value })),
    mockGetChatStreamLockOwners: vi.fn(),
    mockSet: vi.fn(),
    mockUpdate: vi.fn(),
    mockWhere: vi.fn(),
  })
)

vi.mock('@sim/db', () => ({
  db: { update: mockUpdate },
}))

vi.mock('@sim/db/schema', () => ({
  copilotChats: {
    id: 'copilotChats.id',
    conversationId: 'copilotChats.conversationId',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: mockAnd,
  eq: mockEq,
}))

vi.mock('@/lib/copilot/request/session', () => ({
  getChatStreamLockOwners: mockGetChatStreamLockOwners,
}))

import { reconcileChatStreamMarkers } from '@/lib/copilot/chat/stream-liveness'

describe('reconcileChatStreamMarkers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSet.mockReturnValue({ where: mockWhere })
    mockUpdate.mockReturnValue({ set: mockSet })
    mockWhere.mockResolvedValue(undefined)
    mockGetChatStreamLockOwners.mockResolvedValue({
      status: 'verified',
      ownersByChatId: new Map<string, string>(),
    })
  })

  it('clears a persisted stream marker when Redis verifies no lock owner exists', async () => {
    const markers = await reconcileChatStreamMarkers([
      { chatId: 'chat-stuck', streamId: 'stream-orphaned' },
    ])

    expect(mockGetChatStreamLockOwners).toHaveBeenCalledWith(['chat-stuck'])
    expect(markers.get('chat-stuck')).toEqual({
      chatId: 'chat-stuck',
      streamId: null,
      status: 'inactive',
    })
  })

  it('repairs a verified stale persisted stream marker when requested', async () => {
    await reconcileChatStreamMarkers([{ chatId: 'chat-stuck', streamId: 'stream-orphaned' }], {
      repairVerifiedStaleMarkers: true,
    })

    expect(mockUpdate).toHaveBeenCalled()
    expect(mockSet).toHaveBeenCalledWith({ conversationId: null })
    expect(mockWhere).toHaveBeenCalledWith(
      mockAnd(
        mockEq('copilotChats.id', 'chat-stuck'),
        mockEq('copilotChats.conversationId', 'stream-orphaned')
      )
    )
  })

  it('uses the canonical Redis owner when the persisted stream marker is stale', async () => {
    mockGetChatStreamLockOwners.mockResolvedValueOnce({
      status: 'verified',
      ownersByChatId: new Map([['chat-mismatch', 'stream-live']]),
    })

    const markers = await reconcileChatStreamMarkers([
      { chatId: 'chat-mismatch', streamId: 'stream-stale' },
    ])

    expect(markers.get('chat-mismatch')).toEqual({
      chatId: 'chat-mismatch',
      streamId: 'stream-live',
      status: 'active',
    })
  })

  it('preserves persisted stream markers when Redis state is unknown', async () => {
    mockGetChatStreamLockOwners.mockResolvedValueOnce({
      status: 'unknown',
      ownersByChatId: new Map<string, string>(),
    })

    const markers = await reconcileChatStreamMarkers([
      { chatId: 'chat-remote', streamId: 'stream-remote' },
    ])

    expect(markers.get('chat-remote')).toEqual({
      chatId: 'chat-remote',
      streamId: 'stream-remote',
      status: 'unknown',
    })
  })

  it('preserves a persisted marker when unknown local owner differs', async () => {
    mockGetChatStreamLockOwners.mockResolvedValueOnce({
      status: 'unknown',
      ownersByChatId: new Map([['chat-mismatch', 'stream-local']]),
    })

    const markers = await reconcileChatStreamMarkers([
      { chatId: 'chat-mismatch', streamId: 'stream-persisted' },
    ])

    expect(markers.get('chat-mismatch')).toEqual({
      chatId: 'chat-mismatch',
      streamId: 'stream-persisted',
      status: 'unknown',
    })
  })

  it('treats a null persisted marker as inactive even when Redis still holds a lock (post-completion teardown window)', async () => {
    mockGetChatStreamLockOwners.mockResolvedValueOnce({
      status: 'verified',
      ownersByChatId: new Map([['chat-starting', 'stream-starting']]),
    })

    const markers = await reconcileChatStreamMarkers([{ chatId: 'chat-starting', streamId: null }])

    expect(markers.get('chat-starting')).toEqual({
      chatId: 'chat-starting',
      streamId: null,
      status: 'inactive',
    })
  })

  it('does not query locks when no chats have persisted stream markers', async () => {
    const markers = await reconcileChatStreamMarkers([{ chatId: 'chat-idle', streamId: null }])

    expect(markers.get('chat-idle')).toEqual({
      chatId: 'chat-idle',
      streamId: null,
      status: 'inactive',
    })
  })
})
