import { toArray, toRecord } from '@sim/utils/object'
import type {
  OddsApiIoBookmakerMarket,
  OddsApiIoEvent,
  OddsApiIoEventOdds,
  OddsApiIoLeague,
  OddsApiIoMarket,
  OddsApiIoScore,
  OddsApiIoSport,
} from '@/tools/odds_api_io/types'
import type { OutputProperty, ToolConfig } from '@/tools/types'

export const ODDS_API_IO_BASE_URL = 'https://api.odds-api.io/v3'

export const oddsApiIoAuthParams = {
  accessToken: {
    type: 'string',
    required: true,
    visibility: 'hidden',
    description: 'Odds-API.io API key resolved from the selected credential',
  },
} as const satisfies ToolConfig['params']

export const oddsApiIoOAuth = {
  required: true,
  provider: 'odds_api_io',
  credentialKind: 'service-account',
} as const

type QueryValue = string | number | boolean | null | undefined

/**
 * Builds an absolute Odds-API.io URL. The API authenticates with the `apiKey` query parameter;
 * empty query values are skipped so optional filters never reach the API as `?league=`.
 */
export function oddsApiIoUrl(
  path: string,
  apiKey: string | undefined,
  query: Record<string, QueryValue> = {}
): string {
  const url = new URL(`${ODDS_API_IO_BASE_URL}${path}`)
  if (apiKey) url.searchParams.set('apiKey', apiKey.trim())
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    const text = typeof value === 'string' ? value.trim() : String(value)
    if (text === '') continue
    url.searchParams.set(key, text)
  }
  return url.toString()
}

export function oddsApiIoHeaders(): Record<string, string> {
  return { Accept: 'application/json' }
}

/** Normalises a comma-separated list typed with spaces (`Bet365, Unibet`) to the API's `Bet365,Unibet`. */
export function commaList(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item).trim()).filter(Boolean)
    return items.length > 0 ? items.join(',') : undefined
  }
  if (typeof value !== 'string') return undefined
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return items.length > 0 ? items.join(',') : undefined
}

export async function readOddsApiIoJson(response: Response, action: string): Promise<unknown> {
  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  if (!response.ok) {
    const message =
      typeof toRecord(data).error === 'string'
        ? (toRecord(data).error as string)
        : `Odds-API.io ${action} failed with status ${response.status}`
    throw new Error(message)
  }
  return data
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export { numberOrNull, stringOrNull }

function mapNamed(value: unknown): OddsApiIoSport | OddsApiIoLeague | null {
  const record = toRecord(value)
  if (typeof record.name !== 'string' && typeof record.slug !== 'string') return null
  return { name: stringOrNull(record.name), slug: stringOrNull(record.slug) }
}

export function mapScore(value: unknown): OddsApiIoScore | null {
  const record = toRecord(value)
  if (record.home === undefined && record.away === undefined) return null
  return {
    home: numberOrNull(record.home),
    away: numberOrNull(record.away),
    periods: toRecord(record.periods),
  }
}

export function mapEvent(value: unknown): OddsApiIoEvent {
  const record = toRecord(value)
  return {
    id: numberOrNull(record.id),
    home: stringOrNull(record.home),
    away: stringOrNull(record.away),
    homeId: numberOrNull(record.homeId),
    awayId: numberOrNull(record.awayId),
    date: stringOrNull(record.date),
    status: stringOrNull(record.status),
    sport: mapNamed(record.sport),
    league: mapNamed(record.league),
    scores: mapScore(record.scores),
    bookmakerCount: numberOrNull(record.bookmakerCount),
  }
}

export function mapMarket(value: unknown): OddsApiIoMarket {
  const record = toRecord(value)
  return {
    name: stringOrNull(record.name),
    hdp: numberOrNull(record.hdp),
    label: stringOrNull(record.label),
  }
}

function mapBookmakerMarkets(value: unknown): OddsApiIoBookmakerMarket[] {
  return toArray(value).map((market) => {
    const record = toRecord(market)
    return {
      name: stringOrNull(record.name),
      updatedAt: stringOrNull(record.updatedAt),
      odds: toArray(record.odds).map((line) => toRecord(line)),
    }
  })
}

export function mapEventOdds(value: unknown): OddsApiIoEventOdds {
  const record = toRecord(value)
  const bookmakers: Record<string, OddsApiIoBookmakerMarket[]> = {}
  for (const [bookmaker, markets] of Object.entries(toRecord(record.bookmakers))) {
    bookmakers[bookmaker] = mapBookmakerMarkets(markets)
  }
  return {
    id: numberOrNull(record.id),
    home: stringOrNull(record.home),
    away: stringOrNull(record.away),
    homeId: numberOrNull(record.homeId),
    awayId: numberOrNull(record.awayId),
    date: stringOrNull(record.date),
    status: stringOrNull(record.status),
    sport: mapNamed(record.sport),
    league: mapNamed(record.league),
    scores: mapScore(record.scores),
    bookmakers,
    bookmakerIds: Object.fromEntries(
      Object.entries(toRecord(record.bookmakerIds)).map(([name, id]) => [name, stringOrNull(id)])
    ),
    urls: Object.fromEntries(
      Object.entries(toRecord(record.urls)).map(([name, url]) => [name, stringOrNull(url)])
    ),
  }
}

export const NAMED_PROPERTIES: Record<string, OutputProperty> = {
  name: { type: 'string', description: 'Display name', nullable: true },
  slug: { type: 'string', description: 'Slug used in API filters', nullable: true },
}

export const SCORE_PROPERTIES: Record<string, OutputProperty> = {
  home: { type: 'number', description: 'Home score', nullable: true },
  away: { type: 'number', description: 'Away score', nullable: true },
  periods: { type: 'json', description: 'Score per period, keyed by period name' },
}

const BASE_EVENT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'number', description: 'Event ID', nullable: true },
  home: { type: 'string', description: 'Home team or player', nullable: true },
  away: { type: 'string', description: 'Away team or player', nullable: true },
  homeId: { type: 'number', description: 'Home participant ID', nullable: true },
  awayId: { type: 'number', description: 'Away participant ID', nullable: true },
  date: { type: 'string', description: 'Scheduled start in ISO 8601 (UTC)', nullable: true },
  status: {
    type: 'string',
    description: 'Event status (pending, live, settled, cancelled, postponed)',
    nullable: true,
  },
  sport: { type: 'object', description: 'Sport', nullable: true, properties: NAMED_PROPERTIES },
  league: { type: 'object', description: 'League', nullable: true, properties: NAMED_PROPERTIES },
  scores: {
    type: 'object',
    description: 'Scores (live and settled events)',
    nullable: true,
    properties: SCORE_PROPERTIES,
  },
}

export const EVENT_PROPERTIES: Record<string, OutputProperty> = {
  ...BASE_EVENT_PROPERTIES,
  bookmakerCount: {
    type: 'number',
    description: 'Number of bookmakers with odds for the event',
    nullable: true,
  },
}

export const MARKET_PROPERTIES: Record<string, OutputProperty> = {
  name: { type: 'string', description: 'Market name (e.g. ML, Spread, Totals)', nullable: true },
  hdp: {
    type: 'number',
    description: 'Handicap or total line, when the market has one',
    nullable: true,
  },
  label: { type: 'string', description: 'Player name for player prop markets', nullable: true },
}

export const EVENT_ODDS_PROPERTIES: Record<string, OutputProperty> = {
  ...BASE_EVENT_PROPERTIES,
  bookmakers: {
    type: 'json',
    description:
      'Markets per bookmaker name. Each market has name, updatedAt and odds, a list of lines with decimal prices (home/draw/away, over/under, yes/no or label + odds) and hdp',
  },
  bookmakerIds: {
    type: 'json',
    description: 'The event ID each bookmaker uses, keyed by bookmaker name',
  },
  urls: { type: 'json', description: 'Event page URL per bookmaker, keyed by bookmaker name' },
}
