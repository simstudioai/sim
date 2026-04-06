/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { IdempotencyService } from '@/lib/core/idempotency/service'

vi.mock('@/lib/core/utils/uuid', () => ({
  generateId: vi.fn(() => 'fallback-uuid'),
}))

describe('IdempotencyService.createWebhookIdempotencyKey', () => {
  it('uses Greenhouse-Event-ID when present', () => {
    const key = IdempotencyService.createWebhookIdempotencyKey(
      'wh_1',
      { 'greenhouse-event-id': 'evt-gh-99' },
      {},
      'greenhouse'
    )
    expect(key).toBe('wh_1:evt-gh-99')
  })
})
