/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  notLike: vi.fn(() => 'not-like'),
  like: vi.fn(() => 'like'),
}))

vi.mock('@sim/db', () => {
  const selectChain = () => {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.where = () => chain
    chain.limit = () => Promise.resolve([])
    return chain
  }
  return { db: { select: () => selectChain() } }
})
vi.mock('@sim/db/schema', () => ({
  idempotencyKey: { key: 'key', createdAt: 'createdAt' },
}))
vi.mock('@sim/logger', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}))
vi.mock('@sim/utils/helpers', () => ({ sleep: vi.fn() }))
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...values: unknown[]) => values),
  count: vi.fn(),
  inArray: vi.fn(),
  like: mocks.like,
  lt: vi.fn(() => 'older-than'),
  max: vi.fn(),
  min: vi.fn(),
  notLike: mocks.notLike,
  sql: vi.fn(),
}))

import { cleanupExpiredIdempotencyKeys } from '@/lib/core/idempotency/cleanup'

describe('cleanupExpiredIdempotencyKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retains irreversible admin credit-grant keys during global cleanup', async () => {
    await cleanupExpiredIdempotencyKeys()

    expect(mocks.notLike).toHaveBeenCalledWith('key', 'admin-credit-grant:%')
  })

  it('retains permanent workflow execution ID claims during global cleanup', async () => {
    await cleanupExpiredIdempotencyKeys()

    expect(mocks.notLike).toHaveBeenCalledWith('key', 'workflow-execution-id:%')
  })

  it('keeps explicit namespace cleanup behavior unchanged', async () => {
    await cleanupExpiredIdempotencyKeys({ namespace: 'webhook' })

    expect(mocks.like).toHaveBeenCalledWith('key', 'webhook:%')
    expect(mocks.notLike).not.toHaveBeenCalled()
  })
})
