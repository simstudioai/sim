/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAnd, mockEq, mockIsNull } = vi.hoisted(() => ({
  mockAnd: vi.fn((...conditions: unknown[]) => ({ kind: 'and', conditions })),
  mockEq: vi.fn((column: unknown, value: unknown) => ({ kind: 'eq', column, value })),
  mockIsNull: vi.fn((column: unknown) => ({ kind: 'isNull', column })),
}))

vi.mock('drizzle-orm', () => ({
  and: mockAnd,
  eq: mockEq,
  isNull: mockIsNull,
}))

import { deliverableWebhookPredicate } from '@/lib/webhooks/delivery-predicate'

const columns = {
  isActive: 'webhook.isActive',
  archivedAt: 'webhook.archivedAt',
} as unknown as Parameters<typeof deliverableWebhookPredicate>[0]

describe('deliverableWebhookPredicate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the active, non-archived legacy delivery predicate by default', () => {
    const predicate = deliverableWebhookPredicate(columns)

    expect(mockEq).toHaveBeenCalledWith('webhook.isActive', true)
    expect(mockIsNull).toHaveBeenCalledWith('webhook.archivedAt')
    expect(mockAnd).toHaveBeenCalledWith(
      { kind: 'eq', column: 'webhook.isActive', value: true },
      { kind: 'isNull', column: 'webhook.archivedAt' }
    )
    expect(predicate).toEqual({
      kind: 'and',
      conditions: [
        { kind: 'eq', column: 'webhook.isActive', value: true },
        { kind: 'isNull', column: 'webhook.archivedAt' },
      ],
    })
  })

  it('preserves active-only behavior for legacy consumers that included archived rows', () => {
    const predicate = deliverableWebhookPredicate(columns, 'active_only')

    expect(predicate).toEqual({ kind: 'eq', column: 'webhook.isActive', value: true })
    expect(mockIsNull).not.toHaveBeenCalled()
    expect(mockAnd).not.toHaveBeenCalled()
  })
})
