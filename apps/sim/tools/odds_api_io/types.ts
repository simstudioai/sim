import type { ToolResponse } from '@/tools/types'

interface OddsApiIoAuthParams {
  accessToken: string
}

export interface OddsApiIoGetSportsParams extends OddsApiIoAuthParams {}

export interface OddsApiIoGetLeaguesParams extends OddsApiIoAuthParams {
  sport: string
  all?: boolean
}

export interface OddsApiIoGetEventsParams extends OddsApiIoAuthParams {
  sport: string
  league?: string
  status?: string
  from?: string
  to?: string
  bookmaker?: string
  limit?: number
  skip?: number
}

export interface OddsApiIoSearchEventsParams extends OddsApiIoAuthParams {
  query: string
  status?: string
}

export interface OddsApiIoGetEventParams extends OddsApiIoAuthParams {
  eventId: string
}

export interface OddsApiIoGetEventOddsParams extends OddsApiIoAuthParams {
  eventId: string
  bookmakers: string
}

export interface OddsApiIoGetMultiOddsParams extends OddsApiIoAuthParams {
  eventIds: string
  bookmakers: string
}

export interface OddsApiIoGetHistoricalEventsParams extends OddsApiIoAuthParams {
  sport: string
  league: string
  from: string
  to: string
}

export interface OddsApiIoGetClosingLinesParams extends OddsApiIoAuthParams {
  sport: string
  leagues: string
  from: string
  to: string
  markets: string
  bookmakers: string
  limit?: number
  skip?: number
}

export interface OddsApiIoGetValueBetsParams extends OddsApiIoAuthParams {
  bookmaker: string
  sport?: string
  league?: string
  includeEventDetails?: boolean
}

export interface OddsApiIoGetDroppingOddsParams extends OddsApiIoAuthParams {
  sport?: string
  league?: string
  leagues?: string
  markets?: string
  timeWindow?: string
  minDrop?: number
  limit?: number
  page?: number
  includeEventDetails?: boolean
}

export interface OddsApiIoGetArbitrageBetsParams extends OddsApiIoAuthParams {
  bookmakers: string
  limit?: number
  includeEventDetails?: boolean
}

export interface OddsApiIoGetBookmakersParams extends OddsApiIoAuthParams {}

export interface OddsApiIoSport {
  name: string | null
  slug: string | null
}

export interface OddsApiIoLeague {
  name: string | null
  slug: string | null
}

export interface OddsApiIoLeagueSummary extends OddsApiIoLeague {
  eventsCount: number | null
}

export interface OddsApiIoScore {
  home: number | null
  away: number | null
  periods: Record<string, unknown>
}

export interface OddsApiIoEvent {
  id: number | null
  home: string | null
  away: string | null
  homeId: number | null
  awayId: number | null
  date: string | null
  status: string | null
  sport: OddsApiIoSport | null
  league: OddsApiIoLeague | null
  scores: OddsApiIoScore | null
  bookmakerCount: number | null
}

export interface OddsApiIoBookmakerMarket {
  name: string | null
  updatedAt: string | null
  odds: Record<string, unknown>[]
}

export interface OddsApiIoEventOdds extends Omit<OddsApiIoEvent, 'bookmakerCount'> {
  bookmakers: Record<string, OddsApiIoBookmakerMarket[]>
  bookmakerIds: Record<string, string | null>
  urls: Record<string, string | null>
}

export interface OddsApiIoMarket {
  name: string | null
  hdp: number | null
  label: string | null
}

export interface OddsApiIoValueBet {
  id: string | null
  eventId: number | null
  bookmaker: string | null
  betSide: string | null
  expectedValue: number | null
  expectedValueUpdatedAt: string | null
  market: {
    name: string | null
    hdp: number | null
    home: string | null
    draw: string | null
    away: string | null
    max: number | null
  } | null
  bookmakerOdds: {
    home: string | null
    draw: string | null
    away: string | null
    hdp: string | null
    href: string | null
  } | null
  event: {
    home: string | null
    away: string | null
    date: string | null
    sport: string | null
    league: string | null
  } | null
}

export interface OddsApiIoDroppingOdds {
  eventId: number | null
  betSide: string | null
  market: OddsApiIoMarket
  odds: {
    opening: number | null
    current: number | null
    drop: {
      sinceOpening: number | null
      '12h': number | null
      '24h': number | null
      '48h': number | null
    }
  }
  lastMovedAt: number | null
  updatedAt: number | null
  event: {
    home: string | null
    away: string | null
    date: string | null
    sport: OddsApiIoSport | null
    league: OddsApiIoLeague | null
  } | null
}

export interface OddsApiIoArbitrageLeg {
  bookmaker: string | null
  side: string | null
  label: string | null
  odds: string | null
  href: string | null
  directLink: string | null
  bookmakerFixtureId: string | null
}

export interface OddsApiIoOptimalStake {
  bookmaker: string | null
  side: string | null
  stake: number | null
  potentialReturn: number | null
}

export interface OddsApiIoArbitrage {
  id: string | null
  eventId: number | null
  market: OddsApiIoMarket
  profitMargin: number | null
  impliedProbability: number | null
  totalStake: number | null
  legs: OddsApiIoArbitrageLeg[]
  optimalStakes: OddsApiIoOptimalStake[]
  updatedAt: string | null
  event: Record<string, unknown> | null
}

export interface OddsApiIoBookmaker {
  name: string | null
  active: boolean | null
}

export interface OddsApiIoGetSportsResponse extends ToolResponse {
  output: { sports: OddsApiIoSport[] }
}

export interface OddsApiIoGetLeaguesResponse extends ToolResponse {
  output: { leagues: OddsApiIoLeagueSummary[] }
}

export interface OddsApiIoGetEventsResponse extends ToolResponse {
  output: { events: OddsApiIoEvent[] }
}

export interface OddsApiIoSearchEventsResponse extends ToolResponse {
  output: { events: OddsApiIoEvent[] }
}

export interface OddsApiIoGetEventResponse extends ToolResponse {
  output: { event: OddsApiIoEvent }
}

export interface OddsApiIoGetEventOddsResponse extends ToolResponse {
  output: { odds: OddsApiIoEventOdds }
}

export interface OddsApiIoGetMultiOddsResponse extends ToolResponse {
  output: { events: OddsApiIoEventOdds[] }
}

export interface OddsApiIoGetHistoricalEventsResponse extends ToolResponse {
  output: { events: OddsApiIoEvent[] }
}

export interface OddsApiIoGetClosingLinesResponse extends ToolResponse {
  output: { events: OddsApiIoEventOdds[] }
}

export interface OddsApiIoGetValueBetsResponse extends ToolResponse {
  output: { valueBets: OddsApiIoValueBet[] }
}

export interface OddsApiIoGetDroppingOddsResponse extends ToolResponse {
  output: { droppingOdds: OddsApiIoDroppingOdds[] }
}

export interface OddsApiIoGetArbitrageBetsResponse extends ToolResponse {
  output: { arbitrageBets: OddsApiIoArbitrage[] }
}

export interface OddsApiIoGetBookmakersResponse extends ToolResponse {
  output: { bookmakers: OddsApiIoBookmaker[] }
}
