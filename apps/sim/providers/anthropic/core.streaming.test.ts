/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import type { StreamingExecution } from '@/executor/types'
import { executeAnthropicProviderRequest } from '@/providers/anthropic/core'
import type { AgentStreamEvent } from '@/providers/stream-events'

const { mockExecuteTool } = vi.hoisted(() => ({
  mockExecuteTool: vi.fn(),
}))

vi.mock('@/tools', () => ({
  executeTool: mockExecuteTool,
}))

function message(content: unknown[], stopReason: string) {
  return {
    id: `msg-${stopReason}`,
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-5',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 2, output_tokens: 2 },
  }
}

function stream(events: unknown[], finalMessage: ReturnType<typeof message>) {
  return {
    async *[Symbol.asyncIterator]() {
      yield* events
    },
    finalMessage: async () => finalMessage,
  }
}

async function collectEvents(result: StreamingExecution): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = []
  const reader = result.stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) return events
    events.push(value)
  }
}

describe('executeAnthropicProviderRequest live tool streaming', () => {
  it.each([
    ['anthropic', 'Anthropic'],
    ['azure-anthropic', 'Azure Anthropic'],
  ] as const)(
    'uses the live loop for %s streaming tool requests without a caller flag',
    async (providerId, providerLabel) => {
      const model =
        providerId === 'azure-anthropic' ? 'azure-anthropic/claude-sonnet-4-5' : 'claude-sonnet-4-5'
      mockExecuteTool.mockResolvedValue({ success: true, output: { value: 'tool result' } })

      const toolMessage = message(
        [{ type: 'tool_use', id: 'tool-1', name: 'lookup', input: {} }],
        'tool_use'
      )
      const answerMessage = message([{ type: 'text', text: 'settled answer' }], 'end_turn')
      const createStream = vi
        .fn()
        .mockReturnValueOnce(
          stream(
            [
              {
                type: 'content_block_start',
                index: 0,
                content_block: {
                  type: 'tool_use',
                  id: 'tool-1',
                  name: 'lookup',
                  input: {},
                },
              },
              { type: 'content_block_stop', index: 0 },
              { type: 'message_stop' },
            ],
            toolMessage
          )
        )
        .mockReturnValueOnce(
          stream(
            [
              {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'text', text: '' },
              },
              {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: 'settled answer' },
              },
              { type: 'content_block_stop', index: 0 },
              { type: 'message_stop' },
            ],
            answerMessage
          )
        )

      const result = (await executeAnthropicProviderRequest(
        {
          model,
          apiKey: 'test-key',
          stream: true,
          maxTokens: 1024,
          messages: [{ role: 'user', content: 'Look this up' }],
          tools: [
            {
              id: 'lookup',
              name: 'lookup',
              description: 'Lookup',
              params: {},
              parameters: { type: 'object', properties: {}, required: [] },
            },
          ],
        },
        {
          providerId,
          providerLabel,
          ...(providerId === 'azure-anthropic'
            ? { resolveWireModel: () => 'claude-sonnet-4-5' }
            : {}),
          createClient: () => ({ messages: { stream: createStream } }) as never,
          logger: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
          },
        }
      )) as StreamingExecution

      const events = await collectEvents(result)

      expect(createStream).toHaveBeenCalledTimes(2)
      expect(createStream.mock.calls[0][0].model).toBe('claude-sonnet-4-5')
      expect(events).toContainEqual({
        type: 'text_delta',
        text: 'settled answer',
        turn: 'pending',
      })
      expect(events).toContainEqual({ type: 'turn_end', turn: 'final' })
      expect(result.execution.output.content).toBe('settled answer')
      expect(result.execution.output.model).toBe(model)
      expect(
        result.execution.output.providerTiming?.timeSegments
          ?.filter((segment) => segment.type === 'model')
          .map((segment) => segment.provider)
      ).toEqual([providerId, providerId])
    }
  )
})
