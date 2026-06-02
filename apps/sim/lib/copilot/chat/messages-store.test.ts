/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)

import {
  appendCopilotChatMessages,
  replaceCopilotChatMessages,
} from '@/lib/copilot/chat/messages-store'
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

const toolMsg: PersistedMessage = {
  id: 'msg-tool-1',
  role: 'assistant',
  content: '',
  timestamp: '2026-01-01T00:00:02.000Z',
  contentBlocks: [
    {
      type: 'tool',
      phase: 'call',
      toolCall: {
        id: 'tc-1',
        name: 'get_workflow_logs',
        state: 'error',
        params: { workflowId: 'wf-1' },
        result: { success: false, output: { huge: 'x'.repeat(5000) }, error: 'too big' },
      },
    },
  ],
}

/** The persisted `content` of the most recently inserted row at `index`. */
function lastRowContent(index: number): PersistedMessage {
  return lastValuesRows()[index].content as PersistedMessage
}

/** The first arg passed to the most recent `.values(...)` call. */
function lastValuesRows() {
  const calls = dbChainMockFns.values.mock.calls
  return calls[calls.length - 1][0] as Array<Record<string, unknown>>
}

describe('messages-store', () => {
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
      const rows = lastValuesRows()
      expect(rows).toHaveLength(2)

      expect(rows[0]).toMatchObject({
        chatId: 'chat-1',
        messageId: 'msg-user-1',
        role: 'user',
        content: userMsg,
        model: null,
        streamId: null,
      })
      expect(rows[0].createdAt as Date).toEqual(new Date(userMsg.timestamp))
      expect(rows[0].updatedAt as Date).toEqual(new Date(userMsg.timestamp))

      expect(rows[1]).toMatchObject({
        chatId: 'chat-1',
        messageId: 'msg-asst-1',
        role: 'assistant',
        content: assistantMsg,
      })
      expect(rows[1].createdAt as Date).toEqual(new Date(assistantMsg.timestamp))
    })

    it('assigns seq as 0-based array index when the chat has no prior rows', async () => {
      dbChainMockFns.where.mockResolvedValueOnce([{ maxSeq: null }])

      await appendCopilotChatMessages('chat-1', [userMsg, assistantMsg])
      const rows = lastValuesRows()
      expect(rows[0].seq).toBe(0)
      expect(rows[1].seq).toBe(1)
    })

    it('continues seq from MAX(seq)+1 when the chat already has rows', async () => {
      dbChainMockFns.where.mockResolvedValueOnce([{ maxSeq: 4 }])

      await appendCopilotChatMessages('chat-1', [userMsg, assistantMsg])
      const rows = lastValuesRows()
      expect(rows[0].seq).toBe(5)
      expect(rows[1].seq).toBe(6)
    })

    it('passes chatModel and streamId options to every row', async () => {
      await appendCopilotChatMessages('chat-1', [userMsg, assistantMsg], {
        chatModel: 'claude-sonnet-4-5',
        streamId: 'stream-xyz',
      })

      const rows = lastValuesRows()
      expect(rows[0].model).toBe('claude-sonnet-4-5')
      expect(rows[0].streamId).toBe('stream-xyz')
      expect(rows[1].model).toBe('claude-sonnet-4-5')
      expect(rows[1].streamId).toBe('stream-xyz')
    })

    it('uses ON CONFLICT DO UPDATE that PRESERVES existing seq', async () => {
      await appendCopilotChatMessages('chat-1', [userMsg])

      expect(dbChainMockFns.onConflictDoUpdate).toHaveBeenCalledTimes(1)
      const conflictArg = dbChainMockFns.onConflictDoUpdate.mock.calls[0][0]
      expect(conflictArg.target).toHaveLength(2)
      expect(conflictArg.set).toHaveProperty('content')
      expect(conflictArg.set).toHaveProperty('role')
      expect(conflictArg.set).toHaveProperty('model')
      expect(conflictArg.set).toHaveProperty('streamId')
      expect(conflictArg.set).toHaveProperty('updatedAt')
      expect(conflictArg.set.seq.strings.join('')).toContain('COALESCE(')
    })

    it('collapses duplicate message ids to a single row', async () => {
      await appendCopilotChatMessages('chat-1', [userMsg, { ...userMsg, content: 'dupe' }])
      const rows = lastValuesRows()
      expect(rows).toHaveLength(1)
      expect(rows[0].messageId).toBe('msg-user-1')
    })

    it('propagates DB errors — copilot_messages is the sole store', async () => {
      dbChainMockFns.onConflictDoUpdate.mockRejectedValueOnce(new Error('connection lost'))

      await expect(appendCopilotChatMessages('chat-1', [userMsg])).rejects.toThrow(
        'connection lost'
      )
    })

    it('strips tool-result output before persisting, keeping success/error', async () => {
      await appendCopilotChatMessages('chat-1', [toolMsg])

      const toolCall = lastRowContent(0).contentBlocks?.[0].toolCall
      expect(toolCall?.result).toEqual({ success: false, error: 'too big' })
      expect(JSON.stringify(lastValuesRows())).not.toContain('huge')
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

      const rows = lastValuesRows()
      expect(rows).toHaveLength(2)
      expect(rows.map((r) => r.messageId)).toEqual(['msg-user-1', 'msg-asst-1'])

      expect(dbChainMockFns.onConflictDoUpdate).toHaveBeenCalledTimes(1)
      const conflictArg = dbChainMockFns.onConflictDoUpdate.mock.calls[0][0]
      expect(conflictArg.set).toHaveProperty('streamId')
      expect(conflictArg.set).toHaveProperty('model')
    })

    it('assigns seq as the snapshot array index (0-based)', async () => {
      await replaceCopilotChatMessages('chat-1', [userMsg, assistantMsg])
      const rows = lastValuesRows()
      expect(rows[0].seq).toBe(0)
      expect(rows[1].seq).toBe(1)
    })

    it('OVERWRITES seq on conflict so positions re-densify after a delete', async () => {
      await replaceCopilotChatMessages('chat-1', [userMsg])
      const conflictArg = dbChainMockFns.onConflictDoUpdate.mock.calls[0][0]
      expect(conflictArg.set.seq.strings.join('')).toBe('excluded.seq')
    })

    it('collapses duplicate message ids to a single row', async () => {
      await replaceCopilotChatMessages('chat-1', [userMsg, { ...userMsg, content: 'dupe' }])
      const rows = lastValuesRows()
      expect(rows).toHaveLength(1)
      expect(rows[0].seq).toBe(0)
    })

    it('passes chatModel to every row in the snapshot', async () => {
      await replaceCopilotChatMessages('chat-1', [userMsg], {
        chatModel: 'gpt-4o-mini',
      })

      const rows = lastValuesRows()
      expect(rows[0].model).toBe('gpt-4o-mini')
    })

    it('propagates DB errors — the snapshot is authoritative', async () => {
      dbChainMockFns.transaction.mockRejectedValueOnce(new Error('tx aborted'))

      await expect(replaceCopilotChatMessages('chat-1', [userMsg])).rejects.toThrow('tx aborted')
    })

    it('strips tool-result output before persisting, keeping success/error', async () => {
      await replaceCopilotChatMessages('chat-1', [toolMsg])

      const toolCall = lastRowContent(0).contentBlocks?.[0].toolCall
      expect(toolCall?.result).toEqual({ success: false, error: 'too big' })
      expect(JSON.stringify(lastValuesRows())).not.toContain('huge')
    })
  })
})
