/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ToolConfig } from '@/tools/types'
import { zeliqEnrichEmailTool } from '@/tools/zeliq/enrich-email'
import { zeliqEnrichPhoneTool } from '@/tools/zeliq/enrich-phone'
import {
  ZELIQ_ASYNC_BILLING_ASSUMPTION,
  ZELIQ_CREDIT_USD,
  ZELIQ_HOSTED_REQUESTS_PER_MINUTE,
  ZELIQ_PRICING_BASIS,
  ZELIQ_PRICING_SOURCE_DATE,
  ZELIQ_PRICING_SOURCE_URL,
  ZELIQ_RATE_LIMIT_SOURCE_URL,
  ZELIQ_STARTER_MONTHLY_CREDITS,
  ZELIQ_STARTER_MONTHLY_USD,
  ZELIQ_STARTER_REQUESTS_PER_DAY,
  ZELIQ_STARTER_REQUESTS_PER_HOUR,
  ZELIQ_STARTER_REQUESTS_PER_MINUTE,
} from '@/tools/zeliq/hosting'
import type {
  ZeliqAsyncEnrichmentResponse,
  ZeliqEnrichEmailParams,
  ZeliqEnrichPhoneParams,
} from '@/tools/zeliq/types'
import {
  buildZeliqEmailRequestBody,
  buildZeliqHeaders,
  buildZeliqPhoneRequestBody,
  parseZeliqAsyncResponse,
} from '@/tools/zeliq/validation'

function getEstimatedCost<P>(
  tool: ToolConfig<P, ZeliqAsyncEnrichmentResponse>,
  params: P,
  output: Record<string, unknown> = {
    status: 202,
    message: 'Request accepted, results will be sent to the callback URL',
    jobId: 'job-123',
  }
): { cost: number; metadata?: Record<string, unknown> } {
  const pricing = tool.hosting?.pricing
  if (!pricing || pricing.type !== 'custom') {
    throw new Error('Expected Zeliq custom hosted pricing')
  }
  const result = pricing.getCost(params, output)
  return typeof result === 'number' ? { cost: result } : result
}

const emailParams: ZeliqEnrichEmailParams = {
  apiKey: 'sk-test',
  callbackUrl: 'https://example.com/zeliq-callback',
  linkedinUrl: 'https://www.linkedin.com/in/jane-doe',
}

const phoneParams: ZeliqEnrichPhoneParams = {
  apiKey: 'sk-test',
  callbackUrl: 'https://example.com/zeliq-callback',
  email: 'jane@example.com',
}

describe('Zeliq hosted pricing', () => {
  it('uses the published Starter recurring tier as the exact unit-cost basis', () => {
    expect(ZELIQ_PRICING_SOURCE_URL).toBe('https://www.zeliq.com/pricing')
    expect(ZELIQ_PRICING_SOURCE_DATE).toBe('2026-08-26')
    expect(ZELIQ_STARTER_MONTHLY_USD).toBe(59)
    expect(ZELIQ_STARTER_MONTHLY_CREDITS).toBe(750)
    expect(ZELIQ_CREDIT_USD).toBe(59 / 750)
    expect(ZELIQ_PRICING_BASIS).toBe(
      'Starter monthly self-serve: $59 per user per month for 750 credits per month'
    )
  })

  it('estimates one Starter-priced credit for email submissions', () => {
    const result = getEstimatedCost(zeliqEnrichEmailTool, emailParams)
    expect(result.cost).toBe(59 / 750)
    expect(result.metadata).toMatchObject({
      credits: 1,
      estimated: true,
      operation: 'email',
      unitCostUsd: 59 / 750,
      pricingSource: 'https://www.zeliq.com/pricing',
      pricingSourceDate: '2026-08-26',
      pricingBasis: ZELIQ_PRICING_BASIS,
      calculation: '1 * (59 / 750)',
      assumption: ZELIQ_ASYNC_BILLING_ASSUMPTION,
    })
  })

  it('estimates ten Starter-priced credits for phone submissions', () => {
    const result = getEstimatedCost(zeliqEnrichPhoneTool, phoneParams)
    expect(result.cost).toBe(10 * (59 / 750))
    expect(result.metadata).toMatchObject({
      credits: 10,
      estimated: true,
      operation: 'phone',
      calculation: '10 * (59 / 750)',
      assumption: ZELIQ_ASYNC_BILLING_ASSUMPTION,
    })
  })

  it('uses the conservative Starter-plan workspace limit and hosted key identity', () => {
    expect(zeliqEnrichEmailTool.hosting).toMatchObject({
      envKeyPrefix: 'ZELIQ_API_KEY',
      apiKeyParam: 'apiKey',
      byokProviderId: 'zeliq',
      rateLimit: {
        mode: 'per_request',
        requestsPerMinute: ZELIQ_HOSTED_REQUESTS_PER_MINUTE,
      },
    })
    expect(ZELIQ_RATE_LIMIT_SOURCE_URL).toBe('https://docs.zeliq.com/docs/api-pricing')
    expect(ZELIQ_STARTER_REQUESTS_PER_MINUTE).toBe(200)
    expect(ZELIQ_STARTER_REQUESTS_PER_HOUR).toBe(400)
    expect(ZELIQ_STARTER_REQUESTS_PER_DAY).toBe(2_000)
    expect(ZELIQ_HOSTED_REQUESTS_PER_MINUTE).toBe(1)
    expect(ZELIQ_HOSTED_REQUESTS_PER_MINUTE).toBeLessThan(ZELIQ_STARTER_REQUESTS_PER_MINUTE)
    expect(ZELIQ_HOSTED_REQUESTS_PER_MINUTE * 60).toBeLessThan(ZELIQ_STARTER_REQUESTS_PER_HOUR)
    expect(ZELIQ_HOSTED_REQUESTS_PER_MINUTE * 60 * 24).toBeLessThan(ZELIQ_STARTER_REQUESTS_PER_DAY)
  })

  it('fails pricing before estimating malformed submissions', () => {
    expect(() =>
      getEstimatedCost(zeliqEnrichEmailTool, {
        apiKey: 'sk-test',
        callbackUrl: 'https://example.com/callback',
        firstName: 'Jane',
      })
    ).toThrow(/requires linkedinUrl or firstName/)
    expect(() =>
      getEstimatedCost(zeliqEnrichPhoneTool, {
        apiKey: 'sk-test',
        callbackUrl: 'https://example.com/callback',
      })
    ).toThrow(/requires linkedinUrl or email/)
  })

  it('fails pricing when the immediate acceptance output is malformed', () => {
    expect(() => getEstimatedCost(zeliqEnrichEmailTool, emailParams, {})).toThrow(
      /requires a documented HTTP 202 acceptance output/
    )
  })
})

describe('Zeliq request validation', () => {
  it('keeps callback destinations user-controlled', () => {
    expect(zeliqEnrichEmailTool.params.callbackUrl.visibility).toBe('user-only')
    expect(zeliqEnrichPhoneTool.params.callbackUrl.visibility).toBe('user-only')
  })

  it('uses the documented API endpoints and x-api-key authentication', () => {
    expect(zeliqEnrichEmailTool.request.url).toBe('https://api.zeliq.com/api/contact/enrich/email')
    expect(zeliqEnrichPhoneTool.request.url).toBe('https://api.zeliq.com/api/contact/enrich/phone')
    expect(zeliqEnrichEmailTool.request.method).toBe('POST')
    expect(zeliqEnrichPhoneTool.request.method).toBe('POST')
    expect(buildZeliqHeaders(' sk-test ')).toEqual({
      'Content-Type': 'application/json',
      'x-api-key': 'sk-test',
      'x-request-origin': 'sim',
    })
    expect(() => buildZeliqHeaders('')).toThrow(/apiKey must be a non-empty string/)
  })

  it('maps documented email lookup variants to the provider contract', () => {
    expect(buildZeliqEmailRequestBody(emailParams)).toEqual({
      callback_url: 'https://example.com/zeliq-callback',
      linkedin_url: 'https://www.linkedin.com/in/jane-doe',
    })
    expect(
      buildZeliqEmailRequestBody({
        apiKey: 'sk-test',
        callbackUrl: 'https://example.com/zeliq-callback',
        firstName: ' Jane ',
        lastName: ' Doe ',
        domain: ' example.com ',
      })
    ).toEqual({
      callback_url: 'https://example.com/zeliq-callback',
      first_name: 'Jane',
      last_name: 'Doe',
      domain: 'example.com',
    })
  })

  it('maps documented phone lookup variants to the provider contract', () => {
    expect(buildZeliqPhoneRequestBody(phoneParams)).toEqual({
      callback_url: 'https://example.com/zeliq-callback',
      email: 'jane@example.com',
    })
    expect(
      buildZeliqPhoneRequestBody({
        apiKey: 'sk-test',
        callbackUrl: 'https://example.com/zeliq-callback',
        linkedinUrl: 'https://www.linkedin.com/in/jane-doe',
      })
    ).toEqual({
      callback_url: 'https://example.com/zeliq-callback',
      linkedin_url: 'https://www.linkedin.com/in/jane-doe',
    })
  })

  it('rejects ambiguous lookup inputs and invalid callback URLs', () => {
    expect(() =>
      buildZeliqEmailRequestBody({
        ...emailParams,
        firstName: 'Jane',
        lastName: 'Doe',
        domain: 'example.com',
      })
    ).toThrow(/not both/)
    expect(() =>
      buildZeliqPhoneRequestBody({
        ...phoneParams,
        linkedinUrl: 'https://www.linkedin.com/in/jane-doe',
      })
    ).toThrow(/not both/)
    expect(() =>
      buildZeliqPhoneRequestBody({
        ...phoneParams,
        callbackUrl: 'ftp://example.com/callback',
      })
    ).toThrow(/HTTP or HTTPS/)
  })
})

describe('Zeliq async response parsing', () => {
  it('returns the documented HTTP 202 acceptance payload', async () => {
    const result = await parseZeliqAsyncResponse(
      new Response(
        JSON.stringify({
          status: 202,
          message: 'Request accepted, results will be sent to the callback URL',
          jobId: 'job-123',
        }),
        { status: 202, headers: { 'Content-Type': 'application/json' } }
      )
    )

    expect(result).toEqual({
      success: true,
      output: {
        status: 202,
        message: 'Request accepted, results will be sent to the callback URL',
        jobId: 'job-123',
      },
    })
  })

  it('surfaces documented provider errors', async () => {
    const result = await parseZeliqAsyncResponse(
      new Response(
        JSON.stringify({
          message: 'Invalid API key',
          error: 'Unauthorized',
          statusCode: 401,
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    )

    expect(result).toEqual({
      success: false,
      error: 'Invalid API key',
      output: { status: 401, message: 'Invalid API key' },
    })
  })

  it('fails fast on undocumented successful response shapes', async () => {
    await expect(
      parseZeliqAsyncResponse(
        new Response(JSON.stringify({ status: 202, message: 'Accepted' }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    ).rejects.toThrow(/undocumented async acceptance response/)
  })
})
