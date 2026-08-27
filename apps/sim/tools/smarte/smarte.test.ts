/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  smarteEnrichCompanyTool,
  smarteEnrichEmailTool,
  smarteEnrichFundingTool,
  smarteEnrichMobileTool,
  smarteEnrichPersonTool,
  smarteEnrichTechnographicsTool,
} from '@/tools/smarte'
import {
  SMARTE_API_KEY_PREFIX,
  SMARTE_CREDIT_USD,
  SMARTE_REQUESTS_PER_MINUTE,
  smarteHosting,
} from '@/tools/smarte/hosting'
import {
  normalizeEmailRecords,
  normalizePersonRecords,
  readCreditsDeducted,
} from '@/tools/smarte/response'

const SMARTE_TOOLS = [
  smarteEnrichCompanyTool,
  smarteEnrichEmailTool,
  smarteEnrichFundingTool,
  smarteEnrichMobileTool,
  smarteEnrichPersonTool,
  smarteEnrichTechnographicsTool,
] as const

describe('SMARTe hosted key configuration', () => {
  it('configures every documented enrichment operation for hosted and BYOK keys', () => {
    for (const tool of SMARTE_TOOLS) {
      expect(tool.hosting?.envKeyPrefix).toBe(SMARTE_API_KEY_PREFIX)
      expect(tool.hosting?.apiKeyParam).toBe('apiKey')
      expect(tool.hosting?.byokProviderId).toBe('smarte')
      expect(tool.hosting?.rateLimit).toEqual({
        mode: 'per_request',
        requestsPerMinute: SMARTE_REQUESTS_PER_MINUTE,
      })
    }
  })

  it('uses only API-reported credits to calculate hosted cost', () => {
    const pricing = smarteHosting<Record<string, never>>().pricing
    if (pricing.type !== 'custom') throw new Error('Expected SMARTe custom pricing')

    expect(pricing.getCost({}, { creditsDeducted: 2 })).toEqual({
      cost: 2 * SMARTE_CREDIT_USD,
      metadata: { credits: 2 },
    })
    expect(pricing.getCost({}, { creditsDeducted: 0 })).toEqual({
      cost: 0,
      metadata: { credits: 0 },
    })
  })

  it('fails when exact credit usage is unavailable or malformed', () => {
    const pricing = smarteHosting<Record<string, never>>().pricing
    if (pricing.type !== 'custom') throw new Error('Expected SMARTe custom pricing')

    expect(() => pricing.getCost({}, {})).toThrow('hosted cost cannot be determined')
    expect(() => pricing.getCost({}, { creditsDeducted: null })).toThrow(
      'hosted cost cannot be determined'
    )
    expect(() => pricing.getCost({}, { creditsDeducted: -1 })).toThrow(
      'hosted cost cannot be determined'
    )
  })
})

describe('SMARTe documented contracts', () => {
  it('keeps the formal required fields for person and company enrichment', () => {
    for (const field of ['firstName', 'lastName', 'fullName', 'email', 'jobTitle', 'linkedinUrl']) {
      expect(smarteEnrichPersonTool.params[field]?.required).toBe(true)
    }
    for (const field of ['companyId', 'companyName', 'companyWebsite', 'companyLinkedinUrl']) {
      expect(smarteEnrichCompanyTool.params[field]?.required).toBe(true)
    }
    expect(smarteEnrichEmailTool.params.firstName?.required).toBe(false)
    expect(smarteEnrichMobileTool.params.firstName?.required).toBe(false)
  })

  it('normalizes omitted documented fields without accepting the contradictory object example', () => {
    expect(normalizeEmailRecords([{ email: 'person@example.com' }])).toEqual([
      {
        email: 'person@example.com',
        smarteTransactionId: null,
        enrichmentStatus: null,
      },
    ])
    expect(() => normalizeEmailRecords({ email: 'person@example.com' })).toThrow(
      'response must be an array'
    )
  })

  it('rejects response field types outside the formal OpenAPI schema', () => {
    expect(() => normalizePersonRecords([{ personId: 123 }])).toThrow(
      'person[0].personId must be a string'
    )
  })

  it('reads credit usage from the documented response header', () => {
    expect(readCreditsDeducted(new Response(null, { headers: { 'credits-deducted': '2' } }))).toBe(
      2
    )
    expect(readCreditsDeducted(new Response())).toBeNull()
    expect(() =>
      readCreditsDeducted(new Response(null, { headers: { 'credits-deducted': 'invalid' } }))
    ).toThrow('must be a non-negative number')
  })
})
