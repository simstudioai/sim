import type { ToolResponse } from '@/tools/types'

export interface RestCountriesSearchByNameParams {
  name: string
  fullText?: boolean
}

export interface RestCountriesGetByCodeParams {
  code: string
}

export interface RestCountriesListByRegionParams {
  region: string
}

export interface RestCountriesListByCurrencyParams {
  currency: string
}

export interface RestCountriesListByLanguageParams {
  language: string
}

export interface RestCountriesCurrency {
  code: string
  name: string | null
  symbol: string | null
}

export interface RestCountriesLanguage {
  code: string
  name: string
}

export interface RestCountriesFlag {
  png: string | null
  svg: string | null
  alt: string | null
}

export interface RestCountriesCountry {
  name: string | null
  officialName: string | null
  countryCode2: string | null
  countryCode3: string | null
  capital: string[]
  region: string | null
  subregion: string | null
  population: number | null
  area: number | null
  currencies: RestCountriesCurrency[]
  languages: RestCountriesLanguage[]
  timezones: string[]
  latlng: number[]
  flag: RestCountriesFlag | null
  googleMapsUrl: string | null
  openStreetMapsUrl: string | null
}

export interface RestCountriesResponse extends ToolResponse {
  output: {
    countries: RestCountriesCountry[]
    count: number
    firstCountry: RestCountriesCountry | null
  }
}
