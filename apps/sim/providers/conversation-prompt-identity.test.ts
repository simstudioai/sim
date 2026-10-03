import {
  providersConversationHistoryMock,
  providersConversationHistoryMockFns,
} from '@sim/testing/mocks/providers-conversation-history.mock'
import { describe, expect, it, vi } from 'vitest'
import type { ConversationProtocol } from '@/lib/memory/conversation-types'
import type { UserFile } from '@/executor/types'
import { convertAnthropicRequestHistory } from '@/providers/anthropic/request-history'
import { formatMessagesForProvider } from '@/providers/attachments'
import { convertBedrockRequestHistory } from '@/providers/bedrock/request-history'
import {
  bindConversationGenerationPrompt,
  prepareConversationGeneration,
} from '@/providers/conversation-generation'
import {
  copyNativeConversationMessage,
  getConversationMessageSource,
  isConversationHistoryNotice,
  markConversationHistoryNotice,
} from '@/providers/conversation-metadata'
import { convertToGeminiFormat } from '@/providers/google/utils'
import { buildResponsesInputFromMessages } from '@/providers/openai/utils'
import type { Message, ProviderRequest } from '@/providers/types'

providersConversationHistoryMockFns.mockGetConversationRequestContext.mockReturnValue({
  agentConversation: {},
  agentMemoryContext: { historyTokens: 0 },
})

vi.mock('@/providers/conversation-history', () => providersConversationHistoryMock)

const protocols: {
  protocol: ConversationProtocol
  key: string
  convert: (request: ProviderRequest) => object[]
}[] = [
  {
    protocol: 'chat-completions',
    key: 'messages',
    convert: (request) => formatMessagesForProvider(request.messages ?? [], 'openrouter'),
  },
  {
    protocol: 'responses',
    key: 'input',
    convert: (request) => buildResponsesInputFromMessages(request.messages ?? []),
  },
  {
    protocol: 'anthropic',
    key: 'messages',
    convert: (request) =>
      convertAnthropicRequestHistory({ ...request, providerId: 'anthropic' }).messages,
  },
  {
    protocol: 'gemini',
    key: 'contents',
    convert: (request) => convertToGeminiFormat(request).contents,
  },
  {
    protocol: 'bedrock',
    key: 'messages',
    convert: (request) => convertBedrockRequestHistory(request).messages,
  },
]

const file: UserFile = {
  id: 'image',
  name: 'image.png',
  url: '/api/files/image',
  size: 8,
  type: 'image/png',
  key: 'image',
  base64: 'iVBORw0KGgo=',
}

describe('current prompt identity through native history conversion', () => {
  it.each(protocols)(
    'distinguishes notice-only $protocol context from a notice following actual input',
    async ({ protocol, key, convert }) => {
      for (const withPrompt of [false, true]) {
        const prompt: Message = { role: 'user', content: 'Actual current input' }
        const notice: Message = { role: 'user', content: 'Some retained history was omitted.' }
        markConversationHistoryNotice(notice)
        const source = [...(withPrompt ? [prompt] : []), notice]
        const request: ProviderRequest = {
          model: 'gpt-4.1-mini',
          maxTokens: 100,
          messages: source,
        }
        const messages = convert(request)
        await expect(
          prepareConversationGeneration(request, protocol, { [key]: messages })
        ).resolves.toBeDefined()
        expect(messages.map(getConversationMessageSource)).toEqual(source)
      }
    }
  )

  it.each(protocols)(
    'retains a bounded runtime notice through $protocol conversion without new input',
    async ({ protocol, key, convert }) => {
      const notice: Message = {
        role: 'user',
        content: 'Some retained history was omitted. Read earlier records if needed.',
      }
      markConversationHistoryNotice(notice)
      const copied = structuredClone(notice)
      copyNativeConversationMessage(notice, copied)
      const tail: Message = { role: 'assistant', content: 'Previous final response' }
      const request: ProviderRequest = {
        model: 'gpt-4.1-mini',
        maxTokens: 100,
        messages: [{ role: 'assistant', content: 'Optional older answer' }, copied, tail],
      }
      const messages = convert(request)
      await prepareConversationGeneration(request, protocol, { [key]: messages })
      expect(messages.map(getConversationMessageSource)).toEqual([notice, tail])
      expect(isConversationHistoryNotice(messages[0])).toBe(true)
      expect(isConversationHistoryNotice(structuredClone(notice))).toBe(false)
      expect(Object.keys(copied)).toEqual(['role', 'content'])
    }
  )

  it.each(protocols)(
    'retains only the bound duplicate through $protocol conversion',
    async ({ protocol, key, convert }) => {
      for (const withFile of [false, true]) {
        const prompt: Message = {
          role: 'user',
          content: withFile ? '' : 'An identical current prompt',
          ...(withFile ? { files: [file] } : {}),
        }
        const earlier = structuredClone(prompt)
        const later = structuredClone(prompt)
        const tail: Message = { role: 'assistant', content: 'Continue the original task.' }
        const request: ProviderRequest = {
          model: 'gpt-4.1-mini',
          maxTokens: 100,
          messages: [earlier, prompt, later, tail],
        }
        bindConversationGenerationPrompt(request, prompt)
        const messages = convert(request)
        const current = messages.find((message) => getConversationMessageSource(message) === prompt)
        expect(current).toBeDefined()
        const wireText = JSON.stringify(current)
        await prepareConversationGeneration(request, protocol, { [key]: messages })
        expect(messages).toHaveLength(2)
        expect(messages[0]).toBe(current)
        expect(JSON.stringify(messages[0])).toBe(wireText)
        expect(messages.map(getConversationMessageSource)).toEqual([prompt, tail])
      }
    }
  )

  it('retains prompt identity through canonical message copies without adding wire fields', async () => {
    const prompt: Message = { role: 'user', content: 'Original input' }
    const copied = structuredClone(prompt)
    copyNativeConversationMessage(prompt, copied)
    const request: ProviderRequest = {
      model: 'gpt-4.1-mini',
      maxTokens: 100,
      messages: [
        copied,
        { role: 'user', content: 'Original input' },
        { role: 'assistant', content: 'Next' },
      ],
    }
    bindConversationGenerationPrompt(request, prompt)
    const messages = buildResponsesInputFromMessages(request.messages!)
    await prepareConversationGeneration(request, 'responses', { input: messages })
    expect(messages).toHaveLength(2)
    expect(getConversationMessageSource(messages[0])).toBe(prompt)
    expect(Object.keys(copied)).toEqual(['role', 'content'])
  })
})
