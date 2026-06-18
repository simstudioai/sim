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
  season_id: { type: 'number', description: 'Season related to the topscorer' },
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
  season_id: number
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
