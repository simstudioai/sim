import type { OutputProperty } from '@/tools/types'

/**
 * Base URL for the Sportmonks Core API v3 (shared reference data).
 * @see https://docs.sportmonks.com/v3/core-api/core
 */
export const SPORTMONKS_CORE_BASE_URL = 'https://api.sportmonks.com/v3/core'

/**
 * Base URL for the Sportmonks "My Sportmonks" endpoints (account/subscription
 * scoped data such as entity filters and API usage). These live under `/v3/my`
 * rather than `/v3/core` but are documented as part of the Core API.
 * @see https://docs.sportmonks.com/v3/core-api/my-sportmonks/get-my-usage
 */
export const SPORTMONKS_MY_BASE_URL = 'https://api.sportmonks.com/v3/my'

/**
 * Output property definitions for a Continent object.
 * @see https://docs.sportmonks.com/v3/core-api/entities/core
 */
export const SPORTMONKS_CONTINENT_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the continent' },
  name: { type: 'string', description: 'Name of the continent' },
  code: { type: 'string', description: 'Short code of the continent', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Country object.
 * @see https://docs.sportmonks.com/v3/core-api/entities/core
 */
export const SPORTMONKS_COUNTRY_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the country' },
  continent_id: { type: 'number', description: 'Continent of the country', nullable: true },
  name: { type: 'string', description: 'Name of the country' },
  official_name: { type: 'string', description: 'Official name of the country', optional: true },
  fifa_name: {
    type: 'string',
    description: 'Official FIFA short code name',
    nullable: true,
    optional: true,
  },
  iso2: { type: 'string', description: 'Two letter country code', nullable: true, optional: true },
  iso3: {
    type: 'string',
    description: 'Three letter country code',
    nullable: true,
    optional: true,
  },
  latitude: {
    type: 'string',
    description: 'Latitude position of the country',
    nullable: true,
    optional: true,
  },
  longitude: {
    type: 'string',
    description: 'Longitude position of the country',
    nullable: true,
    optional: true,
  },
  geonameid: { type: 'number', description: 'Official geonameid', nullable: true, optional: true },
  borders: {
    type: 'array',
    description: 'Neighbouring countries (ISO3 codes)',
    nullable: true,
    optional: true,
    items: { type: 'string', description: 'ISO3 country code' },
  },
  image_path: { type: 'string', description: 'Image path to the country flag', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Region object.
 * @see https://docs.sportmonks.com/v3/core-api/entities/core
 */
export const SPORTMONKS_REGION_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the region' },
  country_id: { type: 'number', description: 'Country of the region' },
  name: { type: 'string', description: 'Name of the region' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a City object.
 * @see https://docs.sportmonks.com/v3/core-api/entities/core
 */
export const SPORTMONKS_CITY_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the city' },
  country_id: { type: 'number', description: 'Country of the city' },
  region_id: {
    type: 'number',
    description: 'Region id of the city',
    nullable: true,
    optional: true,
  },
  name: { type: 'string', description: 'Name of the city' },
  latitude: { type: 'string', description: 'Latitude of the city', nullable: true, optional: true },
  longitude: {
    type: 'string',
    description: 'Longitude of the city',
    nullable: true,
    optional: true,
  },
  geonameid: {
    type: 'number',
    description: 'Official geonameid of the city',
    nullable: true,
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a Type object.
 * @see https://docs.sportmonks.com/v3/core-api/entities/core
 */
export const SPORTMONKS_TYPE_PROPERTIES = {
  id: { type: 'number', description: 'Unique id of the type' },
  parent_id: { type: 'number', description: 'Parent type of the type', nullable: true },
  name: { type: 'string', description: 'Name of the type' },
  code: { type: 'string', description: 'Code of the type', nullable: true, optional: true },
  developer_name: {
    type: 'string',
    description: 'Developer name of the type',
    nullable: true,
    optional: true,
  },
  group: {
    type: 'string',
    description: 'Group the type falls under',
    nullable: true,
    optional: true,
  },
  description: {
    type: 'string',
    description: 'Description of the type',
    nullable: true,
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output property definitions for a My Sportmonks API usage record.
 * @see https://docs.sportmonks.com/v3/core-api/my-sportmonks/get-my-usage
 */
export const SPORTMONKS_USAGE_PROPERTIES = {
  id: { type: 'number', description: 'Identifier of the usage record' },
  endpoint: { type: 'string', description: 'Identifier of the requested endpoint' },
  count: { type: 'number', description: 'Total calls for the given timeframe' },
  entity: { type: 'string', description: 'The entity the rate limit applies on' },
  remaining_requests: {
    type: 'number',
    description: 'Amount of requests remaining for the entity in the hourly rate limit',
  },
  period_start: {
    type: 'number',
    description: 'Timestamp representing the aggregation start time',
  },
  period_end: {
    type: 'number',
    description: 'Timestamp representing the aggregation end time',
  },
} as const satisfies Record<string, OutputProperty>

export interface SportmonksContinent {
  id: number
  name: string
  code?: string
}

export interface SportmonksCountry {
  id: number
  continent_id: number | null
  name: string
  official_name?: string
  fifa_name?: string | null
  iso2?: string | null
  iso3?: string | null
  latitude?: string | null
  longitude?: string | null
  geonameid?: number | null
  borders?: string[] | null
  image_path?: string
}

export interface SportmonksRegion {
  id: number
  country_id: number
  name: string
}

export interface SportmonksCity {
  id: number
  country_id: number
  region_id?: number | null
  name: string
  latitude?: string | null
  longitude?: string | null
  geonameid?: number | null
}

export interface SportmonksType {
  id: number
  parent_id: number | null
  name: string
  code?: string | null
  developer_name?: string | null
  group?: string | null
  description?: string | null
}

export interface SportmonksUsage {
  id: number
  endpoint: string
  count: number
  entity: string
  remaining_requests: number
  period_start: number
  period_end: number
}

/** A single type entry as returned by the "Type by Entity" endpoint. */
export interface SportmonksTypeEntityEntry {
  id: number
  name: string
  code?: string | null
  developer_name?: string | null
  model_type?: string | null
  stat_group?: string | null
}

/** The per-entity grouping returned by the "Type by Entity" endpoint. */
export interface SportmonksTypeEntityGroup {
  updated_at: string
  types: SportmonksTypeEntityEntry[]
}

/**
 * Response shape of the "Type by Entity" endpoint: a map keyed by entity name
 * (e.g. CoachStatisticDetail) to its available types.
 */
export type SportmonksTypesByEntity = Record<string, SportmonksTypeEntityGroup>

/**
 * Response shape of the "All Entity Filters" endpoint: a map keyed by entity
 * name to the list of filter names available on that entity.
 */
export type SportmonksEntityFilters = Record<string, string[]>
