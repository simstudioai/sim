import type { OutputProperty } from '@/tools/types'

/**
 * Base URL for the shared Sportmonks Odds reference resources (bookmakers and
 * markets). These live under the sport-agnostic `/v3/odds` path.
 * @see https://docs.sportmonks.com/v3/odds-api/getting-started/endpoints/bookmakers/get-all-bookmakers
 * @see https://docs.sportmonks.com/v3/odds-api/getting-started/endpoints/markets/get-all-markets
 */
export const SPORTMONKS_ODDS_BASE_URL = 'https://api.sportmonks.com/v3/odds'

/**
 * Base URL for the Sportmonks football odds feeds (pre-match and in-play odds by
 * fixture). Unlike bookmakers/markets, these endpoints are sport-scoped and live
 * under the `/v3/football/odds` path.
 * @see https://docs.sportmonks.com/v3/odds-api/getting-started/endpoints/pre-match-odds/get-odds-by-fixture-id
 * @see https://docs.sportmonks.com/v3/odds-api/getting-started/endpoints/inplay-odds/get-odds-by-fixture-id
 */
export const SPORTMONKS_FOOTBALL_ODDS_BASE_URL = 'https://api.sportmonks.com/v3/football/odds'

/**
 * Output property definitions for a pre-match Odd object.
 * @see https://docs.sportmonks.com/v3/odds-api/getting-started/entities/odd
 */
export const SPORTMONKS_ODD_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the odd' },
  fixture_id: { type: 'number', description: 'Fixture the odd belongs to' },
  market_id: { type: 'number', description: 'Market the odd belongs to' },
  bookmaker_id: { type: 'number', description: 'Bookmaker offering the odd' },
  label: { type: 'string', description: 'Outcome label (e.g. 1, X, 2)', nullable: true },
  value: { type: 'string', description: 'Decimal odds value', nullable: true },
  name: { type: 'string', description: 'Outcome name (e.g. Home, Draw, Away)', nullable: true },
  sort_order: {
    type: 'number',
    description: 'Sort order of the odd',
    nullable: true,
    optional: true,
  },
  market_description: {
    type: 'string',
    description: 'Description of the market',
    nullable: true,
    optional: true,
  },
  probability: {
    type: 'string',
    description: 'Implied probability (e.g. 48.78%)',
    nullable: true,
    optional: true,
  },
  dp3: {
    type: 'string',
    description: 'Decimal odds to 3 decimal places',
    nullable: true,
    optional: true,
  },
  fractional: {
    type: 'string',
    description: 'Fractional odds (e.g. 31/15)',
    nullable: true,
    optional: true,
  },
  american: {
    type: 'string',
    description: 'American/moneyline odds (e.g. +104)',
    nullable: true,
    optional: true,
  },
  winning: {
    type: 'boolean',
    description: 'Whether this is the winning outcome',
    nullable: true,
    optional: true,
  },
  stopped: {
    type: 'boolean',
    description: 'Whether the odd is stopped',
    nullable: true,
    optional: true,
  },
  total: {
    type: 'string',
    description: 'Total line for over/under markets',
    nullable: true,
    optional: true,
  },
  handicap: {
    type: 'string',
    description: 'Handicap line for handicap markets',
    nullable: true,
    optional: true,
  },
  participants: {
    type: 'string',
    description: 'Participant ids related to the outcome',
    nullable: true,
    optional: true,
  },
  original_label: {
    type: 'string',
    description: 'Original handicap value of the odd (handicap markets)',
    nullable: true,
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for an in-play Odd object.
 * @see https://docs.sportmonks.com/v3/odds-api/getting-started/entities/inplayodd
 */
export const SPORTMONKS_INPLAY_ODD_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the odd' },
  fixture_id: { type: 'number', description: 'Fixture the odd belongs to' },
  external_id: {
    type: 'number',
    description: 'External id of the odd',
    nullable: true,
    optional: true,
  },
  market_id: { type: 'number', description: 'Market the odd belongs to' },
  bookmaker_id: { type: 'number', description: 'Bookmaker offering the odd' },
  label: { type: 'string', description: 'Outcome label (e.g. 1, X, 2)', nullable: true },
  value: { type: 'string', description: 'Decimal odds value', nullable: true },
  name: { type: 'string', description: 'Outcome name', nullable: true },
  sort_order: {
    type: 'number',
    description: 'Sort order of the odd',
    nullable: true,
    optional: true,
  },
  market_description: {
    type: 'string',
    description: 'Description of the market',
    nullable: true,
    optional: true,
  },
  probability: {
    type: 'string',
    description: 'Implied probability',
    nullable: true,
    optional: true,
  },
  dp3: {
    type: 'string',
    description: 'Decimal odds to 3 decimal places',
    nullable: true,
    optional: true,
  },
  fractional: { type: 'string', description: 'Fractional odds', nullable: true, optional: true },
  american: {
    type: 'string',
    description: 'American/moneyline odds',
    nullable: true,
    optional: true,
  },
  winning: {
    type: 'boolean',
    description: 'Whether this is the winning outcome',
    nullable: true,
    optional: true,
  },
  suspended: {
    type: 'boolean',
    description: 'Whether the odd is suspended',
    nullable: true,
    optional: true,
  },
  stopped: {
    type: 'boolean',
    description: 'Whether the odd is stopped',
    nullable: true,
    optional: true,
  },
  total: {
    type: 'string',
    description: 'Total line for over/under markets',
    nullable: true,
    optional: true,
  },
  handicap: {
    type: 'string',
    description: 'Handicap line for handicap markets',
    nullable: true,
    optional: true,
  },
  participants: {
    type: 'string',
    description: 'Participant ids related to the outcome',
    nullable: true,
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Premium Odd object. Premium odds carry
 * created/updated timestamps and do not yet expose winning calculations.
 * @see https://docs.sportmonks.com/v3/endpoints-and-entities/endpoints/premium-odds-feed/premium-pre-match-odds/get-all-premium-odds
 */
export const SPORTMONKS_PREMIUM_ODD_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the odd' },
  fixture_id: { type: 'number', description: 'Fixture the odd belongs to' },
  market_id: { type: 'number', description: 'Market the odd belongs to' },
  bookmaker_id: { type: 'number', description: 'Bookmaker offering the odd' },
  label: { type: 'string', description: 'Outcome label', nullable: true },
  value: { type: 'string', description: 'Decimal odds value', nullable: true },
  name: { type: 'string', description: 'Outcome name', nullable: true },
  sort_order: {
    type: 'number',
    description: 'Sort order of the odd',
    nullable: true,
    optional: true,
  },
  market_description: {
    type: 'string',
    description: 'Description of the market',
    nullable: true,
    optional: true,
  },
  probability: {
    type: 'string',
    description: 'Implied probability (e.g. 29.85%)',
    nullable: true,
    optional: true,
  },
  dp3: {
    type: 'string',
    description: 'Decimal odds to 3 decimal places',
    nullable: true,
    optional: true,
  },
  fractional: { type: 'string', description: 'Fractional odds', nullable: true, optional: true },
  american: {
    type: 'string',
    description: 'American/moneyline odds',
    nullable: true,
    optional: true,
  },
  stopped: {
    type: 'boolean',
    description: 'Whether the odd is stopped',
    nullable: true,
    optional: true,
  },
  total: {
    type: 'string',
    description: 'Total line for over/under markets',
    nullable: true,
    optional: true,
  },
  handicap: {
    type: 'string',
    description: 'Handicap line for handicap markets',
    nullable: true,
    optional: true,
  },
  created_at: {
    type: 'string',
    description: 'Timestamp the odd was created (UTC)',
    nullable: true,
    optional: true,
  },
  updated_at: {
    type: 'string',
    description: 'Timestamp the odd was last updated (UTC)',
    nullable: true,
    optional: true,
  },
  latest_bookmaker_update: {
    type: 'string',
    description: "Bookmaker's own last-update timestamp (UTC)",
    nullable: true,
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Premium Odd history record. Each record is a
 * historical value of a premium odd referenced by `odd_id`.
 * @see https://docs.sportmonks.com/v3/endpoints-and-entities/endpoints/premium-odds-feed/premium-pre-match-odds/get-all-historical-odds
 */
export const SPORTMONKS_PREMIUM_ODD_HISTORY_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the history record' },
  odd_id: { type: 'number', description: 'Premium odd this history record belongs to' },
  value: {
    type: 'string',
    description: 'Historical decimal odds value',
    nullable: true,
    optional: true,
  },
  probability: {
    type: 'string',
    description: 'Implied probability at this point in time',
    nullable: true,
    optional: true,
  },
  dp3: {
    type: 'string',
    description: 'Decimal odds to 3 decimal places',
    nullable: true,
    optional: true,
  },
  fractional: { type: 'string', description: 'Fractional odds', nullable: true, optional: true },
  american: {
    type: 'string',
    description: 'American/moneyline odds',
    nullable: true,
    optional: true,
  },
  bookmaker_update: {
    type: 'string',
    description: "Bookmaker's update timestamp for this record (UTC)",
    nullable: true,
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Bookmaker object.
 * @see https://docs.sportmonks.com/v3/odds-api/getting-started/entities/bookmaker
 */
export const SPORTMONKS_BOOKMAKER_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the bookmaker' },
  name: { type: 'string', description: 'Name of the bookmaker' },
  logo: { type: 'string', description: 'Logo of the bookmaker', nullable: true, optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a bookmaker event mapping record, returned by
 * the "bookmaker event ids by fixture" endpoint. Maps a Sportmonks fixture to a
 * bookmaker's own event id.
 * @see https://docs.sportmonks.com/v3/odds-api/getting-started/endpoints/bookmakers/get-bookmaker-event-ids-by-fixture-id
 */
export const SPORTMONKS_BOOKMAKER_EVENT_PROPERTIES = {
  fixture_id: { type: 'number', description: 'Sportmonks fixture id' },
  bookmaker_id: { type: 'number', description: 'Id of the bookmaker' },
  bookmaker_name: {
    type: 'string',
    description: 'Name of the bookmaker',
    nullable: true,
    optional: true,
  },
  bookmaker_event_id: {
    type: 'string',
    description: "The fixture's event id at the bookmaker",
    nullable: true,
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Market object.
 * @see https://docs.sportmonks.com/v3/odds-api/getting-started/entities/market
 */
export const SPORTMONKS_MARKET_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the market' },
  name: { type: 'string', description: 'Name of the market' },
  developer_name: {
    type: 'string',
    description: 'Developer (machine-readable) name of the market',
    nullable: true,
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export interface SportmonksOdd {
  id: number
  fixture_id: number
  market_id: number
  bookmaker_id: number
  label: string | null
  value: string | null
  name: string | null
  sort_order?: number | null
  market_description?: string | null
  probability?: string | null
  dp3?: string | null
  fractional?: string | null
  american?: string | null
  winning?: boolean | null
  stopped?: boolean | null
  total?: string | null
  handicap?: string | null
  participants?: string | null
  original_label?: string | null
}

export interface SportmonksInplayOdd extends SportmonksOdd {
  external_id?: number | null
  suspended?: boolean | null
}

export interface SportmonksPremiumOdd {
  id: number
  fixture_id: number
  market_id: number
  bookmaker_id: number
  label: string | null
  value: string | null
  name: string | null
  sort_order?: number | null
  market_description?: string | null
  probability?: string | null
  dp3?: string | null
  fractional?: string | null
  american?: string | null
  stopped?: boolean | null
  total?: string | null
  handicap?: string | null
  created_at?: string | null
  updated_at?: string | null
  latest_bookmaker_update?: string | null
}

export interface SportmonksPremiumOddHistory {
  id: number
  odd_id: number
  value?: string | null
  probability?: string | null
  dp3?: string | null
  fractional?: string | null
  american?: string | null
  bookmaker_update?: string | null
}

export interface SportmonksBookmaker {
  id: number
  name: string
  logo?: string | null
}

export interface SportmonksBookmakerEvent {
  fixture_id: number
  bookmaker_id: number
  bookmaker_name?: string | null
  bookmaker_event_id?: string | null
}

export interface SportmonksMarket {
  id: number
  name: string
  developer_name?: string | null
}
