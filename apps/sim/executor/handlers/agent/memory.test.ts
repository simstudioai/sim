import { loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDecryptSecret, mockRedactObjectStrings, mockIsEnforced, mockReportUnrecorded } =
  vi.hoisted(() => ({
    mockDecryptSecret: vi.fn(),
    mockRedactObjectStrings: vi.fn(async (value: unknown) => value),
    mockIsEnforced: vi.fn(() => false),
    mockReportUnrecorded: vi.fn(),
  }))

vi.mock('@/lib/execution/durable-secret-provenance-enforcement', () => ({
  DURABLE_SECRET_PROVENANCE_SURFACES: ['memory', 'table-row', 'knowledge'],
  isDurableSecretProvenanceEnforced: mockIsEnforced,
  reportUnrecordedDurableProvenance: mockReportUnrecorded,
}))

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: mockDecryptSecret,
}))

vi.mock('@/lib/logs/execution/pii-redaction', () => ({
  redactObjectStrings: mockRedactObjectStrings,
}))

import { hashDurableSecretProvenanceValue } from '@/lib/execution/durable-secret-provenance'
import { MEMORY } from '@/executor/constants'
import { Memory } from '@/executor/handlers/agent/memory'
import type { Message } from '@/executor/handlers/agent/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const mockMemoryLogger = vi.mocked(loggerMock.createLogger).mock.results[
  vi.mocked(loggerMock.createLogger).mock.calls.findIndex(([name]) => name === 'Memory')
].value

vi.mock('@/lib/tokenization/accurate', () => ({
  getAccurateTokenCount: vi.fn((text: string) => {
    return Math.ceil(text.length / 4)
  }),
}))

describe('Memory', () => {
  let memoryService: Memory

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsEnforced.mockReturnValue(false)
    mockDecryptSecret.mockImplementation(async (encryptedValue: string) => ({
      decrypted: `decrypted:${encryptedValue}`,
    }))
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

  describe('sanitizeMessageForStorage', () => {
    it('should strip file payloads but preserve tool-call fields before memory persistence', () => {
      const message: Message = {
        role: 'user',
        content: 'Analyze this file',
        executionId: 'exec-1',
        files: [
          {
            id: 'file-1',
            key: 'workspace/ws-1/example.png',
            name: 'example.png',
            url: '/api/files/serve/workspace%2Fws-1%2Fexample.png?context=workspace',
            size: 128,
            type: 'image/png',
            base64: 'iVBORw0KGgo=',
          },
        ],
        tool_calls: [{ id: 'call-1' }],
      }

      expect((memoryService as any).sanitizeMessageForStorage(message)).toEqual({
        role: 'user',
        content: 'Analyze this file',
        executionId: 'exec-1',
        tool_calls: [{ id: 'call-1' }],
      })
    })
  })

  describe('secret projection', () => {
    function createContext(registry: ResolvedSecretTraceRegistry) {
      return {
        workspaceId: 'workspace-1',
        resolvedSecretTraceRegistry: registry,
      }
    }

    const inputs = {
      memoryType: 'conversation' as const,
      conversationId: 'conversation-1',
    }

    it('does not reinterpret dormant catalog values as secret-bearing memory', async () => {
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
      ])
      mockRedactObjectStrings.mockImplementationOnce(async (content: unknown) => {
        expect(content).toBe('Bearer secret-value')
        return content
      })

      const result = await (memoryService as any).maskContentForStorage(
        {
          ...createContext(registry),
          piiBlockOutputRedaction: { enabled: true, entityTypes: [] },
        },
        { role: 'user', content: 'Bearer secret-value' }
      )

      expect(result.content).toBe('Bearer secret-value')
      expect(mockRedactObjectStrings).toHaveBeenCalledOnce()
    })

    it('persists raw memory with unknown lineage when provenance is unavailable', async () => {
      const registry = new ResolvedSecretTraceRegistry()
      registry.markIncomplete('unspecified')
      const appendMessage = vi
        .spyOn(memoryService as any, 'appendMessage')
        .mockResolvedValue(undefined)

      const message = { role: 'user' as const, content: 'possibly secret' }
      await memoryService.appendToMemory(createContext(registry) as never, inputs, message)

      expect(appendMessage).toHaveBeenCalledWith('workspace-1', 'conversation-1', message, {
        status: 'unknown',
      })
    })

    it('seeds raw memory with unknown lineage when provenance is unavailable', async () => {
      const registry = new ResolvedSecretTraceRegistry()
      registry.markIncomplete('unspecified')
      const seedMemoryRecord = vi
        .spyOn(memoryService as any, 'seedMemoryRecord')
        .mockResolvedValue(undefined)
      const message = { role: 'assistant' as const, content: 'possibly secret' }

      await memoryService.seedMemory(createContext(registry) as never, inputs, [message])

      expect(seedMemoryRecord).toHaveBeenCalledWith('workspace-1', 'conversation-1', [message], {
        status: 'unknown',
      })
    })

    it('preserves legacy stored messages when no current resolution activated the value', async () => {
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
      ])
      vi.spyOn(memoryService as any, 'fetchMemory').mockResolvedValue({
        messages: [{ role: 'assistant', content: 'old secret-value' }],
        provenance: { status: 'exact', entries: [] },
      })

      const messages = await memoryService.fetchMemoryMessages(
        createContext(registry) as never,
        inputs
      )

      expect(messages).toEqual([{ role: 'assistant', content: 'old secret-value' }])
    })

    it('keeps raw foreign-scope content in functional storage', async () => {
      mockDecryptSecret.mockResolvedValueOnce({ decrypted: 'foreign-secret' })
      const registry = new ResolvedSecretTraceRegistry([], {
        userId: 'user-1',
        workspaceId: 'workspace-1',
      })
      await registry.importProvenance(
        {
          version: 1,
          complete: true,
          entries: [{ name: 'FOREIGN', encryptedValue: 'foreign-ciphertext' }],
          scope: { userId: 'user-2', workspaceId: 'workspace-2' },
        },
        { trusted: true }
      )

      const result = await (memoryService as any).maskContentForStorage(createContext(registry), {
        role: 'assistant',
        content: 'foreign-secret',
      })

      expect(result.content).toBe('foreign-secret')
    })

    it.each(['12345678'])(
      'projects short secret %s only in model text and arguments',
      async (secret) => {
        const registry = new ResolvedSecretTraceRegistry([
          { name: 'TOKEN', plaintext: secret, encryptedValue: 'ciphertext' },
        ])
        registry.recordResolved('TOKEN', secret)
        const converted = secret === '12345678' ? 12345678 : true
        const message: Message = {
          role: 'assistant',
          content: `Result: ${secret}`,
          function_call: {
            name: 'lookup',
            arguments: JSON.stringify({ value: secret, converted }),
          },
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: 'lookup',
                arguments: JSON.stringify({ value: secret, converted }),
              },
            },
          ],
        }

        const projected = (memoryService as any).projectMessageForModel(
          registry,
          message
        ) as Message

        expect(projected).toMatchObject({
          content: 'Result: {{TOKEN}}',
          function_call: {
            name: 'lookup',
            arguments: '{"value":"{{TOKEN}}","converted":"{{TOKEN}}"}',
          },
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: 'lookup',
                arguments: '{"value":"{{TOKEN}}","converted":"{{TOKEN}}"}',
              },
            },
          ],
        })

        const appendMessage = vi
          .spyOn(memoryService as any, 'appendMessage')
          .mockResolvedValue(undefined)
        await memoryService.appendToMemory(createContext(registry) as never, inputs, message)
        const stored = appendMessage.mock.calls.at(-1)?.[2] as Message
        expect(JSON.parse(stored.function_call?.arguments ?? '')).toEqual({
          value: secret,
          converted,
        })

        vi.spyOn(memoryService as any, 'fetchMemory').mockResolvedValueOnce({
          messages: [message],
          provenance: {
            status: 'exact',
            entries: [
              {
                name: 'TOKEN',
                encryptedValue: 'ciphertext',
                sourceValueHash: hashDurableSecretProvenanceValue(message),
              },
            ],
          },
        })
        mockDecryptSecret.mockResolvedValue({ decrypted: secret })
        const [fetched] = await memoryService.fetchMemoryMessages(
          createContext(registry) as never,
          inputs
        )
        expect(JSON.parse(fetched.tool_calls?.[0]?.function.arguments ?? '')).toEqual({
          value: '{{TOKEN}}',
          converted: '{{TOKEN}}',
        })
      }
    )

    it.each(['name', 'functionName', 'toolCallId', 'toolName'] as const)(
      'does not plaintext-scan the %s control field',
      (field) => {
        const registry = new ResolvedSecretTraceRegistry([
          { name: 'TOKEN', plaintext: 'control-secret', encryptedValue: 'ciphertext' },
        ])
        registry.recordResolved('TOKEN', 'control-secret')
        const message = {
          role: 'assistant',
          content: 'ok',
          ...(field === 'name' ? { name: 'control-secret' } : {}),
          function_call: {
            name: field === 'functionName' ? 'control-secret' : 'lookup',
            arguments: '{}',
          },
          tool_calls: [
            {
              id: field === 'toolCallId' ? 'control-secret' : 'call-1',
              type: 'function',
              function: {
                name: field === 'toolName' ? 'control-secret' : 'lookup',
                arguments: '{}',
              },
            },
          ],
        } as Message

        expect((memoryService as any).projectMessageForModel(registry, message)).toEqual(message)
      }
    )

    it('does not project unrelated active secrets into legacy memory', async () => {
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'TOKEN', plaintext: 'unrelated-secret', encryptedValue: 'ciphertext' },
      ])
      expect(registry.recordResolved('TOKEN', 'unrelated-secret')).toBe(true)
      vi.spyOn(memoryService as any, 'fetchMemory').mockResolvedValueOnce({
        messages: [{ role: 'assistant', content: 'Box unrelated-secret' }],
        provenance: { status: 'exact', entries: [] },
      })

      const messages = await memoryService.fetchMemoryMessages(
        createContext(registry) as never,
        inputs
      )

      expect(messages).toEqual([{ role: 'assistant', content: 'Box unrelated-secret' }])
    })

    it('does not activate provenance from a message dropped by the selected window', async () => {
      const oldSecretMessage: Message = { role: 'user', content: 'same-value' }
      const retainedPublicMessage: Message = { role: 'assistant', content: 'same-value' }
      const registry = new ResolvedSecretTraceRegistry([], {
        userId: 'user-1',
        workspaceId: 'workspace-1',
      })
      vi.spyOn(memoryService as any, 'fetchMemory').mockResolvedValueOnce({
        messages: [oldSecretMessage, retainedPublicMessage],
        provenance: {
          status: 'exact',
          entries: [
            {
              name: 'TOKEN',
              encryptedValue: 'ciphertext',
              sourceUserId: 'user-1',
              sourceWorkspaceId: 'workspace-1',
              sourceValueHash: hashDurableSecretProvenanceValue(oldSecretMessage),
            },
          ],
        },
      })

      const messages = await memoryService.fetchMemoryMessages(createContext(registry) as never, {
        ...inputs,
        memoryType: 'sliding_window',
        slidingWindowSize: '1',
      })

      expect(messages).toEqual([retainedPublicMessage])
      expect(mockDecryptSecret).not.toHaveBeenCalled()
    })

    /** Trace 2's shape: a stored memory a previous run could not vouch for. */
    it('reads a memory with unrecorded provenance while the surface stays open', async () => {
      const registry = new ResolvedSecretTraceRegistry([], {
        userId: 'user-1',
        workspaceId: 'workspace-1',
      })
      vi.spyOn(memoryService as any, 'fetchMemory').mockResolvedValueOnce({
        messages: [{ role: 'user', content: 'how do i see my tickets?' }],
        provenance: { status: 'unknown' },
      })

      const messages = await memoryService.fetchMemoryMessages(
        createContext(registry) as never,
        inputs
      )

      expect(messages).toEqual([{ role: 'user', content: 'how do i see my tickets?' }])
      expect(registry.isPermanentlyIncomplete()).toBe(false)
      expect(mockReportUnrecorded).toHaveBeenCalledWith({
        surface: 'memory',
        cause: 'stored-memory-provenance-unknown',
        workspaceId: 'workspace-1',
      })
    })

    it('refuses that same memory once the memory surface is closed', async () => {
      mockIsEnforced.mockReturnValue(true)
      const registry = new ResolvedSecretTraceRegistry([], {
        userId: 'user-1',
        workspaceId: 'workspace-1',
      })
      vi.spyOn(memoryService as any, 'fetchMemory').mockResolvedValueOnce({
        messages: [{ role: 'user', content: 'how do i see my tickets?' }],
        provenance: { status: 'unknown' },
      })

      await expect(
        memoryService.fetchMemoryMessages(createContext(registry) as never, inputs)
      ).rejects.toThrow()
      expect(mockReportUnrecorded).not.toHaveBeenCalled()
    })
  })

  describe('secret-safe diagnostics', () => {
    it('never logs conversation IDs while retaining structural memory metadata', async () => {
      const registry = new ResolvedSecretTraceRegistry([
        {
          name: 'TOKEN',
          plaintext: 'conversation-secret',
          encryptedValue: 'encrypted-conversation-secret',
        },
      ])
      const ctx = {
        workspaceId: 'workspace-1',
        resolvedSecretTraceRegistry: registry,
      }
      const inputs = {
        memoryType: 'conversation' as const,
        conversationId: 'conversation-secret __var_TOKEN __sim_runtime_test_1',
      }
      vi.spyOn(memoryService as never, 'appendMessage' as never).mockResolvedValue(
        undefined as never
      )

      await memoryService.appendToMemory(ctx as never, inputs, {
        role: 'user',
        content: 'ordinary message',
      })

      expect(mockMemoryLogger.debug).toHaveBeenCalledWith('Appended message to memory', {
        workspaceId: 'workspace-1',
        role: 'user',
      })
      let serializedCalls = JSON.stringify(mockMemoryLogger.debug.mock.calls)
      expect(serializedCalls).not.toContain('conversation-secret')
      expect(serializedCalls).not.toContain('__var_')
      expect(serializedCalls).not.toContain('__sim_')

      mockMemoryLogger.debug.mockClear()
      vi.spyOn(memoryService as never, 'seedMemoryRecord' as never).mockResolvedValue(
        undefined as never
      )

      await memoryService.seedMemory(ctx as never, inputs, [
        { role: 'assistant', content: 'ordinary response' },
      ])

      expect(mockMemoryLogger.debug).toHaveBeenCalledWith('Seeded memory', {
        workspaceId: 'workspace-1',
        count: 1,
      })
      serializedCalls = JSON.stringify(mockMemoryLogger.debug.mock.calls)
      expect(serializedCalls).not.toContain('conversation-secret')
      expect(serializedCalls).not.toContain('__var_')
      expect(serializedCalls).not.toContain('__sim_')
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
