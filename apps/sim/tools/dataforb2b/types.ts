import type { ToolResponse } from '@/tools/types'

/**
 * Shared types and constants for the DataForB2B tools.
 *
 * DataForB2B (https://api.dataforb2b.ai) is a B2B data API for searching and
 * enriching companies and professional (LinkedIn) profiles. Auth is the
 * `api_key` request header; get a key at https://app.dataforb2b.ai.
 *
 * Keeps parity with the Dify / Flowise / Langflow / n8n integrations: the same
 * six endpoints and the same `{op, conditions:[{column,type,value,value2?}]}`
 * filter shape. The Dify plugin is the source of truth for the contract.
 */

export const API_BASE = 'https://api.dataforb2b.ai'

export const FILTER_OPERATORS = [
  '=',
  '!=',
  'like',
  'not_like',
  'in',
  'not_in',
  '>',
  '>=',
  '<',
  '<=',
  'between',
] as const

// Source of truth: reference_dataforb2b_search_columns / the Dify plugin.
export const PEOPLE_COLUMNS = [
  'first_name',
  'last_name',
  'profile_location',
  'profile_country',
  'profile_industry',
  'follower_count',
  'keyword',
  'current_company',
  'current_title',
  'current_job_location',
  'current_company_industry',
  'current_company_category',
  'current_company_size',
  'current_company_id',
  'current_employment_type',
  'years_in_current_position',
  'years_at_current_company',
  'current_company_has_funding',
  'current_company_funding_stage',
  'current_company_investor',
  'past_company',
  'past_title',
  'past_job_location',
  'past_company_industry',
  'past_company_size',
  'past_company_id',
  'past_employment_type',
  'years_at_past_company',
  'skill',
  'school',
  'degree',
  'degree_level',
  'field_of_study',
  'language',
  'language_iso',
  'language_proficiency',
  'certification',
  'certification_authority',
  'years_of_experience',
  'num_total_jobs',
  'is_currently_employed',
] as const

export const COMPANY_COLUMNS = [
  'name',
  'tagline',
  'description',
  'domain',
  'universal_name',
  'keyword',
  'industry',
  'employee_count',
  'country_iso_code',
  'city',
  'region',
  'office_country',
  'office_city',
  'office_region',
  'employee_growth_1m',
  'employee_growth_6m',
  'employee_growth_12m',
  'recent_hires_count',
  'founded_year',
  'company_type',
  'follower_count',
  'page_verified',
  'category',
  'last_funding_amount_usd',
  'last_funding_date',
  'funding_stage_normalized',
  'has_funding',
] as const

export const TYPEAHEAD_TYPES = [
  'company',
  'people_industry',
  'company_industry',
  'category',
  'location',
  'city',
  'region',
  'school',
  'title',
  'skill',
  'investor',
] as const

export interface DataForB2BCondition {
  column: string
  type: string
  value: unknown
  value2?: unknown
}

export interface DataForB2BFilters {
  op?: 'and' | 'or'
  conditions: DataForB2BCondition[]
}

// --- Search (people / companies) ---------------------------------------------

export interface DataForB2BSearchParams {
  apiKey: string
  filters: DataForB2BFilters | string
  count?: number
  offset?: number
}

export interface DataForB2BSearchResponse extends ToolResponse {
  output: {
    results: unknown[]
    total: number
    count: number
  }
}

// --- Reasoning search --------------------------------------------------------

export interface DataForB2BReasoningParams {
  apiKey: string
  query?: string
  category?: 'people' | 'companies'
  max_results?: number
  session_id?: string
  answers?: Record<string, string> | string
}

export interface DataForB2BReasoningResponse extends ToolResponse {
  output: {
    status: string
    results: unknown[]
    total: number
    count: number
    session_id: string | null
    questions: unknown[]
    applied_filters: unknown
  }
}

// --- Typeahead ---------------------------------------------------------------

export interface DataForB2BTypeaheadParams {
  apiKey: string
  type: string
  q: string
  limit?: number
}

export interface DataForB2BTypeaheadResponse extends ToolResponse {
  output: {
    results: unknown[]
  }
}

// --- Enrich profile ----------------------------------------------------------

export interface DataForB2BEnrichProfileParams {
  apiKey: string
  profile_identifier: string
  enrich_profile?: boolean
  enrich_work_email?: boolean
  enrich_personal_email?: boolean
  enrich_phone?: boolean
  enrich_github?: boolean
}

export interface DataForB2BEnrichProfileResponse extends ToolResponse {
  output: {
    profile: Record<string, unknown>
    work_email: unknown
    personal_email: unknown
    phone: unknown
    git_profile: unknown
  }
}

// --- Enrich company ----------------------------------------------------------

export interface DataForB2BEnrichCompanyParams {
  apiKey: string
  company_identifier: string
}

export interface DataForB2BEnrichCompanyResponse extends ToolResponse {
  output: {
    company: Record<string, unknown>
  }
}

// --- Shared helpers ----------------------------------------------------------

/** Accept either a parsed object or a JSON string for object/array params. */
export function parseJson<T>(value: T | string | undefined): T | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'string') return JSON.parse(value) as T
  return value
}

export function authHeaders(apiKey: string): Record<string, string> {
  return {
    api_key: apiKey,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}
