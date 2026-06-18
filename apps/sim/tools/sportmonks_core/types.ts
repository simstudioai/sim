import type { OutputProperty } from '@/tools/types'

/**
 * Base URL for the Sportmonks Core API v3 (shared reference data).
 * @see https://docs.sportmonks.com/v3/core-api/core
 */
export const SPORTMONKS_CORE_BASE_URL = 'https://api.sportmonks.com/v3/core'

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
  region: { type: 'number', description: 'Region of the city', nullable: true, optional: true },
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
  region?: number | null
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
