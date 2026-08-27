/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getContactEnrichmentTool } from '@/tools/fullenrich/get_contact_enrichment'
import { FULLENRICH_CREDIT_USD, FULLENRICH_PRICING_BASIS } from '@/tools/fullenrich/hosting'
import { searchPeopleTool } from '@/tools/fullenrich/search_people'
import { startContactEnrichmentTool } from '@/tools/fullenrich/start_contact_enrichment'
import { startReverseEmailTool } from '@/tools/fullenrich/start_reverse_email'
import type { ToolHostingConfig } from '@/tools/types'

function getCustomCost<P>(
  hosting: ToolHostingConfig<P> | undefined,
  params: P,
  output: Record<string, unknown> = {}
) {
  if (!hosting || hosting.pricing.type !== 'custom') {
    throw new Error('Expected custom hosted pricing')
  }
  const result = hosting.pricing.getCost(params, output)
  if (typeof result === 'number') throw new Error('Expected pricing metadata')
  return result
}

describe('FullEnrich hosted billing', () => {
  it('uses the documented recurring Pro Monthly credit basis', () => {
    expect(FULLENRICH_CREDIT_USD).toBe(29 / 500)
    expect(FULLENRICH_PRICING_BASIS).toContain('https://fullenrich.com/pricing.md')
    expect(FULLENRICH_PRICING_BASIS).toContain('verified 2026-08-26')
  })

  it('estimates asynchronous contact enrichment from requested result weights', () => {
    const result = getCustomCost(
      startContactEnrichmentTool.hosting,
      {
        apiKey: 'key',
        name: 'Contacts',
        data: [
          {
            linkedin_url: 'https://www.linkedin.com/in/ada',
            enrich_fields: ['contact.work_emails', 'contact.personal_emails', 'contact.phones'],
          },
          {
            first_name: 'Grace',
            last_name: 'Hopper',
            domain: 'example.com',
            enrich_fields: ['contact.work_emails'],
          },
        ],
      },
      {}
    )

    expect(result.cost).toBe(15 * 0.058)
    expect(result.metadata).toMatchObject({
      credits: 15,
      estimate: true,
      creditUsd: 0.058,
    })
    expect(result.metadata?.estimateBasis).toContain('mobile phone 10 credits')
  })

  it('estimates asynchronous reverse lookup at one credit per input email', () => {
    const result = getCustomCost(
      startReverseEmailTool.hosting,
      {
        apiKey: 'key',
        name: 'Reverse',
        data: [{ email: 'ada@example.com' }, { email: 'grace@example.com' }],
      },
      {}
    )

    expect(result.cost).toBe(2 * 0.058)
    expect(result.metadata).toMatchObject({ credits: 2, estimate: true })
  })

  it('fails fast when asynchronous estimate inputs are malformed', () => {
    expect(() =>
      getCustomCost(
        startContactEnrichmentTool.hosting,
        {
          apiKey: 'key',
          name: 'Contacts',
          data: [{ first_name: 'Ada', enrich_fields: [] }],
        },
        {}
      )
    ).toThrow('Contacts is invalid')
  })

  it('uses exact provider-reported credits for synchronous operations', () => {
    const result = getCustomCost(searchPeopleTool.hosting, { apiKey: 'key' }, { credits: 2.5 })
    expect(result.cost).toBe(2.5 * 0.058)
    expect(result.metadata).toMatchObject({ credits: 2.5, estimate: false })
  })

  it('fails fast when exact response credits are absent', () => {
    expect(() => getCustomCost(searchPeopleTool.hosting, { apiKey: 'key' }, {})).toThrow(
      'FullEnrich response credits must be a finite non-negative number'
    )
  })

  it('does not rebill historical credits when retrieving async results', () => {
    const result = getCustomCost(
      getContactEnrichmentTool.hosting,
      { apiKey: 'key', enrichmentId: 'enrichment-id' },
      { costCredits: 14 }
    )
    expect(result.cost).toBe(0)
    expect(result.metadata).toMatchObject({ credits: 0, historicalCredits: 14, estimate: false })
  })

  it('uses a conservative hosted-key request limit', () => {
    expect(startContactEnrichmentTool.hosting?.rateLimit).toEqual({
      mode: 'per_request',
      requestsPerMinute: 10,
    })
  })
})
