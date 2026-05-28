/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)

import {
  appendCopilotChatMessages,
  replaceCopilotChatMessages,
} from '@/lib/copilot/chat/messages-dual-write'
import type { PersistedMessage } from '@/lib/copilot/chat/persisted-message'

const userMsg: PersistedMessage = {
  id: 'msg-user-1',
  role: 'user',
  content: 'Hello',
  timestamp: '2026-01-01T00:00:00.000Z',
}

const assistantMsg: PersistedMessage = {
  id: 'msg-asst-1',
  role: 'assistant',
  content: 'Hi back',
  timestamp: '2026-01-01T00:00:01.000Z',
}

describe('messages-dual-write', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  describe('appendCopilotChatMessages', () => {
    it('is a no-op on empty array', async () => {
      await appendCopilotChatMessages('chat-1', [])
      expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    })

    it('inserts rows built from PersistedMessage shape', async () => {
      await appendCopilotChatMessages('chat-1', [userMsg, assistantMsg])

      expect(dbChainMockFns.insert).toHaveBeenCalledTimes(1)
      expect(dbChainMockFns.values).toHaveBeenCalledTimes(1)
      const rows = dbChainMockFns.values.mock.calls[0][0]
      expect(rows).toHaveLength(2)

      expect(rows[0]).toMatchObject({
        chatId: 'chat-1',
        messageId: 'msg-user-1',
        role: 'user',
        content: userMsg,
        model: null,
        streamId: null,
      })
      expect(rows[0].createdAt).toEqual(new Date(userMsg.timestamp))
      expect(rows[0].updatedAt).toEqual(new Date(userMsg.timestamp))

      expect(rows[1]).toMatchObject({
        chatId: 'chat-1',
        messageId: 'msg-asst-1',
        role: 'assistant',
        content: assistantMsg,
      })
      expect(rows[1].createdAt).toEqual(new Date(assistantMsg.timestamp))
    })

    it('preserves per-message ordering via timestamp', async () => {
      await appendCopilotChatMessages('chat-1', [userMsg, assistantMsg])
      const rows = dbChainMockFns.values.mock.calls[0][0]
      expect(rows[0].createdAt.getTime()).toBeLessThan(rows[1].createdAt.getTime())
    })

    it('passes chatModel and streamId options to every row', async () => {
      await appendCopilotChatMessages('chat-1', [userMsg, assistantMsg], {
        chatModel: 'claude-sonnet-4-5',
        streamId: 'stream-xyz',
      })

      const rows = dbChainMockFns.values.mock.calls[0][0]
      expect(rows[0].model).toBe('claude-sonnet-4-5')
      expect(rows[0].streamId).toBe('stream-xyz')
      expect(rows[1].model).toBe('claude-sonnet-4-5')
      expect(rows[1].streamId).toBe('stream-xyz')
    })

    it('uses ON CONFLICT DO UPDATE with chat_id + message_id target', async () => {
      await appendCopilotChatMessages('chat-1', [userMsg])

      expect(dbChainMockFns.onConflictDoUpdate).toHaveBeenCalledTimes(1)
      const conflictArg = dbChainMockFns.onConflictDoUpdate.mock.calls[0][0]
      expect(conflictArg.target).toHaveLength(2)
      expect(conflictArg.set).toHaveProperty('content')
      expect(conflictArg.set).toHaveProperty('role')
      expect(conflictArg.set).toHaveProperty('model')
      expect(conflictArg.set).toHaveProperty('streamId')
      expect(conflictArg.set).toHaveProperty('updatedAt')
    })

    it('swallows DB errors so the legacy JSONB write stays canonical', async () => {
      dbChainMockFns.onConflictDoUpdate.mockRejectedValueOnce(new Error('connection lost'))

      await expect(appendCopilotChatMessages('chat-1', [userMsg])).resolves.toBeUndefined()
    })
  })

  describe('replaceCopilotChatMessages', () => {
    it('deletes all chat rows when given an empty snapshot', async () => {
      await replaceCopilotChatMessages('chat-1', [])

      expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
      expect(dbChainMockFns.delete).toHaveBeenCalledTimes(1)
      expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    })

    it('deletes only rows whose message_id is not in the new snapshot, then upserts', async () => {
      await replaceCopilotChatMessages('chat-1', [userMsg, assistantMsg])

      expect(dbChainMockFns.delete).toHaveBeenCalledTimes(1)
      expect(dbChainMockFns.insert).toHaveBeenCalledTimes(1)

      const rows = dbChainMockFns.values.mock.calls[0][0]
      expect(rows).toHaveLength(2)
      expect(rows.map((r: { messageId: string }) => r.messageId)).toEqual([
        'msg-user-1',
        'msg-asst-1',
      ])

      expect(dbChainMockFns.onConflictDoUpdate).toHaveBeenCalledTimes(1)
      const conflictArg = dbChainMockFns.onConflictDoUpdate.mock.calls[0][0]
      expect(conflictArg.set).toHaveProperty('streamId')
      expect(conflictArg.set).toHaveProperty('model')
    })

    it('passes chatModel to every row in the snapshot', async () => {
      await replaceCopilotChatMessages('chat-1', [userMsg], {
        chatModel: 'gpt-4o-mini',
      })

      const rows = dbChainMockFns.values.mock.calls[0][0]
      expect(rows[0].model).toBe('gpt-4o-mini')
    })

    it('swallows DB errors so the legacy JSONB write stays canonical', async () => {
      dbChainMockFns.transaction.mockRejectedValueOnce(new Error('tx aborted'))

      await expect(replaceCopilotChatMessages('chat-1', [userMsg])).resolves.toBeUndefined()
    })
  })
})
