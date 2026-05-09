import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Output property definitions for People Data Labs API responses.
 * Reference: https://docs.peopledatalabs.com/docs
 */

export const PDL_PERSON_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'PDL person ID', optional: true },
  full_name: { type: 'string', description: 'Full name', optional: true },
  first_name: { type: 'string', description: 'First name', optional: true },
  last_name: { type: 'string', description: 'Last name', optional: true },
  gender: { type: 'string', description: 'Gender', optional: true },
  birth_year: { type: 'number', description: 'Birth year', optional: true },
  linkedin_url: { type: 'string', description: 'LinkedIn profile URL', optional: true },
  linkedin_username: { type: 'string', description: 'LinkedIn username', optional: true },
  twitter_url: { type: 'string', description: 'Twitter profile URL', optional: true },
  github_url: { type: 'string', description: 'GitHub profile URL', optional: true },
  facebook_url: { type: 'string', description: 'Facebook profile URL', optional: true },
  work_email: { type: 'string', description: 'Primary work email', optional: true },
  personal_emails: {
    type: 'array',
    description: 'Personal email addresses',
    optional: true,
    items: { type: 'string', description: 'Email address' },
  },
  emails: {
    type: 'array',
    description: 'All known email addresses',
    optional: true,
    items: { type: 'object', description: 'Email entry' },
  },
  phone_numbers: {
    type: 'array',
    description: 'Known phone numbers',
    optional: true,
    items: { type: 'string', description: 'Phone number' },
  },
  mobile_phone: { type: 'string', description: 'Mobile phone number', optional: true },
  job_title: { type: 'string', description: 'Current job title', optional: true },
  job_title_role: { type: 'string', description: 'Normalized job role', optional: true },
  job_title_sub_role: {
    type: 'string',
    description: 'Normalized job sub-role',
    optional: true,
  },
  job_title_levels: {
    type: 'array',
    description: 'Seniority levels (e.g., manager, director)',
    optional: true,
    items: { type: 'string', description: 'Level' },
  },
  job_company_name: { type: 'string', description: 'Current employer name', optional: true },
  job_company_website: {
    type: 'string',
    description: 'Current employer website',
    optional: true,
  },
  job_company_industry: {
    type: 'string',
    description: 'Current employer industry',
    optional: true,
  },
  job_company_size: { type: 'string', description: 'Current employer size band', optional: true },
  job_company_linkedin_url: {
    type: 'string',
    description: "Current employer's LinkedIn URL",
    optional: true,
  },
  job_start_date: {
    type: 'string',
    description: 'Start date at current employer (YYYY-MM)',
    optional: true,
  },
  location_name: { type: 'string', description: 'Full location name', optional: true },
  location_locality: { type: 'string', description: 'City', optional: true },
  location_region: { type: 'string', description: 'State/region', optional: true },
  location_country: { type: 'string', description: 'Country', optional: true },
  location_continent: { type: 'string', description: 'Continent', optional: true },
  industry: { type: 'string', description: 'Industry', optional: true },
  skills: {
    type: 'array',
    description: 'Skills',
    optional: true,
    items: { type: 'string', description: 'Skill name' },
  },
  interests: {
    type: 'array',
    description: 'Interests',
    optional: true,
    items: { type: 'string', description: 'Interest' },
  },
  experience: {
    type: 'array',
    description: 'Work history entries',
    optional: true,
    items: { type: 'object', description: 'Job experience' },
  },
  education: {
    type: 'array',
    description: 'Education history',
    optional: true,
    items: { type: 'object', description: 'Education entry' },
  },
} as const satisfies Record<string, OutputProperty>

export const PDL_COMPANY_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'PDL company ID', optional: true },
  name: { type: 'string', description: 'Company name', optional: true },
  display_name: { type: 'string', description: 'Display name', optional: true },
  website: { type: 'string', description: 'Website domain', optional: true },
  ticker: { type: 'string', description: 'Stock ticker', optional: true },
  type: { type: 'string', description: 'Company type (public, private, etc.)', optional: true },
  industry: { type: 'string', description: 'Industry', optional: true },
  size: { type: 'string', description: 'Employee size band', optional: true },
  employee_count: { type: 'number', description: 'Estimated employee count', optional: true },
  founded: { type: 'number', description: 'Year founded', optional: true },
  headline: { type: 'string', description: 'Company headline/tagline', optional: true },
  summary: { type: 'string', description: 'Company description', optional: true },
  linkedin_url: { type: 'string', description: 'LinkedIn URL', optional: true },
  linkedin_id: { type: 'string', description: 'LinkedIn ID', optional: true },
  twitter_url: { type: 'string', description: 'Twitter URL', optional: true },
  facebook_url: { type: 'string', description: 'Facebook URL', optional: true },
  location_name: { type: 'string', description: 'HQ location name', optional: true },
  location_locality: { type: 'string', description: 'HQ city', optional: true },
  location_region: { type: 'string', description: 'HQ state/region', optional: true },
  location_country: { type: 'string', description: 'HQ country', optional: true },
  tags: {
    type: 'array',
    description: 'Company tags',
    optional: true,
    items: { type: 'string', description: 'Tag' },
  },
  tickers: {
    type: 'array',
    description: 'All stock tickers',
    optional: true,
    items: { type: 'string', description: 'Ticker' },
  },
} as const satisfies Record<string, OutputProperty>

export interface PdlPersonRecord {
  id?: string
  full_name?: string
  first_name?: string
  last_name?: string
  gender?: string
  birth_year?: number
  linkedin_url?: string
  linkedin_username?: string
  twitter_url?: string
  github_url?: string
  facebook_url?: string
  work_email?: string
  personal_emails?: string[]
  emails?: unknown[]
  phone_numbers?: string[]
  mobile_phone?: string
  job_title?: string
  job_title_role?: string
  job_title_sub_role?: string
  job_title_levels?: string[]
  job_company_name?: string
  job_company_website?: string
  job_company_industry?: string
  job_company_size?: string
  job_company_linkedin_url?: string
  job_start_date?: string
  location_name?: string
  location_locality?: string
  location_region?: string
  location_country?: string
  location_continent?: string
  industry?: string
  skills?: string[]
  interests?: string[]
  experience?: unknown[]
  education?: unknown[]
}

export interface PdlCompanyRecord {
  id?: string
  name?: string
  display_name?: string
  website?: string
  ticker?: string
  type?: string
  industry?: string
  size?: string
  employee_count?: number
  founded?: number
  headline?: string
  summary?: string
  linkedin_url?: string
  linkedin_id?: string
  twitter_url?: string
  facebook_url?: string
  location_name?: string
  location_locality?: string
  location_region?: string
  location_country?: string
  tags?: string[]
  tickers?: string[]
}

export interface PdlPersonEnrichParams {
  apiKey: string
  email?: string
  phone?: string
  profile?: string
  lid?: string
  name?: string
  first_name?: string
  last_name?: string
  company?: string
  school?: string
  location?: string
  min_likelihood?: number
  required?: string
  titlecase?: boolean
}

export interface PdlPersonEnrichResponse extends ToolResponse {
  output: {
    matched: boolean
    likelihood: number | null
    person: PdlPersonRecord | null
  }
}

export interface PdlPersonSearchParams {
  apiKey: string
  sql?: string
  query?: string
  size?: number
  scroll_token?: string
  dataset?: string
  titlecase?: boolean
}

export interface PdlPersonSearchResponse extends ToolResponse {
  output: {
    total: number
    scroll_token: string | null
    results: PdlPersonRecord[]
  }
}

export interface PdlCompanyEnrichParams {
  apiKey: string
  name?: string
  website?: string
  profile?: string
  ticker?: string
  pdl_id?: string
  location?: string
  locality?: string
  region?: string
  country?: string
  min_likelihood?: number
  required?: string
  titlecase?: boolean
}

export interface PdlCompanyEnrichResponse extends ToolResponse {
  output: {
    matched: boolean
    likelihood: number | null
    company: PdlCompanyRecord | null
  }
}

export interface PdlCompanySearchParams {
  apiKey: string
  sql?: string
  query?: string
  size?: number
  scroll_token?: string
  titlecase?: boolean
}

export interface PdlCompanySearchResponse extends ToolResponse {
  output: {
    total: number
    scroll_token: string | null
    results: PdlCompanyRecord[]
  }
}

export interface PdlAutocompleteParams {
  apiKey: string
  field: string
  text?: string
  size?: number
  titlecase?: boolean
}

export interface PdlAutocompleteSuggestion {
  name: string
  count: number
  meta?: Record<string, unknown>
}

export interface PdlAutocompleteResponse extends ToolResponse {
  output: {
    suggestions: PdlAutocompleteSuggestion[]
  }
}

export interface PdlBulkPersonEnrichParams {
  apiKey: string
  requests: string
  required?: string
}

export interface PdlBulkPersonResultItem {
  status: number
  likelihood: number | null
  matched: boolean
  metadata: Record<string, unknown> | null
  person: PdlPersonRecord | null
}

export interface PdlBulkPersonEnrichResponse extends ToolResponse {
  output: {
    results: PdlBulkPersonResultItem[]
  }
}

export interface PdlBulkCompanyEnrichParams {
  apiKey: string
  requests: string
  required?: string
}

export interface PdlBulkCompanyResultItem {
  status: number
  likelihood: number | null
  matched: boolean
  metadata: Record<string, unknown> | null
  company: PdlCompanyRecord | null
}

export interface PdlBulkCompanyEnrichResponse extends ToolResponse {
  output: {
    results: PdlBulkCompanyResultItem[]
  }
}

export interface PdlPersonIdentifyParams {
  apiKey: string
  email?: string
  phone?: string
  profile?: string
  email_hash?: string
  lid?: string
  name?: string
  first_name?: string
  middle_name?: string
  last_name?: string
  company?: string
  school?: string
  location?: string
  street_address?: string
  locality?: string
  region?: string
  country?: string
  postal_code?: string
  birth_date?: string
  data_include?: string
  include_if_matched?: boolean
  titlecase?: boolean
}

export interface PdlPersonIdentifyMatch {
  match_score: number
  matched_on?: string[]
  person: PdlPersonRecord
}

export interface PdlPersonIdentifyResponse extends ToolResponse {
  output: {
    matches: PdlPersonIdentifyMatch[]
  }
}

export interface PdlCleanCompanyParams {
  apiKey: string
  name?: string
  website?: string
  profile?: string
}

export interface PdlCleanCompanyResponse extends ToolResponse {
  output: {
    matched: boolean
    company: PdlCompanyRecord | null
  }
}

export interface PdlCleanLocationParams {
  apiKey: string
  location: string
}

export const PDL_LOCATION_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Normalized location name', optional: true },
  locality: { type: 'string', description: 'City', optional: true },
  region: { type: 'string', description: 'State/region', optional: true },
  subregion: { type: 'string', description: 'Subregion (e.g., county)', optional: true },
  country: { type: 'string', description: 'Country', optional: true },
  continent: { type: 'string', description: 'Continent', optional: true },
  type: { type: 'string', description: 'Location type', optional: true },
  geo: { type: 'string', description: 'Latitude,longitude string', optional: true },
} as const satisfies Record<string, OutputProperty>

export interface PdlLocationRecord {
  name?: string
  locality?: string
  region?: string
  subregion?: string
  country?: string
  continent?: string
  type?: string
  geo?: string
}

export interface PdlCleanLocationResponse extends ToolResponse {
  output: {
    matched: boolean
    location: PdlLocationRecord | null
  }
}

export interface PdlCleanSchoolParams {
  apiKey: string
  name?: string
  website?: string
  profile?: string
}

export const PDL_SCHOOL_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'PDL school ID', optional: true },
  name: { type: 'string', description: 'School name', optional: true },
  type: {
    type: 'string',
    description: 'School type (e.g., university, secondary)',
    optional: true,
  },
  website: { type: 'string', description: 'Website domain', optional: true },
  linkedin_url: { type: 'string', description: 'LinkedIn URL', optional: true },
  linkedin_id: { type: 'string', description: 'LinkedIn ID', optional: true },
  facebook_url: { type: 'string', description: 'Facebook URL', optional: true },
  twitter_url: { type: 'string', description: 'Twitter URL', optional: true },
  domain: { type: 'string', description: 'School domain', optional: true },
  location_name: { type: 'string', description: 'Location name', optional: true },
  location_locality: { type: 'string', description: 'City', optional: true },
  location_region: { type: 'string', description: 'State/region', optional: true },
  location_country: { type: 'string', description: 'Country', optional: true },
  location_continent: { type: 'string', description: 'Continent', optional: true },
} as const satisfies Record<string, OutputProperty>

export interface PdlSchoolRecord {
  id?: string
  name?: string
  type?: string
  website?: string
  linkedin_url?: string
  linkedin_id?: string
  facebook_url?: string
  twitter_url?: string
  domain?: string
  location_name?: string
  location_locality?: string
  location_region?: string
  location_country?: string
  location_continent?: string
}

export interface PdlCleanSchoolResponse extends ToolResponse {
  output: {
    matched: boolean
    school: PdlSchoolRecord | null
  }
}
