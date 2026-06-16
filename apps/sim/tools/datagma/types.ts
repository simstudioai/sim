import type { ToolResponse } from '@/tools/types'

interface DatagmaBaseParams {
  apiKey: string
}

// ---------------------------------------------------------------------------
// Find Email (findEmail)
// Endpoint: GET https://gateway.datagma.net/api/ingress/v6/findEmail
// Auth: apiId query param
// Docs: https://datagmaapi.readme.io/reference/find-work-email-address
// ---------------------------------------------------------------------------

export interface DatagmaFindEmailParams extends DatagmaBaseParams {
  fullName: string
  company: string
  linkedInSlug?: string
  findEmailV2Step?: number
  findEmailV2Country?: string
}

export interface DatagmaFindEmailResponse extends ToolResponse {
  output: {
    email: string | null
    emailStatus: string | null
    emailDomain: string | null
    mxfound: boolean | null
    smtpCheck: boolean | null
    catchAll: boolean | null
  }
}

// ---------------------------------------------------------------------------
// Enrich Person
// Endpoint: GET https://gateway.datagma.net/api/ingress/v2/full
// Auth: apiId query param
// Docs: https://datagmaapi.readme.io/reference/ingressservice_fullapiv2
// Pricing: 2 credits per successful response
// ---------------------------------------------------------------------------

export interface DatagmaEnrichPersonParams extends DatagmaBaseParams {
  /** Email address, LinkedIn URL, or full name (use with companyKeyword) */
  data: string
  companyKeyword?: string
  countryCode?: string
  personFull?: boolean
  phoneFull?: boolean
}

export interface DatagmaEnrichPersonResponse extends ToolResponse {
  output: {
    name: string | null
    firstName: string | null
    lastName: string | null
    email: string | null
    emailStatus: string | null
    jobTitle: string | null
    company: string | null
    linkedInUrl: string | null
    location: string | null
    country: string | null
    region: string | null
    city: string | null
    extractedRole: string | null
    extractedSeniority: string | null
    twitter: string | null
    phone: string | null
    personConfidenceScore: number | null
  }
}

// ---------------------------------------------------------------------------
// Enrich Company (via full endpoint with company domain/name)
// Endpoint: GET https://gateway.datagma.net/api/ingress/v2/full
// Auth: apiId query param
// Docs: https://datagmaapi.readme.io/reference/ingressservice_fullapiv2
// Pricing: 2 credits per successful response
// ---------------------------------------------------------------------------

export interface DatagmaEnrichCompanyParams extends DatagmaBaseParams {
  /** Company domain, name, or SIREN number */
  data: string
  companyPremium?: boolean
  companyFull?: boolean
}

export interface DatagmaEnrichCompanyResponse extends ToolResponse {
  output: {
    name: string | null
    website: string | null
    industries: string | null
    companySize: string | null
    type: string | null
    founded: string | null
    shortDescription: string | null
    revenueRange: string | null
    headquarters: string | null
  }
}

// ---------------------------------------------------------------------------
// Find Phone (via search endpoint or enrich with phoneFull)
// Endpoint: GET https://gateway.datagma.net/api/ingress/v1/search
// Auth: apiId query param
// Docs: https://datagmaapi.readme.io/reference/find-a-phone-number
// Pricing: 30 credits per phone number found (1 credit = 1 email)
// ---------------------------------------------------------------------------

export interface DatagmaFindPhoneParams extends DatagmaBaseParams {
  /** LinkedIn URL of the person */
  username: string
  /** Email address to improve match accuracy */
  email?: string
  /** Minimum match confidence (0–1, default 1) */
  minimumMatch?: number
}

export interface DatagmaFindPhoneResponse extends ToolResponse {
  output: {
    phone: string | null
    countryCode: string | null
    isWhatsapp: boolean | null
  }
}

// ---------------------------------------------------------------------------
// Get Credits
// Endpoint: GET https://gateway.datagma.net/api/ingress/v1/mine
// Auth: apiId query param
// Docs: https://datagmaapi.readme.io/reference/ingressservice_getcredit
// Pricing: free (no credit consumed)
// ---------------------------------------------------------------------------

export interface DatagmaGetCreditsParams extends DatagmaBaseParams {}

export interface DatagmaGetCreditsResponse extends ToolResponse {
  output: {
    credits: number | null
  }
}

// ---------------------------------------------------------------------------
// Union of all response types
// ---------------------------------------------------------------------------

export type DatagmaResponse =
  | DatagmaFindEmailResponse
  | DatagmaEnrichPersonResponse
  | DatagmaEnrichCompanyResponse
  | DatagmaFindPhoneResponse
  | DatagmaGetCreditsResponse
