/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { findEmailFromNameTool } from '@/tools/findymail/find_email_from_name'
import { findEmailsByDomainTool } from '@/tools/findymail/find_emails_by_domain'
import { findPhoneTool } from '@/tools/findymail/find_phone'
import { FINDYMAIL_CREDIT_USD } from '@/tools/findymail/hosting'
import { reverseEmailLookupTool } from '@/tools/findymail/reverse_email_lookup'
import { verifyEmailTool } from '@/tools/findymail/verify_email'
import { bulkEnrichPersonTool } from '@/tools/prospeo/bulk_enrich_person'
import { enrichCompanyTool } from '@/tools/prospeo/enrich_company'
import { enrichPersonTool } from '@/tools/prospeo/enrich_person'
import { PROSPEO_CREDIT_USD } from '@/tools/prospeo/hosting'
import { searchPersonTool } from '@/tools/prospeo/search_person'
import type { ToolConfig } from '@/tools/types'
import { wizaCompanyEnrichmentTool } from '@/tools/wiza/company_enrichment'
import { WIZA_CREDIT_USD } from '@/tools/wiza/hosting'
import { wizaIndividualRevealTool } from '@/tools/wiza/individual_reveal'
import { wizaProspectSearchTool } from '@/tools/wiza/prospect_search'

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

describe('Findymail hosted key pricing', () => {
  it('declares hosting with the shared env prefix and BYOK provider', () => {
    expect(findEmailFromNameTool.hosting?.envKeyPrefix).toBe('FINDYMAIL_API_KEY')
    expect(findEmailFromNameTool.hosting?.byokProviderId).toBe('findymail')
  })

  it('charges one credit only when an email is found', () => {
    expect(cost(findEmailFromNameTool, {}, { contact: { email: 'a@b.com' } }).cost).toBeCloseTo(
      FINDYMAIL_CREDIT_USD
    )
    expect(cost(findEmailFromNameTool, {}, { contact: null }).cost).toBe(0)
  })

  it('charges 10 credits for a found phone', () => {
    expect(cost(findPhoneTool, {}, { phone: '+1555' }).cost).toBeCloseTo(10 * FINDYMAIL_CREDIT_USD)
    expect(cost(findPhoneTool, {}, { phone: null }).cost).toBe(0)
  })

  it('charges one credit per contact returned by domain search', () => {
    expect(cost(findEmailsByDomainTool, {}, { contacts: [{}, {}, {}] }).cost).toBeCloseTo(
      3 * FINDYMAIL_CREDIT_USD
    )
  })

  it('charges 2 credits for a reverse lookup with profile enrichment, 1 without', () => {
    expect(
      cost(reverseEmailLookupTool, { with_profile: true }, { email: 'a@b.com' }).cost
    ).toBeCloseTo(2 * FINDYMAIL_CREDIT_USD)
    expect(
      cost(reverseEmailLookupTool, { with_profile: false }, { email: 'a@b.com' }).cost
    ).toBeCloseTo(FINDYMAIL_CREDIT_USD)
    expect(
      cost(reverseEmailLookupTool, {}, { email: null, linkedin_url: null, fullName: null }).cost
    ).toBe(0)
  })

  it('charges one verifier credit per verification', () => {
    expect(cost(verifyEmailTool, {}, { verified: true }).cost).toBeCloseTo(FINDYMAIL_CREDIT_USD)
  })
})

describe('Prospeo hosted key pricing', () => {
  it('declares hosting with the shared env prefix and BYOK provider', () => {
    expect(enrichPersonTool.hosting?.envKeyPrefix).toBe('PROSPEO_API_KEY')
    expect(enrichPersonTool.hosting?.byokProviderId).toBe('prospeo')
  })

  it('charges 1 credit for a person match and 10 when a mobile is revealed', () => {
    expect(cost(enrichPersonTool, {}, { free_enrichment: false, person: {} }).cost).toBeCloseTo(
      PROSPEO_CREDIT_USD
    )
    expect(
      cost(enrichPersonTool, {}, { free_enrichment: false, person: { mobile: { revealed: true } } })
        .cost
    ).toBeCloseTo(10 * PROSPEO_CREDIT_USD)
  })

  it('does not charge on a free or no-match enrichment', () => {
    expect(cost(enrichPersonTool, {}, { free_enrichment: true, person: {} }).cost).toBe(0)
    expect(cost(enrichPersonTool, {}, { free_enrichment: false, person: null }).cost).toBe(0)
    expect(cost(enrichCompanyTool, {}, { free_enrichment: false, company: null }).cost).toBe(0)
  })

  it('uses the API-reported total_cost for bulk endpoints', () => {
    expect(cost(bulkEnrichPersonTool, {}, { total_cost: 7 }).cost).toBeCloseTo(
      7 * PROSPEO_CREDIT_USD
    )
  })

  it('throws when bulk total_cost is missing', () => {
    expect(() => cost(bulkEnrichPersonTool, {}, { matched: [] })).toThrow(/total_cost/)
  })

  it('charges one credit per non-free search page with results', () => {
    expect(cost(searchPersonTool, {}, { free: false, results: [{}] }).cost).toBeCloseTo(
      PROSPEO_CREDIT_USD
    )
    expect(cost(searchPersonTool, {}, { free: true, results: [{}] }).cost).toBe(0)
    expect(cost(searchPersonTool, {}, { free: false, results: [] }).cost).toBe(0)
  })
})

describe('Wiza hosted key pricing', () => {
  it('declares hosting with the shared env prefix and BYOK provider', () => {
    expect(wizaIndividualRevealTool.hosting?.envKeyPrefix).toBe('WIZA_API_KEY')
    expect(wizaIndividualRevealTool.hosting?.byokProviderId).toBe('wiza')
  })

  it('charges 2 credits for a valid email and 5 for a phone on individual reveal', () => {
    expect(
      cost(wizaIndividualRevealTool, {}, { email_status: 'valid', phones: [] }).cost
    ).toBeCloseTo(2 * WIZA_CREDIT_USD)
    expect(
      cost(wizaIndividualRevealTool, {}, { email_status: 'unfound', mobile_phone: '+1555' }).cost
    ).toBeCloseTo(5 * WIZA_CREDIT_USD)
    expect(
      cost(wizaIndividualRevealTool, {}, { email_status: 'valid', phones: [{ number: '+1555' }] })
        .cost
    ).toBeCloseTo(7 * WIZA_CREDIT_USD)
    expect(cost(wizaIndividualRevealTool, {}, { email_status: 'unfound', phones: [] }).cost).toBe(0)
  })

  it('charges 2 credits per company enrichment match and nothing for prospect search', () => {
    expect(cost(wizaCompanyEnrichmentTool, {}, { company_name: 'Wiza' }).cost).toBeCloseTo(
      2 * WIZA_CREDIT_USD
    )
    expect(
      cost(
        wizaCompanyEnrichmentTool,
        {},
        { company_name: null, company_domain: null, domain: null }
      ).cost
    ).toBe(0)
    expect(cost(wizaProspectSearchTool, {}, { total: 100, profiles: [] }).cost).toBe(0)
  })

  it('polls the reveal to completion in postProcess', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: 123,
            status: 'finished',
            email: 'a@b.com',
            email_status: 'valid',
            emails: [],
            phones: [],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const initial = {
      success: true as const,
      output: { id: 123, status: 'queued', is_complete: false } as any,
    }
    const promise = wizaIndividualRevealTool.postProcess!(
      initial as any,
      { apiKey: 'k', enrichment_level: 'full' } as any,
      vi.fn()
    )
    await vi.advanceTimersByTimeAsync(2000)
    const result = await promise

    expect(fetchMock).toHaveBeenCalledWith(
      'https://wiza.co/api/individual_reveals/123',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer k' }) })
    )
    expect(result.success).toBe(true)
    expect((result.output as any).email).toBe('a@b.com')
    expect((result.output as any).status).toBe('finished')
  })

  it('returns immediately without polling when the initial reveal is already terminal', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const initial = {
      success: true as const,
      output: {
        id: 123,
        status: 'finished',
        is_complete: true,
        email: 'a@b.com',
        email_status: 'valid',
        emails: [],
        phones: [],
      } as any,
    }
    const result = await wizaIndividualRevealTool.postProcess!(
      initial as any,
      { apiKey: 'k', enrichment_level: 'full' } as any,
      vi.fn()
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.success).toBe(true)
    expect((result.output as any).email).toBe('a@b.com')
  })

  it('retries transient poll errors and still resolves on a later finished response', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 1,
              status: 'finished',
              email: 'a@b.com',
              email_status: 'valid',
              emails: [],
              phones: [],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    vi.stubGlobal('fetch', fetchMock)

    const initial = {
      success: true as const,
      output: { id: 1, status: 'queued', is_complete: false } as any,
    }
    const promise = wizaIndividualRevealTool.postProcess!(
      initial as any,
      { apiKey: 'k', enrichment_level: 'full' } as any,
      vi.fn()
    )
    await vi.advanceTimersByTimeAsync(6000)
    const result = await promise

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.success).toBe(true)
    expect((result.output as any).email).toBe('a@b.com')
  })

  it('returns an explicit failure (not a queued success) after repeated poll errors', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(new Response('error', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    const initial = {
      success: true as const,
      output: { id: 1, status: 'queued', is_complete: false } as any,
    }
    const promise = wizaIndividualRevealTool.postProcess!(
      initial as any,
      { apiKey: 'k', enrichment_level: 'full' } as any,
      vi.fn()
    )
    await vi.advanceTimersByTimeAsync(6000)
    const result = await promise

    expect(result.success).toBe(false)
    expect((result.output as any).status).toBe('queued')
  })
})
