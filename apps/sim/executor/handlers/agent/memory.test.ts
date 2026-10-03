import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { piiRedactionMock, piiRedactionMockFns } from '@sim/testing/mocks/pii-redaction.mock'
import {
  tokenizationAccurateMock,
  tokenizationAccurateMockFns,
} from '@sim/testing/mocks/tokenization-accurate.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

vi.mock('@/lib/logs/execution/pii-redaction', () => piiRedactionMock)

import { hashDurableSecretProvenanceValue } from '@/lib/execution/durable-secret-provenance'
import { assertUserFileContentAccess } from '@/lib/execution/payloads/materialization.server'
import { MEMORY } from '@/lib/memory/constants'
import * as conversationStore from '@/lib/memory/conversation-store'
import {
  selectConversationMessageWindow,
  selectConversationTokenWindow,
} from '@/lib/memory/history-window'
import { Memory } from '@/executor/handlers/agent/memory'
import type { Message } from '@/executor/handlers/agent/types'
import type { ExecutionContext, UserFile } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const mockDecryptSecret = encryptionMockFns.mockDecryptSecret
const { mockRedactObjectStrings } = piiRedactionMockFns
tokenizationAccurateMockFns.mockGetAccurateTokenCount.mockImplementation((text: string) =>
  Math.ceil(text.length / 4)
)

const mockMemoryLogger = getMockLogger('Memory')

vi.mock('@/lib/tokenization/accurate', () => tokenizationAccurateMock)

describe('Memory', () => {
  let memoryService: Memory

  beforeEach(() => {
    resetDbChainMock()
    mockDecryptSecret.mockImplementation(async (encryptedValue: string) => ({
      decrypted: `decrypted:${encryptedValue}`,
    }))
    memoryService = new Memory()
  })

  describe('optional durable storage', () => {
    const ctx = { workspaceId: 'workspace-1' } as ExecutionContext
    const inputs = { memoryType: 'conversation' as const, conversationId: 'conversation-1' }

    function rejectRead(error: Error) {
      vi.spyOn(
        memoryService as unknown as { fetchMemory: () => Promise<unknown> },
        'fetchMemory'
      ).mockRejectedValue(error)
    }

    it.each(['ECONNREFUSED', '42P01', '23514'])(
      'degrades rich history on storage failure %s while preserving ordinary read errors',
      async (code) => {
        const error = Object.assign(new Error('Storage unavailable'), { code })
        rejectRead(error)
        await expect(
          memoryService.fetchMemoryMessages(ctx, inputs, undefined, { richHistory: true })
        ).resolves.toEqual([])
        await expect(memoryService.fetchMemoryMessages(ctx, inputs)).rejects.toBe(error)
        expect(mockMemoryLogger.warn).toHaveBeenCalledWith(
          'Agent durable memory read is unavailable',
          { workspaceId: 'workspace-1' }
        )
      }
    )
  })

  describe('message window', () => {
    it('should keep last N messages', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Message 1' },
        { role: 'assistant', content: 'Response 1' },
        { role: 'user', content: 'Message 2' },
        { role: 'assistant', content: 'Response 2' },
        { role: 'user', content: 'Message 3' },
        { role: 'assistant', content: 'Response 3' },
      ]

      const result = selectConversationMessageWindow(messages, 4)

      expect(result.length).toBe(4)
      expect(result[0].content).toBe('Message 2')
      expect(result[3].content).toBe('Response 3')
    })
  })

  describe('token window', () => {
    it('should keep messages within token limit', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Short' },
        { role: 'assistant', content: 'This is a longer response message' },
        { role: 'user', content: 'Another user message here' },
        { role: 'assistant', content: 'Final response' },
      ]

      const result = selectConversationTokenWindow(messages, 15, 'gpt-4o')

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

      const result = selectConversationTokenWindow(messages, 5, 'gpt-4o')

      expect(result.length).toBe(1)
      expect(result[0].content).toBe(messages[0].content)
    })
  })

  describe('validateConversationId', () => {
    it('should throw error for too long conversationId', () => {
      const longId = 'a'.repeat(MEMORY.MAX_CONVERSATION_ID_LENGTH + 1)
      expect(() => {
        ;(memoryService as any).validateConversationId(longId)
      }).toThrow('Conversation ID too long')
    })
  })

  describe('validateContent', () => {
    it('should throw error for content exceeding max size', () => {
      const largeContent = 'x'.repeat(MEMORY.MAX_MESSAGE_CONTENT_BYTES + 1)
      expect(() => {
        ;(memoryService as any).validateContent(largeContent)
      }).toThrow('Message content too large')
    })
  })

  describe('sanitizeMessageForStorage', () => {
    it('preserves storage references and tool calls without file payloads or provider handles', () => {
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
            providerFileId: 'expired-provider-file',
            providerFileUri: 'expired-provider-uri',
            remoteUrl: 'https://storage.example.com/expired',
          },
        ],
        tool_calls: [{ id: 'call-1' }],
      }

      expect((memoryService as any).sanitizeMessageForStorage(message)).toEqual({
        role: 'user',
        content: 'Analyze this file',
        executionId: 'exec-1',
        files: [
          {
            id: 'file-1',
            key: 'workspace/ws-1/example.png',
            name: 'example.png',
            url: '',
            size: 128,
            type: 'image/png',
          },
        ],
        tool_calls: [{ id: 'call-1' }],
      })
    })
  })

  describe('provider-independent file references', () => {
    const storedFile: UserFile = {
      id: 'file-1',
      key: 'workspace/workspace-1/image.png',
      name: 'image.png',
      url: '',
      type: 'image/png',
      size: 8,
      context: 'workspace',
    }

    it('admits only the remembered execution file and preserves workspace and workflow scope', async () => {
      const file = {
        ...storedFile,
        key: 'execution/workspace-1/workflow-1/exec-1/image.png',
        context: 'execution',
      }
      queueTableRows(schemaMock.memory, [
        { secretProvenanceVersion: null, data: [{ role: 'user', content: 'File', files: [file] }] },
      ])
      const context = {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'exec-2',
      } as ExecutionContext
      await memoryService.fetchMemoryMessages(context, {
        memoryType: 'conversation',
        conversationId: 'conversation-1',
      })
      await expect(assertUserFileContentAccess(file, context)).resolves.toBeUndefined()
      await expect(
        assertUserFileContentAccess(
          { ...file, key: 'execution/workspace-1/workflow-1/exec-1/other.png' },
          context
        )
      ).rejects.toThrow('File is not available')
      await expect(
        assertUserFileContentAccess(file, { ...context, workspaceId: 'workspace-2' })
      ).rejects.toThrow('File is not available')
      const otherWorkflow = { ...context, workflowId: 'workflow-2', fileKeys: undefined }
      queueTableRows(schemaMock.memory, [
        { secretProvenanceVersion: null, data: [{ role: 'user', content: 'File', files: [file] }] },
      ])
      await memoryService.fetchMemoryMessages(otherWorkflow, {
        memoryType: 'conversation',
        conversationId: 'conversation-1',
      })
      expect(otherWorkflow.fileKeys).toBeUndefined()
      await expect(assertUserFileContentAccess(file, otherWorkflow)).rejects.toThrow(
        'File is not available'
      )
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
        .spyOn(conversationStore, 'appendMemoryMessages')
        .mockResolvedValue(undefined)

      const message = { role: 'user' as const, content: 'possibly secret' }
      await memoryService.appendToMemory(createContext(registry) as never, inputs, message)

      expect(appendMessage).toHaveBeenCalledWith({
        workspaceId: 'workspace-1',
        key: 'conversation-1',
        messages: [message],
        provenance: { status: 'unknown' },
      })
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
          .spyOn(conversationStore, 'appendMemoryMessages')
          .mockResolvedValue(undefined)
        await memoryService.appendToMemory(createContext(registry) as never, inputs, message)
        const stored = appendMessage.mock.calls.at(-1)?.[0].messages[0] as Message
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

    it('refuses tracked memory with unknown provenance', async () => {
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
    })
  })
})
