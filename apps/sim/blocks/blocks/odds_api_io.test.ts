import { describe, expect, it } from 'vitest'
import { OddsApiIoBlock } from '@/blocks/blocks/odds_api_io'

const mapParams = OddsApiIoBlock.tools.config?.params
if (!mapParams) throw new Error('Odds-API.io block has no params mapper')

/** Runs the mapper the way an Agent tool call does: its result is spread over the merged args. */
function toolCall(args: Record<string, unknown>, operation: string) {
  return { ...args, ...mapParams(args, { operation }) }
}

/** Runs the mapper the way the canvas does: no context, the block's own operation input. */
function canvas(args: Record<string, unknown>, operation: string) {
  return { ...args, ...mapParams({ ...args, operation }, undefined) }
}

describe('OddsApiIoBlock params mapper', () => {
  it('lets the model pick the search status over the dropdown on a tool call', () => {
    expect(
      toolCall(
        { searchStatus: 'upcoming', status: 'live', query: 'Arsenal' },
        'odds_api_io_search_events'
      )
    ).toMatchObject({ status: 'live' })
    expect(
      toolCall({ searchStatus: 'live', query: 'Arsenal' }, 'odds_api_io_search_events')
    ).toMatchObject({ status: 'live' })
  })

  it('uses the dropdown on the canvas and the free-text status for Get Events', () => {
    expect(
      canvas({ searchStatus: 'live', query: 'Arsenal' }, 'odds_api_io_search_events')
    ).toMatchObject({ status: 'live' })
    expect(
      canvas(
        { searchStatus: 'live', sport: 'football', status: 'pending,live' },
        'odds_api_io_get_events'
      )
    ).toMatchObject({
      status: 'pending,live',
    })
  })

  it('lets the model include inactive leagues when the switch is off', () => {
    expect(toolCall({ sport: 'football', all: true }, 'odds_api_io_get_leagues')).toMatchObject({
      all: true,
    })
    expect(
      toolCall({ sport: 'football', includeInactiveLeagues: false }, 'odds_api_io_get_leagues').all
    ).toBeUndefined()
    expect(
      canvas({ sport: 'football', includeInactiveLeagues: true }, 'odds_api_io_get_leagues')
    ).toMatchObject({ all: true })
    expect(canvas({ sport: 'football', all: true }, 'odds_api_io_get_leagues').all).toBeUndefined()
  })

  it('keeps model-provided filters that share the tool param name', () => {
    expect(
      toolCall(
        {
          sport: 'football',
          timeWindow: '24h',
          minDrop: '12.5',
          limit: '20',
          page: 2,
          includeEventDetails: false,
        },
        'odds_api_io_get_dropping_odds'
      )
    ).toMatchObject({
      timeWindow: '24h',
      minDrop: 12.5,
      limit: 20,
      page: 2,
      includeEventDetails: false,
    })
    expect(toolCall({ bookmaker: 'Bet365' }, 'odds_api_io_get_value_bets')).toMatchObject({
      includeEventDetails: true,
    })
  })

  it('drops fields that do not belong to the operation', () => {
    const result = toolCall({ sport: 'football', limit: '5', page: '3' }, 'odds_api_io_get_events')
    expect(result).toMatchObject({ limit: 5 })
    expect(result.page).toBeUndefined()
    expect(result.searchStatus).toBeUndefined()
    expect(result.includeInactiveLeagues).toBeUndefined()
  })
})
