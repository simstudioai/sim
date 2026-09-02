/**
 * @vitest-environment node
 */
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

import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { SlackOperationError } from '@/lib/internal/slack/errors'
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
  slack_list_channels: { accessToken: 'token', limit: 100, maxPages: 10 },
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
    vi.clearAllMocks()
    for (const operation of Object.values(DISPATCH)) {
      operation.mockResolvedValue({ success: true, output: { ok: true } })
    }
  })

  it.each(Object.keys(INPUTS) as Array<keyof typeof INPUTS>)(
    'validates and dispatches %s from typed input',
    async (toolId) => {
      const controller = new AbortController()
      const response = await executeSlackTool(request(toolId, { signal: controller.signal }))

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ success: true, output: { ok: true } })
      expect(DISPATCH[toolId]).toHaveBeenCalledOnce()
      expect(DISPATCH[toolId].mock.calls[0]?.[0]).toEqual(INPUTS[toolId])
      if (toolId === 'slack_message') {
        expect(DISPATCH[toolId].mock.calls[0]?.[1]).toEqual({
          requestId: 'request-1',
          signal: controller.signal,
          userId: 'user-1',
        })
      } else if (toolId === 'slack_list_channels') {
        expect(DISPATCH[toolId].mock.calls[0]?.[1]).toBe(controller.signal)
        expect(DISPATCH[toolId].mock.calls[0]?.[2]).toMatchObject({
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          userId: 'user-1',
        })
      } else {
        expect(DISPATCH[toolId].mock.calls[0]?.[1]).toBe(controller.signal)
      }
    }
  )

  it('returns the canonical validation envelope before provider work', async () => {
    const response = await executeSlackTool(
      request('slack_add_reaction', { input: { accessToken: '', channel: '' } })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(mocks.addReaction).not.toHaveBeenCalled()
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

  it('preserves Slack logical-error status and envelope', async () => {
    mocks.addReaction.mockRejectedValue(
      new SlackOperationError(200, { success: false, error: 'already_reacted' })
    )

    const response = await executeSlackTool(request('slack_add_reaction'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'already_reacted',
    })
  })

  it('propagates cancellation before validation or provider work', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeSlackTool(request('slack_download', { signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('retains the clean 413 projection for oversized Slack downloads', async () => {
    mocks.download.mockRejectedValue(
      new PayloadSizeLimitError({
        label: 'response body',
        maxBytes: 10,
        observedBytes: 11,
      })
    )

    const response = await executeSlackTool(request('slack_download'))

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({ success: false })
  })
})
