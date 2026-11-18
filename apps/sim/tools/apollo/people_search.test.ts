import { describe, expect, it } from 'vitest'
import { apolloPeopleSearchTool } from '@/tools/apollo/people_search'
import type { ApolloPeopleSearchParams } from '@/tools/apollo/types'

const LEGACY_URL = 'https://api.apollo.io/api/v1/mixed_people/search'
const API_SEARCH_URL = 'https://api.apollo.io/api/v1/mixed_people/api_search'

function resolveUrl(params: ApolloPeopleSearchParams): string {
  const { url } = apolloPeopleSearchTool.request
  return typeof url === 'function' ? url(params) : url
}

async function transform(body: unknown, params: ApolloPeopleSearchParams) {
  const { transformResponse } = apolloPeopleSearchTool
  if (!transformResponse) throw new Error('apollo_people_search has no transformResponse')
  return transformResponse(new Response(JSON.stringify(body), { status: 200 }), params)
}

describe('apollo_people_search endpoint selection', () => {
  it.concurrent.each(['oauth', 'managed_oauth'])(
    'sends %s credentials to the api_search endpoint their scope grants',
    (credentialType) => {
      expect(resolveUrl({ apiKey: 'token', credentialType })).toBe(API_SEARCH_URL)
    }
  )

  it.concurrent.each([undefined, 'api_key', 'service_account'])(
    'keeps credential type %s on the legacy endpoint',
    (credentialType) => {
      expect(resolveUrl({ apiKey: 'key', credentialType })).toBe(LEGACY_URL)
    }
  )
})

describe('apollo_people_search response mapping', () => {
  it.concurrent('reports the requested page when api_search omits pagination', async () => {
    const result = await transform(
      { total_entries: 812, people: [{ id: 'p1' }] },
      { apiKey: 'token', credentialType: 'oauth', page: 3, per_page: 50 }
    )

    expect(result.output).toEqual({
      people: [{ id: 'p1' }],
      page: 3,
      per_page: 50,
      total_entries: 812,
    })
  })

  it.concurrent('reports the clamped page size the request actually sent', async () => {
    const result = await transform(
      { total_entries: 5, people: [] },
      { apiKey: 'token', credentialType: 'oauth', per_page: 500 }
    )

    expect(result.output.page).toBe(1)
    expect(result.output.per_page).toBe(100)
  })

  it.concurrent('reports page 1, the page the request sent, when page is 0', async () => {
    const result = await transform(
      { total_entries: 5, people: [] },
      { apiKey: 'token', credentialType: 'oauth', page: 0 }
    )

    expect(result.output.page).toBe(1)
  })

  it.concurrent('reads the nested pagination the legacy endpoint returns', async () => {
    const result = await transform(
      { people: [{ id: 'p2' }], pagination: { page: 2, per_page: 10, total_entries: 40 } },
      { apiKey: 'key', page: 7, per_page: 25 }
    )

    expect(result.output).toEqual({
      people: [{ id: 'p2' }],
      page: 2,
      per_page: 10,
      total_entries: 40,
    })
  })
})
