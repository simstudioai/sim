/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enrowFindEmailTool } from '@/tools/enrow/find_email'
import { ENROW_CREDIT_USD } from '@/tools/enrow/hosting'
import { enrowVerifyEmailTool } from '@/tools/enrow/verify_email'
import type { ToolConfig } from '@/tools/types'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function cost(
  tool: ToolConfig<unknown, unknown>,
  params: unknown,
  output: Record<string, unknown>
) {
  const pricing = tool.hosting?.pricing
  if (!pricing || pricing.type !== 'custom') throw new Error('Expected custom pricing')
  const result = pricing.getCost(params, output)
  return typeof result === 'number' ? { cost: result } : result
}

describe('Enrow hosted key config', () => {
  it('declares the correct env key prefix and BYOK provider for find_email', () => {
    expect(enrowFindEmailTool.hosting?.envKeyPrefix).toBe('ENROW_API_KEY')
    expect(enrowFindEmailTool.hosting?.byokProviderId).toBe('enrow')
  })

  it('declares the correct env key prefix and BYOK provider for verify_email', () => {
    expect(enrowVerifyEmailTool.hosting?.envKeyPrefix).toBe('ENROW_API_KEY')
    expect(enrowVerifyEmailTool.hosting?.byokProviderId).toBe('enrow')
  })
})

describe('Enrow find_email pricing', () => {
  it('charges 1 credit when qualification is valid (case-insensitive)', () => {
    expect(cost(enrowFindEmailTool, {}, { qualification: 'valid' }).cost).toBeCloseTo(
      1 * ENROW_CREDIT_USD
    )
    expect(cost(enrowFindEmailTool, {}, { qualification: 'VALID' }).cost).toBeCloseTo(
      1 * ENROW_CREDIT_USD
    )
  })

  it('charges 0 credits when qualification is invalid', () => {
    expect(cost(enrowFindEmailTool, {}, { qualification: 'invalid' }).cost).toBe(0)
  })

  it('charges 0 credits when qualification is null (no result)', () => {
    expect(cost(enrowFindEmailTool, {}, { qualification: null }).cost).toBe(0)
  })
})

describe('Enrow verify_email pricing', () => {
  it('charges 0.25 credits for a completed verification (valid or invalid)', () => {
    expect(cost(enrowVerifyEmailTool, {}, { qualification: 'valid' }).cost).toBeCloseTo(
      0.25 * ENROW_CREDIT_USD
    )
    expect(cost(enrowVerifyEmailTool, {}, { qualification: 'invalid' }).cost).toBeCloseTo(
      0.25 * ENROW_CREDIT_USD
    )
  })

  it('charges 0 credits when the job did not complete (no qualification)', () => {
    expect(cost(enrowVerifyEmailTool, {}, { qualification: null }).cost).toBe(0)
    expect(cost(enrowVerifyEmailTool, {}, {}).cost).toBe(0)
  })
})

describe('Enrow find_email postProcess polling', () => {
  it('polls until 200 and resolves the result', async () => {
    vi.useFakeTimers()

    const fetchMock = vi
      .fn()
      // First poll → 202 (still in progress)
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      // Second poll → 200 (complete)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            email: 'john@stripe.com',
            qualification: 'valid',
            fullname: 'John Doe',
            company_name: 'Stripe',
            company_domain: 'stripe.com',
            linkedin_url: 'https://linkedin.com/in/johndoe',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )

    vi.stubGlobal('fetch', fetchMock)

    const initial = {
      success: true as const,
      output: {
        id: 'abc-123',
        email: null,
        qualification: null,
        fullname: null,
        company_name: null,
        company_domain: null,
        linkedin_url: null,
      },
    }

    const promise = enrowFindEmailTool.postProcess!(
      initial as never,
      { apiKey: 'test-key', fullname: 'John Doe', company_domain: 'stripe.com' } as never,
      vi.fn()
    )

    // Advance past two POLL_INTERVAL_MS intervals (3000ms each)
    await vi.advanceTimersByTimeAsync(3000)
    await vi.advanceTimersByTimeAsync(3000)
    const result = await promise

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.enrow.io/email/find/single?id=abc-123',
      expect.objectContaining({ headers: expect.objectContaining({ 'x-api-key': 'test-key' }) })
    )
    expect(result.success).toBe(true)
    expect((result.output as Record<string, unknown>).email).toBe('john@stripe.com')
    expect((result.output as Record<string, unknown>).qualification).toBe('valid')
  })
})

describe('Enrow verify_email postProcess polling', () => {
  it('polls until 200 and resolves the verification result', async () => {
    vi.useFakeTimers()

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          email: 'john@stripe.com',
          qualification: 'valid',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )

    vi.stubGlobal('fetch', fetchMock)

    const initial = {
      success: true as const,
      output: { id: 'xyz-456', email: null, qualification: null },
    }

    const promise = enrowVerifyEmailTool.postProcess!(
      initial as never,
      { apiKey: 'test-key', email: 'john@stripe.com' } as never,
      vi.fn()
    )

    await vi.advanceTimersByTimeAsync(3000)
    const result = await promise

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.enrow.io/email/verify/single?id=xyz-456',
      expect.objectContaining({ headers: expect.objectContaining({ 'x-api-key': 'test-key' }) })
    )
    expect(result.success).toBe(true)
    expect((result.output as Record<string, unknown>).qualification).toBe('valid')
  })
})
