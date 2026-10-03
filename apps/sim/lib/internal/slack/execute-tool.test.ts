import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  addReaction: vi.fn(),
  deleteMessage: vi.fn(),
  download: vi.fn(),
  listConversations: vi.fn(),
  readMessages: vi.fn(),
  removeReaction: vi.fn(),
  sendEphemeral: vi.fn(),
  sendMessage: vi.fn(),
  updateMessage: vi.fn(),
}))

vi.mock('@/lib/internal/slack/operations/list-conversations', () => ({
  executeSlackListConversationsOperation: mocks.listConversations,
}))

vi.mock('@/lib/internal/slack/operations', () => ({
  executeSlackAddReaction: mocks.addReaction,
  executeSlackDeleteMessage: mocks.deleteMessage,
  executeSlackDownload: mocks.download,
  executeSlackReadMessages: mocks.readMessages,
  executeSlackRemoveReaction: mocks.removeReaction,
  executeSlackSendEphemeral: mocks.sendEphemeral,
  executeSlackSendMessage: mocks.sendMessage,
  executeSlackUpdateMessage: mocks.updateMessage,
}))

import { executeSlackTool } from '@/lib/internal/slack/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const INPUTS = {
  slack_add_reaction: {
    accessToken: 'token',
    channel: 'C1',
    timestamp: '1.0',
    name: 'eyes',
  },
  slack_delete_message: { accessToken: 'token', channel: 'C1', timestamp: '1.0' },
  slack_download: { accessToken: 'token', fileId: 'F1', fileName: 'report.pdf' },
  slack_list_channels: { accessToken: 'token', limit: 100, cursor: 'cursor-1' },
  slack_ephemeral_message: {
    accessToken: 'token',
    channel: 'C1',
    user: 'U1',
    text: 'hello',
  },
  slack_message: { accessToken: 'token', channel: 'C1', text: 'hello' },
  slack_message_reader: { accessToken: 'token', channel: 'C1', limit: 2 },
  slack_remove_reaction: {
    accessToken: 'token',
    channel: 'C1',
    timestamp: '1.0',
    name: 'eyes',
  },
  slack_update_message: {
    accessToken: 'token',
    channel: 'C1',
    timestamp: '1.0',
    text: 'updated',
  },
} as const

const DISPATCH = {
  slack_add_reaction: mocks.addReaction,
  slack_delete_message: mocks.deleteMessage,
  slack_download: mocks.download,
  slack_list_channels: mocks.listConversations,
  slack_ephemeral_message: mocks.sendEphemeral,
  slack_message: mocks.sendMessage,
  slack_message_reader: mocks.readMessages,
  slack_remove_reaction: mocks.removeReaction,
  slack_update_message: mocks.updateMessage,
} as const

function request(
  toolId: keyof typeof INPUTS,
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId,
    input: INPUTS[toolId],
    headers: new Headers(),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      userId: 'user-1',
      workspaceId: 'workspace-1',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

describe('executeSlackTool', () => {
  beforeEach(() => {
    for (const operation of Object.values(DISPATCH)) {
      operation.mockResolvedValue({ success: true, output: { ok: true } })
    }
  })

  it('keeps message file authority tied to the trusted execution context', async () => {
    const response = await executeSlackTool(
      request('slack_message', {
        context: { ...createExecutionContext({ workflowId: 'workflow-1' }), userId: undefined },
      })
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Authentication required',
    })
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })
})
