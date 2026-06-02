/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)

const { mockAuthorizeWorkflow, mockGetActiveWorkflow } = vi.hoisted(() => ({
  mockAuthorizeWorkflow: vi.fn(),
  mockGetActiveWorkflow: vi.fn(),
}))

vi.mock('@sim/workflow-authz', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflow,
  getActiveWorkflowRecord: mockGetActiveWorkflow,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  assertActiveWorkspaceAccess: vi.fn(),
  checkWorkspaceAccess: vi.fn(),
}))

import {
  getAccessibleCopilotChat,
  getAccessibleCopilotChatWithMessages,
  resolveOrCreateChat,
} from '@/lib/copilot/chat/lifecycle'

const CHAT_ID = 'chat-1'
const USER_ID = 'user-1'

// A chat with no workflow/workspace skips the authz lookups and authorizes directly.
const chatRow = {
  id: CHAT_ID,
  userId: USER_ID,
  workflowId: null,
  workspaceId: null,
  type: 'copilot',
  title: 'Test',
  conversationId: null,
  resources: [],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

const userMsg = { id: 'm-user', role: 'user', content: 'Hi', timestamp: '2026-01-01T00:00:00.000Z' }
const asstMsg = {
  id: 'm-asst',
  role: 'assistant',
  content: 'Hello',
  timestamp: '2026-01-01T00:00:01.000Z',
}

describe('lifecycle copilot chat reads (cutover to copilot_messages)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('getAccessibleCopilotChatWithMessages sources messages from copilot_messages in seq order', async () => {
    // 1st query: chat metadata (select().from().where().limit())
    dbChainMockFns.limit.mockResolvedValueOnce([chatRow])
    // 2nd query: messages (select().from().where().orderBy())
    dbChainMockFns.orderBy.mockResolvedValueOnce([{ content: userMsg }, { content: asstMsg }])

    const result = await getAccessibleCopilotChatWithMessages(CHAT_ID, USER_ID)

    expect(result).not.toBeNull()
    expect(result?.messages).toEqual([userMsg, asstMsg])
    expect(dbChainMockFns.orderBy).toHaveBeenCalledTimes(1)
  })

  it('strips tool-result output on read, keeping success/error', async () => {
    const toolMsg = {
      id: 'm-tool',
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
            state: 'success',
            result: { success: true, output: { huge: 'x'.repeat(5000) } },
          },
        },
      ],
    }
    dbChainMockFns.limit.mockResolvedValueOnce([chatRow])
    dbChainMockFns.orderBy.mockResolvedValueOnce([{ content: toolMsg }])

    const result = await getAccessibleCopilotChatWithMessages(CHAT_ID, USER_ID)

    expect(result?.messages?.[0].contentBlocks?.[0].toolCall?.result).toEqual({ success: true })
    expect(JSON.stringify(result?.messages)).not.toContain('huge')
  })

  it('returns an empty transcript for a chat with no messages', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([chatRow])
    dbChainMockFns.orderBy.mockResolvedValueOnce([])

    const result = await getAccessibleCopilotChatWithMessages(CHAT_ID, USER_ID)

    expect(result?.messages).toEqual([])
  })

  it('returns null and does NOT query messages when the chat is not found', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    const result = await getAccessibleCopilotChatWithMessages(CHAT_ID, USER_ID)

    expect(result).toBeNull()
    expect(dbChainMockFns.orderBy).not.toHaveBeenCalled()
  })

  it('returns null and does NOT query messages when the row is found but authorization fails', async () => {
    // Row exists but belongs to a workflow the user cannot read.
    dbChainMockFns.limit.mockResolvedValueOnce([{ ...chatRow, workflowId: 'wf-1' }])
    mockAuthorizeWorkflow.mockResolvedValueOnce({ allowed: false, workflow: null })

    const result = await getAccessibleCopilotChatWithMessages(CHAT_ID, USER_ID)

    expect(result).toBeNull()
    expect(dbChainMockFns.orderBy).not.toHaveBeenCalled()
  })

  it('legacy getAccessibleCopilotChat also assembles messages from copilot_messages', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { ...chatRow, model: 'm', planArtifact: null, config: null },
    ])
    dbChainMockFns.orderBy.mockResolvedValueOnce([{ content: userMsg }])

    const result = await getAccessibleCopilotChat(CHAT_ID, USER_ID)

    expect(result?.messages).toEqual([userMsg])
  })

  it('resolveOrCreateChat returns conversationHistory from the table for an existing chat', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([chatRow])
    dbChainMockFns.orderBy.mockResolvedValueOnce([{ content: userMsg }, { content: asstMsg }])

    const result = await resolveOrCreateChat({ chatId: CHAT_ID, userId: USER_ID, model: 'm' })

    expect(result.isNew).toBe(false)
    expect(result.conversationHistory).toEqual([userMsg, asstMsg])
  })

  it('resolveOrCreateChat creates a new chat with an empty transcript', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([chatRow])

    const result = await resolveOrCreateChat({ userId: USER_ID, model: 'm' })

    expect(result.isNew).toBe(true)
    expect(result.conversationHistory).toEqual([])
    expect(result.chat?.messages).toEqual([])
    const insertValues = dbChainMockFns.values.mock.calls[0]?.[0] as Record<string, unknown>
    expect(Object.hasOwn(insertValues, 'messages')).toBe(false)
    // a brand-new chat must not trigger a messages read
    expect(dbChainMockFns.orderBy).not.toHaveBeenCalled()
  })
})
