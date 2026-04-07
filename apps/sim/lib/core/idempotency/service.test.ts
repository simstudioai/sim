/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { IdempotencyService } from '@/lib/core/idempotency/service'

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

  it('prefers svix-id for Resend / Svix duplicate delivery deduplication', () => {
    const key = IdempotencyService.createWebhookIdempotencyKey(
      'wh_1',
      { 'svix-id': 'msg_abc123' },
      { type: 'email.sent' },
      'resend'
    )
    expect(key).toBe('wh_1:msg_abc123')
  })

  it('prefers Linear-Delivery so repeated updates to the same entity are not treated as one idempotent run', () => {
    const key = IdempotencyService.createWebhookIdempotencyKey(
      'wh_linear',
      { 'linear-delivery': '234d1a4e-b617-4388-90fe-adc3633d6b72' },
      { action: 'update', data: { id: 'shared-entity-id' } },
      'linear'
    )
    expect(key).toBe('wh_linear:234d1a4e-b617-4388-90fe-adc3633d6b72')
  })
})
