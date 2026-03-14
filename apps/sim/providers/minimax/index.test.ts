/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreate, MockOpenAI } = vi.hoisted(() => {
  const mockCreate = vi.fn()
  const MockOpenAI = vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  }))
  return { mockCreate, MockOpenAI }
})

vi.mock('openai', () => ({
  default: MockOpenAI,
}))

vi.mock('@/tools', () => ({
  executeTool: vi.fn(),
}))

import { minimaxProvider } from '@/providers/minimax'

describe('MiniMax Provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('provider metadata', () => {
    it('has correct id and name', () => {
      expect(minimaxProvider.id).toBe('minimax')
      expect(minimaxProvider.name).toBe('MiniMax')
    })

    it('has correct version', () => {
      expect(minimaxProvider.version).toBe('1.0.0')
    })

    it('has models defined', () => {
      expect(minimaxProvider.models).toBeDefined()
      expect(minimaxProvider.models.length).toBeGreaterThan(0)
    })

    it('has default model set', () => {
      expect(minimaxProvider.defaultModel).toBe('MiniMax-M2.5')
    })
  })

  describe('executeRequest', () => {
    it('throws when API key is missing', async () => {
      await expect(
        minimaxProvider.executeRequest({
          model: 'MiniMax-M2.5',
          messages: [{ role: 'user', content: 'Hello' }],
        })
      ).rejects.toThrow('API key is required for MiniMax')
    })

    it('creates OpenAI client with correct base URL', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'Hello!', tool_calls: undefined } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })

      await minimaxProvider.executeRequest({
        model: 'MiniMax-M2.5',
        apiKey: 'test-key',
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(MockOpenAI).toHaveBeenCalledWith({
        apiKey: 'test-key',
        baseURL: 'https://api.minimax.io/v1',
      })
    })

    it('returns content from response', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'Hello from MiniMax!', tool_calls: undefined } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })

      const result = await minimaxProvider.executeRequest({
        model: 'MiniMax-M2.5',
        apiKey: 'test-key',
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(result).toHaveProperty('content', 'Hello from MiniMax!')
    })

    it('clamps temperature to valid range', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'ok', tool_calls: undefined } }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      })

      await minimaxProvider.executeRequest({
        model: 'MiniMax-M2.5',
        apiKey: 'test-key',
        temperature: 0,
        messages: [{ role: 'user', content: 'Hi' }],
      })

      const callArgs = mockCreate.mock.calls[0][0]
      expect(callArgs.temperature).toBeGreaterThan(0)
      expect(callArgs.temperature).toBeLessThanOrEqual(1)
    })

    it('includes system prompt when provided', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'ok', tool_calls: undefined } }],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      })

      await minimaxProvider.executeRequest({
        model: 'MiniMax-M2.5',
        apiKey: 'test-key',
        systemPrompt: 'You are a helpful assistant',
        messages: [{ role: 'user', content: 'Hi' }],
      })

      const callArgs = mockCreate.mock.calls[0][0]
      expect(callArgs.messages[0]).toEqual({
        role: 'system',
        content: 'You are a helpful assistant',
      })
    })

    it('returns token usage information', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'Hello!', tool_calls: undefined } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })

      const result = await minimaxProvider.executeRequest({
        model: 'MiniMax-M2.5',
        apiKey: 'test-key',
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(result).toHaveProperty('tokens')
      const response = result as any
      expect(response.tokens.input).toBe(10)
      expect(response.tokens.output).toBe(5)
      expect(response.tokens.total).toBe(15)
    })
  })
})
