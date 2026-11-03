import { describe, expect, it, vi } from 'vitest'
import fixtures from '@/tools/companyenrich/fixtures.json'
import type { CompanyEnrichParams } from '@/tools/companyenrich/types'
import { extractErrorMessage, redactErrorData } from '@/tools/error-extractors'
import { tools } from '@/tools/registry'
import { prepareToolRequest } from '@/tools/request-transport'
import { isInternalToolConfig } from '@/tools/types'

vi.unmock('@/tools/registry')
function registered(id: string) {
  const tool = tools[id]
  if (!tool || isInternalToolConfig(tool))
    throw new Error('Expected an external CompanyEnrich tool')
  return tool
}
function request(id: string, params: Partial<CompanyEnrichParams>) {
  return prepareToolRequest(registered(id), { apiKey: 'secret-key', ...params })
}

describe('CompanyEnrich provider wire contracts through the executable registry', () => {
  for (const fixture of fixtures) {
    it(`dispatches ${fixture.operation} and preserves its response`, async () => {
      const tool = registered('companyenrich_advanced')
      const built = request(tool.id, {
        apiOperation: fixture.operation,
        body: fixture.body,
        queryParameters: fixture.query,
        pathParameters: fixture.path_parameters,
        allow_beta: fixture.allow_beta,
      })
      const url = new URL(built.url)
      let path = fixture.path
      for (const [key, value] of Object.entries(fixture.path_parameters))
        path = path.replace(`{${key}}`, encodeURIComponent(value))
      expect(url.origin).toBe('https://api.companyenrich.com')
      expect(url.pathname).toBe(path)
      expect(built.method).toBe(fixture.method)
      expect(built.headers.get('Authorization')).toBe('Bearer secret-key')
      expect(built.maxRedirects).toBe(0)
      for (const [key, value] of Object.entries(fixture.query))
        expect(url.searchParams.get(key)).toBe(value)
      if (fixture.operation === 'post_people_email_bulk')
        expect(built.body).toContain('"person_id":9223372036854775807')
      const result = await tool.transformResponse?.(Response.json(fixture.response))
      expect(result.output.data).toEqual(fixture.response)
    })
  }
  it('executes all twelve native adapters with documented identifier placement', () => {
    const cases: [string, Partial<CompanyEnrichParams>, string, string][] = [
      ['enrich', { domain: 'example.com' }, 'GET', '/companies/enrich'],
      ['search', { semanticQuery: 'Software' }, 'POST', '/companies/search'],
      ['similar', { domains: ['one.com', 'two.com'] }, 'POST', '/companies/similar'],
      ['search_people', { filters: { domains: ['one.com'] } }, 'POST', '/people/search'],
      ['lookup_person', { email: 'test@example.com' }, 'POST', '/people/lookup'],
      ['workforce', { domain: 'one.com' }, 'GET', '/companies/workforce'],
      ['enrich_properties', { properties: { name: 'Example' } }, 'POST', '/companies/enrich'],
      ['enrich_batch', { domains: ['one.com'] }, 'POST', '/companies/enrich/batch'],
      ['get_company', { id: '00000000-0000-4000-8000-000000000001' }, 'GET', '/companies'],
      ['get_person', { id: '9223372036854775807' }, 'GET', '/people'],
      ['count', { filters: { countries: ['US'] } }, 'POST', '/companies/search/count'],
      ['similar_count', { domains: ['one.com'] }, 'POST', '/companies/similar/count'],
    ]
    for (const [name, params, method, path] of cases) {
      const built = request(`companyenrich_${name}`, params)
      expect(built.method).toBe(method)
      expect(new URL(built.url).pathname).toBe(path)
    }
  })
  it('forwards nested filters, expansions and explicit precedence without losing legacy seeds', () => {
    const built = request('companyenrich_search', {
      query: 'Dedicated',
      semanticQuery: 'Software',
      filters: { query: 'Old', technologies: ['Node.js'], future: { nested: [0, null] } },
      expand: ['workforce'],
    })
    expect(JSON.parse(built.body ?? '{}')).toEqual({
      query: 'Dedicated',
      semanticQuery: 'Software',
      technologies: ['Node.js'],
      future: { nested: [0, null] },
      page: 1,
      pageSize: 10,
    })
    expect(new URL(built.url).searchParams.get('expand')).toBe('workforce')
    expect(
      JSON.parse(request('companyenrich_similar', { domain: 'old.com' }).body ?? '{}').domains
    ).toEqual(['old.com'])
    expect(
      JSON.parse(
        request('companyenrich_similar', { domain: 'old.com', domains: ['new.com'] }).body ?? '{}'
      ).domains
    ).toEqual(['new.com'])
  })
  it('retains full company/page fields and raw null values alongside compatible outputs', async () => {
    const company = {
      id: 'a',
      technologies: null,
      location: { city: 'Paris' },
      future: [0, null, false],
    }
    const enrich = await registered('companyenrich_enrich').transformResponse?.(
      Response.json(company)
    )
    expect(enrich.output.company).toMatchObject({
      location: company.location,
      future: company.future,
      technologies: [],
    })
    expect(enrich.output.data).toEqual(company)
    const page = {
      items: [company],
      page: 1,
      totalPages: 1,
      totalItems: 1,
      metadata: { scores: { a: 0.8 }, future: false },
      future: 'retained',
    }
    const similar = await registered('companyenrich_similar').transformResponse?.(
      Response.json(page)
    )
    expect(similar.output.data).toEqual(page)
    expect(similar.output.scores).toEqual({ a: 0.8 })
    expect(similar.output.items[0].location).toEqual(company.location)
  })
  it('rejects hidden endpoints and malformed paid requests before producing a request', () => {
    const invalid = [
      { apiOperation: 'get_me' },
      { apiOperation: 'constructor' },
      { apiOperation: 'get_companies_enrich', queryParameters: { domain: '' } },
      { apiOperation: 'get_companies_enrich', queryParameters: { domain: 'a.com', extra: true } },
      { apiOperation: 'get_companies_workforce', queryParameters: {} },
      { apiOperation: 'post_companies_enrich', body: {} },
      { apiOperation: 'post_companies_enrich_batch', body: { domains: Array(51).fill('a.com') } },
      { apiOperation: 'post_companies_similar_count', body: { domains: [] } },
      { apiOperation: 'post_companies_search', body: { page: true } },
      { apiOperation: 'post_companies_search', body: { page: 101, pageSize: 100 } },
      { apiOperation: 'post_companies_search', body: { semanticQuery: 'x'.repeat(501) } },
      {
        apiOperation: 'post_companies_search',
        body: { unknown: { nested: Number.POSITIVE_INFINITY } },
      },
      { apiOperation: 'post_people_lookup', body: { email: '' } },
      { apiOperation: 'get_people', queryParameters: { id: Number('9223372036854775807') } },
      { apiOperation: 'get_people', queryParameters: { id: '9223372036854775808' } },
      { apiOperation: 'get_people_email', queryParameters: { id: '1' } },
      { apiOperation: 'get_geo_countries_countrycode', pathParameters: { countryCode: '..' } },
      { apiOperation: 'post_companies_search_async', body: {} },
      { apiOperation: 'post_people_search_async', body: { count: 50001 } },
    ]
    for (const params of invalid) expect(() => request('companyenrich_advanced', params)).toThrow()
  })
  it('sanitizes error messages and attached data through the executor error policy', () => {
    const info = {
      status: 429,
      data: { apiKey: 'secret-key', message: 'private account data' },
      statusText: 'secret-key',
    }
    const extractor = registered('companyenrich_enrich').errorExtractor
    expect(extractErrorMessage(info, extractor)).toBe('CompanyEnrich request failed (HTTP 429)')
    expect(redactErrorData(info, extractor)).toBeNull()
  })
})
