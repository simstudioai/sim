import type { OutputProperty } from '@/tools/types'

/**
 * Base URL for the Sportmonks Motorsport API v3.
 * @see https://docs.sportmonks.com/v3/motorsport-api/welcome/welcome
 */
export const SPORTMONKS_MOTORSPORT_BASE_URL = 'https://api.sportmonks.com/v3/motorsport'

/**
 * Output property definitions for a Motorsport Fixture (session) object.
 * @see https://docs.sportmonks.com/v3/motorsport-api/endpoints-and-entities/entities/fixture
 */
export const SPORTMONKS_MS_FIXTURE_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the fixture (session)' },
  sport_id: { type: 'number', description: 'Sport of the fixture' },
  league_id: { type: 'number', description: 'League the fixture is held in' },
  season_id: { type: 'number', description: 'Season the fixture is held in' },
  stage_id: { type: 'number', description: 'Stage (race weekend) the fixture is held in' },
  group_id: {
    type: 'number',
    description: 'Not used in the Motorsport API',
    nullable: true,
    optional: true,
  },
  aggregate_id: {
    type: 'number',
    description: 'Not used in the Motorsport API',
    nullable: true,
    optional: true,
  },
  round_id: {
    type: 'number',
    description: 'Not used in the Motorsport API',
    nullable: true,
    optional: true,
  },
  state_id: { type: 'number', description: 'State the fixture is currently in' },
  venue_id: { type: 'number', description: 'Venue (track) the fixture is held at', nullable: true },
  name: {
    type: 'string',
    description: 'Name of the fixture (e.g. Practice 1, Race)',
    nullable: true,
  },
  starting_at: { type: 'string', description: 'Start date and time', nullable: true },
  result_info: { type: 'string', description: 'Final result info', nullable: true, optional: true },
  leg: {
    type: 'string',
    description: 'Stage of the fixture (e.g. 2/3 for Practice 2)',
    optional: true,
  },
  details: {
    type: 'string',
    description: 'Details about the fixture',
    nullable: true,
    optional: true,
  },
  length: {
    type: 'number',
    description: 'Session length in minutes or total laps',
    nullable: true,
    optional: true,
  },
  placeholder: {
    type: 'boolean',
    description: 'Whether the fixture is a placeholder',
    optional: true,
  },
  has_odds: { type: 'boolean', description: 'Not used in the Motorsport API', optional: true },
  has_premium_odds: {
    type: 'boolean',
    description: 'Not used in the Motorsport API',
    optional: true,
  },
  starting_at_timestamp: {
    type: 'number',
    description: 'UNIX timestamp of the start time',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Driver object.
 * @see https://docs.sportmonks.com/v3/motorsport-api/endpoints-and-entities/entities/driver
 */
export const SPORTMONKS_MS_DRIVER_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the driver (player_id in responses)' },
  sport_id: { type: 'number', description: 'Sport of the driver' },
  country_id: { type: 'number', description: 'Country of birth of the driver', nullable: true },
  nationality_id: { type: 'number', description: 'Nationality of the driver', nullable: true },
  city_id: {
    type: 'number',
    description: 'City of birth of the driver',
    nullable: true,
    optional: true,
  },
  position_id: {
    type: 'number',
    description: 'Position of the driver within the team',
    nullable: true,
    optional: true,
  },
  detailed_position_id: {
    type: 'number',
    description: 'Not used in the Motorsport API',
    nullable: true,
    optional: true,
  },
  type_id: {
    type: 'number',
    description: 'Not used in the Motorsport API',
    nullable: true,
    optional: true,
  },
  common_name: { type: 'string', description: 'Name the driver is known for', optional: true },
  firstname: { type: 'string', description: 'First name of the driver', optional: true },
  lastname: { type: 'string', description: 'Last name of the driver', optional: true },
  name: { type: 'string', description: 'Name of the driver' },
  display_name: { type: 'string', description: 'Display name of the driver', optional: true },
  image_path: { type: 'string', description: 'URL to the driver headshot', optional: true },
  height: {
    type: 'number',
    description: 'Height of the driver in cm',
    nullable: true,
    optional: true,
  },
  weight: {
    type: 'number',
    description: 'Weight of the driver in kg',
    nullable: true,
    optional: true,
  },
  date_of_birth: {
    type: 'string',
    description: 'Date of birth of the driver',
    nullable: true,
    optional: true,
  },
  gender: { type: 'string', description: 'Gender of the driver', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Motorsport Team (constructor) object.
 * @see https://docs.sportmonks.com/v3/motorsport-api/endpoints-and-entities/entities/team
 */
export const SPORTMONKS_MS_TEAM_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the team' },
  sport_id: { type: 'number', description: 'Sport of the team' },
  country_id: { type: 'number', description: 'Country of the team' },
  venue_id: {
    type: 'number',
    description: 'Not used in the Motorsport API',
    nullable: true,
    optional: true,
  },
  gender: { type: 'string', description: 'Gender of the team', optional: true },
  name: { type: 'string', description: 'Name of the team (constructor)' },
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
    description: "Date and time of the team's last session",
    nullable: true,
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Motorsport Standing object.
 * @see https://docs.sportmonks.com/v3/motorsport-api/endpoints-and-entities/entities/standing
 */
export const SPORTMONKS_MS_STANDING_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the standing' },
  participant_id: { type: 'number', description: 'Driver or team related to the standing' },
  sport_id: { type: 'number', description: 'Sport related to the standing' },
  league_id: { type: 'number', description: 'League related to the standing' },
  season_id: { type: 'number', description: 'Season related to the standing' },
  stage_id: { type: 'number', description: 'Stage related to the standing' },
  group_id: {
    type: 'number',
    description: 'Not used in the Motorsport API',
    nullable: true,
    optional: true,
  },
  round_id: {
    type: 'number',
    description: 'Not used in the Motorsport API',
    nullable: true,
    optional: true,
  },
  standing_rule_id: {
    type: 'number',
    description: 'Not used in the Motorsport API',
    nullable: true,
    optional: true,
  },
  position: { type: 'number', description: 'Position of the participant in the standing' },
  result: {
    type: 'string',
    description: 'Not used in the Motorsport API',
    nullable: true,
    optional: true,
  },
  points: { type: 'number', description: 'Points the participant has gathered' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Lap / Pitstop object (identical shape).
 * @see https://docs.sportmonks.com/v3/motorsport-api/endpoints-and-entities/entities/lap
 */
export const SPORTMONKS_MS_LAP_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the lap/pitstop' },
  fixture_id: { type: 'number', description: 'Fixture related to the lap/pitstop' },
  lap_number: { type: 'number', description: 'Lap number in the fixture' },
  driver_number: { type: 'number', description: 'Number of the driver' },
  participant_id: { type: 'number', description: 'Driver related to the lap/pitstop' },
  is_latest: { type: 'boolean', description: 'Whether it is the latest lap/pitstop' },
} as const satisfies Record<string, OutputProperty>

export interface SportmonksMsFixture {
  id: number
  sport_id: number
  league_id: number
  season_id: number
  stage_id: number
  group_id?: number | null
  aggregate_id?: number | null
  round_id?: number | null
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

export interface SportmonksMsDriver {
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

export interface SportmonksMsTeam {
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

export interface SportmonksMsStanding {
  id: number
  participant_id: number
  sport_id: number
  league_id: number
  season_id: number
  stage_id: number
  group_id?: number | null
  round_id?: number | null
  standing_rule_id?: number | null
  position: number
  result?: string | null
  points: number
}

export interface SportmonksMsLap {
  id: number
  fixture_id: number
  lap_number: number
  driver_number: number
  participant_id: number
  is_latest: boolean
}

/**
 * Output property definitions for a Stint object.
 * @see https://docs.sportmonks.com/v3/motorsport-api/endpoints-and-entities/entities/stint
 */
export const SPORTMONKS_MS_STINT_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the stint' },
  fixture_id: { type: 'number', description: 'Fixture related to the stint' },
  stint_number: { type: 'number', description: 'Stint number in the fixture' },
  driver_number: { type: 'number', description: 'Number of the driver' },
  participant_id: { type: 'number', description: 'Driver related to the stint' },
  is_latest: { type: 'boolean', description: 'Whether it is the latest stint' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Venue (racing track) object.
 * @see https://docs.sportmonks.com/v3/motorsport-api/endpoints-and-entities/entities/venue
 */
export const SPORTMONKS_MS_VENUE_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the venue (track)' },
  country_id: { type: 'number', description: 'Country the venue is in' },
  city_id: {
    type: 'number',
    description: 'City the venue is in',
    nullable: true,
    optional: true,
  },
  name: { type: 'string', description: 'Name of the venue/track' },
  address: { type: 'string', description: 'Address of the venue', nullable: true },
  zipcode: { type: 'string', description: 'Zipcode of the venue', nullable: true },
  latitude: { type: 'string', description: 'Latitude of the venue', nullable: true },
  longitude: { type: 'string', description: 'Longitude of the venue', nullable: true },
  capacity: { type: 'number', description: 'Capacity of the venue', nullable: true },
  image_path: {
    type: 'string',
    description: 'URL to the track layout image',
    nullable: true,
    optional: true,
  },
  city_name: { type: 'string', description: 'Name of the city the venue is in', nullable: true },
  surface: { type: 'string', description: 'Surface of the venue', nullable: true },
  national_team: {
    type: 'boolean',
    description: 'Not used in the Motorsport API',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Motorsport League object.
 * @see https://docs.sportmonks.com/v3/motorsport-api/endpoints-and-entities/entities/league
 */
export const SPORTMONKS_MS_LEAGUE_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the league' },
  sport_id: { type: 'number', description: 'Sport of the league' },
  country_id: { type: 'number', description: 'Country of the league' },
  name: { type: 'string', description: 'Name of the league' },
  active: { type: 'boolean', description: 'Whether the league is active' },
  short_code: { type: 'string', description: 'Short code of the league', nullable: true },
  image_path: {
    type: 'string',
    description: 'URL to the league logo',
    nullable: true,
    optional: true,
  },
  type: { type: 'string', description: 'Type of the league', optional: true },
  sub_type: {
    type: 'string',
    description: 'Subtype of the league',
    nullable: true,
    optional: true,
  },
  last_played_at: {
    type: 'string',
    description: 'Date of the last fixture held in the league',
    nullable: true,
  },
  category: {
    type: 'number',
    description: 'Category of the league',
    nullable: true,
    optional: true,
  },
  has_jerseys: {
    type: 'boolean',
    description: 'Not used in the Motorsport API',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Motorsport Season object.
 * @see https://docs.sportmonks.com/v3/motorsport-api/endpoints-and-entities/entities/season
 */
export const SPORTMONKS_MS_SEASON_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the season' },
  sport_id: { type: 'number', description: 'Sport of the season' },
  league_id: { type: 'number', description: 'League of the season' },
  tie_breaker_rule_id: {
    type: 'number',
    description: 'Not used in the Motorsport API',
    nullable: true,
    optional: true,
  },
  name: { type: 'string', description: 'Name of the season' },
  finished: { type: 'boolean', description: 'Whether the season is finished' },
  pending: { type: 'boolean', description: 'Whether the season is pending' },
  is_current: { type: 'boolean', description: 'Whether the season is the current season' },
  starting_at: { type: 'string', description: 'Starting date of the season', nullable: true },
  ending_at: { type: 'string', description: 'Ending date of the season', nullable: true },
  standings_recalculated_at: {
    type: 'string',
    description: 'Timestamp when standings were last updated',
    nullable: true,
    optional: true,
  },
  games_in_current_week: {
    type: 'boolean',
    description: 'Not used in the Motorsport API',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Motorsport Stage (race weekend) object.
 * @see https://docs.sportmonks.com/v3/motorsport-api/endpoints-and-entities/entities/stage
 */
export const SPORTMONKS_MS_STAGE_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the stage (race weekend)' },
  sport_id: { type: 'number', description: 'Sport of the stage' },
  league_id: { type: 'number', description: 'League related to the stage' },
  season_id: { type: 'number', description: 'Season related to the stage' },
  type_id: { type: 'number', description: 'Type of the stage', nullable: true },
  name: { type: 'string', description: 'Name of the stage' },
  sort_order: {
    type: 'number',
    description: 'Order of the stage',
    nullable: true,
    optional: true,
  },
  finished: { type: 'boolean', description: 'Whether the stage is finished' },
  is_current: { type: 'boolean', description: 'Whether the stage is the current stage' },
  starting_at: { type: 'string', description: 'Starting date of the stage', nullable: true },
  ending_at: { type: 'string', description: 'Ending date of the stage', nullable: true },
  games_in_current_week: {
    type: 'boolean',
    description: 'Not used in the Motorsport API',
    optional: true,
  },
  tie_breaker_rule_id: {
    type: 'number',
    description: 'Not used in the Motorsport API',
    nullable: true,
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Motorsport State (fixture status) object.
 * @see https://docs.sportmonks.com/v3/motorsport-api/endpoints-and-entities/entities/state
 */
export const SPORTMONKS_MS_STATE_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the state' },
  state: { type: 'string', description: 'Abbreviation of the state' },
  name: { type: 'string', description: 'Full name of the state' },
  short_name: {
    type: 'string',
    description: 'Short name of the state',
    nullable: true,
    optional: true,
  },
  developer_name: {
    type: 'string',
    description: 'Name recommended for developers to use',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export interface SportmonksMsStint {
  id: number
  fixture_id: number
  stint_number: number
  driver_number: number
  participant_id: number
  is_latest: boolean
}

export interface SportmonksMsVenue {
  id: number
  country_id: number
  city_id?: number | null
  name: string
  address: string | null
  zipcode: string | null
  latitude: string | null
  longitude: string | null
  capacity: number | null
  image_path?: string | null
  city_name: string | null
  surface: string | null
  national_team?: boolean
}

export interface SportmonksMsLeague {
  id: number
  sport_id: number
  country_id: number
  name: string
  active: boolean
  short_code: string | null
  image_path?: string | null
  type?: string
  sub_type?: string | null
  last_played_at: string | null
  category?: number | null
  has_jerseys?: boolean
}

export interface SportmonksMsSeason {
  id: number
  sport_id: number
  league_id: number
  tie_breaker_rule_id?: number | null
  name: string
  finished: boolean
  pending: boolean
  is_current: boolean
  starting_at: string | null
  ending_at: string | null
  standings_recalculated_at?: string | null
  games_in_current_week?: boolean
}

export interface SportmonksMsStage {
  id: number
  sport_id: number
  league_id: number
  season_id: number
  type_id: number | null
  name: string
  sort_order?: number | null
  finished: boolean
  is_current: boolean
  starting_at: string | null
  ending_at: string | null
  games_in_current_week?: boolean
  tie_breaker_rule_id?: number | null
}

export interface SportmonksMsState {
  id: number
  state: string
  name: string
  short_name?: string | null
  developer_name?: string
}
