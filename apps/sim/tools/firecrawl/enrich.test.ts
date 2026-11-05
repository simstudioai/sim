import { jsonResponse } from '@sim/testing/helpers/http'
import { describe, expect, it } from 'vitest'
import { firecrawlEnrichTool } from '@/tools/firecrawl/enrich'

async function transform(payload: unknown) {
  if (!firecrawlEnrichTool.transformResponse) throw new Error('Missing response transform')
  return firecrawlEnrichTool.transformResponse(jsonResponse(payload))
}

describe('Alexandria enrichment wire contract', () => {
  it('surfaces provider errors inside a successful HTTP envelope', async () => {
    const result = await transform({
      success: true,
      data: {
        creditsCost: 0,
        alexandria: [
          {
            error: {
              code: 'THIRD_PARTY_DATA_TERMS_REQUIRED',
              message: 'Accept provider terms',
              status: 403,
            },
          },
        ],
      },
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Accept provider terms')
    expect(result.output.statusCode).toBe(403)
  })

  it('preserves a provider 404 for the enrichment runner to classify as no match', async () => {
    const result = await transform({
      success: true,
      data: { creditsCost: 0, alexandria: [{ error: { message: 'No match', status: 404 } }] },
    })
    expect(result.success).toBe(false)
    expect(result.output.statusCode).toBe(404)
  })

  it('rejects malformed success envelopes instead of reporting a clean miss', async () => {
    await expect(
      transform({ success: true, data: { creditsCost: 0, alexandria: [] } })
    ).rejects.toThrow(/result/i)
  })

  it('bills Firecrawl credits rather than the upstream provider metadata', async () => {
    const result = await transform({
      success: true,
      data: {
        creditsCost: 10,
        alexandria: [
          {
            provider: 'fullenrich',
            capability: 'companies/lookup',
            data: { companies: [], metadata: { credits: 0 } },
          },
        ],
      },
    })
    const pricing = firecrawlEnrichTool.hosting?.pricing
    if (pricing?.type !== 'custom') throw new Error('Missing usage pricing')
    expect(
      pricing.getCost({ apiKey: 'test', enrichmentType: 'company' }, result.output)
    ).toMatchObject({ cost: 0.01 })
  })

  it.each([undefined, -1, '30', null])(
    'rejects unusable reported usage: %s',
    async (creditsCost) => {
      await expect(
        transform({
          success: true,
          data: {
            creditsCost,
            alexandria: [
              { provider: 'fullenrich', capability: 'contacts/work-email', data: { results: [] } },
            ],
          },
        })
      ).rejects.toThrow(/credits/i)
    }
  )

  it.each([
    ['DELIVERABLE', true],
    ['CATCH_ALL', false],
    ['HIGH_PROBABILITY', false],
  ])('does not claim mailbox verification for %s', async (status, verified) => {
    const result = await transform({
      success: true,
      data: {
        creditsCost: 30,
        alexandria: [
          {
            provider: 'fullenrich',
            capability: 'contacts/work-email',
            data: {
              results: [
                {
                  contact_info: {
                    most_probable_work_email: { email: 'person@example.com', status },
                  },
                },
              ],
            },
          },
        ],
      },
    })
    expect(result.output.email).toBe('person@example.com')
    expect(result.output.emailVerified).toBe(verified)
  })

  it('keeps empty, free contact results as a successful no-match', async () => {
    const result = await transform({
      success: true,
      data: {
        creditsCost: 0,
        alexandria: [
          { provider: 'fullenrich', capability: 'contacts/work-email', data: { results: [] } },
        ],
      },
    })
    expect(result.success).toBe(true)
    expect(result.output.email).toBeNull()
    expect(result.output.creditsUsed).toBe(0)
  })

  it('maps PDL contact records without claiming mailbox verification', async () => {
    const result = await transform({
      success: true,
      data: {
        creditsCost: 60,
        alexandria: [
          {
            provider: 'people-data-labs',
            capability: 'person/enrich',
            data: {
              data: { work_email: 'person@example.com', mobile_phone: '+12025550123' },
            },
          },
        ],
      },
    })
    expect(result.output).toMatchObject({
      email: 'person@example.com',
      emailVerified: false,
      phone: '+12025550123',
    })
  })
})
