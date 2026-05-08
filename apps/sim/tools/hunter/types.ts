// Common types for Hunter.io tools
import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for Hunter.io API responses.
 * These are reusable across all Hunter tools to ensure consistency.
 * Based on Hunter.io API v2 documentation: https://hunter.io/api-documentation/v2
 */

/**
 * Output definition for source objects where emails were found
 */
export const SOURCE_OUTPUT_PROPERTIES = {
  domain: { type: 'string', description: 'Domain where the email was found' },
  uri: { type: 'string', description: 'Full URL of the source page' },
  extracted_on: {
    type: 'string',
    description: 'Date when the email was first extracted (YYYY-MM-DD)',
  },
  last_seen_on: { type: 'string', description: 'Date when the email was last seen (YYYY-MM-DD)' },
  still_on_page: {
    type: 'boolean',
    description: 'Whether the email is still present on the source page',
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete sources array output definition
 */
export const SOURCES_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'List of sources where the email was found (limited to 20)',
  items: {
    type: 'object',
    properties: SOURCE_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for verification objects
 */
export const VERIFICATION_OUTPUT_PROPERTIES = {
  date: {
    type: 'string',
    description: 'Date when the email was verified (YYYY-MM-DD)',
    optional: true,
  },
  status: {
    type: 'string',
    description: 'Verification status (valid, invalid, accept_all, webmail, disposable, unknown)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete verification object output definition
 */
export const VERIFICATION_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Email verification information',
  properties: VERIFICATION_OUTPUT_PROPERTIES,
}

/**
 * Output definition for email objects in domain search responses
 */
export const EMAIL_OUTPUT_PROPERTIES = {
  value: { type: 'string', description: 'The email address' },
  type: { type: 'string', description: 'Email type: personal or generic (role-based)' },
  confidence: {
    type: 'number',
    description: 'Probability score (0-100) that the email is correct',
  },
  first_name: { type: 'string', description: "Person's first name", optional: true },
  last_name: { type: 'string', description: "Person's last name", optional: true },
  position: { type: 'string', description: 'Job title/position', optional: true },
  position_raw: { type: 'string', description: 'Raw job title as found', optional: true },
  seniority: {
    type: 'string',
    description: 'Seniority level (junior, senior, executive)',
    optional: true,
  },
  department: {
    type: 'string',
    description:
      'Department (executive, it, finance, management, sales, legal, support, hr, marketing, communication, education, design, health, operations)',
    optional: true,
  },
  linkedin: { type: 'string', description: 'LinkedIn profile URL', optional: true },
  twitter: { type: 'string', description: 'Twitter handle', optional: true },
  phone_number: { type: 'string', description: 'Phone number', optional: true },
  sources: SOURCES_OUTPUT,
  verification: VERIFICATION_OUTPUT,
} as const satisfies Record<string, OutputProperty>

/**
 * Complete emails array output definition for domain search
 */
export const EMAILS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'List of email addresses found for the domain (up to 100 per request)',
  items: {
    type: 'object',
    properties: EMAIL_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for department breakdown in email count
 */
export const DEPARTMENT_OUTPUT_PROPERTIES = {
  executive: { type: 'number', description: 'Number of executive department emails' },
  it: { type: 'number', description: 'Number of IT department emails' },
  finance: { type: 'number', description: 'Number of finance department emails' },
  management: { type: 'number', description: 'Number of management department emails' },
  sales: { type: 'number', description: 'Number of sales department emails' },
  legal: { type: 'number', description: 'Number of legal department emails' },
  support: { type: 'number', description: 'Number of support department emails' },
  hr: { type: 'number', description: 'Number of HR department emails' },
  marketing: { type: 'number', description: 'Number of marketing department emails' },
  communication: { type: 'number', description: 'Number of communication department emails' },
  education: { type: 'number', description: 'Number of education department emails' },
  design: { type: 'number', description: 'Number of design department emails' },
  health: { type: 'number', description: 'Number of health department emails' },
  operations: { type: 'number', description: 'Number of operations department emails' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete department object output definition
 */
export const DEPARTMENT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Email count breakdown by department',
  properties: DEPARTMENT_OUTPUT_PROPERTIES,
}

/**
 * Output definition for seniority breakdown in email count
 */
export const SENIORITY_OUTPUT_PROPERTIES = {
  junior: { type: 'number', description: 'Number of junior-level emails' },
  senior: { type: 'number', description: 'Number of senior-level emails' },
  executive: { type: 'number', description: 'Number of executive-level emails' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete seniority object output definition
 */
export const SENIORITY_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Email count breakdown by seniority level',
  properties: SENIORITY_OUTPUT_PROPERTIES,
}

/**
 * Output definition for discover result company objects.
 * Hunter Discover returns minimal info per company — use Domain Search or
 * Company Enrichment for richer data on a specific result.
 */
export const DISCOVER_RESULT_OUTPUT_PROPERTIES = {
  domain: { type: 'string', description: 'Company domain' },
  organization: { type: 'string', description: 'Organization name' },
  personal_emails: { type: 'number', description: 'Count of personal emails' },
  generic_emails: { type: 'number', description: 'Count of generic (role-based) emails' },
  total_emails: { type: 'number', description: 'Total emails found for the company' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete discover results array output definition
 */
export const DISCOVER_RESULTS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'List of companies matching the search criteria',
  items: {
    type: 'object',
    properties: DISCOVER_RESULT_OUTPUT_PROPERTIES,
  },
}

// Common parameters for all Hunter.io tools
export interface HunterBaseParams {
  apiKey: string
}

// Discover tool types
export interface HunterDiscoverParams extends HunterBaseParams {
  query?: string
  domain?: string
  headcount?: string
  company_type?: string
  technology?: string
}

export interface HunterDiscoverResult {
  domain: string
  organization: string
  personal_emails: number
  generic_emails: number
  total_emails: number
}

export interface HunterDiscoverResponse extends ToolResponse {
  output: {
    results: HunterDiscoverResult[]
  }
}

// Domain Search tool types
export interface HunterDomainSearchParams extends HunterBaseParams {
  domain: string
  limit?: number
  offset?: number
  type?: 'personal' | 'generic' | 'all'
  seniority?: 'junior' | 'senior' | 'executive' | 'all'
  department?: string
}

export interface HunterEmail {
  value: string
  type: string
  confidence: number
  sources: Array<{
    domain: string
    uri: string
    extracted_on: string
    last_seen_on: string
    still_on_page: boolean
  }>
  first_name: string | null
  last_name: string | null
  position: string | null
  position_raw: string | null
  seniority: string | null
  department: string | null
  linkedin: string | null
  twitter: string | null
  phone_number: string | null
  verification: {
    date: string | null
    status: string
  }
}

export interface HunterDomainSearchResponse extends ToolResponse {
  output: {
    domain: string
    disposable: boolean
    webmail: boolean
    accept_all: boolean
    pattern: string
    organization: string
    linked_domains: string[]
    emails: HunterEmail[]
  }
}

// Email Finder tool types
export interface HunterEmailFinderParams extends HunterBaseParams {
  domain: string
  first_name: string
  last_name: string
  company?: string
}

export interface HunterEmailFinderResponse extends ToolResponse {
  output: {
    first_name: string
    last_name: string
    email: string
    score: number
    domain: string
    accept_all: boolean
    position: string | null
    twitter: string | null
    linkedin_url: string | null
    phone_number: string | null
    company: string | null
    sources: Array<{
      domain: string
      uri: string
      extracted_on: string
      last_seen_on: string
      still_on_page: boolean
    }>
    verification: {
      date: string | null
      status: string
    }
  }
}

// Email Verifier tool types
export interface HunterEmailVerifierParams extends HunterBaseParams {
  email: string
}

export interface HunterEmailVerifierResponse extends ToolResponse {
  output: {
    result: 'deliverable' | 'undeliverable' | 'risky'
    score: number
    email: string
    regexp: boolean
    gibberish: boolean
    disposable: boolean
    webmail: boolean
    mx_records: boolean
    smtp_server: boolean
    smtp_check: boolean
    accept_all: boolean
    block: boolean
    status: 'valid' | 'invalid' | 'accept_all' | 'webmail' | 'disposable' | 'unknown'
    sources: Array<{
      domain: string
      uri: string
      extracted_on: string
      last_seen_on: string
      still_on_page: boolean
    }>
  }
}

// Enrichment tool types
export interface HunterEnrichmentParams extends HunterBaseParams {
  email?: string
  domain?: string
  linkedin_handle?: string
}

export interface HunterEnrichmentResponse extends ToolResponse {
  output: {
    name: string
    domain: string
    description: string
    industry: string
    sector: string
    size: string
    founded_year: number | null
    location: string
    country: string
    country_code: string
    state: string
    city: string
    linkedin: string
    twitter: string
    facebook: string
    logo: string
    phone: string
    tech: string[]
  }
}

// Email Count tool types
export interface HunterEmailCountParams extends HunterBaseParams {
  domain?: string
  company?: string
  type?: 'personal' | 'generic' | 'all'
}

export interface HunterEmailCountResponse extends ToolResponse {
  output: {
    total: number
    personal_emails: number
    generic_emails: number
    department: {
      executive: number
      it: number
      finance: number
      management: number
      sales: number
      legal: number
      support: number
      hr: number
      marketing: number
      communication: number
      education: number
      design: number
      health: number
      operations: number
    }
    seniority: {
      junior: number
      senior: number
      executive: number
    }
  }
}

export type HunterResponse =
  | HunterDiscoverResponse
  | HunterDomainSearchResponse
  | HunterEmailFinderResponse
  | HunterEmailVerifierResponse
  | HunterEnrichmentResponse
  | HunterEmailCountResponse
