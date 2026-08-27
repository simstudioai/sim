/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MAX_ERROR_BODY_BYTES } from '@/lib/core/utils/stream-limits'
import {
  foragerJobSearchTool,
  foragerJobSearchTotalsTool,
  foragerOrganizationSearchTool,
  foragerOrganizationSearchTotalsTool,
  foragerPersonDetailTool,
  foragerPersonPersonalEmailsTool,
  foragerPersonPhoneNumbersTool,
  foragerPersonReverseEmailTool,
  foragerPersonReversePhoneTool,
  foragerPersonRoleSearchTool,
  foragerPersonRoleSearchTotalsTool,
  foragerPersonWorkEmailsTool,
  foragerWebsiteDetailTool,
} from '@/tools/forager'
import {
  FORAGER_CREDIT_USD,
  FORAGER_ENDPOINT_PRICING_SOURCE_URL,
  FORAGER_HOSTED_REQUESTS_PER_MINUTE,
  FORAGER_PLAN_PRICING_SOURCE_URL,
  FORAGER_PRICING_BASIS,
  FORAGER_PRICING_EXCLUSIONS,
  FORAGER_PRICING_VERIFIED_ON,
} from '@/tools/forager/hosting'
import type { ToolConfig } from '@/tools/types'

const FORAGER_TOOLS: ToolConfig[] = [
  foragerJobSearchTool,
  foragerJobSearchTotalsTool,
  foragerOrganizationSearchTool,
  foragerOrganizationSearchTotalsTool,
  foragerPersonDetailTool,
  foragerPersonPersonalEmailsTool,
  foragerPersonPhoneNumbersTool,
  foragerPersonReverseEmailTool,
  foragerPersonReversePhoneTool,
  foragerPersonRoleSearchTool,
  foragerPersonRoleSearchTotalsTool,
  foragerPersonWorkEmailsTool,
  foragerWebsiteDetailTool,
]

interface FetchCall {
  url: string
  init: RequestInit
}

const calls: FetchCall[] = []

function mockFetch(responses: Array<{ body?: unknown; status?: number; text?: string }>) {
  const queue = [...responses]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      const response = queue.shift()
      if (!response) throw new Error(`Unexpected fetch to ${String(url)}`)
      const body = response.text ?? JSON.stringify(response.body)
      return new Response(body, { status: response.status ?? 200 })
    })
  )
}

function getCustomCost(
  tool: ToolConfig,
  output: Record<string, unknown>
): { cost: number; metadata?: Record<string, unknown> } {
  const pricing = tool.hosting?.pricing
  if (!pricing || pricing.type !== 'custom') {
    throw new Error(`${tool.id} does not have custom hosted pricing`)
  }
  return pricing.getCost({}, output)
}

afterEach(() => {
  calls.length = 0
  vi.unstubAllGlobals()
})

describe('Forager hosted billing', () => {
  it('uses the 2026-08-26 Starter monthly basis of $50 divided by 2,250 credits', () => {
    expect(FORAGER_CREDIT_USD).toBe(1 / 45)
    expect(5 * FORAGER_CREDIT_USD).toBeCloseTo(0.1111111111111111)
    expect(FORAGER_PLAN_PRICING_SOURCE_URL).toBe('https://www.forager.ai/pricing')
    expect(FORAGER_ENDPOINT_PRICING_SOURCE_URL).toBe(
      'https://docs.forager.ai/api-overview/credit-pricing'
    )
    expect(FORAGER_PRICING_VERIFIED_ON).toBe('2026-08-26')
  })

  it('excludes annual commitment, free allowance, and custom enterprise pricing in its basis', () => {
    expect(FORAGER_PRICING_EXCLUSIONS).toEqual([
      'free allowance',
      'annual commitment discount',
      'custom Enterprise plan',
    ])
    expect(FORAGER_PRICING_BASIS.jobSearchTotals).toContain('Explicit estimate')
    expect(FORAGER_PRICING_BASIS.organizationSearchTotals).toContain('Explicit estimate')
    expect(FORAGER_PRICING_BASIS.personRoleSearchTotals).toContain('Explicit estimate')
    expect(FORAGER_PRICING_BASIS.websiteDetail).toContain('Explicit mapping')
  })

  it('configures every supported operation for hosted keys at the internal 10 RPM limit', () => {
    expect(FORAGER_TOOLS).toHaveLength(13)
    for (const tool of FORAGER_TOOLS) {
      expect(tool.hosting?.envKeyPrefix).toBe('FORAGER_API_KEY')
      expect(tool.hosting?.apiKeyParam).toBe('apiKey')
      expect(tool.hosting?.byokProviderId).toBe('forager')
      expect(tool.hosting?.rateLimit).toEqual({
        mode: 'per_request',
        requestsPerMinute: FORAGER_HOSTED_REQUESTS_PER_MINUTE,
      })
    }
  })

  it('charges the documented fixed endpoint credits at the published unit price', () => {
    expect(getCustomCost(foragerJobSearchTool, {}).cost).toBeCloseTo(2 / 45)
    expect(getCustomCost(foragerOrganizationSearchTool, {}).cost).toBeCloseTo(1 / 45)
    expect(getCustomCost(foragerPersonReversePhoneTool, {}).cost).toBeCloseTo(15 / 45)
  })

  it('charges personal-email credits only for documented nonempty successes', () => {
    expect(getCustomCost(foragerPersonPersonalEmailsTool, { emails: [] }).cost).toBe(0)
    expect(
      getCustomCost(foragerPersonPersonalEmailsTool, {
        emails: [{ email: 'person@example.com' }],
      }).cost
    ).toBeCloseTo(5 / 45)
  })

  it('charges the documented fixed work-email and phone lookup prices', () => {
    expect(getCustomCost(foragerPersonWorkEmailsTool, { emails: [] }).cost).toBeCloseTo(5 / 45)
    expect(getCustomCost(foragerPersonPhoneNumbersTool, { phoneNumbers: [] }).cost).toBeCloseTo(
      15 / 45
    )
  })

  it('fails hosted billing when the personal-email billing output is malformed', () => {
    expect(() => getCustomCost(foragerPersonPersonalEmailsTool, {})).toThrow(/missing emails array/)
  })
})

describe('Forager execution', () => {
  it('sends API-key auth, account path, and the documented request body', async () => {
    mockFetch([{ body: { total_search_results: 7 } }])

    const result = await foragerJobSearchTotalsTool.directExecution!({
      apiKey: 'secret',
      accountId: 42,
      filters: { title: 'engineer', is_remote: true },
    })

    expect(result.output).toEqual({ totalSearchResults: 7 })
    expect(calls[0].url).toBe('https://api-v2.forager.ai/api/42/datastorage/job_search/totals/')
    expect((calls[0].init.headers as Record<string, string>)['X-API-KEY']).toBe('secret')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      title: 'engineer',
      is_remote: true,
    })
  })

  it('auto-resolves the account when the key has exactly one account', async () => {
    mockFetch([
      {
        body: {
          id: 1,
          username: 'user',
          email: 'user@example.com',
          accounts: [{ id: 77, name: 'Main', subscription: {} }],
        },
      },
      { body: { total_search_results: 3 } },
    ])

    await foragerOrganizationSearchTotalsTool.directExecution!({
      apiKey: 'secret',
      filters: { domains: ['example.com'] },
    })

    expect(calls.map((call) => call.url)).toEqual([
      'https://api-v2.forager.ai/api/users/current/',
      'https://api-v2.forager.ai/api/77/datastorage/organization_search/totals/',
    ])
  })

  it('requires an explicit account ID for a multi-account key', async () => {
    mockFetch([
      {
        body: {
          id: 1,
          username: 'user',
          email: 'user@example.com',
          accounts: [
            { id: 77, name: 'One', subscription: {} },
            { id: 88, name: 'Two', subscription: {} },
          ],
        },
      },
    ])

    await expect(foragerJobSearchTotalsTool.directExecution!({ apiKey: 'secret' })).rejects.toThrow(
      /accountId is required when the API key has 2 accounts/
    )
  })

  it('accepts the documented empty personal-email success response', async () => {
    mockFetch([{ text: '' }])

    const result = await foragerPersonPersonalEmailsTool.directExecution!({
      apiKey: 'secret',
      accountId: 42,
      personId: 100,
    })

    expect(result.output).toEqual({ emails: [] })
  })

  it('rejects undocumented request keys before making an enrichment call', async () => {
    mockFetch([])
    await expect(
      foragerJobSearchTotalsTool.directExecution!({
        apiKey: 'secret',
        accountId: 42,
        filters: { guessed_filter: true },
      })
    ).rejects.toThrow(/Unrecognized key/)
    expect(calls).toHaveLength(0)
  })

  it('rejects malformed response JSON before returning a successful tool result', async () => {
    mockFetch([{ body: { total_search_results: 'seven' } }])
    await expect(
      foragerJobSearchTotalsTool.directExecution!({ apiKey: 'secret', accountId: 42 })
    ).rejects.toThrow()
  })

  it('bounds provider error response bodies before materializing them', async () => {
    mockFetch([
      {
        status: 500,
        text: 'x'.repeat(DEFAULT_MAX_ERROR_BODY_BYTES + 1),
      },
    ])

    await expect(
      foragerJobSearchTotalsTool.directExecution!({ apiKey: 'secret', accountId: 42 })
    ).rejects.toThrow(/Forager error response exceeds maximum size/)
  })

  it('treats null person and organization IDs as omitted lookup alternatives', async () => {
    mockFetch([])

    await expect(
      foragerPersonDetailTool.directExecution!({
        apiKey: 'secret',
        accountId: 42,
        personId: null,
      })
    ).rejects.toThrow(/requires personId or linkedinPublicIdentifier/)
    await expect(
      foragerWebsiteDetailTool.directExecution!({
        apiKey: 'secret',
        accountId: 42,
        organizationId: null,
      })
    ).rejects.toThrow(/requires domain, organizationId, or organizationLinkedinPublicIdentifier/)
    expect(calls).toHaveLength(0)
  })
})
