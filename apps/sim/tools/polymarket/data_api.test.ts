import { describe, expect, it } from 'vitest'
import { polymarketGetActivityTool } from '@/tools/polymarket/get_activity'
import { polymarketGetLeaderboardTool } from '@/tools/polymarket/get_leaderboard'
import { polymarketGetPositionsTool } from '@/tools/polymarket/get_positions'
import { polymarketGetTradesTool } from '@/tools/polymarket/get_trades'

/** Builds the request URL a tool would call for `params`. */
function requestUrl<P>(
  tool: { request: { url: string | ((params: P) => string) } },
  params: P
): URL {
  const { url } = tool.request
  return new URL(typeof url === 'function' ? url(params) : url)
}

/** The unversioned Data API v1 routes answer `410 Gone`; every Data tool must call v2. */
describe('Polymarket Data API v2', () => {
  it('sends v1-style position filters under their v2 names', () => {
    const url = requestUrl(polymarketGetPositionsTool, {
      user: '0xabc',
      market: '0xcond',
      eventId: '42',
      sizeThreshold: '5',
      redeemable: 'true',
      sortBy: 'CURRENT',
      limit: '10',
      cursor: 'next-page',
    })
    expect(url.pathname).toBe('/v2/positions')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      user: '0xabc',
      condition: '0xcond',
      event_id: '42',
      filter_amount: '5',
      status: 'REDEEMABLE',
      sort_by: 'CURRENT_VALUE',
      limit: '10',
      cursor: 'next-page',
    })
  })

  it('maps v2 snake_case rows and the cursor envelope to the existing outputs', async () => {
    const body = {
      data: [
        {
          proxy_wallet: '0xw',
          token_id: '123',
          condition_id: '0xc',
          side: 'BUY',
          size: 2,
          price: 0.4,
          timestamp: 1700000000,
          event_slug: 'event',
          outcome_index: 1,
          profile_image: 'img',
          transaction_hash: '0xt',
        },
      ],
      pagination: { has_more: true, next_cursor: 'cursor-2', limit: 1, offset: 0 },
    }
    const result = await polymarketGetTradesTool.transformResponse?.(
      new Response(JSON.stringify(body), { status: 200 })
    )
    expect(result?.output).toMatchObject({
      trades: [
        {
          proxyWallet: '0xw',
          asset: '123',
          conditionId: '0xc',
          eventSlug: 'event',
          outcomeIndex: 1,
          profileImage: 'img',
          transactionHash: '0xt',
        },
      ],
      nextCursor: 'cursor-2',
      hasMore: true,
    })
  })

  it("returns one wallet's volume rank from the v2 standing object", async () => {
    const params = { user: '0xw', orderBy: 'VOL' }
    expect(requestUrl(polymarketGetLeaderboardTool, params).searchParams.get('sort_by')).toBe(
      'VOLUME'
    )
    const body = { data: { user_id: '0xw', rank_pnl: 9, rank_volume: 3, volume: 10, pnl: 1 } }
    const result = await polymarketGetLeaderboardTool.transformResponse?.(
      new Response(JSON.stringify(body), { status: 200 }),
      params
    )
    expect(result?.output.leaderboard).toEqual([
      expect.objectContaining({ rank: '3', proxyWallet: '0xw', vol: 10 }),
    ])
  })

  it('drops redeemable positions when Non-Redeemable Only is selected', async () => {
    const body = {
      data: [
        { token_id: 'open', redeemable: false, mergeable: false },
        { token_id: 'settled', redeemable: true, mergeable: false },
      ],
      pagination: { has_more: false, next_cursor: null },
    }
    const result = await polymarketGetPositionsTool.transformResponse?.(
      new Response(JSON.stringify(body), { status: 200 }),
      { user: '0xabc', redeemable: 'false' }
    )
    expect(result?.output.positions.map((position) => position.asset)).toEqual(['open'])
  })

  it('applies redeemable and mergeable filters an agent sends as JSON booleans', async () => {
    const url = requestUrl(polymarketGetPositionsTool, {
      user: '0xabc',
      redeemable: true as unknown as string,
    })
    expect(url.searchParams.get('status')).toBe('REDEEMABLE')

    const body = {
      data: [
        { token_id: 'open', redeemable: false, mergeable: false },
        { token_id: 'mergeable', redeemable: false, mergeable: true },
      ],
      pagination: { has_more: false, next_cursor: null },
    }
    const result = await polymarketGetPositionsTool.transformResponse?.(
      new Response(JSON.stringify(body), { status: 200 }),
      { user: '0xabc', mergeable: false as unknown as string }
    )
    expect(result?.output.positions.map((position) => position.asset)).toEqual(['open'])
  })

  it('skips an untouched (null) or empty start/end and accepts a numeric string', () => {
    const url = requestUrl(polymarketGetActivityTool, {
      user: '0xabc',
      start: null as unknown as number,
      end: '' as unknown as number,
    })
    expect(url.searchParams.has('start')).toBe(false)
    expect(url.searchParams.has('end')).toBe(false)
    const fromString = requestUrl(polymarketGetActivityTool, {
      user: '0xabc',
      start: '1700000000' as unknown as number,
    })
    expect(fromString.searchParams.get('start')).toBe('1700000000')
  })

  it('rejects a non-numeric start and reads start=0 as the full history', () => {
    expect(() =>
      requestUrl(polymarketGetActivityTool, {
        user: '0xabc',
        start: 'yesterday' as unknown as number,
      })
    ).toThrow('Unix timestamp')
    expect(
      requestUrl(polymarketGetActivityTool, { user: '0xabc', start: 0 }).searchParams.get('start')
    ).toBe('1')
  })
})
