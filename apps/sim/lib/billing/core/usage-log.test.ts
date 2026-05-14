/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  dbMock,
  selectLimitMock,
  insertValuesMock,
  insertReturningMock,
  updateReturningMock,
  enqueueOutboxEventMock,
} = vi.hoisted(() => {
  const selectLimitMock = vi.fn()
  const insertValuesMock = vi.fn()
  const insertReturningMock = vi.fn()
  const updateReturningMock = vi.fn()
  const dbMock = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: selectLimitMock,
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: insertValuesMock.mockImplementation(() => ({
        onConflictDoNothing: vi.fn(() => ({
          returning: insertReturningMock,
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: updateReturningMock,
        })),
      })),
    })),
    transaction: vi.fn(async (callback) => callback(dbMock)),
  }
  return {
    dbMock,
    selectLimitMock,
    insertValuesMock,
    insertReturningMock,
    updateReturningMock,
    enqueueOutboxEventMock: vi.fn(),
  }
})

vi.mock('@sim/db', () => ({ db: dbMock }))

vi.mock('@sim/db/schema', () => ({
  usageLog: {
    sourceEventHash: 'source_event_hash',
    sourceEventKey: 'source_event_key',
    $inferInsert: {},
  },
  userStats: {
    userId: 'user_id',
  },
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock('@sim/utils/id', () => ({
  generateId: vi.fn(() => 'usage-id'),
}))

vi.mock('@/lib/billing/ledger/usage-ledger', () => ({
  resolveUsageBillingContext: vi.fn(async () => ({
    attribution: {
      entityType: 'user',
      entityId: 'user-1',
    },
    subscriptionId: 'sub-1',
  })),
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  isBillingEnabled: true,
}))

vi.mock('@/lib/core/outbox/service', () => ({
  enqueueOutboxEvent: enqueueOutboxEventMock,
}))

import { recordUsage } from '@/lib/billing/core/usage-log'

describe('recordUsage durable source identity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectLimitMock.mockResolvedValue([])
    insertReturningMock.mockResolvedValue([
      { id: 'usage-id', sourceEventKey: 'update-cost:key-1:0' },
    ])
    updateReturningMock.mockResolvedValue([{ userId: 'user-1' }])
    enqueueOutboxEventMock.mockResolvedValue('outbox-1')
  })

  it('inserts usage once and ignores a replay with the same source event payload', async () => {
    await recordUsage({
      userId: 'user-1',
      sourceEventKey: 'update-cost:key-1',
      entries: [
        {
          category: 'model',
          source: 'workflow',
          description: 'gpt-4o',
          cost: 1.25,
          metadata: { inputTokens: 10, outputTokens: 20 },
        },
      ],
    })

    const insertedRows = insertValuesMock.mock.calls[0][0]
    expect(insertedRows[0]).toMatchObject({
      billingEntityType: 'user',
      billingEntityId: 'user-1',
    })
    const insertedHash = insertedRows[0].sourceEventHash
    selectLimitMock.mockResolvedValueOnce([{ sourceEventHash: insertedHash }])

    await recordUsage({
      userId: 'user-1',
      sourceEventKey: 'update-cost:key-1',
      entries: [
        {
          category: 'model',
          source: 'workflow',
          description: 'gpt-4o',
          cost: 1.25,
          metadata: { inputTokens: 10, outputTokens: 20 },
        },
      ],
    })

    expect(insertValuesMock).toHaveBeenCalledTimes(1)
    expect(updateReturningMock).not.toHaveBeenCalled()
  })

  it('rejects a replay with a changed payload hash', async () => {
    selectLimitMock.mockResolvedValueOnce([{ sourceEventHash: 'different-hash' }])

    await expect(
      recordUsage({
        userId: 'user-1',
        sourceEventKey: 'update-cost:key-1',
        entries: [
          {
            category: 'model',
            source: 'workflow',
            description: 'gpt-4o',
            cost: 2,
            metadata: { inputTokens: 10, outputTokens: 20 },
          },
        ],
      })
    ).rejects.toThrow('was replayed with a different payload')

    expect(insertValuesMock).not.toHaveBeenCalled()
    expect(updateReturningMock).not.toHaveBeenCalled()
  })

  it('does not increment counters when a concurrent replay loses the insert race', async () => {
    selectLimitMock.mockReset()
    selectLimitMock.mockResolvedValueOnce([])
    selectLimitMock.mockImplementationOnce(async () => [
      { sourceEventHash: insertValuesMock.mock.calls[0][0][0].sourceEventHash },
    ])
    insertReturningMock.mockResolvedValueOnce([])

    await recordUsage({
      userId: 'user-1',
      sourceEventKey: 'update-cost:key-1',
      entries: [
        {
          category: 'model',
          source: 'workflow',
          description: 'gpt-4o',
          cost: 1.25,
          metadata: { inputTokens: 10, outputTokens: 20 },
        },
      ],
    })

    expect(insertValuesMock).toHaveBeenCalledTimes(1)
    expect(updateReturningMock).not.toHaveBeenCalled()
  })
})
