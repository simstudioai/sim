import { SportmonksIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'

const DATE_WAND_CONFIG = {
  enabled: true,
  prompt: `Generate a calendar date in YYYY-MM-DD format based on the user's description.
Examples:
- "today" -> today's date in YYYY-MM-DD
- "this weekend" -> the date of the upcoming Sunday in YYYY-MM-DD

Return ONLY the date string in YYYY-MM-DD format - no explanations, no quotes, no extra text.`,
  placeholder: 'Describe the date (e.g., "today", "this weekend")...',
  generationType: 'timestamp' as const,
}

const FOOTBALL_OPS = [
  'football_get_livescores',
  'football_get_inplay_livescores',
  'football_get_fixtures_by_date',
  'football_get_fixtures_by_date_range',
  'football_get_fixture',
  'football_get_head_to_head',
  'football_get_leagues',
  'football_get_league',
  'football_search_teams',
  'football_get_team',
  'football_get_team_squad',
  'football_search_players',
  'football_get_player',
  'football_get_standings_by_season',
  'football_get_topscorers_by_season',
]

const MOTORSPORT_OPS = [
  'motorsport_get_livescores',
  'motorsport_get_fixtures_by_date',
  'motorsport_get_fixture',
  'motorsport_get_drivers',
  'motorsport_get_driver',
  'motorsport_search_drivers',
  'motorsport_get_teams',
  'motorsport_get_team',
  'motorsport_get_driver_standings_by_season',
  'motorsport_get_team_standings_by_season',
  'motorsport_get_laps_by_fixture',
  'motorsport_get_pitstops_by_fixture',
]

const CORE_GEO_OPS = [
  'core_get_continents',
  'core_get_continent',
  'core_get_countries',
  'core_get_country',
  'core_search_countries',
  'core_get_regions',
  'core_get_region',
  'core_get_cities',
  'core_get_city',
  'core_search_cities',
]

const ODDS_FIXTURE_OPS = ['odds_get_pre_match_odds_by_fixture', 'odds_get_inplay_odds_by_fixture']

const INCLUDE_OPS = [...FOOTBALL_OPS, ...MOTORSPORT_OPS, ...ODDS_FIXTURE_OPS, ...CORE_GEO_OPS]

const FILTER_OPS = [
  ...FOOTBALL_OPS,
  ...MOTORSPORT_OPS,
  ...ODDS_FIXTURE_OPS,
  'odds_get_bookmakers',
  'odds_get_markets',
  'core_get_continents',
  'core_get_countries',
  'core_get_regions',
  'core_get_cities',
]

const PAGINATED_OPS = [
  'football_get_fixtures_by_date',
  'football_get_fixtures_by_date_range',
  'football_get_head_to_head',
  'football_get_leagues',
  'football_search_teams',
  'football_search_players',
  'football_get_topscorers_by_season',
  'motorsport_get_livescores',
  'motorsport_get_fixtures_by_date',
  'motorsport_get_drivers',
  'motorsport_search_drivers',
  'motorsport_get_teams',
  'motorsport_get_driver_standings_by_season',
  'motorsport_get_team_standings_by_season',
  'odds_get_pre_match_odds_by_fixture',
  'odds_get_inplay_odds_by_fixture',
  'odds_get_bookmakers',
  'odds_search_bookmakers',
  'odds_get_markets',
  'odds_search_markets',
  'core_get_continents',
  'core_get_countries',
  'core_search_countries',
  'core_get_regions',
  'core_get_cities',
  'core_search_cities',
  'core_get_types',
]

export const SportmonksBlock: BlockConfig = {
  type: 'sportmonks',
  name: 'Sportmonks',
  description: 'Access Sportmonks football, motorsport, odds, and reference data',
  longDescription:
    'Integrate the Sportmonks sports data APIs into the workflow from a single block. Football: fixtures, livescores, leagues, teams, squads, players, standings, and topscorers. Motorsport: sessions, drivers, teams, championship standings, laps, and pitstops. Odds: pre-match and in-play odds, bookmakers, and markets. Core: continents, countries, regions, cities, types, and time zones.',
  docsLink: 'https://docs.sim.ai/integrations/sportmonks',
  category: 'tools',
  integrationType: IntegrationType.Analytics,
  bgColor: '#171534',
  icon: SportmonksIcon,
  authMode: AuthMode.ApiKey,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // Football
        { label: 'Get Live Football Scores', id: 'football_get_livescores', group: 'Football' },
        {
          label: 'Get Inplay Football Scores',
          id: 'football_get_inplay_livescores',
          group: 'Football',
        },
        {
          label: 'Get Football Fixtures by Date',
          id: 'football_get_fixtures_by_date',
          group: 'Football',
        },
        {
          label: 'Get Football Fixtures by Date Range',
          id: 'football_get_fixtures_by_date_range',
          group: 'Football',
        },
        { label: 'Get Football Fixture by ID', id: 'football_get_fixture', group: 'Football' },
        { label: 'Get Football Head to Head', id: 'football_get_head_to_head', group: 'Football' },
        { label: 'Get Football Leagues', id: 'football_get_leagues', group: 'Football' },
        { label: 'Get Football League by ID', id: 'football_get_league', group: 'Football' },
        { label: 'Search Football Teams', id: 'football_search_teams', group: 'Football' },
        { label: 'Get Football Team by ID', id: 'football_get_team', group: 'Football' },
        { label: 'Get Football Team Squad', id: 'football_get_team_squad', group: 'Football' },
        { label: 'Search Football Players', id: 'football_search_players', group: 'Football' },
        { label: 'Get Football Player by ID', id: 'football_get_player', group: 'Football' },
        {
          label: 'Get Football Standings by Season',
          id: 'football_get_standings_by_season',
          group: 'Football',
        },
        {
          label: 'Get Football Topscorers by Season',
          id: 'football_get_topscorers_by_season',
          group: 'Football',
        },
        // Motorsport
        {
          label: 'Get Live Motorsport Scores',
          id: 'motorsport_get_livescores',
          group: 'Motorsport',
        },
        {
          label: 'Get Motorsport Fixtures by Date',
          id: 'motorsport_get_fixtures_by_date',
          group: 'Motorsport',
        },
        {
          label: 'Get Motorsport Fixture by ID',
          id: 'motorsport_get_fixture',
          group: 'Motorsport',
        },
        { label: 'Get Motorsport Drivers', id: 'motorsport_get_drivers', group: 'Motorsport' },
        { label: 'Get Motorsport Driver by ID', id: 'motorsport_get_driver', group: 'Motorsport' },
        {
          label: 'Search Motorsport Drivers',
          id: 'motorsport_search_drivers',
          group: 'Motorsport',
        },
        { label: 'Get Motorsport Teams', id: 'motorsport_get_teams', group: 'Motorsport' },
        { label: 'Get Motorsport Team by ID', id: 'motorsport_get_team', group: 'Motorsport' },
        {
          label: 'Get Motorsport Driver Standings by Season',
          id: 'motorsport_get_driver_standings_by_season',
          group: 'Motorsport',
        },
        {
          label: 'Get Motorsport Team Standings by Season',
          id: 'motorsport_get_team_standings_by_season',
          group: 'Motorsport',
        },
        {
          label: 'Get Motorsport Laps by Fixture',
          id: 'motorsport_get_laps_by_fixture',
          group: 'Motorsport',
        },
        {
          label: 'Get Motorsport Pitstops by Fixture',
          id: 'motorsport_get_pitstops_by_fixture',
          group: 'Motorsport',
        },
        // Odds
        {
          label: 'Get Pre-match Odds by Fixture',
          id: 'odds_get_pre_match_odds_by_fixture',
          group: 'Odds',
        },
        {
          label: 'Get In-play Odds by Fixture',
          id: 'odds_get_inplay_odds_by_fixture',
          group: 'Odds',
        },
        { label: 'Get Bookmakers', id: 'odds_get_bookmakers', group: 'Odds' },
        { label: 'Get Bookmaker by ID', id: 'odds_get_bookmaker', group: 'Odds' },
        { label: 'Search Bookmakers', id: 'odds_search_bookmakers', group: 'Odds' },
        { label: 'Get Betting Markets', id: 'odds_get_markets', group: 'Odds' },
        { label: 'Get Betting Market by ID', id: 'odds_get_market', group: 'Odds' },
        { label: 'Search Betting Markets', id: 'odds_search_markets', group: 'Odds' },
        // Core reference data
        { label: 'Get Continents', id: 'core_get_continents', group: 'Core (Reference)' },
        { label: 'Get Continent by ID', id: 'core_get_continent', group: 'Core (Reference)' },
        { label: 'Get Countries', id: 'core_get_countries', group: 'Core (Reference)' },
        { label: 'Get Country by ID', id: 'core_get_country', group: 'Core (Reference)' },
        { label: 'Search Countries', id: 'core_search_countries', group: 'Core (Reference)' },
        { label: 'Get Regions', id: 'core_get_regions', group: 'Core (Reference)' },
        { label: 'Get Region by ID', id: 'core_get_region', group: 'Core (Reference)' },
        { label: 'Get Cities', id: 'core_get_cities', group: 'Core (Reference)' },
        { label: 'Get City by ID', id: 'core_get_city', group: 'Core (Reference)' },
        { label: 'Search Cities', id: 'core_search_cities', group: 'Core (Reference)' },
        { label: 'Get Types', id: 'core_get_types', group: 'Core (Reference)' },
        { label: 'Get Type by ID', id: 'core_get_type', group: 'Core (Reference)' },
        { label: 'Get Timezones', id: 'core_get_timezones', group: 'Core (Reference)' },
      ],
      value: () => 'football_get_fixtures_by_date',
    },
    // Date inputs (football + motorsport fixtures by date)
    {
      id: 'date',
      title: 'Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: {
        field: 'operation',
        value: ['football_get_fixtures_by_date', 'motorsport_get_fixtures_by_date'],
      },
      required: {
        field: 'operation',
        value: ['football_get_fixtures_by_date', 'motorsport_get_fixtures_by_date'],
      },
      wandConfig: DATE_WAND_CONFIG,
    },
    {
      id: 'startDate',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: 'football_get_fixtures_by_date_range' },
      required: { field: 'operation', value: 'football_get_fixtures_by_date_range' },
      wandConfig: DATE_WAND_CONFIG,
    },
    {
      id: 'endDate',
      title: 'End Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD (max 100 days after start)',
      condition: { field: 'operation', value: 'football_get_fixtures_by_date_range' },
      required: { field: 'operation', value: 'football_get_fixtures_by_date_range' },
      wandConfig: DATE_WAND_CONFIG,
    },
    // Fixture ID (football + motorsport + odds fixture operations)
    {
      id: 'fixtureId',
      title: 'Fixture ID',
      type: 'short-input',
      placeholder: 'Numeric fixture ID',
      condition: {
        field: 'operation',
        value: [
          'football_get_fixture',
          'motorsport_get_fixture',
          'motorsport_get_laps_by_fixture',
          'motorsport_get_pitstops_by_fixture',
          'odds_get_pre_match_odds_by_fixture',
          'odds_get_inplay_odds_by_fixture',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'football_get_fixture',
          'motorsport_get_fixture',
          'motorsport_get_laps_by_fixture',
          'motorsport_get_pitstops_by_fixture',
          'odds_get_pre_match_odds_by_fixture',
          'odds_get_inplay_odds_by_fixture',
        ],
      },
    },
    // Head to head team IDs (football)
    {
      id: 'team1',
      title: 'Team 1 ID',
      type: 'short-input',
      placeholder: 'First team ID',
      condition: { field: 'operation', value: 'football_get_head_to_head' },
      required: { field: 'operation', value: 'football_get_head_to_head' },
    },
    {
      id: 'team2',
      title: 'Team 2 ID',
      type: 'short-input',
      placeholder: 'Second team ID',
      condition: { field: 'operation', value: 'football_get_head_to_head' },
      required: { field: 'operation', value: 'football_get_head_to_head' },
    },
    // League ID (football)
    {
      id: 'leagueId',
      title: 'League ID',
      type: 'short-input',
      placeholder: 'Numeric league ID',
      condition: { field: 'operation', value: 'football_get_league' },
      required: { field: 'operation', value: 'football_get_league' },
    },
    // Team ID (football + motorsport)
    {
      id: 'teamId',
      title: 'Team ID',
      type: 'short-input',
      placeholder: 'Numeric team ID',
      condition: {
        field: 'operation',
        value: ['football_get_team', 'football_get_team_squad', 'motorsport_get_team'],
      },
      required: {
        field: 'operation',
        value: ['football_get_team', 'football_get_team_squad', 'motorsport_get_team'],
      },
    },
    // Driver ID (motorsport)
    {
      id: 'driverId',
      title: 'Driver ID',
      type: 'short-input',
      placeholder: 'Numeric driver ID',
      condition: { field: 'operation', value: 'motorsport_get_driver' },
      required: { field: 'operation', value: 'motorsport_get_driver' },
    },
    // Player ID (football)
    {
      id: 'playerId',
      title: 'Player ID',
      type: 'short-input',
      placeholder: 'Numeric player ID',
      condition: { field: 'operation', value: 'football_get_player' },
      required: { field: 'operation', value: 'football_get_player' },
    },
    // Season ID (football + motorsport standings/topscorers)
    {
      id: 'seasonId',
      title: 'Season ID',
      type: 'short-input',
      placeholder: 'Numeric season ID',
      condition: {
        field: 'operation',
        value: [
          'football_get_standings_by_season',
          'football_get_topscorers_by_season',
          'motorsport_get_driver_standings_by_season',
          'motorsport_get_team_standings_by_season',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'football_get_standings_by_season',
          'football_get_topscorers_by_season',
          'motorsport_get_driver_standings_by_season',
          'motorsport_get_team_standings_by_season',
        ],
      },
    },
    // Bookmaker / Market IDs (odds)
    {
      id: 'bookmakerId',
      title: 'Bookmaker ID',
      type: 'short-input',
      placeholder: 'Numeric bookmaker ID',
      condition: { field: 'operation', value: 'odds_get_bookmaker' },
      required: { field: 'operation', value: 'odds_get_bookmaker' },
    },
    {
      id: 'marketId',
      title: 'Market ID',
      type: 'short-input',
      placeholder: 'Numeric market ID',
      condition: { field: 'operation', value: 'odds_get_market' },
      required: { field: 'operation', value: 'odds_get_market' },
    },
    // Core reference IDs
    {
      id: 'continentId',
      title: 'Continent ID',
      type: 'short-input',
      placeholder: 'Numeric continent ID',
      condition: { field: 'operation', value: 'core_get_continent' },
      required: { field: 'operation', value: 'core_get_continent' },
    },
    {
      id: 'countryId',
      title: 'Country ID',
      type: 'short-input',
      placeholder: 'Numeric country ID',
      condition: { field: 'operation', value: 'core_get_country' },
      required: { field: 'operation', value: 'core_get_country' },
    },
    {
      id: 'regionId',
      title: 'Region ID',
      type: 'short-input',
      placeholder: 'Numeric region ID',
      condition: { field: 'operation', value: 'core_get_region' },
      required: { field: 'operation', value: 'core_get_region' },
    },
    {
      id: 'cityId',
      title: 'City ID',
      type: 'short-input',
      placeholder: 'Numeric city ID',
      condition: { field: 'operation', value: 'core_get_city' },
      required: { field: 'operation', value: 'core_get_city' },
    },
    {
      id: 'typeId',
      title: 'Type ID',
      type: 'short-input',
      placeholder: 'Numeric type ID',
      condition: { field: 'operation', value: 'core_get_type' },
      required: { field: 'operation', value: 'core_get_type' },
    },
    // Shared search query
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Name to search for',
      condition: {
        field: 'operation',
        value: [
          'football_search_teams',
          'football_search_players',
          'motorsport_search_drivers',
          'odds_search_bookmakers',
          'odds_search_markets',
          'core_search_countries',
          'core_search_cities',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'football_search_teams',
          'football_search_players',
          'motorsport_search_drivers',
          'odds_search_bookmakers',
          'odds_search_markets',
          'core_search_countries',
          'core_search_cities',
        ],
      },
    },
    // Shared enrichment + pagination (advanced)
    {
      id: 'include',
      title: 'Includes',
      type: 'short-input',
      placeholder: 'Semicolon-separated relations (e.g. participants;scores)',
      mode: 'advanced',
      condition: { field: 'operation', value: INCLUDE_OPS },
    },
    {
      id: 'filters',
      title: 'Filters',
      type: 'short-input',
      placeholder: 'Filters to apply (e.g. fixtureLeagues:501)',
      mode: 'advanced',
      condition: { field: 'operation', value: FILTER_OPS },
    },
    {
      id: 'per_page',
      title: 'Per Page',
      type: 'short-input',
      placeholder: 'Results per page (max 50)',
      mode: 'advanced',
      condition: { field: 'operation', value: PAGINATED_OPS },
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: 'Page number',
      mode: 'advanced',
      condition: { field: 'operation', value: PAGINATED_OPS },
    },
    {
      id: 'order',
      title: 'Order',
      type: 'dropdown',
      options: [
        { label: 'Ascending', id: 'asc' },
        { label: 'Descending', id: 'desc' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: PAGINATED_OPS },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Sportmonks API token',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: [
      'sportmonks_football_get_livescores',
      'sportmonks_football_get_inplay_livescores',
      'sportmonks_football_get_fixtures_by_date',
      'sportmonks_football_get_fixtures_by_date_range',
      'sportmonks_football_get_fixture',
      'sportmonks_football_get_head_to_head',
      'sportmonks_football_get_leagues',
      'sportmonks_football_get_league',
      'sportmonks_football_search_teams',
      'sportmonks_football_get_team',
      'sportmonks_football_get_team_squad',
      'sportmonks_football_search_players',
      'sportmonks_football_get_player',
      'sportmonks_football_get_standings_by_season',
      'sportmonks_football_get_topscorers_by_season',
      'sportmonks_motorsport_get_livescores',
      'sportmonks_motorsport_get_fixtures_by_date',
      'sportmonks_motorsport_get_fixture',
      'sportmonks_motorsport_get_drivers',
      'sportmonks_motorsport_get_driver',
      'sportmonks_motorsport_search_drivers',
      'sportmonks_motorsport_get_teams',
      'sportmonks_motorsport_get_team',
      'sportmonks_motorsport_get_driver_standings_by_season',
      'sportmonks_motorsport_get_team_standings_by_season',
      'sportmonks_motorsport_get_laps_by_fixture',
      'sportmonks_motorsport_get_pitstops_by_fixture',
      'sportmonks_odds_get_pre_match_odds_by_fixture',
      'sportmonks_odds_get_inplay_odds_by_fixture',
      'sportmonks_odds_get_bookmakers',
      'sportmonks_odds_get_bookmaker',
      'sportmonks_odds_search_bookmakers',
      'sportmonks_odds_get_markets',
      'sportmonks_odds_get_market',
      'sportmonks_odds_search_markets',
      'sportmonks_core_get_continents',
      'sportmonks_core_get_continent',
      'sportmonks_core_get_countries',
      'sportmonks_core_get_country',
      'sportmonks_core_search_countries',
      'sportmonks_core_get_regions',
      'sportmonks_core_get_region',
      'sportmonks_core_get_cities',
      'sportmonks_core_get_city',
      'sportmonks_core_search_cities',
      'sportmonks_core_get_types',
      'sportmonks_core_get_type',
      'sportmonks_core_get_timezones',
    ],
    config: {
      tool: (params) => `sportmonks_${params.operation}`,
      params: (params) => {
        const cleaned: Record<string, any> = {}
        Object.entries(params).forEach(([key, value]) => {
          if (key === 'operation') return
          if (value !== undefined && value !== null && value !== '') {
            cleaned[key] = value
          }
        })
        return cleaned
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Sportmonks API token' },
    date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
    startDate: { type: 'string', description: 'Start date in YYYY-MM-DD format' },
    endDate: { type: 'string', description: 'End date in YYYY-MM-DD format' },
    fixtureId: { type: 'string', description: 'Fixture (session) ID' },
    team1: { type: 'string', description: 'First team ID for head-to-head' },
    team2: { type: 'string', description: 'Second team ID for head-to-head' },
    leagueId: { type: 'string', description: 'League ID' },
    teamId: { type: 'string', description: 'Team ID' },
    driverId: { type: 'string', description: 'Driver ID' },
    playerId: { type: 'string', description: 'Player ID' },
    seasonId: { type: 'string', description: 'Season ID' },
    bookmakerId: { type: 'string', description: 'Bookmaker ID' },
    marketId: { type: 'string', description: 'Market ID' },
    continentId: { type: 'string', description: 'Continent ID' },
    countryId: { type: 'string', description: 'Country ID' },
    regionId: { type: 'string', description: 'Region ID' },
    cityId: { type: 'string', description: 'City ID' },
    typeId: { type: 'string', description: 'Type ID' },
    query: { type: 'string', description: 'Search query' },
    include: { type: 'string', description: 'Semicolon-separated relations to include' },
    filters: { type: 'string', description: 'Filters to apply' },
    per_page: { type: 'string', description: 'Results per page (max 50)' },
    page: { type: 'string', description: 'Page number' },
    order: { type: 'string', description: 'Order direction (asc or desc)' },
  },
  outputs: {
    // Football + Motorsport fixtures
    fixtures: {
      type: 'json',
      description:
        'Array of fixtures/sessions [{id, name, starting_at, league_id, season_id, state_id}] — football and motorsport',
    },
    fixture: { type: 'json', description: 'Single fixture/session object' },
    // Football
    leagues: { type: 'json', description: 'Array of football leagues' },
    league: { type: 'json', description: 'Single football league object' },
    teams: { type: 'json', description: 'Array of teams (football or motorsport)' },
    team: { type: 'json', description: 'Single team object (football or motorsport)' },
    squad: { type: 'json', description: 'Array of football squad entries' },
    players: { type: 'json', description: 'Array of football players' },
    player: { type: 'json', description: 'Single football player object' },
    standings: {
      type: 'json',
      description: 'Array of standings (football league or motorsport championship)',
    },
    topscorers: { type: 'json', description: 'Array of football topscorers' },
    // Motorsport
    drivers: { type: 'json', description: 'Array of motorsport drivers' },
    driver: { type: 'json', description: 'Single motorsport driver object' },
    laps: { type: 'json', description: 'Array of motorsport laps' },
    pitstops: { type: 'json', description: 'Array of motorsport pitstops' },
    // Odds
    odds: {
      type: 'json',
      description:
        'Array of odds [{id, fixture_id, market_id, bookmaker_id, label, value, probability}]',
    },
    bookmakers: { type: 'json', description: 'Array of bookmakers [{id, name, logo}]' },
    bookmaker: { type: 'json', description: 'Single bookmaker object' },
    markets: { type: 'json', description: 'Array of betting markets [{id, name}]' },
    market: { type: 'json', description: 'Single betting market object' },
    // Core reference
    continents: { type: 'json', description: 'Array of continents [{id, name, code}]' },
    continent: { type: 'json', description: 'Single continent object' },
    countries: {
      type: 'json',
      description: 'Array of countries [{id, name, iso2, iso3, image_path}]',
    },
    country: { type: 'json', description: 'Single country object' },
    regions: { type: 'json', description: 'Array of regions [{id, country_id, name}]' },
    region: { type: 'json', description: 'Single region object' },
    cities: { type: 'json', description: 'Array of cities [{id, country_id, name}]' },
    city: { type: 'json', description: 'Single city object' },
    types: {
      type: 'json',
      description: 'Array of types [{id, name, code, developer_name, group}]',
    },
    type: { type: 'json', description: 'Single type object' },
    timezones: { type: 'json', description: 'Array of IANA time zone name strings' },
    pagination: {
      type: 'json',
      description: 'Pagination metadata {count, per_page, current_page, next_page, has_more}',
    },
  },
}

export const SportmonksBlockMeta = {
  tags: ['data-analytics'],
  url: 'https://www.sportmonks.com',
  templates: [
    {
      icon: SportmonksIcon,
      title: 'Daily football fixtures digest',
      prompt:
        "Build a scheduled daily workflow that fetches today's football fixtures from Sportmonks for the leagues I follow, summarizes the key matchups and kickoff times, and posts the digest to Slack.",
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['automation', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SportmonksIcon,
      title: 'Live football score alerter',
      prompt:
        'Create a scheduled workflow that polls Sportmonks inplay football scores, detects goals and status changes since the last run, and pings Slack with the updated scoreline for tracked matches.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SportmonksIcon,
      title: 'Weekly league standings report',
      prompt:
        'Build a scheduled weekly workflow that pulls the Sportmonks football standings and topscorers for a season, formats a league table with recent form, and emails the report to the group.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'analysis'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: SportmonksIcon,
      title: 'Race weekend schedule digest',
      prompt:
        "Build a scheduled workflow that fetches this weekend's motorsport sessions from Sportmonks, summarizes the practice, qualifying, and race times, and posts the schedule to Slack.",
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['automation', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SportmonksIcon,
      title: 'Motorsport championship tracker',
      prompt:
        'Create a scheduled weekly workflow that pulls the Sportmonks motorsport driver and constructor standings for the current season, formats the championship tables, and emails them to the group.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'analysis'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: SportmonksIcon,
      title: 'Pre-match odds snapshot',
      prompt:
        'Build a workflow that pulls Sportmonks pre-match odds for a fixture across selected bookmakers, computes the implied probability for each outcome, and writes the snapshot to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'analysis'],
    },
    {
      icon: SportmonksIcon,
      title: 'Live odds movement alerter',
      prompt:
        'Create a scheduled workflow that polls Sportmonks in-play odds for a fixture, detects sharp price moves since the last run, and pings Slack with the updated lines.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'finance'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SportmonksIcon,
      title: 'Head-to-head match preview',
      prompt:
        'Create a workflow that takes two team names, resolves them to IDs via Sportmonks football team search, pulls their head-to-head history and current standings, and writes a match preview file.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['research', 'content'],
    },
  ],
  skills: [
    {
      name: 'daily-football-fixtures',
      description: "List a day's football fixtures from Sportmonks, optionally filtered by league.",
      content:
        '# Daily Football Fixtures\n\nGet the football matches scheduled for a given day.\n\n## Steps\n1. Use Get Football Fixtures by Date with the target date in YYYY-MM-DD format.\n2. Optionally set Includes to `participants;scores;league` to enrich each fixture.\n3. Optionally set Filters such as `fixtureLeagues:501,271` to restrict to specific leagues.\n\n## Output\nA list of fixtures with kickoff time, the participating teams, and league.',
    },
    {
      name: 'live-football-scores',
      description: 'Fetch in-play football matches and their current scores from Sportmonks.',
      content:
        '# Live Football Scores\n\nSee which matches are being played now and the live score.\n\n## Steps\n1. Use Get Inplay Football Scores to fetch matches in progress.\n2. Set Includes to `participants;scores` for team names and the scoreline.\n3. Optionally filter with `fixtureLeagues:501`.\n\n## Output\nA list of live fixtures, each with the two teams, current score, and match state.',
    },
    {
      name: 'football-league-table',
      description: 'Build a football league standings table for a season from Sportmonks.',
      content:
        "# Football League Table\n\nGet the current standings for a competition.\n\n## Steps\n1. Find the season ID (use Get Football Leagues, then its current season).\n2. Use Get Football Standings by Season with that season ID.\n3. Set Includes to `participant` for team names and `form` for recent results.\n\n## Output\nAn ordered league table with each team's position, points, and recent form.",
    },
    {
      name: 'race-weekend-sessions',
      description: 'List the motorsport sessions on a given date from Sportmonks.',
      content:
        '# Race Weekend Sessions\n\nGet the practice, qualifying, and race sessions for a day.\n\n## Steps\n1. Use Get Motorsport Fixtures by Date with the target date in YYYY-MM-DD format.\n2. Set Includes to `venue;participants` to attach the track and entrants.\n\n## Output\nA list of sessions for the day with type (Practice/Qualifying/Race), track, and start time.',
    },
    {
      name: 'motorsport-championship',
      description: 'Fetch driver and constructor championship standings for a motorsport season.',
      content:
        "# Motorsport Championship\n\nGet the title race state for a season.\n\n## Steps\n1. Use Get Motorsport Driver Standings by Season with the season ID.\n2. Use Get Motorsport Team Standings by Season with the same season ID.\n3. Set Includes to `participant` for driver/team names.\n\n## Output\nOrdered drivers and constructors tables with each participant's position and points.",
    },
    {
      name: 'pre-match-odds',
      description: 'Fetch pre-match odds for a fixture and compute implied probabilities.',
      content:
        '# Pre-match Odds\n\nGet the betting odds for an upcoming fixture.\n\n## Steps\n1. Use Get Pre-match Odds by Fixture with the fixture ID.\n2. Set Includes to `market;bookmaker` and optionally Filters like `bookmakers:2,14` to narrow results.\n\n## Output\nThe odds per outcome with decimal value and implied probability, grouped by market and bookmaker.',
    },
    {
      name: 'odds-line-shopping',
      description: 'Find the best available price per outcome across bookmakers.',
      content:
        '# Odds Line Shopping\n\nFind the best odds for each outcome.\n\n## Steps\n1. Use Get Pre-match Odds by Fixture for the fixture (do not filter to one bookmaker).\n2. Group the returned odds by market and outcome label.\n3. For each outcome, pick the highest value and note its bookmaker_id.\n\n## Output\nFor each outcome, the best decimal price and which bookmaker offers it.',
    },
    {
      name: 'resolve-country',
      description:
        'Resolve a country name to its Sportmonks ID and ISO codes via Core reference data.',
      content:
        '# Resolve Country\n\nNormalize a country name to Sportmonks reference data.\n\n## Steps\n1. Use Search Countries with the country name.\n2. Read the matching country id, iso2, iso3, and fifa_name.\n\n## Output\nThe country id plus its ISO2, ISO3, and FIFA codes for use in other lookups.',
    },
  ],
} as const satisfies BlockMeta
