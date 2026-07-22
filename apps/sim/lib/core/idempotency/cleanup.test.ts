/**
 * @vitest-environment node
 */
import { idempotencyKey } from '@sim/db/schema'
import { dbChainMock, drizzleOrmMock, resetDbChainMock } from '@sim/testing'
import { like } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockNotLike } = vi.hoisted(() => ({
  mockNotLike: vi.fn((column: unknown, pattern: unknown) => ({ type: 'notLike', column, pattern })),
}))

vi.mock('@sim/db', () => dbChainMock)
/** The shared operator mock has no `notLike`; extend it for this suite only. */
vi.mock('drizzle-orm', () => ({ ...drizzleOrmMock, notLike: mockNotLike }))
vi.mock('@sim/utils/helpers', () => ({ sleep: vi.fn() }))

import { cleanupExpiredIdempotencyKeys } from '@/lib/core/idempotency/cleanup'

afterAll(resetDbChainMock)

describe('cleanupExpiredIdempotencyKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('retains irreversible admin credit-grant keys during global cleanup', async () => {
    await cleanupExpiredIdempotencyKeys()

    expect(mockNotLike).toHaveBeenCalledWith(idempotencyKey.key, 'admin-credit-grant:%')
  })

  it('retains permanent workflow execution ID claims during global cleanup', async () => {
    await cleanupExpiredIdempotencyKeys()

    expect(mockNotLike).toHaveBeenCalledWith(idempotencyKey.key, 'workflow-execution-id:%')
  })

  it('keeps explicit namespace cleanup behavior unchanged', async () => {
    await cleanupExpiredIdempotencyKeys({ namespace: 'webhook' })

    expect(like).toHaveBeenCalledWith(idempotencyKey.key, 'webhook:%')
    expect(mockNotLike).not.toHaveBeenCalled()
  })
})
