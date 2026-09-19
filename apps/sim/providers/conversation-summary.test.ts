/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  save: vi.fn(),
  principal: vi.fn(),
  project: vi.fn(),
  redact: vi.fn(),
  tokens: vi.fn(),
}))
vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: mocks.principal,
}))
vi.mock('@/lib/memory/application/summaries', () => ({
  readAgentMemorySummaryUseCase: { execute: mocks.read },
  saveAgentMemorySummaryUseCase: { execute: mocks.save },
}))
vi.mock('@/executor/utils/resolved-secret-content-projection', () => ({
  projectResolvedSecretModelContent: mocks.project,
}))
vi.mock('@/lib/logs/execution/pii-redaction', () => ({ redactObjectStrings: mocks.redact }))
vi.mock('@/lib/memory/context-tokens', () => ({
  getConversationTokenCount: mocks.tokens,
}))

import { setNativeConversationMessage } from '@/providers/conversation-metadata'
import { createAgentConversationCompactor } from '@/providers/conversation-summary'
import type { ProviderRuntimeContext } from '@/providers/runtime-context'
import type { Message, ProviderRequest } from '@/providers/types'

function fixture() {
  const current: Message = { role: 'user', content: 'CURRENT_REQUEST' }
  const system: Message = { role: 'system', content: 'SYSTEM_RULES' }
  const history: Message[] = Array.from({ length: 10 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `old-${index} ${'x'.repeat(1500)}`,
  }))
  const request: ProviderRequest = {
    model: 'gpt-4.1-mini',
    messages: [system, ...history, current],
    tools: [],
    stream: true,
  }
  const recordContextUsage = vi.fn()
  const runtime = {
    agentConversation: {
      memoryId: 'memory-1',
      recordContextUsage,
      getMessages: vi.fn().mockReturnValue([]),
    },
    conversationProvider: { providerId: 'openai', binding: 'test' },
    executionContext: { workspaceId: 'workspace-1' },
    agentMemoryContext: { historyTokens: 2500 },
  } as unknown as ProviderRuntimeContext
  const generate = vi.fn().mockResolvedValue({
    content: 'Confirmed order receipt R123; unresolved delivery date.',
    model: 'test-model',
    tokens: { input: 1000, output: 30 },
    cost: { input: 0.01, output: 0.02, total: 0.03 },
  })
  const onUsage = vi.fn()
  const compact = () =>
    createAgentConversationCompactor(request, runtime, current, generate, onUsage)
  return {
    current,
    system,
    history,
    request,
    runtime,
    generate,
    recordContextUsage,
    onUsage,
    compact,
  }
}

function activeExchange(index: number, contentCharacters = 20_000): Message[] {
  return [
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: `call-${index}`,
          type: 'function',
          function: { name: 'http_request', arguments: JSON.stringify({ stage: index }) },
        },
      ],
    },
    {
      role: 'tool',
      tool_call_id: `call-${index}`,
      content: JSON.stringify({
        receipt: `RECEIPT-${index}`,
        padding: 'x'.repeat(contentCharacters),
      }),
    },
  ]
}

function summarySource(test: ReturnType<typeof fixture>, callIndex: number): Message[] {
  return JSON.parse(test.generate.mock.calls[callIndex][0].messages[0].content)
}

describe('bounded derived conversation summaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.read.mockResolvedValue(undefined)
    mocks.save.mockResolvedValue(undefined)
    mocks.principal.mockResolvedValue({ kind: 'delegated' })
    mocks.project.mockImplementation((value: string) => ({ safe: true, value }))
    mocks.redact.mockImplementation(async (value: string) =>
      value.replaceAll('PRIVATE', '[redacted]')
    )
    mocks.tokens.mockImplementation((text: string) => Math.ceil(text.length / 4))
  })

  it('does not generate or load a summary before the wire guard requests compaction', () => {
    const test = fixture()
    test.compact()
    expect(test.generate).not.toHaveBeenCalled()
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('summarizes only older eligible history without tools, files, streaming, or the current request', async () => {
    const test = fixture()
    const selected = await test.compact()({ maxSummaryTokens: 1600 })
    expect(selected?.role).toBe('user')
    const summaryRequest = test.generate.mock.calls[0][0]
    expect(summaryRequest).toMatchObject({
      stream: false,
      tools: [],
      maxTokens: 1024,
      thinkingLevel: 'none',
    })
    const source = summaryRequest.messages[0].content
    expect(source).not.toContain('CURRENT_REQUEST')
    expect(source).not.toContain('SYSTEM_RULES')
    expect(source).not.toContain('old-9')
    expect(Math.ceil(source.length / 4)).toBeLessThanOrEqual(8000)
    expect(JSON.parse(selected!.content!)).toMatchObject({ type: 'untrusted_conversation_summary' })
    expect(test.request.messages).toHaveLength(12)
    expect(test.recordContextUsage).toHaveBeenCalledExactlyOnceWith({
      tokens: { input: 1000, output: 30, cacheRead: 0, cacheWrite: 0 },
      cost: { input: 0.01, output: 0.02, total: 0.03, toolCost: 0 },
    })
  })

  it('reuses an exact cached summary without another provider charge', async () => {
    const test = fixture()
    await test.compact()({ maxSummaryTokens: 1600 })
    const cached = mocks.save.mock.calls.at(-1)![0].input
    mocks.read.mockResolvedValue({ ...cached, content: 'Cached order receipt R123' })
    test.generate.mockClear()
    test.recordContextUsage.mockClear()
    const selected = await test.compact()({ maxSummaryTokens: 1600 })
    expect(selected!.content).toContain('Cached order receipt R123')
    expect(test.generate).not.toHaveBeenCalled()
    expect(test.recordContextUsage).not.toHaveBeenCalled()
    expect(mocks.read.mock.calls[0][0].input).toMatchObject({
      memoryId: 'memory-1',
      workspaceId: 'workspace-1',
    })
  })

  it('changes the cache binding when the selected source content changes', async () => {
    const test = fixture()
    await test.compact()({ maxSummaryTokens: 1600 })
    test.history[5].content = `changed ${'x'.repeat(1500)}`
    await test.compact()({ maxSummaryTokens: 1600 })
    expect(mocks.save.mock.calls[0][0].input.sourceHash).not.toBe(
      mocks.save.mock.calls[1][0].input.sourceHash
    )
  })

  it('projects and redacts cached summaries again under current policy', async () => {
    const test = fixture()
    await test.compact()({ maxSummaryTokens: 1600 })
    const cached = mocks.save.mock.calls.at(-1)![0].input
    test.runtime.executionContext!.piiBlockOutputRedaction = {
      enabled: true,
      entityTypes: ['PERSON'],
      language: 'en',
    }
    test.runtime.resolvedSecretTraceRegistry = {} as NonNullable<
      ProviderRuntimeContext['resolvedSecretTraceRegistry']
    >
    mocks.read.mockResolvedValue({ ...cached, content: 'PRIVATE order receipt R123' })
    const selected = await test.compact()({ maxSummaryTokens: 1600 })
    expect(selected!.content).toContain('[redacted]')
    expect(selected!.content).not.toContain('PRIVATE')
    expect(mocks.project).toHaveBeenCalled()
  })

  it('keeps normal bounded selection available when optional summarization fails', async () => {
    const test = fixture()
    test.generate.mockRejectedValue(new Error('Synthetic provider outage'))
    expect(await test.compact()({ maxSummaryTokens: 1600 })).toBeUndefined()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('does not generate when cache authorization or storage admission fails', async () => {
    const test = fixture()
    mocks.read.mockRejectedValue(new Error('Access denied'))
    expect(await test.compact()({ maxSummaryTokens: 1600 })).toBeUndefined()
    expect(test.generate).not.toHaveBeenCalled()
  })

  it('records usage before rejecting an unsafe or oversized generated summary', async () => {
    const test = fixture()
    test.generate.mockResolvedValue({
      content: 'x'.repeat(7000),
      tokens: { input: 20, output: 10 },
    })
    expect(await test.compact()({ maxSummaryTokens: 1600 })).toBeUndefined()
    expect(test.recordContextUsage).toHaveBeenCalledOnce()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('propagates cancellation without starting a summary or saving derived context', async () => {
    const test = fixture()
    test.request.abortSignal = AbortSignal.abort()
    await expect(test.compact()({ maxSummaryTokens: 1600 })).rejects.toThrow()
    expect(test.generate).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('reuses the in-flight note until enough new complete history accumulates', async () => {
    const test = fixture()
    const compact = test.compact()
    const first = await compact({ maxSummaryTokens: 1600 })
    expect(await compact({ maxSummaryTokens: 1600 })).toBe(first)
    expect(test.generate).toHaveBeenCalledOnce()
    expect(test.onUsage).toHaveBeenCalledOnce()
    const active = Array.from({ length: 8 }, (_, i) => ({
      role: 'assistant',
      content: `ACTIVE-${i} ${'y'.repeat(2000)}`,
    }))
    vi.mocked(test.runtime.agentConversation!.getMessages).mockReturnValue(active as Message[])
    await compact({ maxSummaryTokens: 1600 })
    expect(test.generate).toHaveBeenCalledTimes(2)
    const source = test.generate.mock.calls[1][0].messages[0].content
    expect(source).toContain('ACTIVE-0')
    expect(source).not.toContain('ACTIVE-7')
    expect(source).toContain('untrusted_conversation_summary')
  })

  it('does not start a paid summary when too little wire space remains', async () => {
    const test = fixture()
    expect(await test.compact()({ maxSummaryTokens: 200 })).toBeUndefined()
    expect(test.generate).not.toHaveBeenCalled()
  })

  it('compacts according to actual wire capacity when the configured history target is larger', async () => {
    const test = fixture()
    test.runtime.agentMemoryContext = { historyTokens: 16_000 }
    const note = await test.compact()({ maxSummaryTokens: 1600 })
    expect(note).toBeDefined()
    expect(test.generate).toHaveBeenCalledOnce()
    expect(summarySource(test, 0)[0].content).toContain('old-0')
    expect(summarySource(test, 0).at(-1)?.content).not.toContain('old-9')
  })

  it('suppresses repeated failed compaction calls until history advances', async () => {
    const test = fixture()
    test.generate.mockRejectedValue(new Error('Provider unavailable'))
    const compact = test.compact()
    await compact({ maxSummaryTokens: 1600 })
    await compact({ maxSummaryTokens: 1600 })
    expect(test.generate).toHaveBeenCalledOnce()
  })

  it('covers the earliest receipt in consecutive 5000-token sources before later exchanges', async () => {
    const test = fixture()
    test.request.messages = [test.current]
    test.generate.mockResolvedValue({ content: 'Confirmed first receipt RECEIPT-0.' })
    const active = Array.from({ length: 3 }, (_, index) => activeExchange(index)).flat()
    vi.mocked(test.runtime.agentConversation!.getMessages).mockReturnValue(active)
    const note = await test.compact()({ maxSummaryTokens: 1600 })
    expect(test.generate).toHaveBeenCalledTimes(2)
    expect(
      summarySource(test, 0)
        .map((message) => message.tool_call_id)
        .filter(Boolean)
    ).toEqual(['call-0'])
    expect(
      summarySource(test, 1)
        .map((message) => message.tool_call_id)
        .filter(Boolean)
    ).toEqual(['call-1'])
    expect(summarySource(test, 1)[0].content).toContain('RECEIPT-0')
    expect(note?.content).toContain('RECEIPT-0')
    expect(test.recordContextUsage).toHaveBeenCalledTimes(2)
    expect(test.onUsage).toHaveBeenCalledTimes(2)
  })

  it('limits each pressure event to three batches and drains successful backlog without new history', async () => {
    const test = fixture()
    test.request.messages = [test.current]
    const active = Array.from({ length: 6 }, (_, index) => activeExchange(index)).flat()
    vi.mocked(test.runtime.agentConversation!.getMessages).mockReturnValue(active)
    const compact = test.compact()
    await compact({ maxSummaryTokens: 1600 })
    expect(test.generate).toHaveBeenCalledTimes(3)
    await compact({ maxSummaryTokens: 1600 })
    expect(test.generate).toHaveBeenCalledTimes(5)
    await compact({ maxSummaryTokens: 1600 })
    expect(test.generate).toHaveBeenCalledTimes(5)
    for (let index = 0; index < 5; index++) {
      expect(summarySource(test, index).at(-1)?.tool_call_id).toBe(`call-${index}`)
    }
  })

  it('retains successful prefix coverage after a later summary fails', async () => {
    const test = fixture()
    test.request.messages = [test.current]
    const active = Array.from({ length: 4 }, (_, index) => activeExchange(index)).flat()
    vi.mocked(test.runtime.agentConversation!.getMessages).mockReturnValue(active)
    test.generate
      .mockResolvedValueOnce({ content: 'Confirmed first receipt RECEIPT-0.' })
      .mockRejectedValueOnce(new Error('second summary failed'))
    const compact = test.compact()
    const note = await compact({ maxSummaryTokens: 1600 })
    expect(note?.content).toContain('RECEIPT-0')
    expect(test.generate).toHaveBeenCalledTimes(2)
    expect(await compact({ maxSummaryTokens: 1600 })).toBe(note)
    expect(test.generate).toHaveBeenCalledTimes(2)
    active.push(...activeExchange(4))
    await compact({ maxSummaryTokens: 1600 })
    expect(summarySource(test, 2).at(-1)?.tool_call_id).toBe('call-1')
    expect(summarySource(test, 2)[0].content).toContain('RECEIPT-0')
    expect(test.recordContextUsage).toHaveBeenCalledTimes(4)
  })

  it('summarizes an oversized parallel head as explicit excerpts with complete identities and artifact handles', async () => {
    const test = fixture()
    test.request.messages = [test.current]
    const ids = ['a'.repeat(80), 'b'.repeat(80)]
    const artifactId = 'c'.repeat(64)
    const head: Message[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: ids.map((id) => ({
          id,
          type: 'function',
          function: {
            name: 'http_request',
            arguments: JSON.stringify({ body: 'q'.repeat(30_000) }),
          },
        })),
      },
      ...ids.map((id) => ({
        role: 'tool' as const,
        tool_call_id: id,
        content: JSON.stringify({
          success: false,
          output: { padding: 'x'.repeat(30_000), memoryArtifact: { id: artifactId } },
          error: 'Request did not succeed',
        }),
      })),
    ]
    const original = JSON.stringify(head)
    vi.mocked(test.runtime.agentConversation!.getMessages).mockReturnValue([
      ...head,
      ...activeExchange(1),
    ])
    await test.compact()({ maxSummaryTokens: 1600 })
    expect(test.generate).toHaveBeenCalledOnce()
    const excerpt = JSON.parse(summarySource(test, 0)[0].content!)
    expect(excerpt.type).toBe('untrusted_summary_source_excerpt')
    expect(excerpt.notice).toContain('do not infer an outcome')
    expect(excerpt.identities).toEqual([
      { role: 'assistant', calls: ids.map((id) => ({ id, name: 'http_request' })) },
      ...ids.map((callId) => ({ role: 'tool', callId })),
    ])
    expect(excerpt.artifactIds).toEqual([artifactId])
    expect(excerpt.excerpt).toContain('success')
    expect(JSON.stringify(head)).toBe(original)
  })

  it('labels an oversized plain user excerpt without inventing tool execution', async () => {
    const test = fixture()
    test.request.messages = [
      { role: 'user', content: `User preference: blue. ${'x'.repeat(60_000)}` },
      test.current,
    ]
    await test.compact()({ maxSummaryTokens: 1600 })
    const excerpt = JSON.parse(summarySource(test, 0)[0].content!)
    expect(excerpt.identities).toEqual([{ role: 'user' }])
    expect(excerpt.excerpt[0]).toEqual({
      role: 'user',
      content: expect.stringContaining('User preference: blue.'),
    })
    expect(excerpt).not.toHaveProperty('calls')
    expect(JSON.stringify(excerpt)).not.toContain('untrusted_prior_tool_execution')
  })

  it('rechecks the complete source when small groups cross the conservative tokenizer threshold', async () => {
    const test = fixture()
    mocks.tokens.mockImplementation((text: string) =>
      text.length > 4096 ? Buffer.byteLength(text) : Math.ceil(text.length / 4)
    )
    await test.compact()({ maxSummaryTokens: 1600 })
    expect(test.generate).toHaveBeenCalledTimes(2)
    for (const [request] of test.generate.mock.calls) {
      expect(Buffer.byteLength(request.messages[0].content)).toBeLessThanOrEqual(8000)
    }
    expect(summarySource(test, 0)[0].content).toContain('old-0')
  })

  it('reuses the latest cumulative cache after three batches in a fresh compactor', async () => {
    const test = fixture()
    test.request.messages = [test.current]
    const active = Array.from({ length: 4 }, (_, index) => activeExchange(index)).flat()
    vi.mocked(test.runtime.agentConversation!.getMessages).mockReturnValue(active)
    let cached: unknown
    mocks.read.mockImplementation(async () => cached)
    mocks.save.mockImplementation(async ({ input }) => {
      cached = input
    })
    const first = await test.compact()({ maxSummaryTokens: 1600 })
    expect(test.generate).toHaveBeenCalledTimes(3)
    expect(mocks.save.mock.calls.map(([call]) => call.input.sourceMessageCount)).toEqual([2, 4, 6])
    test.generate.mockClear()
    test.recordContextUsage.mockClear()
    expect(await test.compact()({ maxSummaryTokens: 1600 })).toEqual(first)
    expect(test.generate).not.toHaveBeenCalled()
    expect(test.recordContextUsage).not.toHaveBeenCalled()
    expect(mocks.read).toHaveBeenCalledTimes(2)
  })

  it('resumes a cached partial prefix without regenerating the first three summaries', async () => {
    const test = fixture()
    test.request.messages = [test.current]
    const active = Array.from({ length: 6 }, (_, index) => activeExchange(index)).flat()
    vi.mocked(test.runtime.agentConversation!.getMessages).mockReturnValue(active)
    let cached: unknown
    mocks.read.mockImplementation(async () => cached)
    mocks.save.mockImplementation(async ({ input }) => {
      cached = input
    })
    await test.compact()({ maxSummaryTokens: 1600 })
    expect(test.generate).toHaveBeenCalledTimes(3)
    await test.compact()({ maxSummaryTokens: 1600 })
    expect(test.generate).toHaveBeenCalledTimes(5)
    expect(summarySource(test, 3).at(-1)?.tool_call_id).toBe('call-3')
    expect(summarySource(test, 4).at(-1)?.tool_call_id).toBe('call-4')
    expect(mocks.save.mock.calls.at(-1)![0].input.sourceMessageCount).toBe(10)
  })

  it('binds the cache to canonical history without current instructions or private native state', async () => {
    const test = fixture()
    await test.compact()({ maxSummaryTokens: 1600 })
    const cached = mocks.save.mock.calls.at(-1)![0].input
    mocks.read.mockResolvedValue(cached)
    test.current.content = 'A different current request'
    test.system.content = 'Different current system rules'
    setNativeConversationMessage(test.history[0], {
      protocol: 'responses',
      providerId: 'openai',
      model: test.request.model,
      binding: 'test',
      value: [{ type: 'reasoning', encrypted_content: 'PRIVATE_PROVIDER_STATE' }],
    })
    await test.compact()({ maxSummaryTokens: 1600 })
    expect(test.generate).toHaveBeenCalledOnce()
    expect(JSON.stringify(summarySource(test, 0))).not.toContain('PRIVATE_PROVIDER_STATE')
  })

  it.each(['partial-group', 'ineligible-count', 'mismatched-hash'] as const)(
    'rejects a cached %s prefix before using its content',
    async (failure) => {
      const test = fixture()
      test.request.messages = [test.current]
      vi.mocked(test.runtime.agentConversation!.getMessages).mockReturnValue([
        ...activeExchange(0),
        ...activeExchange(1),
      ])
      await test.compact()({ maxSummaryTokens: 1600 })
      const cached = { ...mocks.save.mock.calls.at(-1)![0].input, content: 'UNTRUSTED_CACHE' }
      if (failure === 'partial-group') cached.sourceMessageCount = 1
      if (failure === 'ineligible-count') cached.sourceMessageCount = 4
      if (failure === 'mismatched-hash') cached.sourceHash = '0'.repeat(64)
      mocks.read.mockResolvedValue(cached)
      await test.compact()({ maxSummaryTokens: 1600 })
      expect(test.generate).toHaveBeenCalledTimes(2)
      expect(JSON.stringify(summarySource(test, 1))).not.toContain('UNTRUSTED_CACHE')
    }
  )
})
