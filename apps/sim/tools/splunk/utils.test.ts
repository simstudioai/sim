/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildSplunkFormBody,
  buildSplunkHeaders,
  buildSplunkUrl,
  getSplunkPaging,
  normalizeSearchQuery,
  readSplunkJson,
  requireSplunkSid,
  savedSearchFieldQuery,
} from '@/tools/splunk/utils'

const BASE = { baseUrl: 'https://splunk.example.com:8089' }

describe('buildSplunkUrl', () => {
  it('pins output_mode=json and cannot be overridden by a caller', () => {
    const url = buildSplunkUrl(BASE, '/search/jobs', { output_mode: 'xml' })
    expect(url).toBe('https://splunk.example.com:8089/services/search/jobs?output_mode=json')
  })

  it('omits query values that an untouched subBlock supplies as null', () => {
    const url = buildSplunkUrl(BASE, '/data/indexes', {
      count: null,
      offset: undefined,
      datatype: '',
      add_summary_to_metadata: null,
    })

    expect(url).not.toContain('null')
    expect(url).toBe('https://splunk.example.com:8089/services/data/indexes?output_mode=json')
  })

  it('keeps explicit falsy values that Splunk treats as meaningful', () => {
    const url = buildSplunkUrl(BASE, '/data/indexes', { count: 0, offset: 0 })
    expect(url).toContain('count=0')
    expect(url).toContain('offset=0')
  })

  it('uses the namespace prefix only when an owner or app is supplied', () => {
    expect(buildSplunkUrl(BASE, '/saved/searches')).toContain('/services/saved/searches')
    expect(buildSplunkUrl({ ...BASE, owner: 'admin', app: 'search' }, '/saved/searches')).toContain(
      '/servicesNS/admin/search/saved/searches'
    )
  })

  it('fills a half-specified namespace with the - wildcard, never nobody or search', () => {
    const appOnly = buildSplunkUrl({ ...BASE, app: 'myapp' }, '/saved/searches')
    expect(appOnly).toContain('/servicesNS/-/myapp/saved/searches')
    expect(appOnly).not.toContain('nobody')

    const ownerOnly = buildSplunkUrl({ ...BASE, owner: 'admin' }, '/saved/searches')
    expect(ownerOnly).toContain('/servicesNS/admin/-/saved/searches')
  })
})

describe('buildSplunkHeaders', () => {
  it('prefers the bearer token over basic credentials', () => {
    const headers = buildSplunkHeaders({ ...BASE, authToken: 'tok', username: 'u', password: 'p' })
    expect(headers.Authorization).toBe('Bearer tok')
  })

  it('falls back to basic authentication', () => {
    const headers = buildSplunkHeaders({ ...BASE, username: 'u', password: 'p' })
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`)
  })

  it('throws when neither credential form is supplied', () => {
    expect(() => buildSplunkHeaders(BASE)).toThrow(/authentication token or a username/)
  })
})

describe('readSplunkJson', () => {
  it('returns an empty envelope for 204 No Content instead of throwing', async () => {
    await expect(readSplunkJson(new Response(null, { status: 204 }))).resolves.toEqual({})
  })

  it('returns an empty envelope for a 200 with an empty body', async () => {
    await expect(readSplunkJson(new Response('   ', { status: 200 }))).resolves.toEqual({})
  })

  it('still parses a real body', async () => {
    await expect(readSplunkJson(new Response('{"results":[]}'))).resolves.toEqual({ results: [] })
  })

  /**
   * `output_mode` is not in the documented parameter table for the dispatching and
   * job-control endpoints, and the only response the reference documents for them
   * is XML. Throwing here reported a cancel that succeeded server-side as a
   * failure, and pre-empted the error the caller raises for a missing value.
   */
  it('returns an empty envelope for an XML body instead of throwing', async () => {
    await expect(
      readSplunkJson(new Response('<response><sid>1457683115.100</sid></response>'))
    ).resolves.toEqual({})
  })
})

describe('getSplunkPaging', () => {
  it('projects total and offset from the collection paging envelope', () => {
    expect(getSplunkPaging({ paging: { total: 412, perPage: 30, offset: 30 } })).toEqual({
      total: 412,
      offset: 30,
    })
  })

  it('reads the Atom-nested form and tolerates a response with no envelope', () => {
    expect(getSplunkPaging({ feed: { paging: { total: 7, offset: 0 } } })).toEqual({
      total: 7,
      offset: 0,
    })
    expect(getSplunkPaging({ entry: [] })).toEqual({ total: null, offset: null })
  })
})

describe('requireSplunkSid', () => {
  it('reads the flat sid envelope', () => {
    expect(requireSplunkSid({ sid: '1457683115.100' })).toBe('1457683115.100')
  })

  it('throws rather than reporting success with no search ID', () => {
    expect(() => requireSplunkSid({})).toThrow(/did not return a search ID/)
  })
})

describe('savedSearchFieldQuery', () => {
  it('requests only the projected fields, with dotted keys encoded', () => {
    const query = savedSearchFieldQuery()
    expect(query).toContain('f=qualifiedSearch')
    expect(query).toContain(`f=${encodeURIComponent('dispatch.earliest_time')}`)
    expect(query).not.toContain('action.email')
  })
})

describe('buildSplunkFormBody', () => {
  it('drops null fields so Splunk applies its own documented default', () => {
    const body = buildSplunkFormBody({
      search: 'search index=main',
      earliest_time: null,
      trigger_actions: null,
      force_dispatch: null,
      enable_lookups: undefined,
    })

    expect(body).toBe('search=search+index%3Dmain')
    expect(body).not.toContain('null')
  })

  it('serializes booleans as 1/0 when the user set them explicitly', () => {
    expect(buildSplunkFormBody({ enable_lookups: true, allow_partial_results: false })).toBe(
      'enable_lookups=1&allow_partial_results=0'
    )
  })
})

describe('normalizeSearchQuery', () => {
  it('prefixes the implicit search command', () => {
    expect(normalizeSearchQuery('index=main error')).toBe('search index=main error')
  })

  it('leaves an explicit search or generating command alone', () => {
    expect(normalizeSearchQuery('search index=main')).toBe('search index=main')
    expect(normalizeSearchQuery('| tstats count')).toBe('| tstats count')
  })
})
