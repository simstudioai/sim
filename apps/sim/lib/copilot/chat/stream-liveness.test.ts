/**
 * @vitest-environment node
 */
import { copilotChats } from '@sim/db/schema'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetChatStreamLockOwners } = vi.hoisted(() => ({
  mockGetChatStreamLockOwners: vi.fn(),
}))

vi.mock('@/lib/copilot/request/session', () => ({
  getChatStreamLockOwners: mockGetChatStreamLockOwners,
}))

import { reconcileChatStreamMarkers } from '@/lib/copilot/chat/stream-liveness'

describe('reconcileChatStreamMarkers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetChatStreamLockOwners.mockResolvedValue({
      status: 'verified',
      ownersByChatId: new Map<string, string>(),
    })
  })

  afterAll(() => {
    resetDbChainMock()
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

    expect(dbChainMockFns.update).toHaveBeenCalledWith(copilotChats)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ conversationId: null })
    expect(dbChainMockFns.where).toHaveBeenCalledWith(
      and(eq(copilotChats.id, 'chat-stuck'), eq(copilotChats.conversationId, 'stream-orphaned'))
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
