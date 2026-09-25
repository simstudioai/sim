import { describe, expect, it, vi } from 'vitest'
import type { LargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import type { AgentTurnState, ConversationToolResult } from '@/lib/memory/conversation-types'
import { createJournalArtifactFixture } from '@/lib/memory/journal.test-helpers'
import { AgentTurnJournal, MAX_AGENT_JOURNAL_PAYLOAD_BYTES } from '@/lib/memory/turn-journal'

const binding = { identity: 'bound-invocation', memoryId: 'memory-1', turnId: 'turn-1' }

function fixture() {
  const artifacts = createJournalArtifactFixture()
  const storage = {
    store: vi.fn(async (value: unknown) => (await artifacts.store({ input: { value } })).ref),
    read: vi.fn(async (ref: LargeValueRef) => artifacts.read({ input: { ref } })),
    compactResult: (result: ConversationToolResult) => result,
    unavailable: vi.fn(),
  }
  const state: AgentTurnState = {
    version: 1,
    steps: [
      {
        id: 'step-1',
        assistant: { role: 'assistant', content: '' },
        calls: [{ invocationId: 'call-1', toolId: 'send_email', arguments: '{}' }],
        results: [],
        native: {
          providerId: 'bedrock',
          protocol: 'bedrock',
          model: 'model-1',
          binding: 'provider-binding',
          value: { signature: new Uint8Array([1, 2, 255]) },
        },
      },
    ],
  }
  return { artifacts, storage, state, journal: new AgentTurnJournal(binding, storage) }
}

describe('compact invocation journal', () => {
  it('preserves opaque provider byte signatures and exact invocation IDs', async () => {
    const { journal, state, storage } = fixture()
    const checkpoint = await journal.checkpoint(state)
    expect(await new AgentTurnJournal(binding, storage).restore(checkpoint)).toEqual(state)
    expect(storage.store).toHaveBeenCalledTimes(1)
    await journal.checkpoint(state)
    expect(storage.store).toHaveBeenCalledTimes(1)
  })

  it('rejects an oversized manifest before reading any payloads', async () => {
    const { journal, state, storage } = fixture()
    const checkpoint = await journal.checkpoint(state)
    checkpoint.steps[0].bytes = MAX_AGENT_JOURNAL_PAYLOAD_BYTES + 1
    await expect(new AgentTurnJournal(binding, storage).restore(checkpoint)).rejects.toThrow(
      'Invalid Agent memory journal'
    )
    expect(storage.read).not.toHaveBeenCalled()
  })

  it('rejects a step payload bound to a different invocation even within the same memory owner', async () => {
    const { journal, state, storage } = fixture()
    const checkpoint = await journal.checkpoint(state)
    await expect(
      new AgentTurnJournal({ ...binding, turnId: 'other-turn' }, storage).restore(checkpoint)
    ).rejects.toThrow('binding is invalid')
  })

  it('keeps a terminal result recorded when its bound payload cannot be authenticated', async () => {
    const { journal, state, storage, artifacts } = fixture()
    state.steps[0].results.push({
      invocationId: 'call-1',
      rawResponse: { success: true, output: { cost: { total: 0.5 } } },
      modelResponse: { success: true, output: { delivered: true } },
    })
    const checkpoint = await journal.checkpoint(state)
    storage.read.mockImplementation(async (ref) => {
      const payload = await artifacts.read({ input: { ref } })
      return ref.key === checkpoint.steps[0].results[0].ref.key
        ? { ...(payload as Record<string, unknown>), turnId: 'other-turn' }
        : payload
    })
    const restored = await new AgentTurnJournal(binding, storage).restore(checkpoint)
    expect(restored).toMatchObject({
      steps: [
        {
          results: [
            {
              invocationId: 'call-1',
              rawResponse: {
                success: true,
                output: { memoryResultUnavailable: true, cost: { total: 0.5 } },
              },
            },
          ],
        },
      ],
    })
    expect(storage.unavailable).toHaveBeenCalledOnce()
  })
})
