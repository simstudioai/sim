import type { OutputProperty, ToolResponse } from '@/tools/types'

interface FindymailBaseParams {
  apiKey: string
}

export const FINDYMAIL_CONTACT_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Contact full name' },
  email: { type: 'string', description: 'Contact email address' },
  domain: { type: 'string', description: 'Email domain' },
} as const satisfies Record<string, OutputProperty>

export const FINDYMAIL_CONTACT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Contact information',
  properties: FINDYMAIL_CONTACT_OUTPUT_PROPERTIES,
}

export const FINDYMAIL_CONTACTS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'List of contacts found',
  items: {
    type: 'object',
    properties: FINDYMAIL_CONTACT_OUTPUT_PROPERTIES,
  },
}

export const FINDYMAIL_TECHNOLOGY_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Technology name' },
  category: { type: 'string', description: 'Technology category' },
  subcategory: { type: 'string', description: 'Technology subcategory' },
  last_detected_at: {
    type: 'string',
    description: 'Last detection timestamp (ISO 8601)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const FINDYMAIL_TECHNOLOGIES_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'List of technologies',
  items: {
    type: 'object',
    properties: FINDYMAIL_TECHNOLOGY_OUTPUT_PROPERTIES,
  },
}

export const FINDYMAIL_EMPLOYEE_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Employee full name' },
  linkedinUrl: { type: 'string', description: 'LinkedIn profile URL', optional: true },
  companyWebsite: { type: 'string', description: 'Company website', optional: true },
  companyName: { type: 'string', description: 'Company name', optional: true },
  jobTitle: { type: 'string', description: 'Job title', optional: true },
} as const satisfies Record<string, OutputProperty>

export const FINDYMAIL_EMPLOYEES_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'List of employees matching the search criteria',
  items: {
    type: 'object',
    properties: FINDYMAIL_EMPLOYEE_OUTPUT_PROPERTIES,
  },
}

export interface FindymailContact {
  name: string
  email: string
  domain: string
}

export interface FindymailVerifyEmailParams extends FindymailBaseParams {
  email: string
}

export interface FindymailVerifyEmailResponse extends ToolResponse {
  output: {
    email: string
    verified: boolean
    provider: string | null
  }
}

export interface FindymailFindEmailFromNameParams extends FindymailBaseParams {
  name: string
  domain: string
}

export interface FindymailFindEmailFromNameResponse extends ToolResponse {
  output: {
    contact: FindymailContact | null
  }
}

export interface FindymailFindEmailsByDomainParams extends FindymailBaseParams {
  domain: string
  roles: string[]
}

export interface FindymailFindEmailsByDomainResponse extends ToolResponse {
  output: {
    contacts: FindymailContact[]
  }
}

export interface FindymailFindEmailFromLinkedInParams extends FindymailBaseParams {
  linkedin_url: string
}

export interface FindymailFindEmailFromLinkedInResponse extends ToolResponse {
  output: {
    contact: FindymailContact | null
  }
}

export interface FindymailReverseEmailLookupParams extends FindymailBaseParams {
  email: string
  with_profile?: boolean
}

export interface FindymailReverseEmailLookupResponse extends ToolResponse {
  output: {
    email: string | null
    linkedin_url: string | null
    fullName: string | null
    username: string | null
    headline: string | null
    jobTitle: string | null
    summary: string | null
    city: string | null
    region: string | null
    country: string | null
    companyLinkedinUrl: string | null
    companyName: string | null
    companyWebsite: string | null
    isPremium: boolean | null
    isOpenProfile: boolean | null
    skills: unknown[]
    jobs: unknown[]
    educations: unknown[]
    certificates: unknown[]
  }
}

export interface FindymailGetCompanyParams extends FindymailBaseParams {
  linkedin_url?: string
  domain?: string
  name?: string
}

export interface FindymailGetCompanyResponse extends ToolResponse {
  output: {
    name: string | null
    domain: string | null
    company_size: string | null
    industry: string | null
    linkedin_url: string | null
    description: string | null
  }
}

export interface FindymailFindEmployeesParams extends FindymailBaseParams {
  website: string
  job_titles: string[]
  count?: number
}

export interface FindymailEmployee {
  name: string
  linkedinUrl: string | null
  companyWebsite: string | null
  companyName: string | null
  jobTitle: string | null
}

export interface FindymailFindEmployeesResponse extends ToolResponse {
  output: {
    employees: FindymailEmployee[]
  }
}

export interface FindymailFindPhoneParams extends FindymailBaseParams {
  linkedin_url: string
}

export interface FindymailFindPhoneResponse extends ToolResponse {
  output: {
    phone: string | null
    line_type: string | null
  }
}

export interface FindymailSearchTechnologiesParams extends FindymailBaseParams {
  q: string
}

export interface FindymailTechnology {
  name: string
  category: string | null
  subcategory: string | null
  last_detected_at?: string | null
}

export interface FindymailSearchTechnologiesResponse extends ToolResponse {
  output: {
    technologies: FindymailTechnology[]
  }
}

export interface FindymailLookupTechnologiesParams extends FindymailBaseParams {
  domain: string
  technologies?: string[]
}

export interface FindymailLookupTechnologiesResponse extends ToolResponse {
  output: {
    domain: string
    technologies: FindymailTechnology[]
  }
}

export interface FindymailGetCreditsParams extends FindymailBaseParams {}

export interface FindymailGetCreditsResponse extends ToolResponse {
  output: {
    credits: number
    verifier_credits: number
  }
}

export type FindymailResponse =
  | FindymailVerifyEmailResponse
  | FindymailFindEmailFromNameResponse
  | FindymailFindEmailsByDomainResponse
  | FindymailFindEmailFromLinkedInResponse
  | FindymailReverseEmailLookupResponse
  | FindymailGetCompanyResponse
  | FindymailFindEmployeesResponse
  | FindymailFindPhoneResponse
  | FindymailSearchTechnologiesResponse
  | FindymailLookupTechnologiesResponse
  | FindymailGetCreditsResponse
