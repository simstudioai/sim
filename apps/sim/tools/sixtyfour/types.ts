import type { ToolResponse } from '@/tools/types'

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
  struct: string
  researchPlan?: string
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
  }
}
