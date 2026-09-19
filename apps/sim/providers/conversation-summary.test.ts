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
  getConversationTokenCount: (text: string) => Math.ceil(text.length / 4),
}))

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
    mocks.read.mockResolvedValue('Cached order receipt R123')
    const selected = await test.compact()({ maxSummaryTokens: 1600 })
    expect(selected!.content).toContain('Cached order receipt R123')
    expect(test.generate).not.toHaveBeenCalled()
    expect(test.recordContextUsage).not.toHaveBeenCalled()
    expect(mocks.read.mock.calls[0][0].input).toMatchObject({
      memoryId: 'memory-1',
      workspaceId: 'workspace-1',
      sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
  })

  it('changes the cache binding when the selected source content changes', async () => {
    const test = fixture()
    await test.compact()({ maxSummaryTokens: 1600 })
    test.history[5].content = `changed ${'x'.repeat(1500)}`
    await test.compact()({ maxSummaryTokens: 1600 })
    expect(mocks.read.mock.calls[0][0].input.sourceHash).not.toBe(
      mocks.read.mock.calls[1][0].input.sourceHash
    )
  })

  it('projects and redacts cached summaries again under current policy', async () => {
    const test = fixture()
    test.runtime.executionContext!.piiBlockOutputRedaction = {
      enabled: true,
      entityTypes: ['PERSON'],
      language: 'en',
    }
    test.runtime.resolvedSecretTraceRegistry = {} as NonNullable<
      ProviderRuntimeContext['resolvedSecretTraceRegistry']
    >
    mocks.read.mockResolvedValue('PRIVATE order receipt R123')
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

  it('suppresses repeated failed compaction calls until history advances', async () => {
    const test = fixture()
    test.generate.mockRejectedValue(new Error('Provider unavailable'))
    const compact = test.compact()
    await compact({ maxSummaryTokens: 1600 })
    await compact({ maxSummaryTokens: 1600 })
    expect(test.generate).toHaveBeenCalledOnce()
  })
})
