import { describe, expect, it } from 'vitest'
import { commaList, oddsApiIoUrl, readOddsApiIoJson } from '@/tools/odds_api_io/utils'

describe('readOddsApiIoJson', () => {
  it('returns the parsed body of a successful response', async () => {
    await expect(
      readOddsApiIoJson(new Response('[{"name":"Football"}]', { status: 200 }), 'get sports')
    ).resolves.toEqual([{ name: 'Football' }])
  })

  it('throws the API error message on a failed response', async () => {
    await expect(
      readOddsApiIoJson(
        new Response('{"error":"You need to provide a valid apiKey"}', { status: 401 }),
        'get events'
      )
    ).rejects.toThrow('You need to provide a valid apiKey')
  })

  it('throws instead of treating an unreadable successful body as empty data', async () => {
    await expect(
      readOddsApiIoJson(new Response('<html>maintenance</html>', { status: 200 }), 'get events')
    ).rejects.toThrow(/not valid JSON/)
    await expect(readOddsApiIoJson(new Response('', { status: 200 }), 'get event')).rejects.toThrow(
      /not valid JSON/
    )
  })
})

describe('oddsApiIoUrl', () => {
  it('sends the key as apiKey and skips empty filters', () => {
    const url = new URL(
      oddsApiIoUrl('/events', ' key ', { sport: 'football', league: '', limit: 5, to: undefined })
    )
    expect(url.pathname).toBe('/v3/events')
    expect(url.searchParams.get('apiKey')).toBe('key')
    expect(url.searchParams.get('sport')).toBe('football')
    expect(url.searchParams.get('limit')).toBe('5')
    expect(url.searchParams.has('league')).toBe(false)
    expect(url.searchParams.has('to')).toBe(false)
  })
})

describe('commaList', () => {
  it('normalises typed lists and arrays', () => {
    expect(commaList('Bet365, Unibet ,,')).toBe('Bet365,Unibet')
    expect(commaList(['Bet365', ' Unibet '])).toBe('Bet365,Unibet')
    expect(commaList('')).toBeUndefined()
  })
})
