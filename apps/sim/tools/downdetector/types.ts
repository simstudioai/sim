import type { ToolResponse } from '@/tools/types'

/** Base URL for the Downdetector Enterprise API (v2). */
export const DOWNDETECTOR_API_BASE = 'https://downdetectorapi.com/v2'

interface DowndetectorBaseParams {
  /** Bearer access token generated from the Downdetector API dashboard. */
  apiKey: string
}

/** Company summary returned by the search endpoint (restricted field set). */
export interface DowndetectorCompanySummary {
  id: number | null
  name: string | null
  slug: string | null
  url: string | null
  countryIso: string | null
  categoryId: number | null
}

/** Full company detail returned by the company endpoint. */
export interface DowndetectorCompany {
  id: number | null
  name: string | null
  slug: string | null
  url: string | null
  status: string | null
  categoryId: number | null
  countryIso: string | null
  siteId: number | null
  baselineCurrent: number | null
  stats24: number[]
  baseline: number[]
  indicators: string[]
  description: string | null
}

/** A single reported indicator (e.g. "App crashing", "Login") for a company. */
export interface DowndetectorIndicator {
  slug: string | null
  indicator: string | null
  key: string | null
  amount: number | null
  percentage: number | null
}

/** A time bucket of report counts. */
export interface DowndetectorReportBucket {
  pointInTime: string | null
  total: number | null
  indicators: number | null
  other: number | null
}

/** An incident (outage) detected for a company. */
export interface DowndetectorIncident {
  id: number | null
  createdAt: string | null
  resolvedAt: string | null
  isActive: boolean | null
  peakAttribution: number | null
  peakUserImpact: number | null
  total: number | null
  indicators: number | null
  other: number | null
  updatedAt: string | null
}

/** A Downdetector category (e.g. "Telecom", "Gaming"). */
export interface DowndetectorCategory {
  id: number | null
  name: string | null
  slug: string | null
}

/** A Downdetector site (regional status page domain). */
export interface DowndetectorSite {
  id: number | null
  name: string | null
  domain: string | null
  countryId: number | null
}

/** Company summary including current status (returned by the site companies endpoint). */
export interface DowndetectorSiteCompany {
  id: number | null
  name: string | null
  slug: string | null
  url: string | null
  status: string | null
  countryIso: string | null
  categoryId: number | null
}

/** An event (e.g. a detected outage) published for a company. */
export interface DowndetectorEvent {
  id: number | null
  title: string | null
  body: string | null
  companyId: number | null
  createdAt: string | null
  publishAt: string | null
  isActive: boolean | null
  measurement: {
    startedOn: string | null
    endedOn: string | null
    expected: number | null
    actual: number | null
  } | null
}

/** Incident attribution detail for a company. */
export interface DowndetectorAttribution {
  attribution: number | null
  attributionCalculatedAt: string | null
  userImpact: number | null
  userImpactCalculatedAt: string | null
  reason: number | null
  dangerDurationS: number | null
  incidentId: number | null
  incidentCreatedAt: string | null
}

/** A Downdetector provider (ISP / network operator). */
export interface DowndetectorProvider {
  id: number | null
  name: string | null
  downdetectorId: number | null
}

export interface DowndetectorSearchCompaniesParams extends DowndetectorBaseParams {
  name?: string
  country?: string
  slug?: string
  categoryId?: number
  page?: number
  pageSize?: number
}

export interface DowndetectorSearchCompaniesResponse extends ToolResponse {
  output: {
    companies: DowndetectorCompanySummary[]
    nextPage: string | null
  }
}

export interface DowndetectorGetCompanyParams extends DowndetectorBaseParams {
  companyId: string
  fields?: string
}

export interface DowndetectorGetCompanyResponse extends ToolResponse {
  output: {
    company: DowndetectorCompany
  }
}

export interface DowndetectorGetCompanyStatusParams extends DowndetectorBaseParams {
  companyId: string
  threshold?: number
}

export interface DowndetectorGetCompanyStatusResponse extends ToolResponse {
  output: {
    status: string
  }
}

export interface DowndetectorGetCompanyBaselineParams extends DowndetectorBaseParams {
  companyId: string
}

export interface DowndetectorGetCompanyBaselineResponse extends ToolResponse {
  output: {
    baseline: number
  }
}

export interface DowndetectorGetCompanyIndicatorsParams extends DowndetectorBaseParams {
  companyId: string
  startdate?: string
  enddate?: string
}

export interface DowndetectorGetCompanyIndicatorsResponse extends ToolResponse {
  output: {
    indicators: DowndetectorIndicator[]
  }
}

export interface DowndetectorGetReportsParams extends DowndetectorBaseParams {
  slugs: string
  startdate?: string
  enddate?: string
  interval?: string
}

export interface DowndetectorGetReportsResponse extends ToolResponse {
  output: {
    reports: DowndetectorReportBucket[]
  }
}

export interface DowndetectorGetCompanyIncidentsParams extends DowndetectorBaseParams {
  companyId: string
  onlyActive?: boolean
  startdate?: string
  enddate?: string
  page?: number
  pageSize?: number
}

export interface DowndetectorListIncidentsParams extends DowndetectorBaseParams {
  onlyActive?: boolean
  startdate?: string
  enddate?: string
  page?: number
  pageSize?: number
}

export interface DowndetectorIncidentsResponse extends ToolResponse {
  output: {
    incidents: DowndetectorIncident[]
    nextPage: string | null
  }
}

export interface DowndetectorListCategoriesParams extends DowndetectorBaseParams {}

export interface DowndetectorListCategoriesResponse extends ToolResponse {
  output: {
    categories: DowndetectorCategory[]
  }
}

export interface DowndetectorListSitesParams extends DowndetectorBaseParams {}

export interface DowndetectorListSitesResponse extends ToolResponse {
  output: {
    sites: DowndetectorSite[]
  }
}

export interface DowndetectorGetCompanyLast15Params extends DowndetectorBaseParams {
  companyId: string
}

export interface DowndetectorGetCompanyLast15Response extends ToolResponse {
  output: {
    count: number
  }
}

export interface DowndetectorGetCompanyEventsParams extends DowndetectorBaseParams {
  companyId: string
  startdate?: string
  enddate?: string
  page?: number
  pageSize?: number
}

export interface DowndetectorGetCompanyEventsResponse extends ToolResponse {
  output: {
    events: DowndetectorEvent[]
    nextPage: string | null
  }
}

export interface DowndetectorGetCompanyAttributionParams extends DowndetectorBaseParams {
  companyId: string
}

export interface DowndetectorGetCompanyAttributionResponse extends ToolResponse {
  output: {
    attribution: DowndetectorAttribution
  }
}

export interface DowndetectorGetSiteCompaniesParams extends DowndetectorBaseParams {
  siteId: string
  fields?: string
  /** Opaque page token from a previous response's `X-Page-Next` header. */
  page?: string
  pageSize?: number
}

export interface DowndetectorGetSiteCompaniesResponse extends ToolResponse {
  output: {
    companies: DowndetectorSiteCompany[]
    nextPage: string | null
  }
}

export interface DowndetectorGetProviderParams extends DowndetectorBaseParams {
  providerId: string
}

export interface DowndetectorGetProviderResponse extends ToolResponse {
  output: {
    provider: DowndetectorProvider
  }
}

export type DowndetectorResponse =
  | DowndetectorSearchCompaniesResponse
  | DowndetectorGetCompanyResponse
  | DowndetectorGetCompanyStatusResponse
  | DowndetectorGetCompanyBaselineResponse
  | DowndetectorGetCompanyIndicatorsResponse
  | DowndetectorGetReportsResponse
  | DowndetectorIncidentsResponse
  | DowndetectorListCategoriesResponse
  | DowndetectorListSitesResponse
  | DowndetectorGetCompanyLast15Response
  | DowndetectorGetCompanyEventsResponse
  | DowndetectorGetCompanyAttributionResponse
  | DowndetectorGetSiteCompaniesResponse
  | DowndetectorGetProviderResponse
