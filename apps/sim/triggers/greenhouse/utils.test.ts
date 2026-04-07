/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { greenhouseHandler } from '@/lib/webhooks/providers/greenhouse'
import { isGreenhouseEventMatch } from '@/triggers/greenhouse/utils'

describe('isGreenhouseEventMatch', () => {
  it('matches mapped trigger ids to Greenhouse action strings', () => {
    expect(isGreenhouseEventMatch('greenhouse_new_application', 'new_candidate_application')).toBe(
      true
    )
    expect(isGreenhouseEventMatch('greenhouse_new_application', 'hire_candidate')).toBe(false)
  })

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
