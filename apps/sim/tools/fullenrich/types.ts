import type { OutputProperty, ToolResponse } from '@/tools/types'

export interface FullEnrichBaseParams {
  apiKey: string
}

export interface FullEnrichStartContactEnrichmentParams extends FullEnrichBaseParams {
  name: string
  data: unknown
  webhookUrl?: string
  contactFinishedWebhookUrl?: string
}

export interface FullEnrichGetContactEnrichmentParams extends FullEnrichBaseParams {
  enrichmentId: string
  forceResults?: boolean
}

export interface FullEnrichStartReverseEmailParams extends FullEnrichBaseParams {
  name: string
  data: unknown
  webhookUrl?: string
  contactFinishedWebhookUrl?: string
}

export interface FullEnrichGetReverseEmailParams extends FullEnrichBaseParams {
  enrichmentId: string
}

export interface FullEnrichSearchParams extends FullEnrichBaseParams {
  filters?: unknown
  offset?: number
  limit?: number
  searchAfter?: string
}

export interface FullEnrichLookupPersonParams extends FullEnrichBaseParams {
  personName?: string
  personProfessionalNetworkUrl?: string
  personProfessionalNetworkId?: number
  companyProfessionalNetworkUrl?: string
  companyProfessionalNetworkId?: number
  companyDomain?: string
}

export interface FullEnrichLookupCompanyParams extends FullEnrichBaseParams {
  domain?: string
  professionalNetworkUrl?: string
  professionalNetworkId?: number
}

export interface FullEnrichPerson {
  id?: string
  full_name?: string
  first_name?: string
  last_name?: string
  headline?: string
  description?: string
  location?: Record<string, unknown>
  social_profiles?: Record<string, unknown>
  educations?: Array<Record<string, unknown>>
  languages?: Array<Record<string, unknown>>
  skills?: string[]
  employment?: Record<string, unknown>
}

export interface FullEnrichCompany {
  id?: string
  name?: string
  domain?: string
  website?: string
  description?: string
  year_founded?: number
  headcount?: number
  headcount_range?: string
  company_type?: string
  locations?: Record<string, unknown>
  social_profiles?: Record<string, unknown>
  specialties?: string[]
  industry?: Record<string, unknown>
  logo_url?: string
}

export interface FullEnrichAsyncStartResponse extends ToolResponse {
  output: {
    enrichmentId: string
  }
}

export interface FullEnrichGetEnrichmentResponse extends ToolResponse {
  output: {
    id: string
    name: string
    status: string
    records: Array<Record<string, unknown>>
    costCredits: number
  }
}

export interface FullEnrichSearchPeopleResponse extends ToolResponse {
  output: {
    people: FullEnrichPerson[]
    total: number
    credits: number
    offset: number
    searchAfter: string | null
  }
}

export interface FullEnrichSearchCompaniesResponse extends ToolResponse {
  output: {
    companies: FullEnrichCompany[]
    total: number
    credits: number
    offset: number
    searchAfter: string | null
  }
}

export interface FullEnrichLookupPeopleResponse extends ToolResponse {
  output: {
    people: FullEnrichPerson[]
    credits: number
  }
}

export interface FullEnrichLookupCompaniesResponse extends ToolResponse {
  output: {
    companies: FullEnrichCompany[]
    credits: number
  }
}

export const FULLENRICH_PERSON_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'People returned by FullEnrich',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'FullEnrich person identifier' },
      full_name: { type: 'string', description: 'Full name' },
      first_name: { type: 'string', description: 'First name' },
      last_name: { type: 'string', description: 'Last name' },
      headline: { type: 'string', description: 'Professional headline' },
      description: { type: 'string', description: 'Professional profile summary' },
      location: { type: 'json', description: 'Structured person location' },
      social_profiles: { type: 'json', description: 'Professional-network profile details' },
      educations: { type: 'json', description: 'Education history' },
      languages: { type: 'json', description: 'Languages and proficiency' },
      skills: { type: 'json', description: 'Professional skills' },
      employment: { type: 'json', description: 'Current and past employment' },
    },
  },
}

export const FULLENRICH_COMPANY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Companies returned by FullEnrich',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'FullEnrich company identifier' },
      name: { type: 'string', description: 'Company name' },
      domain: { type: 'string', description: 'Company domain' },
      website: { type: 'string', description: 'Company website' },
      description: { type: 'string', description: 'Company description' },
      year_founded: { type: 'number', description: 'Year founded' },
      headcount: { type: 'number', description: 'Exact employee count' },
      headcount_range: { type: 'string', description: 'Employee-count range' },
      company_type: { type: 'string', description: 'Company type' },
      locations: { type: 'json', description: 'Headquarters and office locations' },
      social_profiles: { type: 'json', description: 'Professional-network profile details' },
      specialties: { type: 'json', description: 'Company specialties' },
      industry: { type: 'json', description: 'Company industry information' },
      logo_url: { type: 'string', description: 'FullEnrich-hosted company logo URL' },
    },
  },
}

export type FullEnrichResponse =
  | FullEnrichAsyncStartResponse
  | FullEnrichGetEnrichmentResponse
  | FullEnrichSearchPeopleResponse
  | FullEnrichSearchCompaniesResponse
  | FullEnrichLookupPeopleResponse
  | FullEnrichLookupCompaniesResponse
