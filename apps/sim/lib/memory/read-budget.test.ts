/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ select: vi.fn(), limit: vi.fn() }))
vi.unmock('drizzle-orm')
vi.unmock('@sim/db/schema')
vi.mock('@sim/db', () => ({ db: { select: mocks.select } }))

import { hashDurableSecretProvenanceValue } from '@/lib/execution/durable-secret-provenance'
import { readConversationItems, readPlainMemoryTail } from '@/lib/memory/conversation-store'
import { PlainMemoryReadBudget } from '@/lib/memory/read-budget'

const message = { role: 'user', content: 'hello' }
function row(sequence: number) {
  return {
    item: {
      id: `item-${sequence}`,
      sequence,
      memoryId: 'memory-1',
      appendKey: `key-${sequence}`,
      kind: 'message',
      data: message,
      contentHash: hashDurableSecretProvenanceValue(message),
      provenanceStatus: 'exact',
      provenanceEntries: [],
      turnId: null,
      createdAt: new Date(),
    },
  }
}

describe('plain appended-memory read budget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.limit.mockReset()
    const chain = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: mocks.limit,
    }
    chain.from.mockReturnValue(chain)
    chain.innerJoin.mockReturnValue(chain)
    chain.where.mockReturnValue(chain)
    chain.orderBy.mockReturnValue(chain)
    mocks.select.mockReturnValue(chain)
  })

  it('rejects oversized JSON from size metadata before selecting the payload', async () => {
    mocks.limit.mockResolvedValueOnce([{ id: 'item-1', sequence: 1, bytes: 1025 }])
    await expect(
      readPlainMemoryTail(
        'memory-1',
        'workspace-1',
        new PlainMemoryReadBudget({ rows: 10, bytes: 1024 })
      )
    ).rejects.toMatchObject({ code: 'payload_too_large' })
    expect(mocks.select).toHaveBeenCalledOnce()
    expect(mocks.select.mock.calls[0][0]).not.toHaveProperty('item')
  })

  it('stops pagination before loading a page that would exceed the remaining row budget', async () => {
    mocks.limit.mockResolvedValueOnce(
      Array.from({ length: 100 }, (_, index) => ({
        id: `item-${index + 1}`,
        sequence: index + 1,
        bytes: 1,
      }))
    )
    mocks.limit.mockResolvedValueOnce(Array.from({ length: 100 }, (_, index) => row(index + 1)))
    mocks.limit.mockResolvedValueOnce([{ id: 'item-101', sequence: 101, bytes: 1 }])
    await expect(
      readPlainMemoryTail(
        'memory-1',
        'workspace-1',
        new PlainMemoryReadBudget({ rows: 100, bytes: 1024 })
      )
    ).rejects.toMatchObject({ code: 'payload_too_large' })
    expect(mocks.select).toHaveBeenCalledTimes(3)
    expect(mocks.select.mock.calls[1][0]).toHaveProperty('item')
    expect(mocks.select.mock.calls[2][0]).not.toHaveProperty('item')
  })

  it('shares reservations across conversations instead of granting each its own cap', async () => {
    const budget = new PlainMemoryReadBudget({ rows: 1, bytes: 1024 })
    mocks.limit.mockResolvedValueOnce([{ id: 'item-1', sequence: 1, bytes: 100 }])
    mocks.limit.mockResolvedValueOnce([row(1)])
    mocks.limit.mockResolvedValueOnce([{ id: 'item-2', sequence: 2, bytes: 100 }])
    expect((await readPlainMemoryTail('memory-1', 'workspace-1', budget)).messages).toEqual([
      message,
    ])
    await expect(readPlainMemoryTail('memory-2', 'workspace-1', budget)).rejects.toMatchObject({
      code: 'payload_too_large',
    })
    expect(mocks.select).toHaveBeenCalledTimes(3)
  })
  it('stops rich pagination at an oversized group before loading its JSON', async () => {
    mocks.limit.mockResolvedValueOnce([
      { id: 'item-3', sequence: 3, bytes: 100 },
      { id: 'item-2', sequence: 2, bytes: 5 * 1024 * 1024 },
      { id: 'item-1', sequence: 1, bytes: 100 },
    ])
    mocks.limit.mockResolvedValueOnce([row(3)])
    const page = await readConversationItems({
      memoryId: 'memory-1',
      workspaceId: 'workspace-1',
      limit: 2,
    })
    expect(page.items.map((item) => item.sequence)).toEqual([3])
    expect(page.nextBeforeSequence).toBeUndefined()
    expect(mocks.select).toHaveBeenCalledTimes(2)
  })

  it('does not fetch rich JSON when the newest group alone exceeds the page byte budget', async () => {
    mocks.limit.mockResolvedValueOnce([{ id: 'item-1', sequence: 1, bytes: 5 * 1024 * 1024 }])
    expect(
      await readConversationItems({ memoryId: 'memory-1', workspaceId: 'workspace-1' })
    ).toEqual({ items: [] })
    expect(mocks.select).toHaveBeenCalledOnce()
    expect(mocks.select.mock.calls[0][0]).not.toHaveProperty('item')
  })
})
