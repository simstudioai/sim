import type { ToolResponse } from '@/tools/types'

export interface ZoomInfoBaseParams {
  clientId: string
  clientSecret: string
}

export interface ZoomInfoSearchCompaniesParams extends ZoomInfoBaseParams {
  companyName?: string
  companyWebsite?: string
  companyTicker?: string
  industryCodes?: string
  country?: string
  state?: string
  metroRegion?: string
  revenueMin?: number
  revenueMax?: number
  employeeRangeMin?: number
  employeeRangeMax?: number
  excludeDefunctCompanies?: boolean
  page?: number
  rpp?: number
  sortBy?: string
  sortOrder?: string
}

export interface ZoomInfoSearchContactsParams extends ZoomInfoBaseParams {
  firstName?: string
  lastName?: string
  fullName?: string
  emailAddress?: string
  jobTitle?: string
  managementLevel?: string
  department?: string
  companyId?: string
  companyName?: string
  contactAccuracyScoreMin?: number
  requiredFields?: string
  excludePartialProfiles?: boolean
  page?: number
  rpp?: number
  sortBy?: string
  sortOrder?: string
}

export interface ZoomInfoEnrichCompaniesParams extends ZoomInfoBaseParams {
  matchCompanyInput: string
  outputFields?: string
}

export interface ZoomInfoEnrichContactsParams extends ZoomInfoBaseParams {
  matchPersonInput: string
  outputFields?: string
  requiredFields?: string
}

export interface ZoomInfoSearchIntentParams extends ZoomInfoBaseParams {
  topics: string
  signalStartDate?: string
  signalEndDate?: string
  signalScoreMin?: number
  signalScoreMax?: number
  audienceStrengthMin?: string
  audienceStrengthMax?: string
  findRecommendedContacts?: boolean
  country?: string
  state?: string
  industryCodes?: string
  page?: number
  rpp?: number
}

export interface ZoomInfoSearchNewsParams extends ZoomInfoBaseParams {
  categories?: string
  url?: string
  pageDateMin?: string
  pageDateMax?: string
  page?: number
  rpp?: number
}

export interface ZoomInfoSearchCompaniesResponse extends ToolResponse {
  output: {
    companies: Array<Record<string, unknown>>
    totalResults: number | null
    currentPage: number | null
    totalPages: number | null
  }
}

export interface ZoomInfoSearchContactsResponse extends ToolResponse {
  output: {
    contacts: Array<Record<string, unknown>>
    totalResults: number | null
    currentPage: number | null
    totalPages: number | null
  }
}

export interface ZoomInfoEnrichCompaniesResponse extends ToolResponse {
  output: {
    results: Array<Record<string, unknown>>
  }
}

export interface ZoomInfoEnrichContactsResponse extends ToolResponse {
  output: {
    results: Array<Record<string, unknown>>
  }
}

export interface ZoomInfoSearchIntentResponse extends ToolResponse {
  output: {
    signals: Array<Record<string, unknown>>
    totalResults: number | null
    currentPage: number | null
    totalPages: number | null
  }
}

export interface ZoomInfoSearchNewsResponse extends ToolResponse {
  output: {
    articles: Array<Record<string, unknown>>
    totalResults: number | null
    currentPage: number | null
    totalPages: number | null
  }
}

export type ZoomInfoResponse =
  | ZoomInfoSearchCompaniesResponse
  | ZoomInfoSearchContactsResponse
  | ZoomInfoEnrichCompaniesResponse
  | ZoomInfoEnrichContactsResponse
  | ZoomInfoSearchIntentResponse
  | ZoomInfoSearchNewsResponse
