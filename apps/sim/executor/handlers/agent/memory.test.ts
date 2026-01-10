import { loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MEMORY } from '@/executor/constants'
import { Memory } from '@/executor/handlers/agent/memory'
import type { Message } from '@/executor/handlers/agent/types'

vi.mock('@sim/logger', () => loggerMock)

vi.mock('@/lib/tokenization/estimators', () => ({
  getAccurateTokenCount: vi.fn((text: string) => {
    return Math.ceil(text.length / 4)
  }),
}))

describe('Memory', () => {
  let memoryService: Memory

  beforeEach(() => {
    memoryService = new Memory()
  })

  describe('applyWindow (message-based)', () => {
    it('should keep last N messages', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Message 1' },
        { role: 'assistant', content: 'Response 1' },
        { role: 'user', content: 'Message 2' },
        { role: 'assistant', content: 'Response 2' },
        { role: 'user', content: 'Message 3' },
        { role: 'assistant', content: 'Response 3' },
      ]

      const result = (memoryService as any).applyWindow(messages, 4)

      expect(result.length).toBe(4)
      expect(result[0].content).toBe('Message 2')
      expect(result[3].content).toBe('Response 3')
    })

    it('should return all messages if limit exceeds array length', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Test' },
        { role: 'assistant', content: 'Response' },
      ]

      const result = (memoryService as any).applyWindow(messages, 10)
      expect(result.length).toBe(2)
    })

    it('should handle invalid window size', () => {
      const messages: Message[] = [{ role: 'user', content: 'Test' }]

      const result = (memoryService as any).applyWindow(messages, Number.NaN)
      expect(result).toEqual(messages)
    })

    it('should handle zero limit', () => {
      const messages: Message[] = [{ role: 'user', content: 'Test' }]

      const result = (memoryService as any).applyWindow(messages, 0)
      expect(result).toEqual(messages)
    })
  })

  describe('applyTokenWindow (token-based)', () => {
    it('should keep messages within token limit', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Short' },
        { role: 'assistant', content: 'This is a longer response message' },
        { role: 'user', content: 'Another user message here' },
        { role: 'assistant', content: 'Final response' },
      ]

      const result = (memoryService as any).applyTokenWindow(messages, 15, 'gpt-4o')

      expect(result.length).toBeGreaterThan(0)
      expect(result.length).toBeLessThan(messages.length)
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

      const result = (memoryService as any).applyTokenWindow(messages, 5, 'gpt-4o')

      expect(result.length).toBe(1)
      expect(result[0].content).toBe(messages[0].content)
    })

    it('should process messages from newest to oldest', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Old message' },
        { role: 'assistant', content: 'Old response' },
        { role: 'user', content: 'New message' },
        { role: 'assistant', content: 'New response' },
      ]

      const result = (memoryService as any).applyTokenWindow(messages, 10, 'gpt-4o')

      expect(result[result.length - 1].content).toBe('New response')
    })

    it('should handle invalid token limit', () => {
      const messages: Message[] = [{ role: 'user', content: 'Test' }]

      const result = (memoryService as any).applyTokenWindow(messages, Number.NaN, 'gpt-4o')
      expect(result).toEqual(messages)
    })

    it('should handle zero or negative token limit', () => {
      const messages: Message[] = [{ role: 'user', content: 'Test' }]

      const result1 = (memoryService as any).applyTokenWindow(messages, 0, 'gpt-4o')
      expect(result1).toEqual(messages)

      const result2 = (memoryService as any).applyTokenWindow(messages, -5, 'gpt-4o')
      expect(result2).toEqual(messages)
    })

    it('should work without model specified', () => {
      const messages: Message[] = [{ role: 'user', content: 'Test message' }]

      const result = (memoryService as any).applyTokenWindow(messages, 100, undefined)
      expect(result.length).toBe(1)
    })

    it('should handle empty messages array', () => {
      const messages: Message[] = []

      const result = (memoryService as any).applyTokenWindow(messages, 100, 'gpt-4o')
      expect(result).toEqual([])
    })
  })

  describe('validateConversationId', () => {
    it('should throw error for missing conversationId', () => {
      expect(() => {
        ;(memoryService as any).validateConversationId(undefined)
      }).toThrow('Conversation ID is required')
    })

    it('should throw error for empty conversationId', () => {
      expect(() => {
        ;(memoryService as any).validateConversationId('   ')
      }).toThrow('Conversation ID is required')
    })

    it('should throw error for too long conversationId', () => {
      const longId = 'a'.repeat(MEMORY.MAX_CONVERSATION_ID_LENGTH + 1)
      expect(() => {
        ;(memoryService as any).validateConversationId(longId)
      }).toThrow('Conversation ID too long')
    })

    it('should accept valid conversationId', () => {
      expect(() => {
        ;(memoryService as any).validateConversationId('user-123')
      }).not.toThrow()
    })
  })

  describe('validateContent', () => {
    it('should throw error for content exceeding max size', () => {
      const largeContent = 'x'.repeat(MEMORY.MAX_MESSAGE_CONTENT_BYTES + 1)
      expect(() => {
        ;(memoryService as any).validateContent(largeContent)
      }).toThrow('Message content too large')
    })

    it('should accept content within limit', () => {
      const content = 'Normal sized content'
      expect(() => {
        ;(memoryService as any).validateContent(content)
      }).not.toThrow()
    })
  })

  describe('Token-based vs Message-based comparison', () => {
    it('should produce different results for same limit concept', () => {
      const messages: Message[] = [
        { role: 'user', content: 'A' },
        {
          role: 'assistant',
          content: 'This is a much longer response that takes many more tokens',
        },
        { role: 'user', content: 'B' },
      ]

      const messageResult = (memoryService as any).applyWindow(messages, 2)
      expect(messageResult.length).toBe(2)

      const tokenResult = (memoryService as any).applyTokenWindow(messages, 10, 'gpt-4o')
      expect(tokenResult.length).toBeGreaterThanOrEqual(1)
    })
  })
})
