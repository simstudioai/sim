/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { companiesFindTool } from '@/tools/hunter/companies_find'
import { discoverTool } from '@/tools/hunter/discover'
import { domainSearchTool } from '@/tools/hunter/domain_search'
import { emailFinderTool } from '@/tools/hunter/email_finder'

const respond = (body: unknown) => new Response(JSON.stringify(body))

describe('hunter domain_search', () => {
  const transform = domainSearchTool.transformResponse!

  it('maps the documented response shape', async () => {
    const result = await transform(
      respond({
        data: {
          domain: 'stripe.com',
          disposable: false,
          webmail: false,
          accept_all: true,
          pattern: '{first}',
          organization: 'Stripe',
          linked_domains: ['stripe.io'],
          emails: [
            {
              value: 'patrick@stripe.com',
              type: 'personal',
              confidence: 92,
              first_name: 'Patrick',
              last_name: 'Collison',
              position: 'CEO',
              seniority: 'executive',
              department: 'executive',
              linkedin: null,
              twitter: 'patrickc',
              phone_number: null,
              sources: [],
              verification: { date: '2024-01-01', status: 'valid' },
            },
          ],
        },
      })
    )

    expect(result.success).toBe(true)
    expect(result.output.domain).toBe('stripe.com')
    expect(result.output.linked_domains).toEqual(['stripe.io'])
    expect(result.output.emails).toHaveLength(1)
    expect(result.output.emails[0]).toMatchObject({
      value: 'patrick@stripe.com',
      first_name: 'Patrick',
      twitter: 'patrickc',
      verification: { status: 'valid' },
    })
  })

  it('returns safe defaults when fields are missing', async () => {
    const result = await transform(respond({ data: null }))
    expect(result.output).toMatchObject({
      domain: '',
      disposable: false,
      webmail: false,
      accept_all: false,
      pattern: '',
      organization: '',
      linked_domains: [],
      emails: [],
    })
  })

  it('nullifies missing optional email fields', async () => {
    const result = await transform(
      respond({
        data: {
          emails: [{ value: 'a@b.com', type: 'generic', confidence: 50 }],
        },
      })
    )
    expect(result.output.emails[0]).toMatchObject({
      first_name: null,
      last_name: null,
      position: null,
      linkedin: null,
      verification: { status: 'unknown' },
    })
  })
})

describe('hunter email_finder', () => {
  const transform = emailFinderTool.transformResponse!

  it('extracts the documented finder fields', async () => {
    const result = await transform(
      respond({
        data: {
          first_name: 'Alex',
          last_name: 'Smith',
          email: 'alex@acme.com',
          score: 85,
          domain: 'acme.com',
          accept_all: false,
          position: 'Engineer',
          twitter: null,
          linkedin_url: 'https://linkedin.com/in/alex',
          phone_number: null,
          company: 'Acme',
          sources: [],
          verification: { date: null, status: 'valid' },
        },
      })
    )

    expect(result.output).toMatchObject({
      first_name: 'Alex',
      email: 'alex@acme.com',
      score: 85,
      linkedin_url: 'https://linkedin.com/in/alex',
      company: 'Acme',
      verification: { status: 'valid' },
    })
  })

  it('falls back to safe defaults', async () => {
    const result = await transform(respond({ data: {} }))
    expect(result.output).toMatchObject({
      email: '',
      score: 0,
      accept_all: false,
      sources: [],
      verification: { date: null, status: 'unknown' },
    })
  })
})

describe('hunter discover', () => {
  const transform = discoverTool.transformResponse!

  it('maps documented data array shape', async () => {
    const result = await transform(
      respond({
        data: [
          {
            domain: 'hunter.io',
            organization: 'Hunter',
            emails_count: { personal: 23, generic: 5, total: 28 },
          },
        ],
      })
    )

    expect(result.output.results).toEqual([
      {
        domain: 'hunter.io',
        organization: 'Hunter',
        personal_emails: 23,
        generic_emails: 5,
        total_emails: 28,
      },
    ])
  })

  it('returns empty array when data is missing', async () => {
    const result = await transform(respond({}))
    expect(result.output.results).toEqual([])
  })

  it('falls back to zero counts when emails_count is missing', async () => {
    const result = await transform(
      respond({ data: [{ domain: 'acme.com', organization: 'Acme' }] })
    )
    expect(result.output.results[0]).toEqual({
      domain: 'acme.com',
      organization: 'Acme',
      personal_emails: 0,
      generic_emails: 0,
      total_emails: 0,
    })
  })

  it('throws when no search params provided', () => {
    const buildUrl = discoverTool.request.url as (p: Record<string, unknown>) => string
    expect(() => buildUrl({ apiKey: 'k' })).toThrow(/At least one search parameter/)
  })

  it('builds body per docs (headcount as plain array, technology wrapped)', () => {
    const buildBody = discoverTool.request.body as (
      p: Record<string, unknown>
    ) => Record<string, unknown>
    const body = buildBody({ apiKey: 'k', headcount: '11-50', technology: 'react' })
    expect(body).toEqual({
      headcount: ['11-50'],
      technology: { include: ['react'] },
    })
  })
})

describe('hunter companies_find', () => {
  const transform = companiesFindTool.transformResponse!

  it('flattens nested company fields', async () => {
    const result = await transform(
      respond({
        data: {
          name: 'Stripe',
          domain: 'stripe.com',
          description: 'Payments',
          category: { industry: 'Fintech', sector: 'Software' },
          metrics: { employees: '1000+' },
          foundedYear: 2010,
          location: 'San Francisco, CA',
          geo: { country: 'United States', countryCode: 'US', state: 'CA', city: 'SF' },
          linkedin: { handle: 'company/stripe' },
          twitter: { handle: 'stripe' },
          facebook: { handle: 'stripe' },
          logo: 'https://logo.png',
          phone: '+1-555',
          tech: ['react', 'node'],
        },
      })
    )

    expect(result.output).toEqual({
      name: 'Stripe',
      domain: 'stripe.com',
      description: 'Payments',
      industry: 'Fintech',
      sector: 'Software',
      size: '1000+',
      founded_year: 2010,
      location: 'San Francisco, CA',
      country: 'United States',
      country_code: 'US',
      state: 'CA',
      city: 'SF',
      linkedin: 'company/stripe',
      twitter: 'stripe',
      facebook: 'stripe',
      logo: 'https://logo.png',
      phone: '+1-555',
      tech: ['react', 'node'],
    })
  })

  it('prefers employeesRange and coerces numeric employees', async () => {
    const rangeResult = await transform(
      respond({ data: { metrics: { employees: 5432, employeesRange: '1001-5000' } } })
    )
    expect(rangeResult.output.size).toBe('1001-5000')

    const numericResult = await transform(respond({ data: { metrics: { employees: 5432 } } }))
    expect(numericResult.output.size).toBe('5432')
  })

  it('survives missing nested objects', async () => {
    const result = await transform(respond({ data: {} }))
    expect(result.output).toMatchObject({
      name: '',
      industry: '',
      sector: '',
      size: '',
      country: '',
      linkedin: '',
      tech: [],
      founded_year: null,
    })
  })
})
