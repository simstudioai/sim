import type { OutputProperty, ToolResponse } from '@/tools/types'

interface LeadMagicBaseParams {
  apiKey: string
}

// ---------------------------------------------------------------------------
// Shared output property constants
// ---------------------------------------------------------------------------

export const LEADMAGIC_PROFILE_OUTPUT_PROPERTIES = {
  profile_url: { type: 'string', description: 'LinkedIn profile URL' },
  first_name: { type: 'string', description: 'First name' },
  last_name: { type: 'string', description: 'Last name' },
  full_name: { type: 'string', description: 'Full name' },
  professional_title: { type: 'string', description: 'Current job title', optional: true },
  bio: { type: 'string', description: 'Profile bio / summary', optional: true },
  location: { type: 'string', description: 'Location string', optional: true },
  country: { type: 'string', description: 'Country', optional: true },
  company_name: { type: 'string', description: 'Current employer', optional: true },
  company_industry: { type: 'string', description: 'Industry of current employer', optional: true },
  company_website: { type: 'string', description: 'Company website', optional: true },
} as const satisfies Record<string, OutputProperty>

// ---------------------------------------------------------------------------
// Email Validation
// ---------------------------------------------------------------------------

export interface LeadMagicValidateEmailParams extends LeadMagicBaseParams {
  email: string
}

export interface LeadMagicValidateEmailResponse extends ToolResponse {
  output: {
    email: string
    email_status: string
    is_domain_catch_all: boolean | null
    credits_consumed: number
    message: string | null
    mx_record: string | null
    mx_provider: string | null
    mx_gateway: string | null
    mx_security_gateway: boolean | null
    company_name: string | null
    company_industry: string | null
    company_size: string | null
  }
}

// ---------------------------------------------------------------------------
// Email Finder
// ---------------------------------------------------------------------------

export interface LeadMagicFindEmailParams extends LeadMagicBaseParams {
  first_name?: string
  last_name?: string
  full_name?: string
  domain?: string
  company_name?: string
}

export interface LeadMagicFindEmailResponse extends ToolResponse {
  output: {
    email: string | null
    status: string | null
    credits_consumed: number
    message: string | null
    employment_verified: boolean | null
    has_mx: boolean | null
    mx_record: string | null
    mx_provider: string | null
    company_name: string | null
    company_industry: string | null
    company_size: string | null
    company_profile_url: string | null
  }
}

// ---------------------------------------------------------------------------
// Mobile Finder
// ---------------------------------------------------------------------------

export interface LeadMagicFindMobileParams extends LeadMagicBaseParams {
  profile_url?: string
  work_email?: string
  personal_email?: string
}

export interface LeadMagicFindMobileResponse extends ToolResponse {
  output: {
    profile_url: string | null
    email: string | null
    mobile_number: string | null
    credits_consumed: number
    message: string | null
  }
}

// ---------------------------------------------------------------------------
// Profile Search (LinkedIn enrichment by profile URL)
// ---------------------------------------------------------------------------

export interface LeadMagicProfileSearchParams extends LeadMagicBaseParams {
  profile_url: string
  extended_response?: boolean
}

export interface LeadMagicProfileSearchResponse extends ToolResponse {
  output: {
    profile_url: string | null
    first_name: string | null
    last_name: string | null
    full_name: string | null
    professional_title: string | null
    bio: string | null
    location: string | null
    country: string | null
    followers_range: string | null
    company_name: string | null
    company_industry: string | null
    company_website: string | null
    total_tenure_years: string | null
    total_tenure_months: string | null
    work_experience: unknown[]
    education: unknown[]
    certifications: unknown[]
    credits_consumed: number
    message: string | null
  }
}

// ---------------------------------------------------------------------------
// Profile to Email (LinkedIn URL → work email)
// ---------------------------------------------------------------------------

export interface LeadMagicProfileToEmailParams extends LeadMagicBaseParams {
  profile_url: string
}

export interface LeadMagicProfileToEmailResponse extends ToolResponse {
  output: {
    email: string | null
    profile_url: string | null
    credits_consumed: number
    message: string | null
  }
}

// ---------------------------------------------------------------------------
// Email to Profile (work/personal email → LinkedIn profile URL)
// ---------------------------------------------------------------------------

export interface LeadMagicEmailToProfileParams extends LeadMagicBaseParams {
  work_email?: string
  personal_email?: string
}

export interface LeadMagicEmailToProfileResponse extends ToolResponse {
  output: {
    profile_url: string | null
    credits_consumed: number
    message: string | null
  }
}

// ---------------------------------------------------------------------------
// Company Search
// ---------------------------------------------------------------------------

export interface LeadMagicCompanySearchParams extends LeadMagicBaseParams {
  company_domain?: string
  profile_url?: string
  company_name?: string
}

export interface LeadMagicCompanySearchResponse extends ToolResponse {
  output: {
    companyName: string | null
    companyId: number | null
    industry: string | null
    employeeCount: number | null
    employeeRange: string | null
    founded: number | null
    headquarters: Record<string, string> | null
    revenue: string | null
    funding: string | null
    description: string | null
    specialties: unknown[]
    competitors: unknown[]
    followerCount: number | null
    twitter_url: string | null
    facebook_url: string | null
    b2b_profile_url: string | null
    logo_url: string | null
    credits_consumed: number
    message: string | null
  }
}

// ---------------------------------------------------------------------------
// Role Finder
// ---------------------------------------------------------------------------

export interface LeadMagicRoleFinderParams extends LeadMagicBaseParams {
  job_title: string
  company_domain?: string
  company_name?: string
}

export interface LeadMagicRoleFinderResponse extends ToolResponse {
  output: {
    first_name: string | null
    last_name: string | null
    full_name: string | null
    profile_url: string | null
    job_title: string | null
    company_name: string | null
    company_website: string | null
    credits_consumed: number
    message: string | null
  }
}

// ---------------------------------------------------------------------------
// Get Credits (balance check — free, no hosting)
// ---------------------------------------------------------------------------

export interface LeadMagicGetCreditsParams extends LeadMagicBaseParams {}

export interface LeadMagicGetCreditsResponse extends ToolResponse {
  output: {
    credits: number
  }
}

// ---------------------------------------------------------------------------
// Union response type
// ---------------------------------------------------------------------------

export type LeadMagicResponse =
  | LeadMagicValidateEmailResponse
  | LeadMagicFindEmailResponse
  | LeadMagicFindMobileResponse
  | LeadMagicProfileSearchResponse
  | LeadMagicProfileToEmailResponse
  | LeadMagicEmailToProfileResponse
  | LeadMagicCompanySearchResponse
  | LeadMagicRoleFinderResponse
  | LeadMagicGetCreditsResponse
