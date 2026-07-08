/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dropcontactEnrichContactTool } from '@/tools/dropcontact/enrich_contact'
import { DROPCONTACT_CREDIT_USD } from '@/tools/dropcontact/hosting'
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

describe('Dropcontact hosted key config', () => {
  it('declares hosting with the correct env prefix and BYOK provider ID', () => {
    expect(dropcontactEnrichContactTool.hosting?.envKeyPrefix).toBe('DROPCONTACT_API_KEY')
    expect(dropcontactEnrichContactTool.hosting?.byokProviderId).toBe('dropcontact')
  })
})

describe('Dropcontact hosted key pricing', () => {
  it('charges 1 credit when email_found is true', () => {
    expect(
      cost(dropcontactEnrichContactTool, {}, { email_found: true, email: 'a@b.com' }).cost
    ).toBeCloseTo(DROPCONTACT_CREDIT_USD)
  })

  it('charges 0 credits when email_found is false', () => {
    expect(cost(dropcontactEnrichContactTool, {}, { email_found: false, email: null }).cost).toBe(0)
  })

  it('charges 0 credits when email_found is undefined/missing', () => {
    expect(cost(dropcontactEnrichContactTool, {}, {}).cost).toBe(0)
  })
})

describe('Dropcontact postProcess polls to completion', () => {
  it('polls the enrich endpoint until success:true and resolves the final output', async () => {
    vi.useFakeTimers()

    // Mock: first call returns success:false (pending), second returns success:true (ready)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: false,
            success: false,
            reason: 'Request not ready yet, try again in 30 seconds',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: false,
            success: true,
            data: [
              {
                civility: 'Mr',
                first_name: 'John',
                last_name: 'Doe',
                full_name: 'John Doe',
                email: [{ email: 'john.doe@acme.com', qualification: 'nominative@pro' }],
                phone: null,
                mobile_phone: null,
                company: 'Acme Corp',
                website: 'acme.com',
                company_linkedin: null,
                linkedin: 'https://linkedin.com/in/johndoe',
                siren: null,
                siret: null,
                siret_address: null,
                vat: null,
                nb_employees: '50-100',
                naf5_code: null,
                naf5_des: null,
                industry: 'Software',
                job: 'Software Engineer',
                job_level: 'Senior',
                job_function: 'Engineering',
                company_turnover: null,
                company_results: null,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    vi.stubGlobal('fetch', fetchMock)

    const initial = {
      success: true as const,
      output: { request_id: 'req_abc123' } as any,
    }
    const promise = dropcontactEnrichContactTool.postProcess!(
      initial as any,
      { apiKey: 'test-key' } as any,
      vi.fn()
    )

    // Advance past two poll intervals
    await vi.advanceTimersByTimeAsync(5000)
    await vi.advanceTimersByTimeAsync(5000)

    const result = await promise

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.dropcontact.com/v1/enrich/all/req_abc123',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Access-Token': 'test-key' }),
      })
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.success).toBe(true)
    expect((result.output as any).email).toBe('john.doe@acme.com')
    expect((result.output as any).email_found).toBe(true)
    expect((result.output as any).qualification).toBe('nominative@pro')
    expect((result.output as any).first_name).toBe('John')
    expect((result.output as any).company).toBe('Acme Corp')
    expect((result.output as any).request_id).toBe('req_abc123')
  })

  it('throws if no request_id is present in the initial result', async () => {
    const initial = {
      success: true as const,
      output: { request_id: null } as any,
    }
    await expect(
      dropcontactEnrichContactTool.postProcess!(initial as any, { apiKey: 'k' } as any, vi.fn())
    ).rejects.toThrow('request_id')
  })

  it('throws if enrichment does not complete within the polling window', async () => {
    vi.useFakeTimers()

    // Always returns pending — use a factory so each call gets a fresh Response body
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: false,
            success: false,
            reason: 'Request not ready yet, try again in 30 seconds',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const initial = {
      success: true as const,
      output: { request_id: 'req_timeout' } as any,
    }

    let rejection: unknown
    const promise = dropcontactEnrichContactTool.postProcess!(
      initial as any,
      { apiKey: 'k' } as any,
      vi.fn()
    ).catch((err) => {
      rejection = err
    })

    // Advance past MAX_POLL_TIME_MS (120000ms)
    await vi.advanceTimersByTimeAsync(125000)
    await promise

    expect(rejection).toBeInstanceOf(Error)
    expect((rejection as Error).message).toMatch(/polling window/)
  })
})
