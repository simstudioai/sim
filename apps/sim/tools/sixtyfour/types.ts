import type { ToolResponse } from '@/tools/types'

/**
 * Client-side deadline for the two synchronous enrichment endpoints
 * (`/people-intelligence`, `/company-intelligence`).
 *
 * Sixtyfour reports a P95 of roughly 5 minutes for these calls, with complex
 * cases reaching 10, and its docs ask clients to allow at least 15 minutes.
 * Sim's default outbound-fetch deadline is 300000 ms, which cuts off at the
 * P95, so both enrichment tools send this value as the reserved `timeout`
 * param that `prepareToolRequest` turns into the fetch deadline.
 */
export const SIXTYFOUR_ENRICH_TIMEOUT_MS = 900_000

/** Research depth / credit control for `/people-intelligence`. */
export type SixtyfourLeadTier = 'micro' | 'low' | 'medium' | 'high' | 'xhigh'

/** Research depth / credit control for `/company-intelligence`. */
export type SixtyfourCompanyTier = 'micro' | 'low' | 'medium' | 'high'

export interface SixtyfourFindPhoneParams {
  apiKey: string
  name: string
  company?: string
  linkedinUrl?: string
  domain?: string
  email?: string
}

export interface SixtyfourFindEmailParams {
  apiKey: string
  name: string
  company?: string
  linkedinUrl?: string
  domain?: string
  phone?: string
  title?: string
  mode?: string
}

export interface SixtyfourEnrichLeadParams {
  apiKey: string
  leadInfo: string
  struct?: string
  researchPlan?: string
  tier?: SixtyfourLeadTier
  timeout?: number
}

export interface SixtyfourEnrichCompanyParams {
  apiKey: string
  targetCompany: string
  struct: string
  findPeople?: boolean
  fullOrgChart?: boolean
  researchPlan?: string
  peopleFocusPrompt?: string
  leadStruct?: string
  tier?: SixtyfourCompanyTier
  timeout?: number
}

export interface SixtyfourFindPhoneResponse extends ToolResponse {
  output: {
    name: string | null
    company: string | null
    phone: string | null
    linkedinUrl: string | null
  }
}

export interface SixtyfourFindEmailResponse extends ToolResponse {
  output: {
    name: string | null
    company: string | null
    title: string | null
    phone: string | null
    linkedinUrl: string | null
    emails: { address: string; status: string; type: string }[]
    personalEmails: { address: string; status: string; type: string }[]
  }
}

export interface SixtyfourEnrichLeadResponse extends ToolResponse {
  output: {
    notes: string | null
    structuredData: Record<string, unknown>
    references: Record<string, string>
    confidenceScore: number | null
  }
}

export interface SixtyfourEnrichCompanyResponse extends ToolResponse {
  output: {
    notes: string | null
    structuredData: Record<string, unknown>
    references: Record<string, string>
    confidenceScore: number | null
    orgChart: Record<string, unknown> | unknown[] | null
  }
}
