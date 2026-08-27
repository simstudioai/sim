import type { ToolResponse } from '@/tools/types'

export interface ForagerAuthParams {
  apiKey: string
  accountId?: number | string
}

export interface ForagerSearchParams extends ForagerAuthParams {
  filters?: Record<string, unknown> | string
}

export interface ForagerPersonLookupParams extends ForagerAuthParams {
  personId?: number | string | null
  linkedinPublicIdentifier?: string
}

export interface ForagerWorkEmailLookupParams extends ForagerPersonLookupParams {
  doContactsEnrichment?: boolean | string
}

export interface ForagerReverseEmailLookupParams extends ForagerAuthParams {
  email: string
}

export interface ForagerReversePhoneLookupParams extends ForagerAuthParams {
  phoneNumber: string
}

export interface ForagerWebsiteLookupParams extends ForagerAuthParams {
  domain?: string
  organizationId?: number | string | null
  organizationLinkedinPublicIdentifier?: string
}

export type ForagerRecord = Record<string, unknown>

export interface ForagerSearchResponse extends ToolResponse {
  output: {
    results: ForagerRecord[]
    totalSearchResults: number
  }
}

export interface ForagerTotalsResponse extends ToolResponse {
  output: {
    totalSearchResults: number
    totalPersons?: number
    totalOrganizations?: number
  }
}

export interface ForagerEmailLookupResponse extends ToolResponse {
  output: {
    emails: ForagerRecord[]
  }
}

export interface ForagerPhoneLookupResponse extends ToolResponse {
  output: {
    phoneNumbers: ForagerRecord[]
  }
}

export interface ForagerPersonLookupResponse extends ToolResponse {
  output: {
    person: ForagerRecord
  }
}

export interface ForagerWebsiteLookupResponse extends ToolResponse {
  output: {
    website: ForagerRecord
  }
}

export type ForagerResponse =
  | ForagerSearchResponse
  | ForagerTotalsResponse
  | ForagerEmailLookupResponse
  | ForagerPhoneLookupResponse
  | ForagerPersonLookupResponse
  | ForagerWebsiteLookupResponse
