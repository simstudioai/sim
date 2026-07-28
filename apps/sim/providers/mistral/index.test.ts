/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStreamEvent } from '@/providers/stream-events'
import type { ProviderToolConfig } from '@/providers/types'

const { mockCreate, mockExecuteTool } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockExecuteTool: vi.fn(),
}))

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(
    class {
      chat = { completions: { create: mockCreate } }
    }
  ),
}))
vi.mock('@/providers', () => ({ MAX_TOOL_ITERATIONS: 20 }))
vi.mock('@/providers/attachments', () => ({
  formatMessagesForProvider: (messages: unknown) => messages,
}))
vi.mock('@/providers/mistral/utils', () => ({
  createReadableStreamFromMistralStream: vi.fn(),
}))
vi.mock('@/providers/models', () => ({
  getProviderFileAttachment: vi
    .fn()
    .mockReturnValue({ maxBytes: 10 * 1024 * 1024, strategy: 'inline' }),
  INLINE_ATTACHMENT_MAX_BYTES: 10 * 1024 * 1024,
  getProviderModels: vi.fn(() => []),
  getProviderDefaultModel: vi.fn(() => 'mistral-large-latest'),
}))
vi.mock('@/providers/trace-enrichment', () => ({
  enrichLastModelSegmentFromChatCompletions: vi.fn(),
}))
vi.mock('@/providers/utils', () => ({
  calculateCost: vi.fn(() => ({ input: 0, output: 0, total: 0 })),
  prepareToolExecution: vi.fn((_tool, args) => ({ toolParams: args, executionParams: args })),
  prepareToolsWithUsageControl: vi.fn((tools) => ({
    tools,
    toolChoice: 'auto',
    forcedTools: [],
  })),
  sumToolCosts: vi.fn(() => 0),
  trackForcedToolUsage: vi.fn(() => ({ hasUsedForcedTool: false, usedForcedTools: [] })),
}))
vi.mock('@/tools', () => ({ executeTool: mockExecuteTool }))

import { mistralProvider } from '@/providers/mistral'

function makeTool(id: string): ProviderToolConfig {
  return {
    id,
    name: id,
    description: '',
    params: {},
    parameters: { type: 'object', properties: {}, required: [] },
  }
}

async function readAgentEvents(stream: ReadableStream<AgentStreamEvent>) {
  const events: AgentStreamEvent[] = []
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) return events
    events.push(value)
  }
}

describe('mistralProvider.executeRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecuteTool.mockResolvedValue({ success: true, output: { ok: true } })
  })

  it('projects the settled tool-loop answer without a final streaming request', async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'lookup', arguments: '{}' },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'done', tool_calls: undefined } }],
        usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
      })

    const result = await mistralProvider.executeRequest!({
      model: 'mistral-large-latest',
      apiKey: 'key',
      messages: [{ role: 'user', content: 'Use a tool' }],
      stream: true,
      tools: [makeTool('lookup')],
    })

    expect(mockCreate).toHaveBeenCalledTimes(2)
    expect(mockExecuteTool).toHaveBeenCalledTimes(1)
    expect('stream' in result).toBe(true)
    if (!('stream' in result)) throw new Error('Expected streaming execution')
    expect(result.execution.output.content).toBe('done')
    expect(result.execution.output.tokens).toEqual({ input: 6, output: 3, total: 9 })
    expect(result.execution.output.providerTiming?.iterations).toBe(2)
    expect(
      result.execution.output.providerTiming?.timeSegments?.filter(
        (segment) => segment.type === 'model'
      )
    ).toHaveLength(2)
    await expect(
      readAgentEvents(result.stream as ReadableStream<AgentStreamEvent>)
    ).resolves.toEqual([{ type: 'text_delta', text: 'done', turn: 'final' }])
  })
})
