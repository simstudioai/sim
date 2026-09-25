import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  updateMessage: vi.fn(),
}))

vi.mock('@/lib/internal/slack/operations/list-conversations', () => ({
  executeSlackListConversationsOperation: vi.fn(),
}))

vi.mock('@/lib/internal/slack/operations', () => ({
  executeSlackAddReaction: vi.fn(),
  executeSlackDeleteMessage: vi.fn(),
  executeSlackDownload: vi.fn(),
  executeSlackReadMessages: vi.fn(),
  executeSlackRemoveReaction: vi.fn(),
  executeSlackSendEphemeral: vi.fn(),
  executeSlackSendMessage: mocks.sendMessage,
  executeSlackUpdateMessage: mocks.updateMessage,
}))

import { executeSlackTool } from '@/lib/internal/slack/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import { slackMessageTool } from '@/tools/slack/message'
import { slackUpdateMessageTool } from '@/tools/slack/update_message'

const INPUTS = {
  slack_message: { accessToken: 'token', channel: 'C1', text: 'hello' },
  slack_update_message: {
    accessToken: 'token',
    channel: 'C1',
    timestamp: '1.0',
    text: 'updated',
  },
} as const

const DISPATCH = {
  slack_message: mocks.sendMessage,
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

  it.each(['slack_message', 'slack_update_message'] as const)(
    'rejects %s without text or blocks through the real tool input and dispatcher',
    async (toolId) => {
      const params = {
        accessToken: 'token',
        channel: 'C1',
        timestamp: '1.0',
        text: ' \n ',
        blocks: '[]',
      }
      const input =
        toolId === 'slack_message'
          ? slackMessageTool.operation.input(params)
          : slackUpdateMessageTool.operation.input(params)
      const response = await executeSlackTool(request(toolId, { input }))

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({
        error: 'Invalid request data',
        details: expect.arrayContaining([
          expect.objectContaining({
            message: 'Provide message text or at least one Block Kit block',
          }),
        ]),
      })
      expect(DISPATCH[toolId]).not.toHaveBeenCalled()
    }
  )

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
