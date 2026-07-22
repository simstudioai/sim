/**
 * @vitest-environment node
 */
import { idempotencyKey } from '@sim/db/schema'
import { dbChainMock, resetDbChainMock } from '@sim/testing'
import { like, notLike } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)
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

    expect(notLike).toHaveBeenCalledWith(idempotencyKey.key, 'admin-credit-grant:%')
  })

  it('retains permanent workflow execution ID claims during global cleanup', async () => {
    await cleanupExpiredIdempotencyKeys()

    expect(notLike).toHaveBeenCalledWith(idempotencyKey.key, 'workflow-execution-id:%')
  })

  it('keeps explicit namespace cleanup behavior unchanged', async () => {
    await cleanupExpiredIdempotencyKeys({ namespace: 'webhook' })

    expect(like).toHaveBeenCalledWith(idempotencyKey.key, 'webhook:%')
    expect(notLike).not.toHaveBeenCalled()
  })
})
