/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { buildSplunkFormBody, buildSplunkUrl, normalizeSearchQuery } from '@/tools/splunk/utils'

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
    expect(buildSplunkUrl({ ...BASE, app: 'search' }, '/saved/searches')).toContain(
      '/servicesNS/nobody/search/saved/searches'
    )
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
