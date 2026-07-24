/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderRequest } from '@/providers/types'

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}))

vi.mock('groq-sdk', () => ({
  Groq: vi.fn().mockImplementation(
    class {
      chat = { completions: { create: mockCreate } }
    }
  ),
}))

vi.mock('@/providers', () => ({ MAX_TOOL_ITERATIONS: 5 }))

vi.mock('@/providers/models', () => ({
  getProviderModels: vi.fn(() => ['groq/openai/gpt-oss-120b']),
  getProviderDefaultModel: vi.fn(() => 'groq/openai/gpt-oss-120b'),
}))

vi.mock('@/providers/attachments', () => ({
  formatMessagesForProvider: vi.fn((messages) => messages),
}))

vi.mock('@/providers/groq/utils', () => ({
  createReadableStreamFromGroqStream: vi.fn(),
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

import { groqProvider } from '@/providers/groq/index'

function request(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    model: 'groq/openai/gpt-oss-120b',
    apiKey: 'test-key',
    messages: [{ role: 'user', content: 'hi' }],
    ...overrides,
  }
}

describe('groqProvider reasoning payload', () => {
  beforeEach(() => {
    mockCreate.mockReset()
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok', tool_calls: [] } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
  })

  it('GPT-OSS sets include_reasoning and reasoning_effort', async () => {
    await groqProvider.executeRequest(
      request({ model: 'groq/openai/gpt-oss-120b', reasoningEffort: 'high' })
    )
    const payload = mockCreate.mock.calls[0][0]
    expect(payload.model).toBe('openai/gpt-oss-120b')
    expect(payload.include_reasoning).toBe(true)
    expect(payload.reasoning_effort).toBe('high')
    expect(payload.reasoning_format).toBeUndefined()
  })

  it('GPT-OSS sends no reasoning params when effort and thinking are unset (legacy request shape)', async () => {
    await groqProvider.executeRequest(request({ model: 'groq/openai/gpt-oss-20b' }))
    const payload = mockCreate.mock.calls[0][0]
    expect(payload.include_reasoning).toBeUndefined()
    expect(payload.reasoning_effort).toBeUndefined()
  })

  it('GPT-OSS defaults reasoning_effort to medium when only a thinking level is set', async () => {
    await groqProvider.executeRequest(
      request({ model: 'groq/openai/gpt-oss-20b', thinkingLevel: 'enabled' })
    )
    const payload = mockCreate.mock.calls[0][0]
    expect(payload.include_reasoning).toBe(true)
    expect(payload.reasoning_effort).toBe('medium')
  })

  it('Qwen sets reasoning_format parsed when thinking enabled', async () => {
    await groqProvider.executeRequest(
      request({
        model: 'groq/qwen/qwen3-32b',
        thinkingLevel: 'enabled',
      })
    )
    const payload = mockCreate.mock.calls[0][0]
    expect(payload.reasoning_format).toBe('parsed')
    expect(payload.include_reasoning).toBeUndefined()
  })

  it('Qwen disables reasoning via reasoning_effort none when thinking is none', async () => {
    await groqProvider.executeRequest(
      request({
        model: 'groq/qwen/qwen3.6-27b',
        thinkingLevel: 'none',
      })
    )
    const payload = mockCreate.mock.calls[0][0]
    expect(payload.reasoning_format).toBeUndefined()
    expect(payload.reasoning_effort).toBe('none')
  })
})
