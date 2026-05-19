import type { OutputProperty, ToolResponse } from '@/tools/types'

export interface ProspeoBaseParams {
  apiKey: string
}

export interface ProspeoPersonData {
  first_name?: string
  last_name?: string
  full_name?: string
  linkedin_url?: string
  email?: string
  company_name?: string
  company_website?: string
  company_linkedin_url?: string
  person_id?: string
}

export interface ProspeoCompanyData {
  company_name?: string
  company_website?: string
  company_linkedin_url?: string
  company_id?: string
}

export interface ProspeoPaginationOutput {
  current_page: number
  per_page: number
  total_page: number
  total_count: number
}

export const PROSPEO_PAGINATION_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Pagination details',
  optional: true,
  properties: {
    current_page: { type: 'number', description: 'Current page number' },
    per_page: { type: 'number', description: 'Results per page' },
    total_page: { type: 'number', description: 'Total number of pages' },
    total_count: { type: 'number', description: 'Total number of matching records' },
  },
}

/** Account Information */
export interface ProspeoAccountInformationParams extends ProspeoBaseParams {}

export interface ProspeoAccountInformationResponse extends ToolResponse {
  output: {
    current_plan: string | null
    current_team_members: number | null
    remaining_credits: number | null
    used_credits: number | null
    next_quota_renewal_days: number | null
    next_quota_renewal_date: string | null
  }
}

/** Enrich Person */
export interface ProspeoEnrichPersonParams extends ProspeoBaseParams, ProspeoPersonData {
  only_verified_email?: boolean
  enrich_mobile?: boolean
  only_verified_mobile?: boolean
}

export interface ProspeoEnrichPersonResponse extends ToolResponse {
  output: {
    free_enrichment: boolean
    person: Record<string, unknown> | null
    company: Record<string, unknown> | null
  }
}

/** Enrich Company */
export interface ProspeoEnrichCompanyParams extends ProspeoBaseParams, ProspeoCompanyData {}

export interface ProspeoEnrichCompanyResponse extends ToolResponse {
  output: {
    free_enrichment: boolean
    company: Record<string, unknown> | null
  }
}

/** Bulk Enrich Person */
export interface ProspeoBulkEnrichPersonParams extends ProspeoBaseParams {
  data: Array<ProspeoPersonData & { identifier: string }>
  only_verified_email?: boolean
  enrich_mobile?: boolean
  only_verified_mobile?: boolean
}

export interface ProspeoBulkEnrichPersonResponse extends ToolResponse {
  output: {
    total_cost: number
    matched: Array<{
      identifier: string
      person: Record<string, unknown> | null
      company: Record<string, unknown> | null
    }>
    not_matched: string[]
    invalid_datapoints: string[]
  }
}

/** Bulk Enrich Company */
export interface ProspeoBulkEnrichCompanyParams extends ProspeoBaseParams {
  data: Array<ProspeoCompanyData & { identifier: string }>
}

export interface ProspeoBulkEnrichCompanyResponse extends ToolResponse {
  output: {
    total_cost: number
    matched: Array<{
      identifier: string
      company: Record<string, unknown> | null
    }>
    not_matched: string[]
    invalid_datapoints: string[]
  }
}

/** Search Person */
export interface ProspeoSearchPersonParams extends ProspeoBaseParams {
  filters: Record<string, unknown> | string
  page?: number
}

export interface ProspeoSearchPersonResponse extends ToolResponse {
  output: {
    free: boolean
    results: Array<{
      person: Record<string, unknown> | null
      company: Record<string, unknown> | null
    }>
    pagination: ProspeoPaginationOutput | null
  }
}

/** Search Company */
export interface ProspeoSearchCompanyParams extends ProspeoBaseParams {
  filters: Record<string, unknown> | string
  page?: number
}

export interface ProspeoSearchCompanyResponse extends ToolResponse {
  output: {
    free: boolean
    results: Array<{
      company: Record<string, unknown> | null
    }>
    pagination: ProspeoPaginationOutput | null
  }
}

/** Search Suggestions */
export interface ProspeoSearchSuggestionsParams extends ProspeoBaseParams {
  location_search?: string
  job_title_search?: string
}

export interface ProspeoSearchSuggestionsResponse extends ToolResponse {
  output: {
    location_suggestions: Array<{ name: string; type: string }>
    job_title_suggestions: string[]
  }
}

export type ProspeoResponse =
  | ProspeoAccountInformationResponse
  | ProspeoEnrichPersonResponse
  | ProspeoEnrichCompanyResponse
  | ProspeoBulkEnrichPersonResponse
  | ProspeoBulkEnrichCompanyResponse
  | ProspeoSearchPersonResponse
  | ProspeoSearchCompanyResponse
  | ProspeoSearchSuggestionsResponse

/**
 * Build a Prospeo API error message from a non-OK response payload.
 */
export async function extractProspeoError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as {
      error_code?: string
      filter_error?: string
      message?: string
    }
    const parts = [data.error_code, data.filter_error, data.message].filter(Boolean)
    if (parts.length > 0) return parts.join(': ')
  } catch {}
  return `Prospeo API error: ${response.status}`
}
