import type {
  RestCountriesCountry,
  RestCountriesCurrency,
  RestCountriesFlag,
  RestCountriesLanguage,
  RestCountriesResponse,
} from '@/tools/restcountries/types'

export const REST_COUNTRIES_FIELDS = [
  'name',
  'cca2',
  'cca3',
  'capital',
  'region',
  'subregion',
  'population',
  'area',
  'currencies',
  'languages',
  'timezones',
  'latlng',
  'flags',
  'maps',
].join(',')

export function buildRestCountriesUrl(path: string, query?: Record<string, string>): string {
  const url = new URL(`https://restcountries.com/v3.1/${path}`)
  url.searchParams.set('fields', REST_COUNTRIES_FIELDS)

  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value)
  }

  return url.toString()
}

export function encodeRestCountriesPathSegment(value: string): string {
  return encodeURIComponent(value.trim())
}

export async function transformRestCountriesResponse(
  response: Response
): Promise<RestCountriesResponse> {
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`REST Countries API error: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  const countries = parseCountries(data)

  return {
    success: true,
    output: {
      countries,
      count: countries.length,
      firstCountry: countries[0] ?? null,
    },
  }
}

function parseCountries(data: unknown): RestCountriesCountry[] {
  if (!Array.isArray(data)) return []
  return data.map(parseCountry)
}

function parseCountry(country: unknown): RestCountriesCountry {
  const record = asRecord(country)
  const name = asRecord(record.name)
  const maps = asRecord(record.maps)

  return {
    name: stringOrNull(name.common),
    officialName: stringOrNull(name.official),
    countryCode2: stringOrNull(record.cca2),
    countryCode3: stringOrNull(record.cca3),
    capital: stringArray(record.capital),
    region: stringOrNull(record.region),
    subregion: stringOrNull(record.subregion),
    population: numberOrNull(record.population),
    area: numberOrNull(record.area),
    currencies: parseCurrencies(record.currencies),
    languages: parseLanguages(record.languages),
    timezones: stringArray(record.timezones),
    latlng: numberArray(record.latlng),
    flag: parseFlag(record.flags),
    googleMapsUrl: stringOrNull(maps.googleMaps),
    openStreetMapsUrl: stringOrNull(maps.openStreetMaps),
  }
}

function parseCurrencies(value: unknown): RestCountriesCurrency[] {
  const currencies = asRecord(value)
  return Object.entries(currencies).map(([code, details]) => {
    const record = asRecord(details)
    return {
      code,
      name: stringOrNull(record.name),
      symbol: stringOrNull(record.symbol),
    }
  })
}

function parseLanguages(value: unknown): RestCountriesLanguage[] {
  const languages = asRecord(value)
  return Object.entries(languages).flatMap(([code, name]) => {
    if (typeof name !== 'string') return []
    return [{ code, name }]
  })
}

function parseFlag(value: unknown): RestCountriesFlag | null {
  const flag = asRecord(value)
  const png = stringOrNull(flag.png)
  const svg = stringOrNull(flag.svg)
  const alt = stringOrNull(flag.alt)

  if (!png && !svg && !alt) return null
  return { png, svg, alt }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function numberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is number => typeof item === 'number')
}
