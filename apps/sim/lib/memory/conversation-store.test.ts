/** @vitest-environment node */
import { memory, memoryItem } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appendAgentMemoryMessage,
  appendMemoryMessages,
  saveAgentMemoryTurn,
} from '@/lib/memory/conversation-store'

const identity = {
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
  blockId: 'block-1',
  nodeId: 'node-1',
  executionOrder: 1,
  conversationId: 'conversation-1',
  memoryId: 'memory-1',
  turnId: 'turn-1',
}

const writers = {
  message: (data: unknown) => appendAgentMemoryMessage({ ...identity, appendKey: 'input', data }),
  ordinary: (data: unknown) =>
    appendMemoryMessages({
      workspaceId: identity.workspaceId,
      key: identity.conversationId,
      messages: [data],
    }),
  checkpoint: (data: unknown) =>
    saveAgentMemoryTurn({
      ...identity,
      encryptedState: 'ciphertext',
      expectedRevision: 0,
      items: [{ appendKey: 'exchange', kind: 'exchange', data }],
    }),
}

describe('bounded conversation item writes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    queueTableRows(memory, [{ id: identity.memoryId, storageVersion: 2 }])
    dbChainMockFns.returning.mockResolvedValue([{ revision: 1 }])
  })

  it.each(Object.entries(writers))(
    '%s writes enforce the shared item limit',
    async (_name, write) => {
      await expect(write({ role: 'user', content: 'x'.repeat(1024 * 1024) })).rejects.toMatchObject(
        { code: 'payload_too_large' }
      )
      expect(dbChainMockFns.insert).not.toHaveBeenCalledWith(memoryItem)
    }
  )

  it('stores the admitted JSON snapshot without re-reading proxy values', async () => {
    const get = vi.fn(() => 'UNADMITTED')
    const value = new Proxy({ role: 'user', content: 'admitted' }, { get })
    await writers.message(value)
    expect(dbChainMockFns.values).toHaveBeenCalledWith([
      expect.objectContaining({ data: { role: 'user', content: 'admitted' } }),
    ])
    expect(get).not.toHaveBeenCalled()
  })
})
