/**
 * @vitest-environment node
 */
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

const ctx = { workspaceId: 'workspace-1' } as ExecutionContext
const inputs = { memoryType: 'conversation' as const, conversationId: 'conversation-1' }
const options = { memoryId: 'memory-1', turnId: 'turn-1', appendKey: 'input' }
const prefix = [{ role: 'user', content: 'previous question' }]
const storageFailure = () => Object.assign(new Error('private SQL and values'), { code: '08006' })

describe('optional Agent memory durability failures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('keeps the available legacy prefix when child storage is unavailable', async () => {
    mocks.items.mockRejectedValue(storageFailure())
    await expect(
      new Memory().fetchMemoryMessages(ctx, inputs, undefined, {
        richHistory: true,
        memoryId: options.memoryId,
      })
    ).resolves.toEqual(prefix)
  })

  it('continues without stored history if the prefix query is unavailable', async () => {
    mocks.prefix.mockRejectedValue(storageFailure())
    await expect(
      new Memory().fetchMemoryMessages(ctx, inputs, undefined, {
        richHistory: true,
        memoryId: options.memoryId,
      })
    ).resolves.toEqual([])
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

  it('drops optional scoped appends when storage fails without retrying an unscoped write', async () => {
    mocks.append.mockRejectedValue(storageFailure())
    await expect(
      new Memory().appendToMemory(ctx, inputs, { role: 'user', content: 'new question' }, options)
    ).resolves.toBeUndefined()
    expect(mocks.append).toHaveBeenCalledOnce()
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

  it('preserves existing secret-projection refusal after storage succeeds', async () => {
    mocks.prefix.mockResolvedValue({
      id: options.memoryId,
      storageVersion: 2,
      data: prefix,
      secretProvenanceVersion: 1,
      provenanceContentHash: 'mismatched',
      provenanceStatus: 'exact',
      provenanceEntries: [],
    })
    await expect(
      new Memory().fetchMemoryMessages(ctx, inputs, undefined, { richHistory: true })
    ).rejects.toThrow('Memory content could not be safely projected')
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
    expect(result).toHaveLength(9)
    expect(result.filter((message) => message.role === 'tool')).toHaveLength(4)
  })

  it('bounds scanning when stored items are malformed or excluded', async () => {
    mocks.items.mockResolvedValue({
      items: Array.from({ length: 10 }, () => ({ kind: 'exchange', data: {} })),
      nextBeforeSequence: 1,
    })
    await expect(
      new Memory().fetchMemoryMessages(ctx, inputs, undefined, { richHistory: true })
    ).resolves.toEqual(prefix)
    expect(mocks.items).toHaveBeenCalledTimes(100)
  })
})
