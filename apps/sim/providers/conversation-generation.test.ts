/** @vitest-environment node */
import { isRecordLike } from '@sim/utils/object'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationProtocol } from '@/lib/memory/conversation-types'
import {
  bindConversationGenerationCompactor,
  bindConversationGenerationPrompt,
  bindConversationGenerationSummary,
  inheritConversationGenerationContext,
  prepareConversationGeneration,
} from '@/providers/conversation-generation'
import { retainConversationMessageSource } from '@/providers/conversation-metadata'
import type { ProviderRequest } from '@/providers/types'

const state = vi.hoisted(() => ({ enabled: true, historyTokens: 0 }))

vi.mock('@/providers/conversation-history', () => ({
  bindConversationRequestContext: vi.fn(),
  getConversationRequestContext: () =>
    state.enabled
      ? { agentConversation: {}, agentMemoryContext: { historyTokens: state.historyTokens } }
      : undefined,
}))
vi.mock('@/providers/models', () => ({
  PROVIDER_DEFINITIONS: {
    test: {
      models: [
        { id: 'large', contextWindow: 4000 },
        { id: 'small', contextWindow: 1000 },
      ],
    },
  },
  getMaxOutputTokensForModel: () => 100,
}))
vi.mock('@/lib/tokenization/accurate', () => ({
  getAccurateTokenCount: (text: string) => text.length,
}))

interface Fixture {
  protocol: ConversationProtocol
  key: 'input' | 'contents' | 'messages'
  prompt: unknown
  batch: unknown[]
  prefixBound?: boolean
}

const fixtures: Fixture[] = [
  {
    protocol: 'chat-completions',
    key: 'messages',
    prompt: { role: 'user', content: 'Complete the current task' },
    batch: [
      {
        role: 'assistant',
        content: '',
        reasoning_content: 'private reasoning retained exactly',
        tool_calls: ['first', 'second'].map((id) => ({
          id,
          type: 'function',
          function: { name: 'lookup', arguments: '{}' },
        })),
      },
      ...['first', 'second'].map((id) => ({ role: 'tool', tool_call_id: id, content: 'outcome' })),
    ],
  },
  {
    protocol: 'responses',
    key: 'input',
    prompt: { role: 'user', content: [{ type: 'input_text', text: 'Complete the current task' }] },
    batch: [
      { type: 'reasoning', id: 'reasoning', encrypted_content: 'opaque encrypted reasoning' },
      ...['first', 'second'].map((id) => ({
        type: 'function_call',
        call_id: id,
        name: 'lookup',
        arguments: '{}',
      })),
      ...['first', 'second'].map((id) => ({
        type: 'function_call_output',
        call_id: id,
        output: 'outcome',
      })),
    ],
  },
  {
    protocol: 'anthropic',
    key: 'messages',
    prompt: { role: 'user', content: [{ type: 'text', text: 'Complete the current task' }] },
    batch: [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'private thought', signature: 'signed-thinking' },
          ...['first', 'second'].map((id) => ({ type: 'tool_use', id, name: 'lookup', input: {} })),
        ],
      },
      {
        role: 'user',
        content: ['first', 'second'].map((id) => ({
          type: 'tool_result',
          tool_use_id: id,
          content: 'outcome',
        })),
      },
    ],
  },
  {
    protocol: 'gemini',
    key: 'contents',
    prompt: { role: 'user', parts: [{ text: 'Complete the current task' }] },
    batch: [
      {
        role: 'model',
        parts: ['first', 'second'].map((id) => ({
          functionCall: { id, name: 'lookup', args: {} },
          thoughtSignature: `signature-${id}`,
        })),
      },
      {
        role: 'user',
        parts: ['first', 'second'].map((id) => ({
          functionResponse: { id, name: 'lookup', response: { outcome: true } },
        })),
      },
    ],
  },
  {
    protocol: 'bedrock',
    key: 'messages',
    prefixBound: true,
    prompt: { role: 'user', content: [{ text: 'Complete the current task' }] },
    batch: [
      {
        role: 'assistant',
        content: [
          {
            reasoningContent: { reasoningText: { text: 'reasoning', signature: 'signed-prefix' } },
          },
          ...['first', 'second'].map((id) => ({
            toolUse: { toolUseId: id, name: 'lookup', input: {} },
          })),
        ],
      },
      {
        role: 'user',
        content: ['first', 'second'].map((id) => ({
          toolResult: { toolUseId: id, content: [{ text: 'outcome' }] },
        })),
      },
    ],
  },
]

function request(model = 'large'): ProviderRequest {
  const input: ProviderRequest = {
    model,
    apiKey: '',
    maxTokens: 100,
    messages: [{ role: 'user', content: 'Complete the current task' }],
  }
  bindConversationGenerationPrompt(input, input.messages![0])
  for (const fixture of fixtures) {
    retainConversationMessageSource(input.messages![0], fixture.prompt as object)
  }
  return input
}

function oldPrompt(fixture: Fixture): unknown {
  return fixture.protocol === 'gemini'
    ? { role: 'user', parts: [{ text: 'old history' }] }
    : { role: 'user', content: 'old history' }
}

function nativeText(fixture: Fixture, text: string): unknown {
  if (fixture.protocol === 'gemini') return { role: 'user', parts: [{ text }] }
  if (fixture.protocol === 'responses')
    return { role: 'user', content: [{ type: 'input_text', text }] }
  if (fixture.protocol === 'anthropic') return { role: 'user', content: [{ type: 'text', text }] }
  if (fixture.protocol === 'bedrock') return { role: 'user', content: [{ text }] }
  return { role: 'user', content: text }
}

describe('provider generation context boundary', () => {
  beforeEach(() => {
    state.enabled = true
    state.historyTokens = 0
  })

  it.each(fixtures)(
    'retains the complete parallel $protocol batch and native state',
    async (fixture) => {
      const prior = oldPrompt(fixture)
      const input = [prior, fixture.prompt, ...fixture.batch]
      const originalBatch = JSON.stringify(fixture.batch)
      const payload = { [fixture.key]: input, max_tokens: 100 }
      expect(await prepareConversationGeneration(request(), fixture.protocol, payload)).toBe(
        payload
      )
      expect(input).toEqual([
        ...(fixture.prefixBound ? [prior] : []),
        fixture.prompt,
        ...fixture.batch,
      ])
      expect(input.at(-1)).toBe(fixture.batch.at(-1))
      expect(JSON.stringify(fixture.batch)).toBe(originalBatch)
    }
  )

  it.each(fixtures)(
    'rejects an incomplete parallel $protocol batch before sending',
    async (fixture) => {
      const batch = structuredClone(fixture.batch)
      batch.pop()
      const payload = { [fixture.key]: [fixture.prompt, ...batch] }
      await expect(
        prepareConversationGeneration(request(), fixture.protocol, payload)
      ).rejects.toMatchObject({
        retryable: false,
        message: expect.stringContaining('incomplete tool call batch'),
      })
    }
  )

  it.each(fixtures)('never admits orphan $protocol results', async (fixture) => {
    const payload = { [fixture.key]: [fixture.prompt, fixture.batch.at(-1)] }
    await expect(
      prepareConversationGeneration(request(), fixture.protocol, payload)
    ).rejects.toThrow('without its complete assistant call batch')
  })

  it.each(fixtures)(
    'sends required $protocol state intact when fixed-input estimates exceed the model capacity',
    async (fixture) => {
      const input = [fixture.prompt, ...fixture.batch]
      const payload = { [fixture.key]: input, tools: [{ description: 'x'.repeat(3500) }] }
      const original = JSON.stringify(payload)
      expect(await prepareConversationGeneration(request(), fixture.protocol, payload)).toBe(
        payload
      )
      expect(JSON.stringify(payload)).toBe(original)
    }
  )

  it.each(fixtures)(
    'drops optional history without refusing a large parallel $protocol result batch',
    async (fixture) => {
      state.historyTokens = 16_000
      const largeResult = 'large tool result '.repeat(1000)
      const expandResults = (value: unknown): unknown => {
        if (value === 'outcome') return largeResult
        if (Array.isArray(value)) return value.map(expandResults)
        if (isRecordLike(value))
          return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [
              key,
              key === 'outcome' ? largeResult : expandResults(entry),
            ])
          )
        return value
      }
      const batch = fixture.batch.map(expandResults)
      const prefix = oldPrompt(fixture)
      const optional = nativeText(fixture, 'older optional history')
      const tail = nativeText(fixture, 'Continue from the completed tool results')
      const input = [prefix, fixture.prompt, ...batch, optional, tail]
      const originalBatch = JSON.stringify(batch)
      const payload = { [fixture.key]: input }
      await expect(
        prepareConversationGeneration(request('small'), fixture.protocol, payload)
      ).resolves.toBe(payload)
      expect(input).toEqual([
        ...(fixture.prefixBound ? [prefix] : []),
        fixture.prompt,
        ...batch,
        tail,
      ])
      expect(input).not.toContain(optional)
      expect(JSON.stringify(batch)).toBe(originalBatch)
      for (const member of batch) expect(input).toContain(member)
    }
  )

  it('uses smaller fallback capacity and its output reserve to omit optional history', async () => {
    state.historyTokens = 2000
    const fixture = fixtures[0]
    const prior = nativeText(fixture, 'optional'.repeat(25))
    const large = {
      messages: [prior, fixture.prompt, ...fixture.batch],
      max_completion_tokens: 100,
    }
    await prepareConversationGeneration(request(), fixture.protocol, large)
    expect(large.messages).toContain(prior)
    const fallback = { ...large, messages: [...large.messages], max_completion_tokens: 700 }
    await prepareConversationGeneration(request('small'), fixture.protocol, fallback)
    expect(fallback.messages).toEqual([fixture.prompt, ...fixture.batch])
  })

  it('reapplies the history target after every new tool turn', async () => {
    const fixture = fixtures[0]
    const input = request()
    const messages = [fixture.prompt, ...fixture.batch]
    await prepareConversationGeneration(input, fixture.protocol, { messages })
    const nextBatch = structuredClone(fixture.batch)
    messages.push(...nextBatch)
    await prepareConversationGeneration(input, fixture.protocol, { messages })
    expect(messages).toEqual([fixture.prompt, ...nextBatch])
    expect(messages[1]).toBe(nextBatch[0])
  })

  it.each(fixtures)(
    'compacts omitted $protocol history using only a numeric budget',
    async (fixture) => {
      state.historyTokens = 200
      const input = request()
      const summary = { role: 'user' as const, content: 'Derived prior context' }
      const compact = vi.fn().mockResolvedValue(summary)
      bindConversationGenerationCompactor(input, compact)
      const prior = nativeText(fixture, 'old'.repeat(250))
      const messages = [
        fixture.prompt,
        ...fixture.batch,
        prior,
        nativeText(fixture, 'latest receipt'),
      ]
      const originalBatch = JSON.stringify(fixture.batch)
      await prepareConversationGeneration(input, fixture.protocol, { [fixture.key]: messages })
      expect(compact).toHaveBeenCalledExactlyOnceWith({ maxSummaryTokens: 200 })
      const note = nativeText(fixture, summary.content)
      expect(messages).toEqual(
        fixture.prefixBound
          ? [fixture.prompt, ...fixture.batch, note, nativeText(fixture, 'latest receipt')]
          : [note, fixture.prompt, ...fixture.batch, nativeText(fixture, 'latest receipt')]
      )
      expect(JSON.stringify(fixture.batch)).toBe(originalBatch)
    }
  )

  it('prioritizes the bound summary and refreshes it without duplicating earlier notes', async () => {
    state.historyTokens = 160
    const input = request()
    const fixture = fixtures[0]
    const summary = { role: 'user' as const, content: 'Prior derived context' }
    bindConversationGenerationSummary(input, summary)
    const messages = [nativeText(fixture, summary.content), oldPrompt(fixture), fixture.prompt]
    await prepareConversationGeneration(input, fixture.protocol, { messages })
    expect(messages[0]).toEqual(nativeText(fixture, summary.content))
    const compact = vi
      .fn()
      .mockResolvedValue({ role: 'user', content: 'Refreshed derived context' })
    bindConversationGenerationCompactor(input, compact)
    messages.push(...fixture.batch, ...structuredClone(fixture.batch))
    await prepareConversationGeneration(input, fixture.protocol, { messages })
    expect(compact).toHaveBeenCalledOnce()
    expect(messages).toEqual([
      nativeText(fixture, 'Refreshed derived context'),
      fixture.prompt,
      ...fixture.batch,
    ])
  })

  it('does not summarize when nothing optional is omitted or when history is disabled', async () => {
    const input = request()
    const compact = vi.fn()
    bindConversationGenerationCompactor(input, compact)
    const fixture = fixtures[0]
    state.historyTokens = 200
    await prepareConversationGeneration(input, fixture.protocol, { messages: [fixture.prompt] })
    state.historyTokens = 0
    await prepareConversationGeneration(input, fixture.protocol, {
      messages: [oldPrompt(fixture), fixture.prompt],
    })
    expect(compact).not.toHaveBeenCalled()
  })

  it.each(['failed', 'oversized'] as const)(
    'keeps bounded history when compaction is %s',
    async (mode) => {
      state.historyTokens = 100
      const input = request()
      const compact = vi.fn()
      if (mode === 'failed') compact.mockRejectedValue(new Error('summary unavailable'))
      else compact.mockResolvedValue({ role: 'user', content: 's'.repeat(500) })
      bindConversationGenerationCompactor(input, compact)
      const fixture = fixtures[0]
      const messages = [nativeText(fixture, 'x'.repeat(500)), fixture.prompt, ...fixture.batch]
      await prepareConversationGeneration(input, fixture.protocol, { messages })
      expect(messages).toEqual([fixture.prompt, ...fixture.batch])
    }
  )

  it('propagates cancellation during compaction before mutating the native list', async () => {
    state.historyTokens = 100
    const input = request()
    const controller = new AbortController()
    input.abortSignal = controller.signal
    bindConversationGenerationCompactor(input, async () => {
      controller.abort()
      return { role: 'user', content: 'Derived context' }
    })
    const fixture = fixtures[0]
    const messages = [nativeText(fixture, 'x'.repeat(500)), fixture.prompt, ...fixture.batch]
    const original = [...messages]
    await expect(
      prepareConversationGeneration(input, fixture.protocol, { messages })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(messages).toEqual(original)
  })

  it('does not charge a dropped remote attachment to the current required prompt', async () => {
    const input = request()
    input.messages!.unshift({
      role: 'user',
      content: 'old attachment',
      files: [
        {
          id: 'file',
          name: 'large.pdf',
          url: 'https://files.test/file',
          size: 120_000,
          type: 'application/pdf',
          key: 'file',
          providerFileId: 'old-file',
        },
      ],
    })
    const prompt = fixtures[1].prompt
    const messages = [
      { role: 'user', content: [{ type: 'input_file', file_id: 'old-file' }] },
      prompt,
    ]
    await prepareConversationGeneration(input, 'responses', { input: messages })
    expect(messages).toEqual([prompt])
  })

  it('retains the exact Bedrock signed prefix even when its estimate exceeds model capacity', async () => {
    const fixture = fixtures[4]
    const prefix = { role: 'user', content: [{ text: 'x'.repeat(3100) }] }
    const messages = [prefix, fixture.prompt, ...fixture.batch]
    const original = JSON.stringify(messages)
    const payload = { messages }
    await expect(prepareConversationGeneration(request(), fixture.protocol, payload)).resolves.toBe(
      payload
    )
    expect(JSON.stringify(messages)).toBe(original)
    expect(messages[0]).toBe(prefix)
  })

  it('reserves remote file estimates by dropping optional history while preserving the attached prompt', async () => {
    state.historyTokens = 2000
    const input = request()
    input.messages![0].files = [
      {
        id: 'file',
        name: 'large.pdf',
        url: 'https://files.test/file',
        size: 12_000,
        type: 'application/pdf',
        key: 'file',
        providerFileId: 'provider-file',
      },
    ]
    const prompt = retainConversationMessageSource(input.messages![0], {
      role: 'user',
      content: [
        { type: 'input_text', text: 'Complete the current task' },
        { type: 'input_file', file_id: 'provider-file' },
      ],
    })
    const payload = { input: [nativeText(fixtures[1], 'optional history'), prompt] }
    await prepareConversationGeneration(input, 'responses', payload)
    expect(payload.input).toEqual([prompt])
    expect(payload.input[0]).toBe(prompt)
  })

  it('checks cancellation before processing a memory generation', async () => {
    const input = request()
    const controller = new AbortController()
    controller.abort()
    input.abortSignal = controller.signal
    await expect(prepareConversationGeneration(input, 'responses', {})).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  it('preserves the original required prompt through wire-model request copies', async () => {
    const input = request()
    const receipt = { role: 'user' as const, content: 'Prior execution receipt' }
    input.messages!.push(receipt)
    const copied = inheritConversationGenerationContext(input, { ...input })
    const messages = [fixtures[0].prompt, receipt]
    await prepareConversationGeneration(copied, 'chat-completions', { messages })
    expect(messages).toEqual([fixtures[0].prompt, receipt])
  })

  it.each(fixtures)(
    'pins the original $protocol prompt when later user content repeats it',
    async (fixture) => {
      const input = request()
      const earlier = structuredClone(fixture.prompt)
      const later = structuredClone(fixture.prompt)
      const tail = nativeText(fixture, 'continue from the recorded tools')
      const messages = [earlier, fixture.prompt, later, tail]
      await prepareConversationGeneration(input, fixture.protocol, { [fixture.key]: messages })
      expect(messages).toEqual([fixture.prompt, tail])
      expect(messages[0]).toBe(fixture.prompt)
      expect(messages).not.toContain(earlier)
      expect(messages).not.toContain(later)
    }
  )

  it('does not confuse a portable tool receipt quoting the prompt with the prompt itself', async () => {
    const input = request()
    const receipt = { role: 'user', content: '{"toolArguments":"Complete the current task"}' }
    const payload = { messages: [fixtures[0].prompt, receipt] }
    await prepareConversationGeneration(input, 'chat-completions', payload)
    expect(payload.messages).toEqual([fixtures[0].prompt, receipt])
  })

  it('refuses a converted request that lost the bound prompt identity', async () => {
    const input = request()
    const messages = [structuredClone(fixtures[0].prompt)]
    await expect(
      prepareConversationGeneration(input, 'chat-completions', { messages })
    ).rejects.toMatchObject({
      retryable: false,
      message: 'Agent context could not preserve the current user prompt.',
    })
  })

  it('preserves a file-only current prompt ahead of a later portable receipt', async () => {
    const input = request()
    input.messages![0].content = ''
    input.messages![0].files = [
      {
        id: 'file',
        name: 'note.txt',
        url: 'https://files.test/file',
        size: 1,
        type: 'text/plain',
        key: 'file',
        providerFileId: 'file',
      },
    ]
    const prompt = retainConversationMessageSource(input.messages![0], {
      role: 'user',
      content: [{ type: 'input_file', file_id: 'file' }],
    })
    const receipt = { role: 'user', content: 'Prior execution receipt' }
    const payload = { input: [prompt, receipt] }
    await prepareConversationGeneration(input, 'responses', payload)
    expect(payload.input).toEqual([prompt, receipt])
  })

  it('preserves non-memory requests without validation or mutation', async () => {
    state.enabled = false
    const payload = { messages: [{ role: 'tool', tool_call_id: 'unmatched' }] }
    expect(await prepareConversationGeneration(request(), 'chat-completions', payload)).toBe(
      payload
    )
    expect(payload.messages).toHaveLength(1)
  })
})
