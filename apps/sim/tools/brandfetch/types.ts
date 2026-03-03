import type { ToolResponse } from '@/tools/types'

export interface BrandfetchGetBrandParams {
  apiKey: string
  identifier: string
}

export interface BrandfetchSearchParams {
  apiKey: string
  name: string
}

export interface BrandLink {
  name: string
  url: string
}

export interface BrandLogo {
  type: string
  theme: string | null
  formats: Array<{
    src: string
    format: string
    width: number | null
    height: number | null
    background: string | null
  }>
}

export interface BrandColor {
  hex: string
  type: string
  brightness: number
}

export interface BrandFont {
  name: string | null
  type: string
  origin: string
  originId: string | null
  weights: number[]
}

export interface BrandCompany {
  employees: string | null
  foundedYear: number | null
  kind: string | null
  location: {
    city: string | null
    country: string | null
    countryCode: string | null
    state: string | null
    stateCode: string | null
    region: string | null
    subRegion: string | null
  } | null
  industries: Array<{
    score: number
    id: string
    name: string
    emoji: string
    slug: string
    parent: { id: string; name: string; emoji: string; slug: string } | null
  }>
}

export interface BrandfetchGetBrandResponse extends ToolResponse {
  output: {
    id: string
    name: string | null
    domain: string
    claimed: boolean
    description: string | null
    longDescription: string | null
    links: BrandLink[]
    logos: BrandLogo[]
    colors: BrandColor[]
    fonts: BrandFont[]
    company: BrandCompany | null
    qualityScore: number | null
    isNsfw: boolean
  }
}

export interface BrandfetchSearchResult {
  brandId: string
  name: string | null
  domain: string
  claimed: boolean
  icon: string | null
}

export interface BrandfetchSearchResponse extends ToolResponse {
  output: {
    results: BrandfetchSearchResult[]
  }
}
