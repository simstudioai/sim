import type { OutputProperty } from '@/tools/types'

/**
 * Base URL for the Sportmonks Football API v3.
 * @see https://docs.sportmonks.com/v3/welcome/authentication
 */
export const SPORTMONKS_FOOTBALL_BASE_URL = 'https://api.sportmonks.com/v3/football'

/**
 * Output property definitions for a Fixture object.
 * @see https://docs.sportmonks.com/v3/endpoints-and-entities/entities/fixture
 */
export const SPORTMONKS_FIXTURE_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the fixture' },
  sport_id: { type: 'number', description: 'Sport the fixture is played at' },
  league_id: { type: 'number', description: 'League the fixture is played in' },
  season_id: { type: 'number', description: 'Season the fixture is played in' },
  stage_id: { type: 'number', description: 'Stage the fixture is played in' },
  group_id: { type: 'number', description: 'Group the fixture is played in', nullable: true },
  aggregate_id: { type: 'number', description: 'Aggregate the fixture belongs to', nullable: true },
  round_id: { type: 'number', description: 'Round the fixture is played in', nullable: true },
  state_id: { type: 'number', description: 'State (status) of the fixture' },
  venue_id: { type: 'number', description: 'Venue the fixture is played at', nullable: true },
  name: { type: 'string', description: 'Name of the fixture (participants)', nullable: true },
  starting_at: { type: 'string', description: 'Datetime the fixture starts', nullable: true },
  result_info: {
    type: 'string',
    description: 'Final result summary',
    nullable: true,
    optional: true,
  },
  leg: { type: 'string', description: 'Leg of the fixture (e.g. 1/1)', optional: true },
  details: {
    type: 'string',
    description: 'Details about the fixture',
    nullable: true,
    optional: true,
  },
  length: {
    type: 'number',
    description: 'Length of the fixture in minutes',
    nullable: true,
    optional: true,
  },
  placeholder: {
    type: 'boolean',
    description: 'Whether the fixture is a placeholder',
    optional: true,
  },
  has_odds: { type: 'boolean', description: 'Whether odds are available', optional: true },
  has_premium_odds: {
    type: 'boolean',
    description: 'Whether premium odds are available',
    optional: true,
  },
  starting_at_timestamp: {
    type: 'number',
    description: 'UNIX timestamp of the start time',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Team object.
 * @see https://docs.sportmonks.com/v3/endpoints-and-entities/entities/team-player-squad-coach-and-referee
 */
export const SPORTMONKS_TEAM_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the team' },
  sport_id: { type: 'number', description: 'Sport of the team' },
  country_id: { type: 'number', description: 'Country of the team' },
  venue_id: {
    type: 'number',
    description: 'Home venue of the team',
    nullable: true,
    optional: true,
  },
  gender: { type: 'string', description: 'Gender of the team', optional: true },
  name: { type: 'string', description: 'Name of the team' },
  short_code: {
    type: 'string',
    description: 'Short code of the team',
    nullable: true,
    optional: true,
  },
  image_path: { type: 'string', description: 'URL to the team logo', optional: true },
  founded: {
    type: 'number',
    description: 'Founding year of the team',
    nullable: true,
    optional: true,
  },
  type: { type: 'string', description: 'Type of the team', optional: true },
  placeholder: {
    type: 'boolean',
    description: 'Whether the team is a placeholder',
    optional: true,
  },
  last_played_at: {
    type: 'string',
    description: 'Date and time of the last played match',
    nullable: true,
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Player object.
 * @see https://docs.sportmonks.com/v3/endpoints-and-entities/entities/team-player-squad-coach-and-referee
 */
export const SPORTMONKS_PLAYER_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the player' },
  sport_id: { type: 'number', description: 'Sport of the player' },
  country_id: { type: 'number', description: 'Country of birth of the player', nullable: true },
  nationality_id: { type: 'number', description: 'Nationality of the player', nullable: true },
  city_id: {
    type: 'number',
    description: 'City of birth of the player',
    nullable: true,
    optional: true,
  },
  position_id: {
    type: 'number',
    description: 'Position of the player',
    nullable: true,
    optional: true,
  },
  detailed_position_id: {
    type: 'number',
    description: 'Detailed position of the player',
    nullable: true,
    optional: true,
  },
  type_id: { type: 'number', description: 'Type of the player', nullable: true, optional: true },
  common_name: { type: 'string', description: 'Name the player is known for', optional: true },
  firstname: { type: 'string', description: 'First name of the player', optional: true },
  lastname: { type: 'string', description: 'Last name of the player', optional: true },
  name: { type: 'string', description: 'Name of the player' },
  display_name: { type: 'string', description: 'Display name of the player', optional: true },
  image_path: { type: 'string', description: 'URL to the player headshot', optional: true },
  height: {
    type: 'number',
    description: 'Height of the player in cm',
    nullable: true,
    optional: true,
  },
  weight: {
    type: 'number',
    description: 'Weight of the player in kg',
    nullable: true,
    optional: true,
  },
  date_of_birth: {
    type: 'string',
    description: 'Date of birth of the player',
    nullable: true,
    optional: true,
  },
  gender: { type: 'string', description: 'Gender of the player', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a League object.
 * @see https://docs.sportmonks.com/v3/endpoints-and-entities/entities/league-season-schedule-stage-and-round
 */
export const SPORTMONKS_LEAGUE_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the league' },
  sport_id: { type: 'number', description: 'Sport of the league' },
  country_id: { type: 'number', description: 'Country of the league' },
  name: { type: 'string', description: 'Name of the league' },
  active: {
    type: 'number',
    description: 'Whether the league is active (1) or inactive (0)',
    optional: true,
  },
  short_code: {
    type: 'string',
    description: 'Short code of the league',
    nullable: true,
    optional: true,
  },
  image_path: { type: 'string', description: 'URL to the league logo', optional: true },
  type: { type: 'string', description: 'Type of the league', optional: true },
  sub_type: { type: 'string', description: 'Subtype of the league', optional: true },
  last_played_at: {
    type: 'string',
    description: 'Date the last fixture was played',
    nullable: true,
    optional: true,
  },
  category: {
    type: 'number',
    description: 'Importance category of the league (1-4)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Standing object.
 * @see https://docs.sportmonks.com/v3/endpoints-and-entities/entities/standing-and-topscorer
 */
export const SPORTMONKS_STANDING_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the standing' },
  participant_id: { type: 'number', description: 'Team related to the standing' },
  sport_id: { type: 'number', description: 'Sport related to the standing' },
  league_id: { type: 'number', description: 'League related to the standing' },
  season_id: { type: 'number', description: 'Season related to the standing' },
  stage_id: { type: 'number', description: 'Stage related to the standing' },
  group_id: { type: 'number', description: 'Group related to the standing', nullable: true },
  round_id: { type: 'number', description: 'Round related to the standing', nullable: true },
  standing_rule_id: {
    type: 'number',
    description: 'Standing rule related to the standing',
    optional: true,
  },
  position: { type: 'number', description: 'Position of the team in the standing' },
  result: { type: 'string', description: 'Movement of the team in the standing', optional: true },
  points: { type: 'number', description: 'Points the team has gathered' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Topscorer object.
 * @see https://docs.sportmonks.com/v3/endpoints-and-entities/entities/standing-and-topscorer
 */
export const SPORTMONKS_TOPSCORER_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the topscorer record' },
  season_id: {
    type: 'number',
    description: 'Season related to the topscorer (absent on stage topscorers)',
    optional: true,
  },
  league_id: { type: 'number', description: 'League related to the topscorer', optional: true },
  stage_id: { type: 'number', description: 'Stage related to the topscorer', optional: true },
  player_id: { type: 'number', description: 'Player related to the topscorer' },
  participant_id: { type: 'number', description: 'Team related to the topscorer' },
  type_id: { type: 'number', description: 'Type of the topscorer (goals, assists, cards)' },
  position: { type: 'number', description: 'Position of the topscorer' },
  total: { type: 'number', description: 'Number of goals, assists or cards' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Team Squad entry.
 * @see https://docs.sportmonks.com/v3/endpoints-and-entities/entities/team-player-squad-coach-and-referee
 */
export const SPORTMONKS_SQUAD_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the squad record' },
  transfer_id: {
    type: 'number',
    description: 'Transfer id of the squad record',
    nullable: true,
    optional: true,
  },
  player_id: { type: 'number', description: 'Player in the squad' },
  team_id: { type: 'number', description: 'Team of the squad' },
  position_id: {
    type: 'number',
    description: 'Position of the player in the squad',
    nullable: true,
    optional: true,
  },
  detailed_position_id: {
    type: 'number',
    description: 'Detailed position of the player in the squad',
    nullable: true,
    optional: true,
  },
  jersey_number: {
    type: 'number',
    description: 'Jersey number of the player',
    nullable: true,
    optional: true,
  },
  start: {
    type: 'string',
    description: 'Start contract date of the player',
    nullable: true,
    optional: true,
  },
  end: {
    type: 'string',
    description: 'End contract date of the player',
    nullable: true,
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export interface SportmonksFixture {
  id: number
  sport_id: number
  league_id: number
  season_id: number
  stage_id: number
  group_id: number | null
  aggregate_id: number | null
  round_id: number | null
  state_id: number
  venue_id: number | null
  name: string | null
  starting_at: string | null
  result_info?: string | null
  leg?: string
  details?: string | null
  length?: number | null
  placeholder?: boolean
  has_odds?: boolean
  has_premium_odds?: boolean
  starting_at_timestamp?: number
}

export interface SportmonksTeam {
  id: number
  sport_id: number
  country_id: number
  venue_id?: number | null
  gender?: string
  name: string
  short_code?: string | null
  image_path?: string
  founded?: number | null
  type?: string
  placeholder?: boolean
  last_played_at?: string | null
}

export interface SportmonksPlayer {
  id: number
  sport_id: number
  country_id: number | null
  nationality_id: number | null
  city_id?: number | null
  position_id?: number | null
  detailed_position_id?: number | null
  type_id?: number | null
  common_name?: string
  firstname?: string
  lastname?: string
  name: string
  display_name?: string
  image_path?: string
  height?: number | null
  weight?: number | null
  date_of_birth?: string | null
  gender?: string
}

export interface SportmonksLeague {
  id: number
  sport_id: number
  country_id: number
  name: string
  active?: number
  short_code?: string | null
  image_path?: string
  type?: string
  sub_type?: string
  last_played_at?: string | null
  category?: number
}

export interface SportmonksStanding {
  id: number
  participant_id: number
  sport_id: number
  league_id: number
  season_id: number
  stage_id: number
  group_id: number | null
  round_id: number | null
  standing_rule_id?: number
  position: number
  result?: string
  points: number
}

export interface SportmonksTopscorer {
  id: number
  season_id?: number
  league_id?: number
  stage_id?: number
  player_id: number
  participant_id: number
  type_id: number
  position: number
  total: number
}

export interface SportmonksSquadEntry {
  id: number
  transfer_id?: number | null
  player_id: number
  team_id: number
  position_id?: number | null
  detailed_position_id?: number | null
  jersey_number?: number | null
  start?: string | null
  end?: string | null
}

/**
 * Output property definitions for a Season object.
 * @see https://docs.sportmonks.com/v3/endpoints-and-entities/entities/league-season-schedule-stage-and-round
 */
export const SPORTMONKS_SEASON_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the season' },
  sport_id: { type: 'number', description: 'Sport of the season' },
  league_id: { type: 'number', description: 'League of the season' },
  tie_breaker_rule_id: {
    type: 'number',
    description: 'Tie-breaker rule of the season',
    nullable: true,
    optional: true,
  },
  name: { type: 'string', description: 'Name of the season (e.g. 2023/2024)' },
  finished: { type: 'boolean', description: 'Whether the season is finished', optional: true },
  pending: { type: 'boolean', description: 'Whether the season is pending', optional: true },
  is_current: {
    type: 'boolean',
    description: 'Whether the season is the current season',
    optional: true,
  },
  standing_method: {
    type: 'string',
    description: 'Standing calculation method',
    nullable: true,
    optional: true,
  },
  starting_at: {
    type: 'string',
    description: 'Start date of the season',
    nullable: true,
    optional: true,
  },
  ending_at: {
    type: 'string',
    description: 'End date of the season',
    nullable: true,
    optional: true,
  },
  standings_recalculated_at: {
    type: 'string',
    description: 'Last standings recalculation time',
    nullable: true,
    optional: true,
  },
  games_in_current_week: {
    type: 'boolean',
    description: 'Whether the season has fixtures this week',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/** Output property definitions for a Stage object. */
export const SPORTMONKS_STAGE_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the stage' },
  sport_id: { type: 'number', description: 'Sport of the stage' },
  league_id: { type: 'number', description: 'League of the stage' },
  season_id: { type: 'number', description: 'Season of the stage' },
  type_id: { type: 'number', description: 'Type of the stage' },
  name: { type: 'string', description: 'Name of the stage' },
  sort_order: { type: 'number', description: 'Sort order of the stage', optional: true },
  finished: { type: 'boolean', description: 'Whether the stage is finished', optional: true },
  is_current: {
    type: 'boolean',
    description: 'Whether the stage is the current stage',
    optional: true,
  },
  starting_at: {
    type: 'string',
    description: 'Start date of the stage',
    nullable: true,
    optional: true,
  },
  ending_at: {
    type: 'string',
    description: 'End date of the stage',
    nullable: true,
    optional: true,
  },
  games_in_current_week: {
    type: 'boolean',
    description: 'Whether the stage has fixtures this week',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/** Output property definitions for a Round object. */
export const SPORTMONKS_ROUND_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the round' },
  sport_id: { type: 'number', description: 'Sport of the round' },
  league_id: { type: 'number', description: 'League of the round' },
  season_id: { type: 'number', description: 'Season of the round' },
  stage_id: { type: 'number', description: 'Stage of the round', nullable: true, optional: true },
  name: { type: 'string', description: 'Name of the round' },
  finished: { type: 'boolean', description: 'Whether the round is finished', optional: true },
  is_current: {
    type: 'boolean',
    description: 'Whether the round is the current round',
    optional: true,
  },
  starting_at: {
    type: 'string',
    description: 'Start date of the round',
    nullable: true,
    optional: true,
  },
  ending_at: {
    type: 'string',
    description: 'End date of the round',
    nullable: true,
    optional: true,
  },
  games_in_current_week: {
    type: 'boolean',
    description: 'Whether the round has fixtures this week',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/** Output property definitions for a Coach object. */
export const SPORTMONKS_COACH_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the coach' },
  player_id: {
    type: 'number',
    description: 'Player related to the coach',
    nullable: true,
    optional: true,
  },
  sport_id: { type: 'number', description: 'Sport of the coach' },
  country_id: { type: 'number', description: 'Country of the coach', nullable: true },
  nationality_id: { type: 'number', description: 'Nationality of the coach', nullable: true },
  city_id: {
    type: 'number',
    description: 'Birth city of the coach',
    nullable: true,
    optional: true,
  },
  common_name: { type: 'string', description: 'Common name of the coach', optional: true },
  firstname: {
    type: 'string',
    description: 'First name of the coach',
    nullable: true,
    optional: true,
  },
  lastname: {
    type: 'string',
    description: 'Last name of the coach',
    nullable: true,
    optional: true,
  },
  name: { type: 'string', description: 'Name of the coach' },
  display_name: { type: 'string', description: 'Display name of the coach', optional: true },
  image_path: { type: 'string', description: 'URL to the coach headshot', optional: true },
  height: {
    type: 'number',
    description: 'Height of the coach in cm',
    nullable: true,
    optional: true,
  },
  weight: {
    type: 'number',
    description: 'Weight of the coach in kg',
    nullable: true,
    optional: true,
  },
  date_of_birth: {
    type: 'string',
    description: 'Date of birth of the coach',
    nullable: true,
    optional: true,
  },
  gender: { type: 'string', description: 'Gender of the coach', nullable: true, optional: true },
} as const satisfies Record<string, OutputProperty>

/** Output property definitions for a Referee object. */
export const SPORTMONKS_REFEREE_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the referee' },
  sport_id: { type: 'number', description: 'Sport of the referee' },
  country_id: { type: 'number', description: 'Country of the referee', nullable: true },
  nationality_id: {
    type: 'number',
    description: 'Nationality of the referee',
    nullable: true,
    optional: true,
  },
  city_id: {
    type: 'number',
    description: 'Birth city of the referee',
    nullable: true,
    optional: true,
  },
  common_name: { type: 'string', description: 'Common name of the referee', optional: true },
  firstname: {
    type: 'string',
    description: 'First name of the referee',
    nullable: true,
    optional: true,
  },
  lastname: {
    type: 'string',
    description: 'Last name of the referee',
    nullable: true,
    optional: true,
  },
  name: { type: 'string', description: 'Name of the referee' },
  display_name: { type: 'string', description: 'Display name of the referee', optional: true },
  image_path: { type: 'string', description: 'URL to the referee headshot', optional: true },
  height: {
    type: 'number',
    description: 'Height of the referee in cm',
    nullable: true,
    optional: true,
  },
  weight: {
    type: 'number',
    description: 'Weight of the referee in kg',
    nullable: true,
    optional: true,
  },
  date_of_birth: {
    type: 'string',
    description: 'Date of birth of the referee',
    nullable: true,
    optional: true,
  },
  gender: { type: 'string', description: 'Gender of the referee', nullable: true, optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Venue object.
 * @see https://docs.sportmonks.com/v3/endpoints-and-entities/entities/other
 */
export const SPORTMONKS_VENUE_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the venue' },
  country_id: { type: 'number', description: 'Country of the venue', nullable: true },
  city_id: { type: 'number', description: 'City of the venue', nullable: true, optional: true },
  name: { type: 'string', description: 'Name of the venue' },
  address: { type: 'string', description: 'Address of the venue', nullable: true, optional: true },
  zipcode: { type: 'string', description: 'Zipcode of the venue', nullable: true, optional: true },
  latitude: {
    type: 'string',
    description: 'Latitude of the venue',
    nullable: true,
    optional: true,
  },
  longitude: {
    type: 'string',
    description: 'Longitude of the venue',
    nullable: true,
    optional: true,
  },
  capacity: {
    type: 'number',
    description: 'Seating capacity of the venue',
    nullable: true,
    optional: true,
  },
  image_path: {
    type: 'string',
    description: 'Image path of the venue',
    nullable: true,
    optional: true,
  },
  city_name: {
    type: 'string',
    description: 'Name of the city the venue is in',
    nullable: true,
    optional: true,
  },
  surface: {
    type: 'string',
    description: 'Surface type of the venue',
    nullable: true,
    optional: true,
  },
  national_team: {
    type: 'boolean',
    description: 'Whether the venue is used by the national team',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a State object.
 * @see https://docs.sportmonks.com/v3/endpoints-and-entities/entities/other
 */
export const SPORTMONKS_STATE_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the state' },
  state: { type: 'string', description: 'State code (e.g. NS, INPLAY_1ST_HALF)' },
  name: { type: 'string', description: 'Full name of the state (e.g. Not Started)' },
  short_name: {
    type: 'string',
    description: 'Short name of the state (e.g. NS)',
    nullable: true,
    optional: true,
  },
  developer_name: { type: 'string', description: 'Developer name of the state', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Transfer object.
 * @see https://docs.sportmonks.com/v3/endpoints-and-entities/entities/other
 */
export const SPORTMONKS_TRANSFER_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the transfer' },
  sport_id: { type: 'number', description: 'Sport of the transfer' },
  player_id: { type: 'number', description: 'Player who transferred' },
  type_id: { type: 'number', description: 'Type of the transfer' },
  from_team_id: { type: 'number', description: 'Team the player transferred from', nullable: true },
  to_team_id: { type: 'number', description: 'Team the player transferred to', nullable: true },
  position_id: {
    type: 'number',
    description: 'Position id of the transfer',
    nullable: true,
    optional: true,
  },
  detailed_position_id: {
    type: 'number',
    description: 'Detailed position id of the transfer',
    nullable: true,
    optional: true,
  },
  date: { type: 'string', description: 'Date of the transfer', nullable: true },
  career_ended: {
    type: 'boolean',
    description: 'Whether the transfer ended the career',
    optional: true,
  },
  completed: { type: 'boolean', description: 'Whether the transfer is completed', optional: true },
  amount: { type: 'number', description: 'Transfer fee amount', nullable: true, optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for an Expected (xG) by-team value.
 * @see https://docs.sportmonks.com/v3/endpoints-and-entities/entities/expected
 */
export const SPORTMONKS_EXPECTED_TEAM_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the expected value' },
  fixture_id: { type: 'number', description: 'Fixture related to the value' },
  type_id: { type: 'number', description: 'Type of the expected value' },
  participant_id: { type: 'number', description: 'Team related to the expected value' },
  data: {
    type: 'object',
    description: 'The expected value payload',
    properties: { value: { type: 'number', description: 'The xG value' } },
  },
  location: { type: 'string', description: 'Home or away', nullable: true, optional: true },
} as const satisfies Record<string, OutputProperty>

/** Output property definitions for an Expected (xG) by-player value. */
export const SPORTMONKS_EXPECTED_PLAYER_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the expected value' },
  fixture_id: { type: 'number', description: 'Fixture related to the value' },
  player_id: { type: 'number', description: 'Player related to the value' },
  team_id: {
    type: 'number',
    description: 'Team related to the value',
    nullable: true,
    optional: true,
  },
  lineup_id: {
    type: 'number',
    description: 'Lineup record the player relates to',
    nullable: true,
    optional: true,
  },
  type_id: { type: 'number', description: 'Type of the expected value' },
  data: {
    type: 'object',
    description: 'The expected value payload',
    properties: { value: { type: 'number', description: 'The xG value' } },
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Prediction / Value Bet object.
 * @see https://docs.sportmonks.com/v3/endpoints-and-entities/entities/odd-and-prediction
 */
export const SPORTMONKS_PREDICTION_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the prediction' },
  fixture_id: { type: 'number', description: 'Fixture related to the prediction' },
  predictions: {
    type: 'json',
    description: 'Prediction payload (varies by type: score map, value bet object, etc.)',
  },
  type_id: { type: 'number', description: 'Type of the prediction' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Commentary object.
 * @see https://docs.sportmonks.com/v3/endpoints-and-entities/entities/other
 */
export const SPORTMONKS_COMMENTARY_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the commentary' },
  fixture_id: { type: 'number', description: 'Fixture related to the commentary' },
  comment: { type: 'string', description: 'The commentary text' },
  minute: {
    type: 'number',
    description: 'Match minute of the comment',
    nullable: true,
    optional: true,
  },
  extra_minute: {
    type: 'number',
    description: 'Extra (injury) minute of the comment',
    nullable: true,
    optional: true,
  },
  is_goal: { type: 'boolean', description: 'Whether the comment is a goal', optional: true },
  is_important: {
    type: 'boolean',
    description: 'Whether the comment is important',
    optional: true,
  },
  order: { type: 'number', description: 'Order of the comment', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a TV Station object.
 * @see https://docs.sportmonks.com/v3/endpoints-and-entities/entities/other
 */
export const SPORTMONKS_TVSTATION_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the TV station' },
  name: { type: 'string', description: 'Name of the TV station' },
  url: { type: 'string', description: 'URL of the TV station', nullable: true, optional: true },
  image_path: {
    type: 'string',
    description: 'Image path of the TV station',
    nullable: true,
    optional: true,
  },
  type: { type: 'string', description: 'Type of the TV station (tv, channel)', optional: true },
  related_id: {
    type: 'number',
    description: 'Related id of the TV station',
    nullable: true,
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Rival object.
 * @see https://docs.sportmonks.com/v3/endpoints-and-entities/entities/other
 */
export const SPORTMONKS_RIVAL_PROPERTIES = {
  sport_id: { type: 'number', description: 'Sport of the rival' },
  team_id: { type: 'number', description: 'Team the rivalry belongs to' },
  rival_id: { type: 'number', description: 'Rival team id' },
} as const satisfies Record<string, OutputProperty>

export interface SportmonksSeason {
  id: number
  sport_id: number
  league_id: number
  tie_breaker_rule_id?: number | null
  name: string
  finished?: boolean
  pending?: boolean
  is_current?: boolean
  standing_method?: string | null
  starting_at?: string | null
  ending_at?: string | null
  standings_recalculated_at?: string | null
  games_in_current_week?: boolean
}

export interface SportmonksStage {
  id: number
  sport_id: number
  league_id: number
  season_id: number
  type_id: number
  name: string
  sort_order?: number
  finished?: boolean
  is_current?: boolean
  starting_at?: string | null
  ending_at?: string | null
  games_in_current_week?: boolean
}

export interface SportmonksRound {
  id: number
  sport_id: number
  league_id: number
  season_id: number
  stage_id?: number | null
  name: string
  finished?: boolean
  is_current?: boolean
  starting_at?: string | null
  ending_at?: string | null
  games_in_current_week?: boolean
}

export interface SportmonksCoach {
  id: number
  player_id?: number | null
  sport_id: number
  country_id: number | null
  nationality_id: number | null
  city_id?: number | null
  common_name?: string
  firstname?: string | null
  lastname?: string | null
  name: string
  display_name?: string
  image_path?: string
  height?: number | null
  weight?: number | null
  date_of_birth?: string | null
  gender?: string | null
}

export interface SportmonksReferee {
  id: number
  sport_id: number
  country_id: number | null
  nationality_id?: number | null
  city_id?: number | null
  common_name?: string
  firstname?: string | null
  lastname?: string | null
  name: string
  display_name?: string
  image_path?: string
  height?: number | null
  weight?: number | null
  date_of_birth?: string | null
  gender?: string | null
}

export interface SportmonksVenue {
  id: number
  country_id: number | null
  city_id?: number | null
  name: string
  address?: string | null
  zipcode?: string | null
  latitude?: string | null
  longitude?: string | null
  capacity?: number | null
  image_path?: string | null
  city_name?: string | null
  surface?: string | null
  national_team?: boolean
}

export interface SportmonksState {
  id: number
  state: string
  name: string
  short_name?: string | null
  developer_name?: string
}

export interface SportmonksTransfer {
  id: number
  sport_id: number
  player_id: number
  type_id: number
  from_team_id: number | null
  to_team_id: number | null
  position_id?: number | null
  detailed_position_id?: number | null
  date: string | null
  career_ended?: boolean
  completed?: boolean
  amount?: number | null
}

export interface SportmonksExpectedTeam {
  id: number
  fixture_id: number
  type_id: number
  participant_id: number
  data: { value: number }
  location?: string | null
}

export interface SportmonksExpectedPlayer {
  id: number
  fixture_id: number
  player_id: number
  team_id?: number | null
  lineup_id?: number | null
  type_id: number
  data: { value: number }
}

export interface SportmonksPrediction {
  id: number
  fixture_id: number
  predictions: Record<string, unknown>
  type_id: number
}

export interface SportmonksCommentary {
  id: number
  fixture_id: number
  comment: string
  minute?: number | null
  extra_minute?: number | null
  is_goal?: boolean
  is_important?: boolean
  order?: number
}

export interface SportmonksTVStation {
  id: number
  name: string
  url?: string | null
  image_path?: string | null
  type?: string
  related_id?: number | null
}

export interface SportmonksRival {
  sport_id: number
  team_id: number
  rival_id: number
}

/**
 * Output property definitions for a News (article) object.
 * @see https://docs.sportmonks.com/v3/endpoints-and-entities/entities/other
 */
export const SPORTMONKS_NEWS_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the news article' },
  fixture_id: { type: 'number', description: 'Fixture related to the news article' },
  league_id: { type: 'number', description: 'League related to the news article' },
  title: { type: 'string', description: 'Title of the news article' },
  type: { type: 'string', description: 'Type of the news (prematch or postmatch)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Statistic object (season/stage/round).
 * @see https://docs.sportmonks.com/v3/endpoints-and-entities/entities/statistic
 */
export const SPORTMONKS_STATISTIC_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the statistic record' },
  model_id: { type: 'number', description: 'Id of the entity the statistic belongs to' },
  type_id: { type: 'number', description: 'Type of the statistic' },
  relation_id: {
    type: 'number',
    description: 'Related entity id (e.g. participant) when applicable',
    nullable: true,
    optional: true,
  },
  value: { type: 'json', description: 'Statistic value payload (varies by type)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Standing Correction object.
 * @see https://docs.sportmonks.com/v3/endpoints-and-entities/entities/standing-and-topscorer
 */
export const SPORTMONKS_STANDING_CORRECTION_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the standing correction' },
  season_id: { type: 'number', description: 'Season related to the correction' },
  stage_id: { type: 'number', description: 'Stage related to the correction', nullable: true },
  group_id: { type: 'number', description: 'Group related to the correction', nullable: true },
  type_id: { type: 'number', description: 'Type of the correction' },
  value: { type: 'number', description: 'Amount of points awarded or deducted' },
  calc_type: { type: 'string', description: 'Calculation type applied (e.g. + or -)' },
  participant_type: { type: 'string', description: 'Type of the participant (e.g. team)' },
  participant_id: { type: 'number', description: 'Participant the correction applies to' },
  active: { type: 'boolean', description: 'Whether the correction is active', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Match Fact object (beta).
 * @see https://docs.sportmonks.com/v3/endpoints-and-entities/endpoints/match-facts-beta
 */
export const SPORTMONKS_MATCH_FACT_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the match fact' },
  sport_id: { type: 'number', description: 'Sport of the match fact' },
  fixture_id: { type: 'number', description: 'Fixture related to the match fact' },
  type_id: { type: 'number', description: 'Type of the match fact' },
  participant: { type: 'string', description: 'Team the fact relates to (home or away)' },
  basis: { type: 'string', description: 'Basis of the match fact (e.g. h2h, overall)' },
  data: { type: 'json', description: 'Match fact data payload (counts and percentages)' },
  natural_language: {
    type: 'string',
    description: 'Human-readable description of the match fact',
    optional: true,
  },
  category: { type: 'string', description: 'Category of the match fact', optional: true },
  scope: { type: 'string', description: 'Scope of the match fact', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Team Ranking object (beta).
 * @see https://docs.sportmonks.com/v3/endpoints-and-entities/endpoints/team-rankings-beta
 */
export const SPORTMONKS_TEAM_RANKING_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the team ranking' },
  team_id: { type: 'number', description: 'Team related to the ranking' },
  date: { type: 'string', description: 'Date of the ranking' },
  current_rank: { type: 'number', description: 'Placement of the team on that date' },
  scaled_score: { type: 'number', description: 'Scaled score of the team (0-100)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Team of the Week (TOTW) entry.
 * @see https://docs.sportmonks.com/v3/endpoints-and-entities/endpoints/team-of-the-week-totw
 */
export const SPORTMONKS_TOTW_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the TOTW entry' },
  player_id: { type: 'number', description: 'Player of the team of the week' },
  fixture_id: { type: 'number', description: 'Fixture the TOTW player played in' },
  round_id: { type: 'number', description: 'Round the fixture is played at' },
  team_id: { type: 'number', description: 'Team the TOTW player played for' },
  rating: { type: 'string', description: 'Rating of the TOTW player' },
  formation_position: {
    type: 'number',
    description: 'Player position in the TOTW formation',
    optional: true,
  },
  formation: { type: 'string', description: "The TOTW's formation", optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Predictability object.
 * @see https://docs.sportmonks.com/v3/endpoints-and-entities/entities/odd-and-prediction
 */
export const SPORTMONKS_PREDICTABILITY_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the predictability record' },
  league_id: { type: 'number', description: 'League related to the predictability' },
  type_id: { type: 'number', description: 'Type of the predictability' },
  data: { type: 'json', description: 'Predictability values per market' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Live Probability object.
 * @see https://docs.sportmonks.com/v3/endpoints-and-entities/endpoints/predictions/get-live-probabilities
 */
export const SPORTMONKS_LIVE_PROBABILITY_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the live prediction record' },
  fixture_id: { type: 'number', description: 'Fixture the prediction belongs to' },
  period_id: { type: 'number', description: 'Match period the prediction was recorded in' },
  minute: { type: 'number', description: 'Match minute the prediction was generated' },
  predictions: {
    type: 'json',
    description: 'Home win, away win and draw probabilities as percentages',
  },
  type_id: { type: 'number', description: 'Type of the prediction (237 for fulltime result)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Transfer Rumour object.
 * @see https://docs.sportmonks.com/v3/endpoints-and-entities/endpoints/transfer-rumours
 */
export const SPORTMONKS_TRANSFER_RUMOUR_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the transfer rumour' },
  sport_id: { type: 'number', description: 'Sport of the transfer rumour' },
  player_id: { type: 'number', description: 'Player the rumour relates to' },
  position_id: {
    type: 'number',
    description: 'Position id of the player',
    nullable: true,
    optional: true,
  },
  from_team_id: {
    type: 'number',
    description: 'Team the player would transfer from',
    nullable: true,
  },
  to_team_id: { type: 'number', description: 'Team the player would transfer to', nullable: true },
  transfer_fee_id: {
    type: 'number',
    description: 'Transfer fee id of the rumour',
    nullable: true,
    optional: true,
  },
  probability: { type: 'string', description: 'Probability of the rumour (e.g. LOW)' },
  source_name: {
    type: 'string',
    description: 'Name of the source of the rumour',
    nullable: true,
    optional: true,
  },
  source_url: {
    type: 'string',
    description: 'URL of the source of the rumour',
    nullable: true,
    optional: true,
  },
  amount: { type: 'number', description: 'Estimated transfer fee amount', nullable: true },
  currency: {
    type: 'string',
    description: 'Currency of the amount',
    nullable: true,
    optional: true,
  },
  date: { type: 'string', description: 'Date of the rumour', nullable: true },
  type_id: { type: 'number', description: 'Type of the transfer rumour' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for an Expected Lineup (premium) object.
 * @see https://docs.sportmonks.com/v3/endpoints-and-entities/endpoints/premium-expected-lineups
 */
export const SPORTMONKS_EXPECTED_LINEUP_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the expected lineup record' },
  sport_id: { type: 'number', description: 'Sport of the expected lineup' },
  fixture_id: { type: 'number', description: 'Fixture the expected lineup relates to' },
  player_id: { type: 'number', description: 'Player in the expected lineup' },
  team_id: { type: 'number', description: 'Team of the expected lineup player' },
  formation_field: {
    type: 'string',
    description: 'Formation field of the player',
    nullable: true,
    optional: true,
  },
  position_id: {
    type: 'number',
    description: 'Position id of the player',
    nullable: true,
    optional: true,
  },
  detailed_position_id: {
    type: 'number',
    description: 'Detailed position id of the player',
    nullable: true,
    optional: true,
  },
  type_id: { type: 'number', description: 'Type of the expected lineup record' },
  formation_position: {
    type: 'number',
    description: 'Position of the player in the formation',
    nullable: true,
    optional: true,
  },
  player_name: { type: 'string', description: 'Name of the player', optional: true },
  jersey_number: {
    type: 'number',
    description: 'Jersey number of the player',
    nullable: true,
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export interface SportmonksNews {
  id: number
  fixture_id: number
  league_id: number
  title: string
  type: string
}

export interface SportmonksStatistic {
  id: number
  model_id: number
  type_id: number
  relation_id?: number | null
  value: Record<string, unknown>
}

export interface SportmonksStandingCorrection {
  id: number
  season_id: number
  stage_id: number | null
  group_id: number | null
  type_id: number
  value: number
  calc_type: string
  participant_type: string
  participant_id: number
  active?: boolean
}

export interface SportmonksMatchFact {
  id: number
  sport_id: number
  fixture_id: number
  type_id: number
  participant: string
  basis: string
  data: Record<string, unknown>
  natural_language?: string
  category?: string
  scope?: string
}

export interface SportmonksTeamRanking {
  id: number
  team_id: number
  date: string
  current_rank: number
  scaled_score: number
}

export interface SportmonksTotw {
  id: number
  player_id: number
  fixture_id: number
  round_id: number
  team_id: number
  rating: string
  formation_position?: number
  formation?: string
}

export interface SportmonksPredictability {
  id: number
  league_id: number
  type_id: number
  data: Record<string, unknown>
}

export interface SportmonksLiveProbability {
  id: number
  fixture_id: number
  period_id: number
  minute: number
  predictions: Record<string, unknown>
  type_id: number
}

export interface SportmonksTransferRumour {
  id: number
  sport_id: number
  player_id: number
  position_id?: number | null
  from_team_id: number | null
  to_team_id: number | null
  transfer_fee_id?: number | null
  probability: string
  source_name?: string | null
  source_url?: string | null
  amount: number | null
  currency?: string | null
  date: string | null
  type_id: number
}

export interface SportmonksExpectedLineup {
  id: number
  sport_id: number
  fixture_id: number
  player_id: number
  team_id: number
  formation_field?: string | null
  position_id?: number | null
  detailed_position_id?: number | null
  type_id: number
  formation_position?: number | null
  player_name?: string
  jersey_number?: number | null
}
