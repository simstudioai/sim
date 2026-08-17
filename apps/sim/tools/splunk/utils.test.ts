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
  readSplunkDispatchJson,
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
   * The results path must never turn an unparseable body into an empty result set:
   * that reports a lost result set as a search that legitimately matched nothing.
   * The XML dispatch tolerance is deliberately not reachable from here.
   */
  it('throws on a truncated JSON body rather than reporting an empty result set', async () => {
    await expect(readSplunkJson(new Response('{"results":[{"_raw":"partial'))).rejects.toThrow()
  })

  it('throws on a non-JSON body', async () => {
    await expect(readSplunkJson(new Response('upstream connect error'))).rejects.toThrow()
  })

  it('throws on a 2xx HTML interstitial instead of reporting zero events', async () => {
    await expect(
      readSplunkJson(new Response('<!DOCTYPE html><html><body>Sign in</body></html>'))
    ).rejects.toThrow()
  })

  it('throws even on the dispatch XML envelope — results are always JSON', async () => {
    await expect(
      readSplunkJson(new Response('<response><sid>1457683115.100</sid></response>'))
    ).rejects.toThrow()
  })
})

describe('readSplunkDispatchJson', () => {
  /**
   * `output_mode` is not in the documented parameter table for the dispatching and
   * job-control endpoints, and the only response the reference documents for them
   * is XML. The envelope is projected onto the same `{ sid }` shape JSON produces,
   * so a dispatch that answered in XML keeps the search ID of the job it just
   * created instead of erroring after the remote work already happened.
   */
  it('reads the search ID out of the documented XML response', async () => {
    await expect(
      readSplunkDispatchJson(new Response('<response><sid>1457683115.100</sid></response>'))
    ).resolves.toEqual({ sid: '1457683115.100' })
  })

  it('accepts the XML declaration and attributes on the root', async () => {
    await expect(
      readSplunkDispatchJson(
        new Response('<?xml version="1.0" encoding="UTF-8"?><response><sid>1.1</sid></response>')
      )
    ).resolves.toEqual({ sid: '1.1' })
  })

  /** Job control documents "Returned values: None", so there is no sid to find. */
  it('returns an empty envelope for a job-control response with no sid', async () => {
    await expect(readSplunkDispatchJson(new Response('<response/>'))).resolves.toEqual({})
    await expect(
      readSplunkDispatchJson(new Response('<response><messages/></response>'))
    ).resolves.toEqual({})
  })

  /**
   * A body cut off mid-transfer still starts with the documented root. Matching the
   * opening tag alone read it as a complete envelope that carried nothing, which on
   * a cancellation reported a truncated response as a successful cancel.
   */
  it('throws on a truncated envelope rather than reporting a successful cancel', async () => {
    await expect(readSplunkDispatchJson(new Response('<response><sid>145768311'))).rejects.toThrow()
  })

  it('still parses a JSON body', async () => {
    await expect(readSplunkDispatchJson(new Response('{"sid":"1.1"}'))).resolves.toEqual({
      sid: '1.1',
    })
  })

  /**
   * `POST search/jobs/{sid}/control` documents "Returned values: None" and answers
   * in XML, so the `<messages>` block is the entire payload it produces — the one
   * signal that the cancel took effect. Dropping it left `cancel_search_job`
   * reporting an empty `messages` array on every call.
   */
  it('projects the messages block of a job-control response', async () => {
    await expect(
      readSplunkDispatchJson(
        new Response(
          '<response><messages><msg type="INFO">Search job cancelled.</msg></messages></response>'
        )
      )
    ).resolves.toEqual({ messages: [{ type: 'INFO', text: 'Search job cancelled.' }] })
  })

  it('keeps every message and its severity', async () => {
    await expect(
      readSplunkDispatchJson(
        new Response(
          '<response><messages><msg type="WARN">Partial results.</msg><msg type="ERROR">Peer down.</msg></messages></response>'
        )
      )
    ).resolves.toEqual({
      messages: [
        { type: 'WARN', text: 'Partial results.' },
        { type: 'ERROR', text: 'Peer down.' },
      ],
    })
  })

  /** A message routinely quotes the search string, so entities reach this path. */
  it('decodes named and numeric XML entities in the message text', async () => {
    await expect(
      readSplunkDispatchJson(
        new Response(
          '<response><messages><msg type="ERROR">Unknown index &quot;a&amp;b&quot; &#60;&#x3e;</msg></messages></response>'
        )
      )
    ).resolves.toEqual({ messages: [{ type: 'ERROR', text: 'Unknown index "a&b" <>' }] })
  })

  it('keeps the search ID and the messages when the envelope carries both', async () => {
    await expect(
      readSplunkDispatchJson(
        new Response(
          '<response><sid>1.1</sid><messages><msg type="INFO">Dispatched.</msg></messages></response>'
        )
      )
    ).resolves.toEqual({ sid: '1.1', messages: [{ type: 'INFO', text: 'Dispatched.' }] })
  })

  it('returns an empty envelope for 204 and for an empty body', async () => {
    await expect(readSplunkDispatchJson(new Response(null, { status: 204 }))).resolves.toEqual({})
    await expect(readSplunkDispatchJson(new Response('  '))).resolves.toEqual({})
  })

  /**
   * The tolerance is anchored to the one documented root element. A proxy error
   * page or an SSO interstitial served with a 2xx is not a successful dispatch, and
   * reading it as an empty envelope would hide it behind the missing-sid message.
   */
  it('throws on a 2xx HTML interstitial rather than reading it as an empty envelope', async () => {
    await expect(
      readSplunkDispatchJson(new Response('<!DOCTYPE html><html><body>Sign in</body></html>'))
    ).rejects.toThrow()
  })

  it('throws on some other XML document', async () => {
    await expect(
      readSplunkDispatchJson(new Response('<error><message>Gateway timeout</message></error>'))
    ).rejects.toThrow()
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
