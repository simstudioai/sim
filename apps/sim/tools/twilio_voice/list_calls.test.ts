import { jsonResponse } from '@sim/testing/helpers/http'
import { setupGlobalFetchMock } from '@sim/testing/mocks/fetch.mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { listCallsTool } from '@/tools/twilio_voice/list_calls'

let fetchMock: ReturnType<typeof setupGlobalFetchMock>

function callsPage(recordingsPaths: string[]) {
  return jsonResponse({
    calls: recordingsPaths.map((recordings, index) => ({
      sid: `CA${index}`,
      from: '+15550000000',
      to: '+15550000001',
      status: 'completed',
      direction: 'outbound-api',
      duration: '12',
      price: null,
      price_unit: 'USD',
      start_time: 'Mon, 09 Nov 2026 10:00:00 +0000',
      end_time: null,
      date_created: 'Mon, 09 Nov 2026 10:00:00 +0000',
      subresource_uris: { recordings },
    })),
    page: 0,
    page_size: 50,
  })
}

async function listCalls(recordingsPaths: string[], signal?: AbortSignal) {
  if (!listCallsTool.transformResponse) throw new Error('Missing response transform')
  return listCallsTool.transformResponse(
    callsPage(recordingsPaths),
    { accountSid: 'AC123', authToken: 'secret' },
    { signal }
  )
}

describe('Twilio list calls recordings lookup', () => {
  beforeEach(() => {
    fetchMock = setupGlobalFetchMock()
    fetchMock.mockImplementation(async () => jsonResponse({ recordings: [{ sid: 'RE1' }] }))
  })

  it.each([
    ['@evil.test/x', 1],
    ['//evil.test/x', 0],
    ['https://evil.test/x', 0],
  ])('never sends the saved credentials off the Twilio API origin for %s', async (path, calls) => {
    await listCalls([path])
    expect(fetchMock).toHaveBeenCalledTimes(calls)
    for (const [url] of fetchMock.mock.calls) {
      expect(new URL(String(url)).origin).toBe('https://api.twilio.com')
    }
  })

  it('fetches recordings for Twilio-relative paths', async () => {
    const result = await listCalls(['/2010-04-01/Accounts/AC123/Calls/CA0/Recordings.json'])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.twilio.com/2010-04-01/Accounts/AC123/Calls/CA0/Recordings.json',
      expect.anything()
    )
    expect(result.output.calls?.[0]?.recordingSids).toEqual(['RE1'])
  })

  it('keeps at most ten recordings requests in flight', async () => {
    let inFlight = 0
    let peak = 0
    fetchMock.mockImplementation(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await Promise.resolve()
      inFlight--
      return jsonResponse({ recordings: [] })
    })

    await listCalls(Array.from({ length: 35 }, (_, i) => `/Calls/CA${i}/Recordings.json`))

    expect(fetchMock).toHaveBeenCalledTimes(35)
    expect(peak).toBe(10)
  })

  it('starts no queued recordings requests once the run is cancelled', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementation(async (_url: unknown, init?: RequestInit) => {
      controller.abort()
      expect(init?.signal).toBe(controller.signal)
      return jsonResponse({ recordings: [] })
    })

    await expect(
      listCalls(
        Array.from({ length: 35 }, (_, i) => `/Calls/CA${i}/Recordings.json`),
        controller.signal
      )
    ).rejects.toThrow()

    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(10)
  })
})

describe('Twilio list calls pagination', () => {
  beforeEach(() => {
    fetchMock = setupGlobalFetchMock()
  })

  it('sends the page token and returns the next one from next_page_uri', async () => {
    if (typeof listCallsTool.request.url !== 'function') throw new Error('Missing request url')
    const url = new URL(
      listCallsTool.request.url({ accountSid: 'AC123', authToken: 'secret', pageToken: 'PA1' })
    )
    expect(url.searchParams.get('PageToken')).toBe('PA1')

    if (!listCallsTool.transformResponse) throw new Error('Missing response transform')
    const result = await listCallsTool.transformResponse(
      jsonResponse({
        calls: [],
        page: 1,
        page_size: 50,
        next_page_uri: '/2010-04-01/Accounts/AC123/Calls.json?PageSize=50&Page=2&PageToken=PA2',
      }),
      { accountSid: 'AC123', authToken: 'secret' }
    )
    expect(result.output.nextPageToken).toBe('PA2')
  })
})

describe('Twilio list calls page size', () => {
  function pageSizeSent(pageSize: number): string | null {
    const url = listCallsTool.request.url
    if (typeof url !== 'function') throw new Error('Expected a URL builder')
    return new URL(url({ accountSid: 'AC123', authToken: 'secret', pageSize })).searchParams.get(
      'PageSize'
    )
  }

  it('clamps PageSize to the 1-1000 integer range Twilio accepts', () => {
    expect(pageSizeSent(5000)).toBe('1000')
    expect(pageSizeSent(-3)).toBe('1')
    expect(pageSizeSent(20.9)).toBe('20')
  })
})
