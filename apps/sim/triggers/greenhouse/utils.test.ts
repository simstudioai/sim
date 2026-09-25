import { describe, expect, it } from 'vitest'
import { greenhouseHandler } from '@/lib/webhooks/providers/greenhouse'
import { isGreenhouseEventMatch } from '@/triggers/greenhouse/utils'

describe('isGreenhouseEventMatch', () => {
  it('rejects unknown trigger ids (no permissive fallback)', () => {
    expect(isGreenhouseEventMatch('greenhouse_unknown', 'new_candidate_application')).toBe(false)
  })

  it('builds fallback idempotency keys for nested offer payloads', () => {
    const key = greenhouseHandler.extractIdempotencyId!({
      action: 'offer_deleted',
      payload: {
        offer: {
          id: 42,
          version: 3,
        },
      },
    })

    expect(key).toBe('greenhouse:offer_deleted:offer:42:3')
  })
})

describe('greenhouseHandler.formatInput', () => {
  it('reads job id from payload.job and offer job_id', async () => {
    const jobFromNested = await greenhouseHandler.formatInput!({
      webhook: {},
      workflow: { id: 'w', userId: 'u' },
      body: {
        action: 'job_created',
        payload: { job: { id: 55 } },
      },
      headers: {},
      requestId: 't',
    })
    expect((jobFromNested.input as Record<string, unknown>).jobId).toBe(55)

    const jobFromOffer = await greenhouseHandler.formatInput!({
      webhook: {},
      workflow: { id: 'w', userId: 'u' },
      body: {
        action: 'offer_created',
        payload: { id: 1, application_id: 2, job_id: 66 },
      },
      headers: {},
      requestId: 't',
    })
    expect((jobFromOffer.input as Record<string, unknown>).jobId).toBe(66)
    expect((jobFromOffer.input as Record<string, unknown>).applicationId).toBe(2)
  })
})
