/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { icypeasFindEmailTool } from '@/tools/icypeas/find_email'
import { ICYPEAS_CREDIT_USD } from '@/tools/icypeas/hosting'
import { icypeasVerifyEmailTool } from '@/tools/icypeas/verify_email'
import type { ToolConfig } from '@/tools/types'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function cost(tool: ToolConfig<any, any>, params: any, output: Record<string, unknown>) {
  const pricing = tool.hosting?.pricing
  if (!pricing || pricing.type !== 'custom') throw new Error('Expected custom pricing')
  const result = pricing.getCost(params, output)
  return typeof result === 'number' ? { cost: result } : result
}

describe('Icypeas hosted key config', () => {
  it('declares the correct env prefix and BYOK provider ID', () => {
    expect(icypeasFindEmailTool.hosting?.envKeyPrefix).toBe('ICYPEAS_API_KEY')
    expect(icypeasFindEmailTool.hosting?.byokProviderId).toBe('icypeas')
    expect(icypeasVerifyEmailTool.hosting?.envKeyPrefix).toBe('ICYPEAS_API_KEY')
    expect(icypeasVerifyEmailTool.hosting?.byokProviderId).toBe('icypeas')
  })
})

describe('Icypeas find-email pricing', () => {
  it('charges 1 credit when status is FOUND', () => {
    expect(cost(icypeasFindEmailTool, {}, { status: 'FOUND', email: 'a@b.com' }).cost).toBeCloseTo(
      ICYPEAS_CREDIT_USD
    )
  })

  it('charges 1 credit when status is DEBITED', () => {
    expect(
      cost(icypeasFindEmailTool, {}, { status: 'DEBITED', email: 'a@b.com' }).cost
    ).toBeCloseTo(ICYPEAS_CREDIT_USD)
  })

  it('charges 0 credits when the email was not found', () => {
    expect(cost(icypeasFindEmailTool, {}, { status: 'NOT_FOUND', email: null }).cost).toBe(0)
    expect(cost(icypeasFindEmailTool, {}, { status: 'DEBITED_NOT_FOUND', email: null }).cost).toBe(
      0
    )
    expect(cost(icypeasFindEmailTool, {}, { status: 'BAD_INPUT', email: null }).cost).toBe(0)
  })
})

describe('Icypeas verify-email pricing', () => {
  it('charges 0.1 credits for FOUND status', () => {
    expect(
      cost(icypeasVerifyEmailTool, {}, { status: 'FOUND', email: 'a@b.com' }).cost
    ).toBeCloseTo(0.1 * ICYPEAS_CREDIT_USD)
  })

  it('charges 0.1 credits for DEBITED status', () => {
    expect(
      cost(icypeasVerifyEmailTool, {}, { status: 'DEBITED', email: 'a@b.com' }).cost
    ).toBeCloseTo(0.1 * ICYPEAS_CREDIT_USD)
  })

  it('charges 0.1 credits for DEBITED_NOT_FOUND (credits were consumed)', () => {
    expect(
      cost(icypeasVerifyEmailTool, {}, { status: 'DEBITED_NOT_FOUND', email: 'a@b.com' }).cost
    ).toBeCloseTo(0.1 * ICYPEAS_CREDIT_USD)
  })

  it('charges 0 credits for non-billable statuses', () => {
    expect(cost(icypeasVerifyEmailTool, {}, { status: 'NOT_FOUND', email: 'a@b.com' }).cost).toBe(0)
    expect(cost(icypeasVerifyEmailTool, {}, { status: 'BAD_INPUT', email: 'a@b.com' }).cost).toBe(0)
    expect(
      cost(icypeasVerifyEmailTool, {}, { status: 'INSUFFICIENT_FUNDS', email: 'a@b.com' }).cost
    ).toBe(0)
    expect(cost(icypeasVerifyEmailTool, {}, { status: 'ABORTED', email: 'a@b.com' }).cost).toBe(0)
  })

  it('throws when status is missing', () => {
    expect(() => cost(icypeasVerifyEmailTool, {}, { email: 'a@b.com' })).toThrow(/status/)
  })
})

describe('Icypeas find-email postProcess poll', () => {
  it('polls the results endpoint until terminal status and returns the email', async () => {
    vi.useFakeTimers()

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          item: {
            _id: 'abc123',
            status: 'FOUND',
            results: {
              firstname: 'John',
              lastname: 'Doe',
              emails: [{ email: 'john@stripe.com', certainty: 'ultra_sure' }],
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const initial = {
      success: true as const,
      output: {
        searchId: 'abc123',
        status: 'NONE',
        email: null,
        firstname: null,
        lastname: null,
        item: { _id: 'abc123', status: 'NONE' },
      },
    }

    const promise = icypeasFindEmailTool.postProcess!(
      initial as any,
      { apiKey: 'test-key', domainOrCompany: 'stripe.com' } as any,
      vi.fn()
    )
    await vi.advanceTimersByTimeAsync(3000)
    const result = await promise

    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.icypeas.com/api/bulk-single-searchs/read',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'test-key' }),
      })
    )
    expect(result.success).toBe(true)
    expect((result.output as any).email).toBe('john@stripe.com')
    expect((result.output as any).status).toBe('FOUND')
  })

  it('returns success=true with a null email for NOT_FOUND terminal status', async () => {
    vi.useFakeTimers()

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          item: { _id: 'abc456', status: 'NOT_FOUND', email: null },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const initial = {
      success: true as const,
      output: {
        searchId: 'abc456',
        status: 'SCHEDULED',
        email: null,
        firstname: null,
        lastname: null,
        item: { _id: 'abc456', status: 'SCHEDULED' },
      },
    }

    const promise = icypeasFindEmailTool.postProcess!(
      initial as any,
      { apiKey: 'test-key', domainOrCompany: 'stripe.com' } as any,
      vi.fn()
    )
    await vi.advanceTimersByTimeAsync(3000)
    const result = await promise

    expect(result.success).toBe(true)
    expect((result.output as any).status).toBe('NOT_FOUND')
    expect((result.output as any).email).toBeNull()
  })
})

describe('Icypeas verify-email postProcess poll', () => {
  it('polls the results endpoint until terminal status and returns valid=true for FOUND', async () => {
    vi.useFakeTimers()

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          item: { _id: 'xyz789', status: 'DEBITED', email: 'jane@example.com' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const initial = {
      success: true as const,
      output: {
        searchId: 'xyz789',
        status: 'IN_PROGRESS',
        email: 'jane@example.com',
        valid: null,
        item: { _id: 'xyz789', status: 'IN_PROGRESS' },
      },
    }

    const promise = icypeasVerifyEmailTool.postProcess!(
      initial as any,
      { apiKey: 'test-key', email: 'jane@example.com' } as any,
      vi.fn()
    )
    await vi.advanceTimersByTimeAsync(3000)
    const result = await promise

    expect(result.success).toBe(true)
    expect((result.output as any).valid).toBe(true)
    expect((result.output as any).status).toBe('DEBITED')
  })
})
