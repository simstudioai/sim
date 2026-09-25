import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prefix: vi.fn(),
  items: vi.fn(),
  append: vi.fn(),
  principal: vi.fn(),
}))
vi.mock('@/lib/memory/application/agent-turns', () => ({
  readAgentMemoryPrefixUseCase: { execute: mocks.prefix },
  readAgentMemoryItemsUseCase: { execute: mocks.items },
  appendAgentMemoryMessageUseCase: { execute: mocks.append },
}))
vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: mocks.principal,
}))
vi.mock('@/lib/tokenization/accurate', () => ({ getAccurateTokenCount: () => 1 }))
vi.mock('@/lib/logs/execution/pii-redaction', () => ({
  redactObjectStrings: async (value: unknown) => value,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { hashDurableSecretProvenanceValue } from '@/lib/execution/durable-secret-provenance'
import { Memory } from '@/executor/handlers/agent/memory'
import type { ExecutionContext } from '@/executor/types'
import { isConversationHistoryNotice } from '@/providers/conversation-metadata'

const ctx = { workspaceId: 'workspace-1' } as ExecutionContext
const inputs = { memoryType: 'conversation' as const, conversationId: 'conversation-1' }
const options = { memoryId: 'memory-1', turnId: 'turn-1', appendKey: 'input' }
const prefix = [{ role: 'user', content: 'previous question' }]
const storageFailure = () => Object.assign(new Error('private SQL and values'), { code: '08006' })

describe('optional Agent memory durability failures', () => {
  beforeEach(() => {
    mocks.principal.mockResolvedValue({ kind: 'delegated' })
    mocks.prefix.mockResolvedValue({
      id: options.memoryId,
      storageVersion: 2,
      data: prefix,
      secretProvenanceVersion: 1,
      provenanceContentHash: hashDurableSecretProvenanceValue(prefix),
      provenanceStatus: 'exact',
      provenanceEntries: [],
    })
    mocks.items.mockResolvedValue({ items: [] })
    mocks.append.mockResolvedValue(undefined)
  })

  it('defers rich conversation selection until the actual provider context is known', async () => {
    const history = [
      { role: 'user', content: 'x'.repeat(140_000) },
      { role: 'assistant', content: 'recent answer' },
    ]
    mocks.prefix.mockResolvedValue({
      id: options.memoryId,
      storageVersion: 2,
      data: history,
      secretProvenanceVersion: 1,
      provenanceContentHash: hashDurableSecretProvenanceValue(history),
      provenanceStatus: 'exact',
      provenanceEntries: [],
    })
    const memory = new Memory()
    await expect(
      memory.fetchMemoryMessages(ctx, { ...inputs, model: 'gpt-4o' }, undefined, {
        richHistory: true,
      })
    ).resolves.toEqual(history)
    await expect(
      memory.fetchMemoryMessages(
        ctx,
        {
          ...inputs,
          memoryType: 'sliding_window_tokens',
          slidingWindowTokens: '100',
          model: 'gpt-4o',
        },
        undefined,
        { richHistory: true }
      )
    ).resolves.toEqual([history[1]])
  })

  it('never rereads a replacement key after the original conversation disappears', async () => {
    mocks.prefix.mockResolvedValue(undefined)
    await expect(
      new Memory().fetchMemoryMessages(ctx, inputs, undefined, {
        richHistory: true,
        memoryId: options.memoryId,
      })
    ).resolves.toEqual([])
    expect(mocks.prefix).toHaveBeenCalledOnce()
    expect(mocks.prefix.mock.calls[0][0].input.memoryId).toBe(options.memoryId)
    expect(mocks.items).not.toHaveBeenCalled()
  })

  it.each([{ name: '', arguments: '{}' }, { name: 'lookup', arguments: 1 }, { arguments: '{}' }])(
    'omits an invalid legacy function exchange: %j',
    async (functionCall) => {
      mocks.items.mockResolvedValue({
        items: [
          {
            kind: 'exchange',
            appendKey: 'step:1',
            turnId: 'previous-turn',
            data: {
              version: 1,
              messages: [
                { role: 'assistant', content: null, function_call: functionCall },
                { role: 'function', name: 'lookup', content: 'Saved result' },
              ],
            },
            provenance: { status: 'exact', entries: [] },
          },
        ],
      })
      await expect(
        new Memory().fetchMemoryMessages(ctx, inputs, undefined, { richHistory: true })
      ).resolves.toEqual(prefix)
    }
  )

  it('drops optional scoped appends when storage fails without retrying an unscoped write', async () => {
    mocks.append.mockRejectedValue(storageFailure())
    await expect(
      new Memory().appendToMemory(ctx, inputs, { role: 'user', content: 'new question' }, options)
    ).resolves.toBeUndefined()
    expect(mocks.append).toHaveBeenCalledOnce()
  })

  it('propagates an append identity conflict instead of treating different content as saved', async () => {
    const failure = new OrchestrationError('conflict', 'Memory append identity was already used')
    mocks.append.mockRejectedValue(failure)
    await expect(
      new Memory().appendToMemory(
        ctx,
        inputs,
        { role: 'user', content: 'changed question' },
        options
      )
    ).rejects.toBe(failure)
    expect(mocks.append).toHaveBeenCalledExactlyOnceWith({
      principal: { kind: 'delegated' },
      input: {
        ...options,
        workspaceId: ctx.workspaceId,
        conversationId: inputs.conversationId,
        data: { role: 'user', content: 'changed question' },
        provenance: undefined,
      },
    })
  })

  it('preserves authorization failures on reads and appends', async () => {
    const failure = new OrchestrationError('forbidden', 'Denied')
    mocks.prefix.mockRejectedValue(failure)
    mocks.append.mockRejectedValue(failure)
    await expect(
      new Memory().fetchMemoryMessages(ctx, inputs, undefined, { richHistory: true })
    ).rejects.toBe(failure)
    await expect(
      new Memory().appendToMemory(ctx, inputs, { role: 'user', content: 'new question' }, options)
    ).rejects.toBe(failure)
  })

  it('counts encrypted provider continuation bytes toward the retained history cap', async () => {
    mocks.items.mockResolvedValue({
      items: Array.from({ length: 5 }, (_, index) => ({
        kind: 'exchange',
        appendKey: `exchange-${index}`,
        turnId: `old-turn-${index}`,
        provenance: { status: 'exact', entries: [] },
        data: {
          version: 1,
          encryptedNative: 'x'.repeat(900 * 1024),
          messages: [
            {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: `call-${index}`,
                  type: 'function',
                  function: { name: 'lookup', arguments: '{}' },
                },
              ],
            },
            { role: 'tool', tool_call_id: `call-${index}`, content: 'result' },
          ],
        },
      })),
    })
    const result = await new Memory().fetchMemoryMessages(ctx, inputs, undefined, {
      richHistory: true,
    })
    expect(result).toHaveLength(10)
    expect(result.filter((message) => message.role === 'tool')).toHaveLength(4)
    expect(isConversationHistoryNotice(result.at(-1)!)).toBe(true)
    expect(result.at(-1)!.content!.length).toBeLessThan(512)
    expect(result.at(-1)!.content).toContain('agent_memory_read')
    expect(mocks.append).not.toHaveBeenCalled()
  })

  it('does not mistake an oversized page head for the end of retained history', async () => {
    mocks.items.mockResolvedValue({
      items: [],
      unavailableSequence: 10,
      nextBeforeSequence: 10,
    })
    const result = await new Memory().fetchMemoryMessages(ctx, inputs, undefined, {
      richHistory: true,
    })
    expect(result).toContainEqual(prefix[0])
    expect(isConversationHistoryNotice(result.at(-1)!)).toBe(true)
    expect(mocks.items).toHaveBeenCalledExactlyOnceWith({
      principal: { kind: 'delegated' },
      input: {
        memoryId: options.memoryId,
        workspaceId: ctx.workspaceId,
        beforeSequence: undefined,
        limit: 10,
        continueAfterByteLimit: true,
      },
    })
  })

  it('still refuses unsafe retained provenance before returning a truncated history notice', async () => {
    mocks.items
      .mockResolvedValueOnce({
        items: [
          {
            kind: 'message',
            appendKey: 'unsafe',
            data: { role: 'assistant', content: 'protected result' },
            provenance: { status: 'unknown' },
          },
        ],
        nextBeforeSequence: 10,
      })
      .mockResolvedValueOnce({
        items: [],
        unavailableSequence: 9,
        nextBeforeSequence: 9,
      })
    await expect(
      new Memory().fetchMemoryMessages(ctx, inputs, undefined, { richHistory: true })
    ).rejects.toThrow('Memory content could not be safely projected')
    expect(mocks.items).toHaveBeenCalledTimes(2)
  })
})
