// Common types for Hunter.io tools
import type { ToolResponse } from '@/tools/types'

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
  name: string
  headcount?: number
  technologies?: string[]
  email_count?: number
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
  first_name: string
  last_name: string
  position: string
  seniority: string
  department: string
  linkedin: string
  twitter: string
  phone_number: string
  verification: {
    date: string
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
    description: string
    industry: string
    twitter: string
    facebook: string
    linkedin: string
    instagram: string
    youtube: string
    technologies: string[]
    country: string
    state: string
    city: string
    postal_code: string
    street: string
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
    email: string
    score: number
    sources: Array<{
      domain: string
      uri: string
      extracted_on: string
      last_seen_on: string
      still_on_page: boolean
    }>
    verification: {
      date: string
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
    person?: {
      first_name: string
      last_name: string
      email: string
      position: string
      seniority: string
      department: string
      linkedin: string
      twitter: string
      phone_number: string
    }
    company?: {
      name: string
      domain: string
      industry: string
      size: string
      country: string
      linkedin: string
      twitter: string
    }
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
