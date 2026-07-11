/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnsureHandlersRegistered, mockExecuteProviderRequest, mockExecuteTool } = vi.hoisted(
  () => ({
    mockEnsureHandlersRegistered: vi.fn(),
    mockExecuteProviderRequest: vi.fn(),
    mockExecuteTool: vi.fn(),
  })
)

vi.mock('@/lib/core/config/env', () => ({
  env: { MOTHERSHIP_MODEL: 'litellm/test-model' },
}))

vi.mock('@/providers', () => ({
  executeProviderRequest: mockExecuteProviderRequest,
}))

vi.mock('@/lib/copilot/tool-executor', () => ({
  ensureHandlersRegistered: mockEnsureHandlersRegistered,
  executeTool: mockExecuteTool,
}))

vi.mock('@/lib/copilot/request/local/messages', () => ({
  buildLocalWorkspaceMessages: vi.fn().mockResolvedValue([{ role: 'user', content: 'hello' }]),
}))

vi.mock('@/lib/copilot/request/local/prompt', () => ({
  buildLocalWorkspaceSystemPrompt: vi.fn(() => 'system prompt'),
}))

vi.mock('@/lib/copilot/request/local/tools', () => ({
  buildLocalWorkspaceTools: vi.fn(() => [
    {
      id: 'user_table',
      name: 'user_table',
      description: 'table tool',
      params: {},
      parameters: { type: 'object', properties: {}, required: [] },
    },
  ]),
}))

import { createStreamingContext } from '@/lib/copilot/request/context/request-context'
import { runLocalMothershipLifecycle } from './lifecycle'

describe('runLocalMothershipLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecuteTool.mockResolvedValue({ success: true, output: { rows: [{ name: 'Ada' }] } })
    mockExecuteProviderRequest.mockImplementation(async (_provider, request) => {
      await request.toolExecutor({
        toolCallId: 'call-1',
        toolId: 'user_table',
        params: { operation: 'get_rows', tableId: 'table-1' },
      })
      return {
        content: 'The table contains Ada.',
        model: 'litellm/test-model',
        tokens: { input: 10, output: 5, total: 15 },
        cost: { input: 0.01, output: 0.02, total: 0.03 },
      }
    })
  })

  it('executes Sim tools and emits compatible tool and text events', async () => {
    const context = createStreamingContext({ messageId: 'message-1' })
    const onEvent = vi.fn()

    await runLocalMothershipLifecycle(
      { message: 'Read the table.' },
      context,
      {
        userId: 'user-1',
        workflowId: '',
        workspaceId: 'workspace-1',
        chatId: 'chat-1',
      },
      {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        chatId: 'chat-1',
        onEvent,
      }
    )

    expect(mockEnsureHandlersRegistered).toHaveBeenCalledOnce()
    expect(mockExecuteTool).toHaveBeenCalledWith(
      'user_table',
      { operation: 'get_rows', tableId: 'table-1' },
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        copilotToolExecution: true,
      })
    )
    expect(onEvent.mock.calls.map(([event]) => event.type)).toEqual(['tool', 'tool', 'text'])
    expect(context.accumulatedContent).toBe('The table contains Ada.')
    expect(context.toolCalls.get('call-1')).toMatchObject({
      name: 'user_table',
      status: 'success',
      result: { success: true, output: { rows: [{ name: 'Ada' }] } },
    })
    expect(context.usage).toEqual({ prompt: 10, completion: 5 })
    expect(context.cost).toEqual({ input: 0.01, output: 0.02, total: 0.03 })
  })
})
