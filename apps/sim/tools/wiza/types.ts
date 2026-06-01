import type { ToolResponse } from '@/tools/types'

export interface WizaGetCreditsParams {
  apiKey: string
}

export interface WizaGetCreditsResponse extends ToolResponse {
  output: {
    email_credits: number | string | null
    phone_credits: number | string | null
    export_credits: number | null
    api_credits: number | null
  }
}

export interface WizaIncludeExcludeFilter {
  v: string
  s: 'i' | 'e'
}

export interface WizaLocationFilter {
  v: string | { country?: string; state?: string; city?: string }
  b: 'country' | 'state' | 'city'
  s: 'i' | 'e'
}

export interface WizaProspectSearchParams {
  apiKey: string
  size?: number
  filters?: Record<string, unknown>
  first_name?: string[]
  last_name?: string[]
  job_title?: WizaIncludeExcludeFilter[]
  job_title_level?: string[]
  job_role?: string[]
  job_sub_role?: string[]
  location?: WizaLocationFilter[]
  skill?: string[]
  school?: string[]
  major?: string[]
  linkedin_slug?: string[]
  job_company?: WizaIncludeExcludeFilter[]
  past_company?: WizaIncludeExcludeFilter[]
  company_location?: WizaLocationFilter[]
  company_industry?: WizaIncludeExcludeFilter[]
  company_size?: string[]
  company_type?: string[]
}

interface WizaProspectProfile {
  full_name: string | null
  linkedin_url: string | null
  industry: string | null
  job_title: string | null
  job_title_role: string | null
  job_title_sub_role: string | null
  job_company_name: string | null
  job_company_website: string | null
  location_name: string | null
}

export interface WizaProspectSearchResponse extends ToolResponse {
  output: {
    total: number
    profiles: WizaProspectProfile[]
  }
}

export interface WizaCompanyEnrichmentParams {
  apiKey: string
  company_name?: string
  company_domain?: string
  company_linkedin_id?: string
  company_linkedin_slug?: string
}

export interface WizaCompanyEnrichmentResponse extends ToolResponse {
  output: {
    company_name: string | null
    company_domain: string | null
    domain: string | null
    company_industry: string | null
    company_size: number | null
    company_size_range: string | null
    company_founded: number | null
    company_revenue_range: string | null
    company_funding: string | null
    company_type: string | null
    company_description: string | null
    company_ticker: string | null
    company_last_funding_round: string | null
    company_last_funding_amount: string | null
    company_last_funding_at: string | null
    company_location: string | null
    company_twitter: string | null
    company_facebook: string | null
    company_linkedin: string | null
    company_linkedin_id: string | null
    company_street: string | null
    company_locality: string | null
    company_region: string | null
    company_postal_code: string | null
    company_country: string | null
    credits: Record<string, unknown> | null
  }
}

export interface WizaIndividualRevealParams {
  apiKey: string
  enrichment_level: 'none' | 'partial' | 'phone' | 'full'
  profile_url?: string
  full_name?: string
  company?: string
  domain?: string
  email?: string
  accept_work?: boolean
  accept_personal?: boolean
}

export interface WizaIndividualRevealData {
  id: number | null
  status: string | null
  is_complete: boolean | null
  name: string | null
  company: string | null
  enrichment_level: string | null
  linkedin_profile_url: string | null
  title: string | null
  location: string | null
  email: string | null
  email_type: string | null
  email_status: string | null
  emails: Array<{
    email: string | null
    email_type: string | null
    email_status: string | null
  }>
  mobile_phone: string | null
  phone_number: string | null
  phone_status: string | null
  phones: Array<{
    number: string | null
    pretty_number: string | null
    type: string | null
  }>
  company_size: number | null
  company_size_range: string | null
  company_type: string | null
  company_domain: string | null
  company_locality: string | null
  company_region: string | null
  company_country: string | null
  company_street: string | null
  company_postal_code: string | null
  company_founded: number | null
  company_funding: string | null
  company_revenue: string | null
  company_industry: string | null
  company_subindustry: string | null
  company_linkedin: string | null
  company_location: string | null
  company_description: string | null
  credits: Record<string, unknown> | null
}

export interface WizaIndividualRevealResponse extends ToolResponse {
  output: WizaIndividualRevealData
}

export type WizaResponse =
  | WizaGetCreditsResponse
  | WizaProspectSearchResponse
  | WizaCompanyEnrichmentResponse
  | WizaIndividualRevealResponse
