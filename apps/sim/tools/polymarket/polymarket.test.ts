/**
 * @vitest-environment node
 *
 * Validates every Polymarket tool's transformResponse against fixtures captured
 * from the live Polymarket Gamma / CLOB / Data APIs. Fixtures mirror the real
 * response shapes (field names, nesting) so a drift between our mapping and the
 * API surfaces as a test failure.
 */
import { describe, expect, it } from 'vitest'
import { polymarketGetActivityTool } from '@/tools/polymarket/get_activity'
import { polymarketGetEventTool } from '@/tools/polymarket/get_event'
import { polymarketGetEventsTool } from '@/tools/polymarket/get_events'
import { polymarketGetHoldersTool } from '@/tools/polymarket/get_holders'
import { polymarketGetLastTradePriceTool } from '@/tools/polymarket/get_last_trade_price'
import { polymarketGetLeaderboardTool } from '@/tools/polymarket/get_leaderboard'
import { polymarketGetMarketTool } from '@/tools/polymarket/get_market'
import { polymarketGetMarketsTool } from '@/tools/polymarket/get_markets'
import { polymarketGetMidpointTool } from '@/tools/polymarket/get_midpoint'
import { polymarketGetOrderbookTool } from '@/tools/polymarket/get_orderbook'
import { polymarketGetPositionsTool } from '@/tools/polymarket/get_positions'
import { polymarketGetPriceTool } from '@/tools/polymarket/get_price'
import { polymarketGetPriceHistoryTool } from '@/tools/polymarket/get_price_history'
import { polymarketGetSeriesTool } from '@/tools/polymarket/get_series'
import { polymarketGetSeriesByIdTool } from '@/tools/polymarket/get_series_by_id'
import { polymarketGetSpreadTool } from '@/tools/polymarket/get_spread'
import { polymarketGetTagsTool } from '@/tools/polymarket/get_tags'
import { polymarketGetTickSizeTool } from '@/tools/polymarket/get_tick_size'
import { polymarketGetTradesTool } from '@/tools/polymarket/get_trades'
import { polymarketSearchTool } from '@/tools/polymarket/search'

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const err = (body: unknown, status = 400) => new Response(JSON.stringify(body), { status })

describe('Polymarket tool transformResponse mappings', () => {
  it('get_markets maps a bare array', async () => {
    const res = await polymarketGetMarketsTool.transformResponse!(
      ok([{ id: '1', question: 'Q?', conditionId: '0xabc', volumeNum: 5 }])
    )
    expect(res.success).toBe(true)
    expect(res.output.markets).toHaveLength(1)
    expect(res.output.markets[0].question).toBe('Q?')
  })

  it('get_market maps a single object', async () => {
    const res = await polymarketGetMarketTool.transformResponse!(
      ok({ id: '540817', question: 'Will X happen?', conditionId: '0xabc' })
    )
    expect(res.output.market.id).toBe('540817')
  })

  it('get_events maps a bare array', async () => {
    const res = await polymarketGetEventsTool.transformResponse!(
      ok([{ id: '1', title: 'Event', markets: [] }])
    )
    expect(res.output.events[0].title).toBe('Event')
  })

  it('get_event maps a single object', async () => {
    const res = await polymarketGetEventTool.transformResponse!(ok({ id: '1', title: 'Event' }))
    expect(res.output.event.title).toBe('Event')
  })

  it('get_tags maps a bare array', async () => {
    const res = await polymarketGetTagsTool.transformResponse!(
      ok([{ id: '1', label: 'Politics', slug: 'politics' }])
    )
    expect(res.output.tags[0].label).toBe('Politics')
  })

  it('search returns events/tags/profiles and never a phantom markets array', async () => {
    // Even if the API ever sent a top-level markets key, our shape must not expose it.
    const res = await polymarketSearchTool.transformResponse!(
      ok({
        events: [{ id: 'e1' }],
        tags: [{ id: 't1' }],
        profiles: [{ id: 'p1' }],
        markets: [{ id: 'm1' }],
      })
    )
    expect(res.output.results.events).toHaveLength(1)
    expect(res.output.results.tags).toHaveLength(1)
    expect(res.output.results.profiles).toHaveLength(1)
    expect('markets' in res.output.results).toBe(false)
  })

  it('search defaults missing arrays to []', async () => {
    const res = await polymarketSearchTool.transformResponse!(ok({ events: [{ id: 'e1' }] }))
    expect(res.output.results.tags).toEqual([])
    expect(res.output.results.profiles).toEqual([])
  })

  it('get_series strips nested events to an eventCount', async () => {
    const res = await polymarketGetSeriesTool.transformResponse!(
      ok([{ id: '1', title: 'Series', events: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }])
    )
    expect(res.output.series[0].eventCount).toBe(3)
    expect('events' in res.output.series[0]).toBe(false)
  })

  it('get_series_by_id maps a single object', async () => {
    const res = await polymarketGetSeriesByIdTool.transformResponse!(
      ok({ id: '1', title: 'Series' })
    )
    expect(res.output.series.title).toBe('Series')
  })

  it('get_orderbook maps bids/asks and last_trade_price', async () => {
    const res = await polymarketGetOrderbookTool.transformResponse!(
      ok({
        market: '0xabc',
        asset_id: 'tok',
        hash: 'h',
        timestamp: '123',
        bids: [{ price: '0.4', size: '10' }],
        asks: [{ price: '0.6', size: '5' }],
        min_order_size: '5',
        tick_size: '0.01',
        neg_risk: false,
        last_trade_price: '0.45',
      })
    )
    expect(res.output.orderbook.bids[0].price).toBe('0.4')
    expect(res.output.orderbook.last_trade_price).toBe('0.45')
  })

  it('get_price coerces numeric price to string and survives a 0 price', async () => {
    const res = await polymarketGetPriceTool.transformResponse!(ok({ price: 0.45 }))
    expect(res.output.price).toBe('0.45')
    const zero = await polymarketGetPriceTool.transformResponse!(ok({ price: 0 }))
    expect(zero.output.price).toBe('0')
  })

  it('get_midpoint reads the live `mid` field', async () => {
    const res = await polymarketGetMidpointTool.transformResponse!(ok({ mid: '0.52' }))
    expect(res.output.midpoint).toBe('0.52')
    // tolerant of the docs-labelled mid_price too
    const alt = await polymarketGetMidpointTool.transformResponse!(ok({ mid_price: '0.33' }))
    expect(alt.output.midpoint).toBe('0.33')
  })

  it('get_price_history maps history entries', async () => {
    const res = await polymarketGetPriceHistoryTool.transformResponse!(
      ok({ history: [{ t: 1700000000, p: 0.5 }] })
    )
    expect(res.output.history[0].t).toBe(1700000000)
    expect(res.output.history[0].p).toBe(0.5)
  })

  it('get_last_trade_price maps price and side', async () => {
    const res = await polymarketGetLastTradePriceTool.transformResponse!(
      ok({ price: '0.45', side: 'BUY' })
    )
    expect(res.output.price).toBe('0.45')
    expect(res.output.side).toBe('BUY')
  })

  it('get_spread maps the spread value', async () => {
    const res = await polymarketGetSpreadTool.transformResponse!(ok({ spread: '0.02' }))
    expect(res.output.spread.spread).toBe('0.02')
  })

  it('get_tick_size reads minimum_tick_size', async () => {
    const res = await polymarketGetTickSizeTool.transformResponse!(ok({ minimum_tick_size: 0.01 }))
    expect(res.output.tickSize).toBe('0.01')
  })

  it('get_positions maps fields with null/empty fallbacks', async () => {
    const res = await polymarketGetPositionsTool.transformResponse!(
      ok([
        {
          proxyWallet: '0xuser',
          asset: 'tok',
          conditionId: '0xabc',
          size: 100,
          avgPrice: 0.4,
          curPrice: 0.5,
          cashPnl: 10,
          negativeRisk: false,
        },
      ])
    )
    expect(res.output.positions[0].proxyWallet).toBe('0xuser')
    expect(res.output.positions[0].curPrice).toBe(0.5)
    expect(res.output.positions[0].title).toBeNull()
  })

  it('get_trades maps trade fields', async () => {
    const res = await polymarketGetTradesTool.transformResponse!(
      ok([
        {
          proxyWallet: '0xuser',
          side: 'BUY',
          asset: 'tok',
          conditionId: '0xabc',
          size: 10,
          price: 0.4,
          timestamp: 1700000000,
        },
      ])
    )
    expect(res.output.trades[0].side).toBe('BUY')
    expect(res.output.trades[0].price).toBe(0.4)
    expect(res.output.trades[0].name).toBeNull()
  })

  it('get_activity maps activity fields', async () => {
    const res = await polymarketGetActivityTool.transformResponse!(
      ok([
        {
          proxyWallet: '0xuser',
          timestamp: 1700000000,
          conditionId: '0xabc',
          type: 'TRADE',
          size: 10,
          usdcSize: 4,
        },
      ])
    )
    expect(res.output.activity[0].type).toBe('TRADE')
    expect(res.output.activity[0].usdcSize).toBe(4)
  })

  it('get_leaderboard maps entries', async () => {
    const res = await polymarketGetLeaderboardTool.transformResponse!(
      ok([
        {
          rank: '1',
          proxyWallet: '0xuser',
          userName: 'whale',
          vol: 1000,
          pnl: 500,
          verifiedBadge: true,
        },
      ])
    )
    expect(res.output.leaderboard[0].userName).toBe('whale')
    expect(res.output.leaderboard[0].verifiedBadge).toBe(true)
  })

  it('get_holders maps holders incl. verified flag', async () => {
    const res = await polymarketGetHoldersTool.transformResponse!(
      ok([
        {
          token: 'tok',
          holders: [
            { proxyWallet: '0xuser', asset: 'tok', amount: 100, outcomeIndex: 0, verified: true },
          ],
        },
      ])
    )
    expect(res.output.holders[0].token).toBe('tok')
    expect(res.output.holders[0].holders[0].amount).toBe(100)
    expect(res.output.holders[0].holders[0].verified).toBe(true)
  })

  it('surfaces API errors via handlePolymarketError', async () => {
    await expect(
      polymarketGetMarketTool.transformResponse!(err({ error: 'not found' }, 404))
    ).rejects.toThrow(/Polymarket API error \(404\)/)
  })
})
