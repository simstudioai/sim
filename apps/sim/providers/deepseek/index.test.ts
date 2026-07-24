/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderRequest } from '@/providers/types'

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}))

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(
    class {
      chat = { completions: { create: mockCreate } }
    }
  ),
}))

vi.mock('@/providers', () => ({ MAX_TOOL_ITERATIONS: 5 }))

vi.mock('@/providers/models', () => ({
  getProviderModels: vi.fn(() => ['deepseek-chat']),
  getProviderDefaultModel: vi.fn(() => 'deepseek-chat'),
}))

vi.mock('@/providers/attachments', () => ({
  formatMessagesForProvider: vi.fn((messages) => messages),
}))

vi.mock('@/providers/deepseek/utils', () => ({
  createReadableStreamFromDeepseekStream: vi.fn(),
}))

vi.mock('@/providers/openai-compat/streaming-tool-loop', () => ({
  createOpenAICompatStreamingToolLoopStream: vi.fn(),
}))

vi.mock('@/providers/streaming-execution', () => ({
  createStreamingExecution: vi.fn((args) => args),
}))

vi.mock('@/providers/trace-enrichment', () => ({
  enrichLastModelSegmentFromChatCompletions: vi.fn(),
}))

vi.mock('@/providers/utils', () => ({
  calculateCost: vi.fn(() => ({ input: 0, output: 0, total: 0 })),
  prepareToolExecution: vi.fn((_tool, args) => ({ toolParams: args, executionParams: args })),
  prepareToolsWithUsageControl: vi.fn(() => ({
    tools: [],
    toolChoice: undefined,
    forcedTools: [],
    hasFilteredTools: false,
  })),
  sumToolCosts: vi.fn(() => 0),
  trackForcedToolUsage: vi.fn(() => ({ hasUsedForcedTool: false, usedForcedTools: [] })),
}))

vi.mock('@/tools', () => ({ executeTool: vi.fn() }))

import { deepseekProvider } from '@/providers/deepseek/index'

function request(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    model: 'deepseek-chat',
    apiKey: 'test-key',
    messages: [{ role: 'user', content: 'hi' }],
    ...overrides,
  }
}

describe('deepseekProvider thinking payload', () => {
  beforeEach(() => {
    mockCreate.mockReset()
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok', tool_calls: [] } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
  })

  it('sets thinking: { type: enabled } when thinkingLevel is enabled', async () => {
    await deepseekProvider.executeRequest(request({ thinkingLevel: 'enabled' }))
    expect(mockCreate).toHaveBeenCalled()
    const payload = mockCreate.mock.calls[0][0]
    expect(payload.thinking).toEqual({ type: 'enabled' })
  })

  it('sets thinking: { type: disabled } when thinkingLevel is none (API default is enabled)', async () => {
    await deepseekProvider.executeRequest(request({ thinkingLevel: 'none' }))
    const payload = mockCreate.mock.calls[0][0]
    expect(payload.thinking).toEqual({ type: 'disabled' })
  })

  it('omits thinking when thinkingLevel is unset', async () => {
    await deepseekProvider.executeRequest(request())
    const payload = mockCreate.mock.calls[0][0]
    expect(payload.thinking).toBeUndefined()
  })
})
