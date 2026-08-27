/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { ENROW_CREDIT_USD, enrowHosting } from '@/tools/enrow/hosting'

/**
 * Per-tool credit accounting lives in `tools/enrow-hosting.test.ts`. This file
 * covers the shared factory itself: the credits-to-dollars conversion and the
 * request-rate ceiling, both checked against Enrow's published limits rather
 * than against the constants the factory happens to hold.
 */
describe('enrowHosting', () => {
  const hosting = enrowHosting<{ apiKey: string }>((_params, output) => Number(output.credits ?? 0))

  it('prices a credit at the published Start tier ($17 / 1,000 credits)', () => {
    expect(ENROW_CREDIT_USD).toBeCloseTo(17 / 1000, 6)
  })

  it('converts the reported credits to dollars and reports the count as metadata', () => {
    expect(hosting.pricing.getCost!({ apiKey: 'k' }, { credits: 0.25 })).toEqual({
      cost: 0.25 * ENROW_CREDIT_USD,
      metadata: { credits: 0.25 },
    })
    expect(hosting.pricing.getCost!({ apiKey: 'k' }, { credits: 4 })).toEqual({
      cost: 4 * ENROW_CREDIT_USD,
      metadata: { credits: 4 },
    })
  })

  it('stays inside the documented 10 req/s POST ceiling', () => {
    // https://docs.enrow.io/rate-limits — 10 requests per second per API key on
    // every POST endpoint. Anything above 600/min would exceed it outright.
    expect(hosting.rateLimit).toMatchObject({ mode: 'per_request' })
    expect(hosting.rateLimit!.requestsPerMinute).toBeLessThanOrEqual(600)
    expect(hosting.rateLimit!.requestsPerMinute).toBeGreaterThan(0)
  })

  it('reads the hosted key into the tool `apiKey` param', () => {
    expect(hosting.apiKeyParam).toBe('apiKey')
    expect(hosting.envKeyPrefix).toBe('ENROW_API_KEY')
  })
})
