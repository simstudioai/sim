import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for RB2B API responses.
 * Based on the RB2B API collection: https://api.rb2b.com/api/v1
 */

/** A single hashed-email match returned by IP to HEM. */
export const RB2B_HEM_RESULT_OUTPUT_PROPERTIES = {
  md5: { type: 'string', description: 'MD5 hash of the matched email' },
  sha256: {
    type: 'string',
    description: 'SHA-256 hash of the matched email (only when include_sha256 is true)',
    optional: true,
  },
  score: {
    type: 'number',
    description: 'Match accuracy score (0 = probabilistic, 1 = deterministic)',
  },
} as const satisfies Record<string, OutputProperty>

/** A single mobile advertising identifier. */
export const RB2B_MAID_RESULT_OUTPUT_PROPERTIES = {
  device_id: { type: 'string', description: 'The mobile advertising identifier' },
  device_type: { type: 'string', description: 'The identifier type (e.g. AAID, IDFA)' },
} as const satisfies Record<string, OutputProperty>

/** A single company-domain match returned by IP to Company. */
export const RB2B_COMPANY_RESULT_OUTPUT_PROPERTIES = {
  domain: { type: 'string', description: 'Company domain associated with the IP' },
  percentage: { type: 'string', description: 'Confidence percentage for the match' },
} as const satisfies Record<string, OutputProperty>

/** A single email activity record. */
export const RB2B_ACTIVITY_RESULT_OUTPUT_PROPERTIES = {
  email: { type: 'string', description: 'The email address' },
  last_active: { type: 'string', description: 'Date the email was last seen active (YYYY-MM-DD)' },
} as const satisfies Record<string, OutputProperty>

/** Fields returned by HEM to Business Profile. */
export const RB2B_BUSINESS_PROFILE_OUTPUT_PROPERTIES = {
  first_name: { type: 'string', description: 'First name', optional: true },
  last_name: { type: 'string', description: 'Last name', optional: true },
  title: { type: 'string', description: 'Job title', optional: true },
  seniority: { type: 'string', description: 'Seniority level', optional: true },
  linkedinurl: { type: 'string', description: 'Personal LinkedIn profile URL', optional: true },
  link_email: { type: 'string', description: 'Linked business email address', optional: true },
  work_email_confirmed: {
    type: 'string',
    description: 'Whether the work email is confirmed',
    optional: true,
  },
  personal_emails: {
    type: 'array',
    description: 'Associated personal emails (hashed or plaintext depending on input)',
    optional: true,
    items: { type: 'string' },
  },
  current_company: { type: 'string', description: 'Current company name', optional: true },
  current_company_url: { type: 'string', description: 'Current company website', optional: true },
  current_company_linkedinurl: {
    type: 'string',
    description: 'Current company LinkedIn URL',
    optional: true,
  },
  current_industry: { type: 'string', description: 'Current industry', optional: true },
  functional_area: { type: 'string', description: 'Functional area', optional: true },
  country: { type: 'string', description: 'Country', optional: true },
  company_employee_count: {
    type: 'string',
    description: 'Company employee count',
    optional: true,
  },
  company_employee_range: {
    type: 'string',
    description: 'Company employee range band',
    optional: true,
  },
  company_revenue_range: {
    type: 'string',
    description: 'Company revenue range band',
    optional: true,
  },
  md5: { type: 'string', description: 'MD5 hash of the resolved email', optional: true },
} as const satisfies Record<string, OutputProperty>

/** Company sub-object returned by LinkedIn to Business Profile. */
export const RB2B_LINKEDIN_COMPANY_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Company name', optional: true },
  industry: { type: 'string', description: 'Company industry', optional: true },
  website_url: { type: 'string', description: 'Company website URL', optional: true },
  linkedin_url: { type: 'string', description: 'Company LinkedIn URL', optional: true },
} as const satisfies Record<string, OutputProperty>

/** Fields returned by LinkedIn to Business Profile. */
export const RB2B_LINKEDIN_PROFILE_OUTPUT_PROPERTIES = {
  first_name: { type: 'string', description: 'First name', optional: true },
  last_name: { type: 'string', description: 'Last name', optional: true },
  full_name: { type: 'string', description: 'Full name', optional: true },
  headline: { type: 'string', description: 'LinkedIn headline', optional: true },
  title: { type: 'string', description: 'Job title', optional: true },
  seniority: { type: 'string', description: 'Seniority level', optional: true },
  country: { type: 'string', description: 'Country', optional: true },
  current_industry: { type: 'string', description: 'Current industry', optional: true },
  functional_area: {
    type: 'array',
    description: 'Functional areas',
    optional: true,
    items: { type: 'string' },
  },
  linkedin_url: { type: 'string', description: 'Personal LinkedIn profile URL', optional: true },
  business_email: { type: 'string', description: 'Business email address', optional: true },
  personal_email: { type: 'string', description: 'Personal email address', optional: true },
  company: {
    type: 'object',
    description: 'Current company details',
    optional: true,
    properties: RB2B_LINKEDIN_COMPANY_OUTPUT_PROPERTIES,
  },
} as const satisfies Record<string, OutputProperty>

interface Rb2bMaidResult {
  device_id: string
  device_type: string
}

export interface Rb2bCreditCheckParams {
  apiKey: string
}

export interface Rb2bCreditCheckResponse extends ToolResponse {
  output: {
    credits_remaining: number
  }
}

export interface Rb2bIpToHemParams {
  apiKey: string
  ip_address: string
  user_agent?: string
  include_sha256?: boolean
}

export interface Rb2bIpToHemResponse extends ToolResponse {
  output: {
    results: Array<{
      md5: string
      sha256?: string
      score: number
    }>
  }
}

export interface Rb2bIpToMaidParams {
  apiKey: string
  ip_address: string
  user_agent?: string
}

export interface Rb2bIpToCompanyParams {
  apiKey: string
  ip_address: string
}

export interface Rb2bIpToCompanyResponse extends ToolResponse {
  output: {
    results: Array<{
      domain: string
      percentage: string
    }>
  }
}

/**
 * Params for HEM (hashed email) endpoints. The `email` field accepts either a
 * plaintext email address or an MD5 hash — the tool routes it to the correct
 * request key automatically.
 */
export interface Rb2bIdentifierParams {
  apiKey: string
  email: string
}

export interface Rb2bMaidResponse extends ToolResponse {
  output: {
    results: Rb2bMaidResult[]
  }
}

export interface Rb2bLinkedinUrlResponse extends ToolResponse {
  output: {
    linkedin_url: string | null
  }
}

export interface Rb2bLinkedinSlugResponse extends ToolResponse {
  output: {
    linkedin_slug: string | null
  }
}

export interface Rb2bBusinessProfileResponse extends ToolResponse {
  output: {
    first_name?: string
    last_name?: string
    title?: string
    seniority?: string
    linkedinurl?: string
    link_email?: string
    work_email_confirmed?: string
    personal_emails?: string[]
    current_company?: string
    current_company_url?: string
    current_company_linkedinurl?: string
    current_industry?: string
    functional_area?: string
    country?: string
    company_employee_count?: string
    company_employee_range?: string
    company_revenue_range?: string
    md5?: string
  }
}

export interface Rb2bEmailActivityParams {
  apiKey: string
  email: string
}

export interface Rb2bEmailActivityResponse extends ToolResponse {
  output: {
    results: Array<{
      email: string
      last_active: string
    }>
    match_count: number
    credits_charged: number
    credits_exhausted: boolean
  }
}

export interface Rb2bLinkedinParams {
  apiKey: string
  linkedin_slug: string
}

export interface Rb2bBestPersonalEmailResponse extends ToolResponse {
  output: {
    email: string | null
  }
}

export interface Rb2bPersonalEmailsResponse extends ToolResponse {
  output: {
    emails: string[]
  }
}

export interface Rb2bHashedEmailsResponse extends ToolResponse {
  output: {
    linkedin_slug: string | null
    business_md5_array: string[]
    business_sha256_array: string[]
    personal_md5_array: string[]
    personal_sha256_array: string[]
  }
}

export interface Rb2bMobilePhoneResponse extends ToolResponse {
  output: {
    mobile_phone: string | null
  }
}

export interface Rb2bLinkedinProfileResponse extends ToolResponse {
  output: {
    first_name?: string
    last_name?: string
    full_name?: string
    headline?: string
    title?: string
    seniority?: string
    country?: string
    current_industry?: string
    functional_area?: string[]
    linkedin_url?: string
    business_email?: string
    personal_email?: string
    company?: {
      name?: string
      industry?: string
      website_url?: string
      linkedin_url?: string
    }
  }
}

export interface Rb2bLinkedinSlugSearchParams {
  apiKey: string
  first_name: string
  last_name: string
  company_domain: string
}

export interface Rb2bLinkedinSlugSearchResponse extends ToolResponse {
  output: {
    linkedin_url: string | null
  }
}

export type Rb2bResponse =
  | Rb2bCreditCheckResponse
  | Rb2bIpToHemResponse
  | Rb2bIpToCompanyResponse
  | Rb2bMaidResponse
  | Rb2bLinkedinUrlResponse
  | Rb2bLinkedinSlugResponse
  | Rb2bBusinessProfileResponse
  | Rb2bEmailActivityResponse
  | Rb2bBestPersonalEmailResponse
  | Rb2bPersonalEmailsResponse
  | Rb2bHashedEmailsResponse
  | Rb2bMobilePhoneResponse
  | Rb2bLinkedinProfileResponse
  | Rb2bLinkedinSlugSearchResponse
