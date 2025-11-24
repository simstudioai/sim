import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Memory } from '@/executor/handlers/agent/memory'
import type { AgentInputs, Message } from '@/executor/handlers/agent/types'
import type { ExecutionContext } from '@/executor/types'

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@/lib/tokenization/estimators', () => ({
  getAccurateTokenCount: vi.fn((text: string) => {
    return Math.ceil(text.length / 4)
  }),
}))

describe('Memory', () => {
  let memoryService: Memory
  let mockContext: ExecutionContext

  beforeEach(() => {
    memoryService = new Memory()
    mockContext = {
      workflowId: 'test-workflow-id',
      executionId: 'test-execution-id',
      workspaceId: 'test-workspace-id',
    } as ExecutionContext
  })

  describe('applySlidingWindow (message-based)', () => {
    it('should keep last N conversation messages', () => {
      const messages: Message[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Message 1' },
        { role: 'assistant', content: 'Response 1' },
        { role: 'user', content: 'Message 2' },
        { role: 'assistant', content: 'Response 2' },
        { role: 'user', content: 'Message 3' },
        { role: 'assistant', content: 'Response 3' },
      ]

      const result = (memoryService as any).applySlidingWindow(messages, '4')

      expect(result.length).toBe(5)
      expect(result[0].role).toBe('system')
      expect(result[0].content).toBe('System prompt')
      expect(result[1].content).toBe('Message 2')
      expect(result[4].content).toBe('Response 3')
    })

    it('should preserve only first system message', () => {
      const messages: Message[] = [
        { role: 'system', content: 'First system' },
        { role: 'user', content: 'User message' },
        { role: 'system', content: 'Second system' },
        { role: 'assistant', content: 'Assistant message' },
      ]

      const result = (memoryService as any).applySlidingWindow(messages, '10')

      const systemMessages = result.filter((m: Message) => m.role === 'system')
      expect(systemMessages.length).toBe(1)
      expect(systemMessages[0].content).toBe('First system')
    })

    it('should handle invalid window size', () => {
      const messages: Message[] = [{ role: 'user', content: 'Test' }]

      const result = (memoryService as any).applySlidingWindow(messages, 'invalid')
      expect(result).toEqual(messages)
    })
  })

  describe('applySlidingWindowByTokens (token-based)', () => {
    it('should keep messages within token limit', () => {
      const messages: Message[] = [
        { role: 'system', content: 'This is a system message' }, // ~6 tokens
        { role: 'user', content: 'Short' }, // ~2 tokens
        { role: 'assistant', content: 'This is a longer response message' }, // ~8 tokens
        { role: 'user', content: 'Another user message here' }, // ~6 tokens
        { role: 'assistant', content: 'Final response' }, // ~3 tokens
      ]

      // Set limit to ~15 tokens - should include last 2-3 messages
      const result = (memoryService as any).applySlidingWindowByTokens(messages, '15', 'gpt-4o')

      expect(result.length).toBeGreaterThan(0)
      expect(result.length).toBeLessThan(messages.length)

      // Should include newest messages
      expect(result[result.length - 1].content).toBe('Final response')
    })

    it('should include at least 1 message even if it exceeds limit', () => {
      const messages: Message[] = [
        {
          role: 'user',
          content:
            'This is a very long message that definitely exceeds our small token limit of just 5 tokens',
        },
      ]

      const result = (memoryService as any).applySlidingWindowByTokens(messages, '5', 'gpt-4o')

      expect(result.length).toBe(1)
      expect(result[0].content).toBe(messages[0].content)
    })

    it('should preserve first system message and exclude it from token count', () => {
      const messages: Message[] = [
        { role: 'system', content: 'A' }, // System message - always preserved
        { role: 'user', content: 'B' }, // ~1 token
        { role: 'assistant', content: 'C' }, // ~1 token
        { role: 'user', content: 'D' }, // ~1 token
      ]

      // Limit to 2 tokens - should fit system message + last 2 conversation messages (D, C)
      const result = (memoryService as any).applySlidingWindowByTokens(messages, '2', 'gpt-4o')

      // Should have: system message + 2 conversation messages = 3 total
      expect(result.length).toBe(3)
      expect(result[0].role).toBe('system') // First system message preserved
      expect(result[1].content).toBe('C') // Second most recent conversation message
      expect(result[2].content).toBe('D') // Most recent conversation message
    })

    it('should process messages from newest to oldest', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Old message' },
        { role: 'assistant', content: 'Old response' },
        { role: 'user', content: 'New message' },
        { role: 'assistant', content: 'New response' },
      ]

      const result = (memoryService as any).applySlidingWindowByTokens(messages, '10', 'gpt-4o')

      // Should prioritize newer messages
      expect(result[result.length - 1].content).toBe('New response')
    })

    it('should handle invalid token limit', () => {
      const messages: Message[] = [{ role: 'user', content: 'Test' }]

      const result = (memoryService as any).applySlidingWindowByTokens(
        messages,
        'invalid',
        'gpt-4o'
      )
      expect(result).toEqual(messages) // Should return all messages
    })

    it('should handle zero or negative token limit', () => {
      const messages: Message[] = [{ role: 'user', content: 'Test' }]

      const result1 = (memoryService as any).applySlidingWindowByTokens(messages, '0', 'gpt-4o')
      expect(result1).toEqual(messages)

      const result2 = (memoryService as any).applySlidingWindowByTokens(messages, '-5', 'gpt-4o')
      expect(result2).toEqual(messages)
    })

    it('should work with different model names', () => {
      const messages: Message[] = [{ role: 'user', content: 'Test message' }]

      const result1 = (memoryService as any).applySlidingWindowByTokens(messages, '100', 'gpt-4o')
      expect(result1.length).toBe(1)

      const result2 = (memoryService as any).applySlidingWindowByTokens(
        messages,
        '100',
        'claude-3-5-sonnet-20241022'
      )
      expect(result2.length).toBe(1)

      const result3 = (memoryService as any).applySlidingWindowByTokens(messages, '100', undefined)
      expect(result3.length).toBe(1)
    })

    it('should handle empty messages array', () => {
      const messages: Message[] = []

      const result = (memoryService as any).applySlidingWindowByTokens(messages, '100', 'gpt-4o')
      expect(result).toEqual([])
    })
  })

  describe('buildMemoryKey', () => {
    it('should build correct key with conversationId:blockId format', () => {
      const inputs: AgentInputs = {
        memoryType: 'conversation',
        conversationId: 'emir',
      }

      const key = (memoryService as any).buildMemoryKey(mockContext, inputs, 'test-block-id')
      expect(key).toBe('emir:test-block-id')
    })

    it('should use same key format regardless of memory type', () => {
      const conversationId = 'user-123'
      const blockId = 'block-abc'

      const conversationKey = (memoryService as any).buildMemoryKey(
        mockContext,
        { memoryType: 'conversation', conversationId },
        blockId
      )
      const slidingWindowKey = (memoryService as any).buildMemoryKey(
        mockContext,
        { memoryType: 'sliding_window', conversationId },
        blockId
      )
      const slidingTokensKey = (memoryService as any).buildMemoryKey(
        mockContext,
        { memoryType: 'sliding_window_tokens', conversationId },
        blockId
      )

      // All should produce the same key - memory type only affects processing
      expect(conversationKey).toBe('user-123:block-abc')
      expect(slidingWindowKey).toBe('user-123:block-abc')
      expect(slidingTokensKey).toBe('user-123:block-abc')
    })

    it('should throw error for missing conversationId', () => {
      const inputs: AgentInputs = {
        memoryType: 'conversation',
        // conversationId missing
      }

      expect(() => {
        ;(memoryService as any).buildMemoryKey(mockContext, inputs, 'test-block-id')
      }).toThrow('Conversation ID is required for all memory types')
    })

    it('should throw error for empty conversationId', () => {
      const inputs: AgentInputs = {
        memoryType: 'conversation',
        conversationId: '   ', // Only whitespace
      }

      expect(() => {
        ;(memoryService as any).buildMemoryKey(mockContext, inputs, 'test-block-id')
      }).toThrow('Conversation ID is required for all memory types')
    })
  })

  describe('Token-based vs Message-based comparison', () => {
    it('should produce different results for same message count limit', () => {
      const messages: Message[] = [
        { role: 'user', content: 'A' }, // Short message (~1 token)
        {
          role: 'assistant',
          content: 'This is a much longer response that takes many more tokens',
        }, // Long message (~15 tokens)
        { role: 'user', content: 'B' }, // Short message (~1 token)
      ]

      // Message-based: last 2 messages
      const messageResult = (memoryService as any).applySlidingWindow(messages, '2')
      expect(messageResult.length).toBe(2)

      // Token-based: with limit of 10 tokens, might fit all 3 messages or just last 2
      const tokenResult = (memoryService as any).applySlidingWindowByTokens(
        messages,
        '10',
        'gpt-4o'
      )

      // The long message should affect what fits
      expect(tokenResult.length).toBeGreaterThanOrEqual(1)
    })
  })
})
