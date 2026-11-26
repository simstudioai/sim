import { OddsApiIoIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import {
  isToolCall,
  mapperOperation,
  parseOptionalBooleanInput,
  parseOptionalNumberInput,
} from '@/blocks/utils'

const GET_SPORTS = 'odds_api_io_get_sports'
const GET_LEAGUES = 'odds_api_io_get_leagues'
const GET_EVENTS = 'odds_api_io_get_events'
const SEARCH_EVENTS = 'odds_api_io_search_events'
const GET_EVENT = 'odds_api_io_get_event'
const GET_EVENT_ODDS = 'odds_api_io_get_event_odds'
const GET_MULTI_ODDS = 'odds_api_io_get_multi_odds'
const GET_HISTORICAL_EVENTS = 'odds_api_io_get_historical_events'
const GET_CLOSING_LINES = 'odds_api_io_get_closing_lines'
const GET_VALUE_BETS = 'odds_api_io_get_value_bets'
const GET_DROPPING_ODDS = 'odds_api_io_get_dropping_odds'
const GET_ARBITRAGE_BETS = 'odds_api_io_get_arbitrage_bets'
const GET_BOOKMAKERS = 'odds_api_io_get_bookmakers'

const SPORT_OPERATIONS = [
  GET_LEAGUES,
  GET_EVENTS,
  GET_HISTORICAL_EVENTS,
  GET_CLOSING_LINES,
  GET_VALUE_BETS,
  GET_DROPPING_ODDS,
]
const SPORT_REQUIRED_OPERATIONS = [
  GET_LEAGUES,
  GET_EVENTS,
  GET_HISTORICAL_EVENTS,
  GET_CLOSING_LINES,
]
const LEAGUE_OPERATIONS = [GET_EVENTS, GET_HISTORICAL_EVENTS, GET_VALUE_BETS, GET_DROPPING_ODDS]
const LEAGUES_OPERATIONS = [GET_CLOSING_LINES, GET_DROPPING_ODDS]
const DATE_RANGE_OPERATIONS = [GET_EVENTS, GET_HISTORICAL_EVENTS, GET_CLOSING_LINES]
const DATE_RANGE_REQUIRED_OPERATIONS = [GET_HISTORICAL_EVENTS, GET_CLOSING_LINES]
const BOOKMAKER_OPERATIONS = [GET_EVENTS, GET_VALUE_BETS]
const BOOKMAKERS_OPERATIONS = [
  GET_EVENT_ODDS,
  GET_MULTI_ODDS,
  GET_CLOSING_LINES,
  GET_ARBITRAGE_BETS,
]
const EVENT_ID_OPERATIONS = [GET_EVENT, GET_EVENT_ODDS]
const MARKETS_OPERATIONS = [GET_CLOSING_LINES, GET_DROPPING_ODDS]
const LIMIT_OPERATIONS = [GET_EVENTS, GET_CLOSING_LINES, GET_DROPPING_ODDS, GET_ARBITRAGE_BETS]
const SKIP_OPERATIONS = [GET_EVENTS, GET_CLOSING_LINES]
const EVENT_DETAILS_OPERATIONS = [GET_VALUE_BETS, GET_DROPPING_ODDS, GET_ARBITRAGE_BETS]

const DATE_WAND_CONFIG = {
  enabled: true,
  prompt:
    'Generate an RFC 3339 UTC timestamp (e.g. 2026-11-28T00:00:00Z) from the description. Return ONLY the timestamp string.',
  placeholder: 'Describe the moment (e.g. "start of today", "next Monday")...',
  generationType: 'timestamp' as const,
}

export const OddsApiIoBlock: BlockConfig = {
  type: 'odds_api_io',
  name: 'Odds-API.io',
  description: 'Sports odds from 500+ bookmakers across 37 sports',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Pre-match and live sports odds from 500+ bookmakers across 37 sports. List sports, leagues and events, fetch odds for one or many events, pull historical results and closing lines, and run the value-bet, dropping-odds and arbitrage scanners.',
  docsLink: 'https://docs.sim.ai/integrations/odds_api_io',
  category: 'tools',
  integrationType: IntegrationType.Analytics,
  bgColor: '#C964CF',
  icon: OddsApiIoIcon,
  canvasPresentation: {
    defaultTitle: 'Odds-API.io',
    sentences: {
      byOperation: {
        [GET_SPORTS]: ['List sports'],
        [GET_LEAGUES]: [{ text: 'List leagues in', field: 'sport', core: true }],
        [GET_EVENTS]: [
          { text: 'List events in', field: 'sport', core: true },
          { text: 'for', field: 'league' },
        ],
        [SEARCH_EVENTS]: [{ text: 'Search events for', field: 'query', core: true }],
        [GET_EVENT]: [{ text: 'Read', field: 'eventId', core: true }],
        [GET_EVENT_ODDS]: [
          { text: 'Get odds for', field: 'eventId', core: true },
          { text: 'from', field: 'bookmakers' },
        ],
        [GET_MULTI_ODDS]: [
          { text: 'Get odds for', field: 'eventIds', core: true },
          { text: 'from', field: 'bookmakers' },
        ],
        [GET_HISTORICAL_EVENTS]: [{ text: 'List finished events in', field: 'league', core: true }],
        [GET_CLOSING_LINES]: [{ text: 'Get closing lines for', field: 'leagues', core: true }],
        [GET_VALUE_BETS]: [{ text: 'Find value bets at', field: 'bookmaker', core: true }],
        [GET_DROPPING_ODDS]: ['Find dropping odds', { text: 'in', field: 'sport' }],
        [GET_ARBITRAGE_BETS]: [{ text: 'Find arbitrage across', field: 'bookmakers', core: true }],
        [GET_BOOKMAKERS]: ['List bookmakers'],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Events', id: GET_EVENTS },
        { label: 'Search Events', id: SEARCH_EVENTS },
        { label: 'Get Event', id: GET_EVENT },
        { label: 'Get Event Odds', id: GET_EVENT_ODDS },
        { label: 'Get Multi Odds', id: GET_MULTI_ODDS },
        { label: 'Get Value Bets', id: GET_VALUE_BETS },
        { label: 'Get Dropping Odds', id: GET_DROPPING_ODDS },
        { label: 'Get Arbitrage Bets', id: GET_ARBITRAGE_BETS },
        { label: 'Get Historical Events', id: GET_HISTORICAL_EVENTS },
        { label: 'Get Closing Lines', id: GET_CLOSING_LINES },
        { label: 'Get Sports', id: GET_SPORTS },
        { label: 'Get Leagues', id: GET_LEAGUES },
        { label: 'Get Bookmakers', id: GET_BOOKMAKERS },
      ],
      value: () => GET_EVENTS,
    },
    {
      id: 'credential',
      title: 'Odds-API.io Account',
      type: 'oauth-input',
      serviceId: 'odds_api_io',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      placeholder: 'Select Odds-API.io credential',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Odds-API.io Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'query',
      title: 'Search',
      type: 'short-input',
      condition: { field: 'operation', value: SEARCH_EVENTS },
      placeholder: 'Team or league name (e.g. Arsenal)',
      required: true,
      canvasNoun: 'a team or league',
    },
    {
      id: 'searchStatus',
      title: 'Search In',
      type: 'dropdown',
      condition: { field: 'operation', value: SEARCH_EVENTS },
      options: [
        { label: 'Upcoming events', id: 'upcoming' },
        { label: 'Live events', id: 'live' },
      ],
      value: () => 'upcoming',
    },
    {
      id: 'eventId',
      title: 'Event ID',
      type: 'short-input',
      condition: { field: 'operation', value: EVENT_ID_OPERATIONS },
      placeholder: 'Event ID from Get Events or Search Events',
      required: true,
      canvasNoun: 'an event',
    },
    {
      id: 'eventIds',
      title: 'Event IDs',
      type: 'short-input',
      condition: { field: 'operation', value: GET_MULTI_ODDS },
      placeholder: 'Comma-separated event IDs, up to 10',
      required: true,
      canvasNoun: 'events',
    },
    {
      id: 'sport',
      title: 'Sport',
      type: 'short-input',
      condition: { field: 'operation', value: SPORT_OPERATIONS },
      required: { field: 'operation', value: SPORT_REQUIRED_OPERATIONS },
      placeholder: 'Sport slug (e.g. football)',
    },
    {
      id: 'league',
      title: 'League',
      type: 'short-input',
      condition: { field: 'operation', value: LEAGUE_OPERATIONS },
      required: { field: 'operation', value: GET_HISTORICAL_EVENTS },
      placeholder: 'League slug (e.g. england-premier-league)',
    },
    {
      id: 'leagues',
      title: 'Leagues',
      type: 'short-input',
      condition: { field: 'operation', value: LEAGUES_OPERATIONS },
      required: { field: 'operation', value: GET_CLOSING_LINES },
      placeholder: 'Comma-separated league slugs, up to 10',
    },
    {
      id: 'bookmaker',
      title: 'Bookmaker',
      type: 'short-input',
      condition: { field: 'operation', value: BOOKMAKER_OPERATIONS },
      required: { field: 'operation', value: GET_VALUE_BETS },
      placeholder: 'Bookmaker name (e.g. Bet365)',
    },
    {
      id: 'bookmakers',
      title: 'Bookmakers',
      type: 'short-input',
      condition: { field: 'operation', value: BOOKMAKERS_OPERATIONS },
      placeholder: 'Comma-separated bookmaker names (e.g. Bet365,Unibet)',
      required: true,
    },
    {
      id: 'markets',
      title: 'Markets',
      type: 'short-input',
      condition: { field: 'operation', value: MARKETS_OPERATIONS },
      required: { field: 'operation', value: GET_CLOSING_LINES },
      placeholder: 'Comma-separated market names (e.g. ML,Spread,Totals)',
    },
    {
      id: 'status',
      title: 'Status',
      type: 'short-input',
      condition: { field: 'operation', value: GET_EVENTS },
      placeholder: 'Comma-separated statuses (e.g. pending,live)',
      mode: 'advanced',
    },
    {
      id: 'from',
      title: 'From',
      type: 'short-input',
      condition: { field: 'operation', value: DATE_RANGE_OPERATIONS },
      required: { field: 'operation', value: DATE_RANGE_REQUIRED_OPERATIONS },
      placeholder: '2026-11-28T00:00:00Z',
      wandConfig: DATE_WAND_CONFIG,
    },
    {
      id: 'to',
      title: 'To',
      type: 'short-input',
      condition: { field: 'operation', value: DATE_RANGE_OPERATIONS },
      required: { field: 'operation', value: DATE_RANGE_REQUIRED_OPERATIONS },
      placeholder: '2026-11-30T23:59:59Z (defaults to 14 days ahead for events)',
      wandConfig: DATE_WAND_CONFIG,
    },
    {
      id: 'timeWindow',
      title: 'Time Window',
      type: 'dropdown',
      condition: { field: 'operation', value: GET_DROPPING_ODDS },
      options: [
        { label: 'Since opening', id: 'opening' },
        { label: 'Last 12 hours', id: '12h' },
        { label: 'Last 24 hours', id: '24h' },
        { label: 'Last 48 hours', id: '48h' },
      ],
      value: () => 'opening',
    },
    {
      id: 'minDrop',
      title: 'Minimum Drop (%)',
      type: 'short-input',
      condition: { field: 'operation', value: GET_DROPPING_ODDS },
      placeholder: 'Defaults to 0',
      mode: 'advanced',
    },
    {
      id: 'includeEventDetails',
      title: 'Include Event Details',
      type: 'switch',
      condition: { field: 'operation', value: EVENT_DETAILS_OPERATIONS },
      defaultValue: true,
    },
    {
      id: 'includeInactiveLeagues',
      title: 'Include Leagues Without Events',
      type: 'switch',
      condition: { field: 'operation', value: GET_LEAGUES },
      defaultValue: false,
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      condition: { field: 'operation', value: LIMIT_OPERATIONS },
      placeholder: 'Defaults to the API default (50 for scanners)',
      mode: 'advanced',
    },
    {
      id: 'skip',
      title: 'Skip',
      type: 'short-input',
      condition: { field: 'operation', value: SKIP_OPERATIONS },
      placeholder: 'Defaults to 0',
      mode: 'advanced',
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      condition: { field: 'operation', value: GET_DROPPING_ODDS },
      placeholder: 'Defaults to 1',
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      GET_SPORTS,
      GET_LEAGUES,
      GET_EVENTS,
      SEARCH_EVENTS,
      GET_EVENT,
      GET_EVENT_ODDS,
      GET_MULTI_ODDS,
      GET_HISTORICAL_EVENTS,
      GET_CLOSING_LINES,
      GET_VALUE_BETS,
      GET_DROPPING_ODDS,
      GET_ARBITRAGE_BETS,
      GET_BOOKMAKERS,
    ],
    config: {
      tool: (params) => params.operation,
      params: (params, context) => {
        const operation = mapperOperation(params, context)
        const { searchStatus, includeInactiveLeagues, ...rest } = params
        // The dropdown and switch always hold a value, so on a tool call the model's own
        // `status` / `all` argument wins and the canvas field only fills in when it gave none.
        const modelArg = (value: unknown) => (isToolCall(context) ? value : undefined)
        return {
          ...rest,
          status:
            operation === SEARCH_EVENTS ? (modelArg(params.status) ?? searchStatus) : params.status,
          all:
            operation === GET_LEAGUES
              ? (modelArg(parseOptionalBooleanInput(params.all)) ??
                (includeInactiveLeagues === true ? true : undefined))
              : undefined,
          includeEventDetails: EVENT_DETAILS_OPERATIONS.includes(operation)
            ? (parseOptionalBooleanInput(params.includeEventDetails) ?? true)
            : undefined,
          minDrop:
            operation === GET_DROPPING_ODDS
              ? parseOptionalNumberInput(params.minDrop, 'Minimum Drop', { min: 0 })
              : undefined,
          limit: LIMIT_OPERATIONS.includes(operation)
            ? parseOptionalNumberInput(params.limit, 'Limit', { integer: true, min: 1 })
            : undefined,
          skip: SKIP_OPERATIONS.includes(operation)
            ? parseOptionalNumberInput(params.skip, 'Skip', { integer: true, min: 0 })
            : undefined,
          page:
            operation === GET_DROPPING_ODDS
              ? parseOptionalNumberInput(params.page, 'Page', { integer: true, min: 1 })
              : undefined,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Saved Odds-API.io API-key credential ID' },
    query: { type: 'string', description: 'Team or league name to search for' },
    searchStatus: { type: 'string', description: 'Search upcoming or live events' },
    eventId: { type: 'string', description: 'Event ID' },
    eventIds: { type: 'string', description: 'Comma-separated event IDs' },
    sport: { type: 'string', description: 'Sport slug' },
    league: { type: 'string', description: 'League slug' },
    leagues: { type: 'string', description: 'Comma-separated league slugs' },
    bookmaker: { type: 'string', description: 'Bookmaker name' },
    bookmakers: { type: 'string', description: 'Comma-separated bookmaker names' },
    markets: { type: 'string', description: 'Comma-separated market names' },
    status: { type: 'string', description: 'Comma-separated event statuses' },
    from: { type: 'string', description: 'Start of the date range (RFC 3339)' },
    to: { type: 'string', description: 'End of the date range (RFC 3339)' },
    timeWindow: { type: 'string', description: 'Window the odds drop is measured over' },
    minDrop: { type: 'number', description: 'Minimum drop in percent' },
    includeEventDetails: { type: 'boolean', description: 'Include event details' },
    includeInactiveLeagues: { type: 'boolean', description: 'Include leagues without events' },
    limit: { type: 'number', description: 'Maximum number of results' },
    skip: { type: 'number', description: 'Number of results to skip' },
    page: { type: 'number', description: 'Page number' },
  },
  outputs: {
    sports: { type: 'array', description: 'Sports (name, slug)' },
    leagues: { type: 'array', description: 'Leagues (name, slug, eventsCount)' },
    events: {
      type: 'array',
      description:
        'Events (id, home, away, date, status, sport, league, scores) or, for odds operations, events with their odds per bookmaker',
    },
    event: {
      type: 'json',
      description: 'Event (id, home, away, homeId, awayId, date, status, sport, league, scores)',
    },
    odds: {
      type: 'json',
      description: 'Event with its markets per bookmaker (bookmakers, bookmakerIds, urls)',
    },
    valueBets: {
      type: 'array',
      description:
        'Value bets (eventId, bookmaker, betSide, expectedValue, market, bookmakerOdds, event)',
    },
    droppingOdds: {
      type: 'array',
      description:
        'Dropping odds (eventId, betSide, market, odds.opening, odds.current, odds.drop, event)',
    },
    arbitrageBets: {
      type: 'array',
      description:
        'Arbitrage opportunities (eventId, market, profitMargin, legs, optimalStakes, event)',
    },
    bookmakers: { type: 'array', description: 'Bookmakers (name, active)' },
  },
}

export const OddsApiIoBlockMeta = {
  tags: ['data-analytics', 'automation', 'monitoring'],
  url: 'https://odds-api.io',
  templates: [
    {
      icon: OddsApiIoIcon,
      title: 'Odds-API.io line movement alerts',
      prompt:
        'Build a scheduled workflow that runs every 10 minutes, gets dropping odds for football over the last 12 hours with a minimum drop of 10%, filters out events already posted (tracked in a Sim table), and posts each new drop with teams, market, opening and current odds to a Discord channel.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'automation'],
      featured: true,
      alsoIntegrations: ['discord'],
    },
    {
      icon: OddsApiIoIcon,
      title: 'Odds-API.io value bet digest',
      prompt:
        'Create a scheduled workflow that pulls value bets for Bet365 with event details every hour, keeps selections with an expected value above 3%, has an agent write a short note per selection, and emails the digest through Gmail.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: OddsApiIoIcon,
      title: 'Odds-API.io odds comparison sheet',
      prompt:
        "Build a workflow that lists this weekend's Premier League events, fetches odds for them from Bet365, Unibet and Betfair ten events at a time with Get Multi Odds, and writes the best moneyline price per outcome and the bookmaker offering it to a Google Sheet.",
      modules: ['workflows'],
      category: 'productivity',
      tags: ['spreadsheet', 'automation'],
      alsoIntegrations: ['google_sheets'],
    },
    {
      icon: OddsApiIoIcon,
      title: 'Odds-API.io closing line archive',
      prompt:
        'Create a weekly scheduled workflow that fetches the closing lines for the last seven days of NBA games from DraftKings and FanDuel for the ML, Spread and Totals markets, paginates through every page, and appends one row per event, bookmaker and market to a Sim table for closing line value analysis.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'engineering',
      tags: ['data-analytics', 'automation'],
    },
    {
      icon: OddsApiIoIcon,
      title: 'Odds-API.io arbitrage watcher',
      prompt:
        'Build a scheduled workflow that checks for arbitrage opportunities across Betfair, Unibet and 1xBet every five minutes, skips opportunities already seen using a Sim table keyed by the opportunity ID, and sends new ones with the legs, odds and stake split to a Slack channel.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: OddsApiIoIcon,
      title: 'Odds-API.io match preview agent',
      prompt:
        'Create a chat workflow where a user names a fixture, an agent searches Odds-API.io events for it, fetches the odds from three bookmakers, and replies with a preview that explains the implied probabilities and where the prices differ most.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['agentic'],
    },
    {
      icon: OddsApiIoIcon,
      title: 'Odds-API.io results settlement',
      prompt:
        'Build a daily scheduled workflow that reads the fixtures a Sim table marks as open, gets each event by ID, writes the final scores and status back once the event is settled, and posts a summary of settled fixtures to Microsoft Teams.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['automation'],
      alsoIntegrations: ['microsoft_teams'],
    },
  ],
  skills: [
    {
      name: 'compare-odds-across-bookmakers',
      description:
        'Find an event and compare its current odds across several bookmakers to spot the best price per outcome.',
      content:
        '# Compare Odds Across Bookmakers\n\nFind the best available price for each outcome of an event.\n\n## Steps\n1. Use Get Bookmakers once to confirm the exact bookmaker names, and Get Sports or Get Leagues for the slugs.\n2. Find the event with Search Events (team or league name) or Get Events (sport, league, date range).\n3. Call Get Event Odds with the event ID and up to 30 bookmakers, or Get Multi Odds for up to 10 events at once.\n4. Read the ML, Spread and Totals markets per bookmaker; each line carries decimal prices and the handicap or total.\n5. Pick the highest price per outcome and note the bookmaker offering it.\n\n## Output\nA table of outcomes with the best price and bookmaker, plus the spread between the best and worst price.\n\nReference: https://docs.odds-api.io',
    },
    {
      name: 'track-dropping-odds',
      description:
        'Monitor significant odds drops in a sport or league and report the market moves that matter.',
      content:
        '# Track Dropping Odds\n\nSurface the selections whose price has shortened the most.\n\n## Steps\n1. Call Get Dropping Odds with a sport (and optionally leagues and markets).\n2. Choose the time window: since opening, or the last 12, 24 or 48 hours; set a minimum drop in percent to cut noise.\n3. Enable Include Event Details so every entry carries the teams, date and league.\n4. Compare opening and current odds and keep the entries whose drop exceeds your threshold.\n5. Store the event ID and bet side you have already reported so repeated runs only report new moves.\n\n## Output\nA list of market moves with teams, market, side, opening odds, current odds and drop percentage.\n\nReference: https://docs.odds-api.io',
    },
    {
      name: 'build-closing-line-dataset',
      description:
        'Collect closing odds and final scores for a league over a season for closing line value analysis.',
      content:
        '# Build a Closing Line Dataset\n\nAssemble the closing prices and results for every settled event in a league.\n\n## Steps\n1. Use Get Leagues to find the league slugs for the sport.\n2. Call Get Closing Lines with the sport, up to 10 league slugs, a date range of up to 366 days, the markets (e.g. ML,Spread,Totals) and up to 30 bookmakers.\n3. Page through the results with Limit and Skip; each page returns at most 100 events.\n4. For each event record the final scores and, per bookmaker and market, the closing line and prices.\n5. Use Get Historical Events when you only need results without odds.\n\n## Output\nOne row per event, bookmaker and market with closing odds, line and final score.\n\nReference: https://docs.odds-api.io',
    },
    {
      name: 'scan-value-bets',
      description:
        'Pull the current value bets for a bookmaker and filter them by expected value, sport and league.',
      content:
        '# Scan Value Bets\n\nList the selections priced above the market consensus at one bookmaker.\n\n## Steps\n1. Call Get Value Bets with the bookmaker name; optionally narrow by sport and league slugs.\n2. Enable Include Event Details to get the teams, date and league of each selection.\n3. Keep the selections whose expectedValue exceeds your threshold and compare the bookmaker price with the consensus market prices.\n4. Re-run regularly; the list is refreshed every few seconds and prices move.\n\n## Output\nSelections with event, market, side, bookmaker price, consensus price and expected value.\n\nReference: https://docs.odds-api.io',
    },
  ],
} as const satisfies BlockMeta
