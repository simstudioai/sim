/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { kittFindEmailTool } from '@/tools/kitt/find_email'
import { KITT_FIND_EMAIL_USD, KITT_VERIFY_EMAIL_USD } from '@/tools/kitt/hosting'
import type { KittFindEmailParams, KittVerifyEmailParams } from '@/tools/kitt/types'
import { kittVerifyEmailTool } from '@/tools/kitt/verify_email'

const FIND_PARAMS: KittFindEmailParams = {
  apiKey: 'test-key',
  fullName: 'Erol Toker',
  domain: 'trykitt.ai',
}

const VERIFY_PARAMS: KittVerifyEmailParams = {
  apiKey: 'test-key',
  email: 'erol@trykitt.ai',
}

function findEmailCost(output: Record<string, unknown>) {
  const pricing = kittFindEmailTool.hosting?.pricing
  if (!pricing || pricing.type !== 'custom') throw new Error('Expected custom pricing')
  const result = pricing.getCost(FIND_PARAMS, output)
  return typeof result === 'number' ? { cost: result } : result
}

function verifyEmailCost(output: Record<string, unknown>) {
  const pricing = kittVerifyEmailTool.hosting?.pricing
  if (!pricing || pricing.type !== 'custom') throw new Error('Expected custom pricing')
  const result = pricing.getCost(VERIFY_PARAMS, output)
  return typeof result === 'number' ? { cost: result } : result
}

/**
 * Pricing basis retrieved 2026-08-26 from https://trykitt.ai/pricing and
 * https://help.trykitt.ai/en/articles/11739656-pricing-faqs. Tests use the
 * public Pay As You Go base rates, excluding free allowances and the discount
 * after one million monthly units. Finding is billed only when a verified
 * email is returned; every completed verification outcome is billed, including
 * unknown/catchall. Kitt's documented default is 15 concurrent requests per
 * key: https://help.trykitt.ai/en/articles/11185667-api-rate-limits. The tested
 * five-RPM workspace limit assumes a conservative one-minute slot occupancy,
 * reserving two thirds of one key's concurrency for pooled workspaces.
 */
describe('Kitt hosted pricing', () => {
  it('configures both operations with the hosted key and conservative five RPM limit', () => {
    for (const tool of [kittFindEmailTool, kittVerifyEmailTool]) {
      expect(tool.hosting?.envKeyPrefix).toBe('KITT_API_KEY')
      expect(tool.hosting?.byokProviderId).toBe('kitt')
      expect(tool.hosting?.rateLimit).toEqual({
        mode: 'per_request',
        requestsPerMinute: 5,
      })
    }
  })

  it('charges the base found-email price only for a successful result', () => {
    expect(findEmailCost({ outcome: 'success', email: 'erol@trykitt.ai' }).cost).toBeCloseTo(
      KITT_FIND_EMAIL_USD
    )
    expect(findEmailCost({ outcome: 'no-results-found', email: null }).cost).toBe(0)
  })

  it('fails fast when a successful finder result lacks the billed email', () => {
    expect(() => findEmailCost({ outcome: 'success', email: null })).toThrow(/billed email/)
  })

  it('fails fast when the finder billing outcome is missing or unsupported', () => {
    expect(() => findEmailCost({ email: null })).toThrow(/billing outcome/)
    expect(() => findEmailCost({ outcome: 'pending', email: null })).toThrow(/billing outcome/)
  })

  it.each(['valid', 'valid-risky', 'invalid', 'unknown'])(
    'charges the base verification price for %s',
    (outcome) => {
      expect(verifyEmailCost({ outcome, email: 'erol@trykitt.ai' }).cost).toBeCloseTo(
        KITT_VERIFY_EMAIL_USD
      )
    }
  )

  it('fails fast when the verification billing outcome is missing or unsupported', () => {
    expect(() => verifyEmailCost({ email: 'erol@trykitt.ai' })).toThrow(/billing outcome/)
    expect(() => verifyEmailCost({ outcome: 'pending', email: 'erol@trykitt.ai' })).toThrow(
      /billing outcome/
    )
  })
})

describe('Kitt request contracts', () => {
  it('builds the documented real-time finder request without transport fallbacks', () => {
    const body = kittFindEmailTool.request.body?.({
      ...FIND_PARAMS,
      linkedinStandardProfileURL: 'https://linkedin.com/in/eroltoker',
      strictNameMatches: false,
      customData: 'crm-123',
    })

    expect(body).toEqual({
      fullName: 'Erol Toker',
      domain: 'trykitt.ai',
      linkedinStandardProfileURL: 'https://linkedin.com/in/eroltoker',
      strictNameMatches: false,
      customData: 'crm-123',
      realtime: true,
    })
  })

  it('builds the documented real-time verifier request', () => {
    const body = kittVerifyEmailTool.request.body?.({
      ...VERIFY_PARAMS,
      treatAliasesAsValid: true,
      customData: 'crm-456',
    })

    expect(body).toEqual({
      email: 'erol@trykitt.ai',
      treatAliasesAsValid: true,
      customData: 'crm-456',
      realtime: true,
    })
  })
})

describe('Kitt response validation', () => {
  it('maps the smallest production-observed successful finder response', async () => {
    const response = new Response(
      JSON.stringify({
        outcome: 'success',
        results: { botGeneratedEmail: 'erol@trykitt.ai' },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

    await expect(kittFindEmailTool.transformResponse?.(response, FIND_PARAMS)).resolves.toEqual({
      success: true,
      output: { outcome: 'success', email: 'erol@trykitt.ai' },
    })
  })

  it('maps the production-observed no-result finder outcome', async () => {
    const response = new Response(JSON.stringify({ outcome: 'no-results-found' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

    await expect(kittFindEmailTool.transformResponse?.(response, FIND_PARAMS)).resolves.toEqual({
      success: true,
      output: { outcome: 'no-results-found', email: null },
    })
  })

  it('rejects a successful finder response without results.botGeneratedEmail', async () => {
    const response = new Response(JSON.stringify({ outcome: 'success', results: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

    await expect(kittFindEmailTool.transformResponse?.(response, FIND_PARAMS)).rejects.toThrow(
      /results\.botGeneratedEmail/
    )
  })

  it.each(['valid', 'valid-risky', 'invalid', 'unknown'])(
    'maps the production-observed verifier outcome %s',
    async (outcome) => {
      const response = new Response(JSON.stringify({ outcome }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })

      await expect(
        kittVerifyEmailTool.transformResponse?.(response, VERIFY_PARAMS)
      ).resolves.toEqual({
        success: true,
        output: { outcome, email: 'erol@trykitt.ai' },
      })
    }
  )

  it('rejects unsupported successful response shapes and outcomes', async () => {
    const arrayResponse = new Response(JSON.stringify([{ outcome: 'valid' }]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    const pendingResponse = new Response(JSON.stringify({ outcome: 'pending' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

    await expect(
      kittVerifyEmailTool.transformResponse?.(arrayResponse, VERIFY_PARAMS)
    ).rejects.toThrow(/JSON object/)
    await expect(
      kittVerifyEmailTool.transformResponse?.(pendingResponse, VERIFY_PARAMS)
    ).rejects.toThrow(/unsupported outcome/)
  })
})
