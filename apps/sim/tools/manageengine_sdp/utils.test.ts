/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { resolveSdpBase, SDP_DATA_CENTER_BASES } from '@/tools/manageengine_sdp/data-centers'
import {
  buildSdpInputDataBody,
  buildSdpListInfo,
  buildSdpListUrl,
  compactSdpEntity,
  getSdpApiBase,
  getSdpErrorMessage,
  parseSdpResponse,
} from '@/tools/manageengine_sdp/utils'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('resolveSdpBase', () => {
  /**
   * All ten hosts are asserted literally, not derived from the map under test —
   * these are transcribed from the docs' "API endpoints by data center" table,
   * and the apex changes with the region (US/EU/IN sit under
   * `sdpondemand.manageengine.*`, the rest under their own `servicedeskplus.*`),
   * so a typo in any one of them would otherwise ship silently.
   */
  it('maps every data center code to its documented host', () => {
    expect(resolveSdpBase('US')).toBe('https://sdpondemand.manageengine.com')
    expect(resolveSdpBase('EU')).toBe('https://sdpondemand.manageengine.eu')
    expect(resolveSdpBase('IN')).toBe('https://sdpondemand.manageengine.in')
    expect(resolveSdpBase('AU')).toBe('https://servicedeskplus.net.au')
    expect(resolveSdpBase('JP')).toBe('https://servicedeskplus.jp')
    expect(resolveSdpBase('CA')).toBe('https://servicedeskplus.ca')
    expect(resolveSdpBase('SA')).toBe('https://servicedeskplus.sa')
    expect(resolveSdpBase('UK')).toBe('https://servicedeskplus.uk')
    expect(resolveSdpBase('CN')).toBe('https://servicedeskplus.cn')
    expect(resolveSdpBase('AE')).toBe('https://servicedeskplus.ae')
    // Guards the test itself: if a code is added to the map, this fails until
    // an assertion for it is added above.
    expect(Object.keys(SDP_DATA_CENTER_BASES)).toHaveLength(10)
  })

  it('accepts a lower-case code, since the value round-trips through workflow JSON', () => {
    expect(resolveSdpBase('eu')).toBe(SDP_DATA_CENTER_BASES.EU)
  })

  it('falls back to the US base for an absent or unrecognized code', () => {
    expect(resolveSdpBase(undefined)).toBe(SDP_DATA_CENTER_BASES.US)
    expect(resolveSdpBase('')).toBe(SDP_DATA_CENTER_BASES.US)
    expect(resolveSdpBase('https://attacker.example.com')).toBe(SDP_DATA_CENTER_BASES.US)
  })
})

describe('getSdpApiBase', () => {
  it('omits the portal segment when no portal is given', () => {
    expect(getSdpApiBase({ dataCenter: 'US' })).toBe('https://sdpondemand.manageengine.com/api/v3')
  })

  it('inserts the portal segment when one is given', () => {
    expect(getSdpApiBase({ dataCenter: 'EU', portal: 'itdesk' })).toBe(
      'https://sdpondemand.manageengine.eu/app/itdesk/api/v3'
    )
  })

  it('rejects a portal carrying a path separator rather than escaping the base', () => {
    expect(() => getSdpApiBase({ dataCenter: 'US', portal: '../../evil' })).toThrow(
      /path separator/
    )
  })
})

describe('buildSdpListInfo', () => {
  it('returns undefined when nothing was supplied, so no input_data is sent', () => {
    expect(buildSdpListInfo({ accessToken: 't' })).toBeUndefined()
  })

  it('clamps row_count to the documented maximum of 100', () => {
    expect(buildSdpListInfo({ accessToken: 't', rowCount: 500 })).toEqual({ row_count: 100 })
  })

  it('drops an out-of-range start_index instead of forwarding it', () => {
    expect(buildSdpListInfo({ accessToken: 't', startIndex: 0 })).toBeUndefined()
    expect(buildSdpListInfo({ accessToken: 't', startIndex: 1.5 })).toBeUndefined()
  })

  it('forwards only the two documented sort directions', () => {
    expect(buildSdpListInfo({ accessToken: 't', sortOrder: 'DESC' })).toEqual({
      sort_order: 'desc',
    })
    expect(buildSdpListInfo({ accessToken: 't', sortOrder: 'sideways' })).toBeUndefined()
  })

  it('parses search criteria supplied as JSON text', () => {
    expect(
      buildSdpListInfo({
        accessToken: 't',
        searchCriteria: '{"field":"status.name","condition":"is","value":"Open"}',
      })
    ).toEqual({
      search_criteria: { field: 'status.name', condition: 'is', value: 'Open' },
    })
  })

  it('names the field when the supplied JSON is unparseable', () => {
    expect(() => buildSdpListInfo({ accessToken: 't', searchCriteria: '{oops' })).toThrow(
      /search criteria/
    )
  })

  it('omits get_total_count unless it was explicitly enabled', () => {
    expect(buildSdpListInfo({ accessToken: 't', getTotalCount: false })).toBeUndefined()
    expect(buildSdpListInfo({ accessToken: 't', getTotalCount: true })).toEqual({
      get_total_count: true,
    })
  })
})

describe('buildSdpListUrl', () => {
  it('leaves the URL untouched when there is no list_info to send', () => {
    expect(buildSdpListUrl('https://host/api/v3/requests', { accessToken: 't' })).toBe(
      'https://host/api/v3/requests'
    )
  })

  it('encodes list_info into the input_data query parameter', () => {
    const url = new URL(
      buildSdpListUrl('https://host/api/v3/requests', { accessToken: 't', rowCount: 25 })
    )
    expect(JSON.parse(url.searchParams.get('input_data') as string)).toEqual({
      list_info: { row_count: 25 },
    })
  })
})

describe('buildSdpInputDataBody', () => {
  it('wraps the entity in its module key inside a form-encoded input_data field', () => {
    const body = new URLSearchParams(buildSdpInputDataBody('request', { subject: 'Printer down' }))
    expect(JSON.parse(body.get('input_data') as string)).toEqual({
      request: { subject: 'Printer down' },
    })
  })
})

describe('compactSdpEntity', () => {
  it('drops absent values so a PUT never clears an untouched field', () => {
    expect(
      compactSdpEntity({ subject: 'A', description: '', technician: undefined, group: null })
    ).toEqual({ subject: 'A' })
  })

  it('keeps false, which is a real value rather than an absent one', () => {
    expect(compactSdpEntity({ show_to_requester: false })).toEqual({ show_to_requester: false })
  })
})

describe('getSdpErrorMessage', () => {
  it('reads the prose message out of the object form of response_status', () => {
    expect(
      getSdpErrorMessage(
        {
          response_status: {
            status: 'failed',
            messages: [
              { status_code: 4001, type: 'failed', message: 'Value given for title is not valid' },
            ],
          },
        },
        'fallback'
      )
    ).toBe('Value given for title is not valid')
  })

  it('reads the array form used by list and bulk responses', () => {
    expect(
      getSdpErrorMessage(
        {
          response_status: [
            { status_code: 4000, status: 'failed', messages: [{ message: 'Internal Error' }] },
          ],
        },
        'fallback'
      )
    ).toBe('Internal Error')
  })

  it('names the offending field when the message carries only a field and a code', () => {
    expect(
      getSdpErrorMessage(
        {
          response_status: {
            status: 'failed',
            messages: [{ status_code: 4008, field: 'name', type: 'failed' }],
          },
        },
        'fallback'
      )
    ).toBe('name: code 4008')
  })

  it('falls back when the body carries no usable message', () => {
    expect(getSdpErrorMessage({}, 'fallback')).toBe('fallback')
    expect(getSdpErrorMessage(null, 'fallback')).toBe('fallback')
  })
})

describe('parseSdpResponse', () => {
  it('returns the body on success', async () => {
    await expect(
      parseSdpResponse(
        jsonResponse({
          response_status: { status_code: 2000, status: 'success' },
          request: { id: '1' },
        }),
        'Failed'
      )
    ).resolves.toEqual({
      response_status: { status_code: 2000, status: 'success' },
      request: { id: '1' },
    })
  })

  it('throws with the provider message on a non-2xx response', async () => {
    await expect(
      parseSdpResponse(
        jsonResponse(
          { response_status: { status: 'failed', messages: [{ message: 'Invalid URL' }] } },
          404
        ),
        'Failed to get request'
      )
    ).rejects.toThrow('Invalid URL')
  })

  it('includes the HTTP status when a failed response carries no message', async () => {
    await expect(parseSdpResponse(jsonResponse({}, 500), 'Failed to get request')).rejects.toThrow(
      'Failed to get request (HTTP 500)'
    )
  })

  it('throws on a 2xx whose body is not JSON, rather than reporting success', async () => {
    // A proxy or captive login page answering 200 with HTML. Swallowing this
    // would report a read as empty and a delete as having succeeded.
    const html = new Response('<html><body>Sign in</body></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })
    await expect(parseSdpResponse(html, 'Failed to delete request')).rejects.toThrow(/non-JSON/)
  })

  it('throws on a 2xx whose body is valid JSON but not an object', async () => {
    const scalar = new Response('"ok"', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    await expect(parseSdpResponse(scalar, 'Failed to get request')).rejects.toThrow(/non-JSON/)
  })

  it('tolerates an empty 2xx body, which carries nothing this layer needs', async () => {
    // `null` rather than `''`: the Response constructor rejects a 204 with a body.
    const noContent = new Response(null, { status: 204 })
    await expect(parseSdpResponse(noContent, 'Failed to delete request')).resolves.toEqual({})
    const blank = new Response('   ', { status: 200 })
    await expect(parseSdpResponse(blank, 'Failed to delete request')).resolves.toEqual({})
  })

  it('throws on a 200 whose response_status reports a failure', async () => {
    await expect(
      parseSdpResponse(
        jsonResponse({
          response_status: [
            { status_code: 2000, status: 'success' },
            { status_code: 4000, status: 'failed', messages: [{ message: 'Internal Error' }] },
          ],
        }),
        'Failed'
      )
    ).rejects.toThrow('Internal Error')
  })
})
