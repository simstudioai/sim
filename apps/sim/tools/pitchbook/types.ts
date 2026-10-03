import type { PitchbookStats } from '@/tools/pitchbook/utils'
import type { ToolResponse } from '@/tools/types'

/** Shared by every PitchBook tool. */
export interface PitchbookBaseParams {
  apiKey: string
  /**
   * Optional ISO currency code. Sent as the `X-Currency` header so monetary
   * values are converted before they are returned.
   */
  currency?: string
}

/** Shared by every tool that reads a single profile by PitchBook ID. */
export interface PitchbookProfileParams extends PitchbookBaseParams {
  pbId: string
}

/** Shared by every search endpoint. */
export interface PitchbookSearchParams extends PitchbookBaseParams {
  page?: number
  perPage?: number
  /** Extra documented query filters that have no dedicated field, as an object. */
  additionalFilters?: Record<string, unknown>
}

/** `{ code, description }` pair used for every enumerated PitchBook field. */
export interface PitchbookCode {
  code: string | null
  description: string | null
}

/** Monetary value carrying both the converted and the natively reported amount. */
export interface PitchbookMoney {
  amount: number | null
  currency: string | null
  nativeAmount: number | null
  nativeCurrency: string | null
  estimated: boolean
}

export interface PitchbookResponse extends ToolResponse {
  output: Record<string, unknown>
}

export interface PitchbookSearchResponse extends ToolResponse {
  output: {
    stats: PitchbookStats
    items: Array<Record<string, unknown>>
  }
}

export interface PitchbookGeneralSearchParams extends PitchbookBaseParams {
  query: string
  page?: number
  perPage?: number
}

export interface PitchbookCompanySearchParams extends PitchbookSearchParams {
  /** ISO code the monetary filters are expressed in; sent as the `currency` query param. */
  filterCurrency?: string
  companyNames?: string
  keywords?: string
  city?: string
  stateProvince?: string
  country?: string
  locationType?: string
  ownershipStatus?: string
  businessStatus?: string
  dateFounded?: string
  industry?: string
  verticals?: string
  dealType?: string
  dealSize?: string
  dealDate?: string
  totalRaised?: string
  investorNames?: string
  employeeCount?: string
  revenue?: string
}

export interface PitchbookDealSearchParams extends PitchbookSearchParams {
  /** ISO code the monetary filters are expressed in; sent as the `currency` query param. */
  filterCurrency?: string
  companyNames?: string
  investorNames?: string
  keywords?: string
  country?: string
  locationType?: string
  industry?: string
  verticals?: string
  dealType?: string
  dealStatus?: string
  dealSize?: string
  dealDate?: string
  postValuation?: string
  revenue?: string
}

export interface PitchbookInvestorSearchParams extends PitchbookSearchParams {
  /** ISO code the monetary filters are expressed in; sent as the `currency` query param. */
  filterCurrency?: string
  investorNames?: string
  investorType?: string
  city?: string
  stateProvince?: string
  country?: string
  locationType?: string
  aum?: string
  dryPowder?: string
  fundType?: string
  fundSize?: string
  dealType?: string
  dealDate?: string
  dealSize?: string
  preferredDealTypes?: string
  industryPreferences?: string
  geographicalPreferences?: string
}

export interface PitchbookPeopleSearchParams extends PitchbookSearchParams {
  personNames?: string
  firstName?: string
  lastName?: string
  email?: string
  firmNames?: string
  firmType?: string
  positionLevel?: string
  positionTitle?: string
  primaryPositionOnly?: boolean
  department?: string
  university?: string
  biography?: string
  city?: string
  country?: string
  industry?: string
  verticals?: string
}

export interface PitchbookFundSearchParams extends PitchbookSearchParams {
  /** ISO code the monetary filters are expressed in; sent as the `currency` query param. */
  filterCurrency?: string
  fundNames?: string
  investorNames?: string
  fundType?: string
  fundSize?: string
  dryPowder?: string
  vintage?: string
  city?: string
  country?: string
  irr?: string
  tvpi?: string
  dpi?: string
  industryPreferences?: string
  geographicalPreferences?: string
}

export interface PitchbookLimitedPartnerSearchParams extends PitchbookSearchParams {
  /** ISO code the monetary filters are expressed in; sent as the `currency` query param. */
  filterCurrency?: string
  limitedPartnerNames?: string
  limitedPartnerType?: string
  city?: string
  stateProvince?: string
  country?: string
  locationType?: string
  aum?: string
  numberOfCommitments?: string
  commitmentSize?: string
  commitmentDate?: string
  fundType?: string
}

export interface PitchbookServiceProviderSearchParams extends PitchbookSearchParams {
  serviceProviderNames?: string
  serviceProviderType?: string
  city?: string
  stateProvince?: string
  country?: string
  locationType?: string
  numberOfDeals?: string
  dealType?: string
  dealDate?: string
  dealSize?: string
  serviceTypesOnDeal?: string
}

/** Shared by the per-entity `updates` endpoints, which take a window, not paging. */
export interface PitchbookUpdatesParams extends PitchbookProfileParams {
  /** Carries its operator in the value: `>YYYY-MM-DD`, `<YYYY-MM-DD`, or `YYYY-MM-DD^YYYY-MM-DD`. */
  sinceDate?: string
  trailingRange?: number
}

/** Account-usage endpoints take the same window as the `updates` endpoints. */
export interface PitchbookUsageWindowParams extends PitchbookBaseParams {
  sinceDate?: string
  trailingRange?: number
}

export interface PitchbookFundCashFlowsParams extends PitchbookProfileParams {
  /** Reporting quarter, formatted as quarter then year, e.g. `4Q2018`. */
  period: string
}

export interface PitchbookPatentSearchParams extends PitchbookProfileParams {
  status?: string
  publicationDate?: string
  firstFilingDate?: string
  filingAuthorityLocation?: string
  cpcSectionCode?: string
  cpcClassCode?: string
  page?: number
  perPage?: number
}

export interface PitchbookCreditNewsSearchParams extends PitchbookBaseParams {
  authors?: string
  regions?: string
  assetClasses?: string
  topics?: string
  issuer?: string
  lender?: string
  sponsor?: string
  sinceDate?: string
  page?: number
  perPage?: number
}

export interface PitchbookCreditNewsRecentParams extends PitchbookBaseParams {
  page?: number
  perPage?: number
}

export interface PitchbookCreditNewsBulkParams extends PitchbookBaseParams {
  articleIds: Array<number | string>
}

export interface PitchbookContractsHistoryParams extends PitchbookBaseParams {
  activeContract?: boolean
}

export interface PitchbookCostOfCallsParams extends PitchbookBaseParams {
  pricingModel?: string
}

export interface PitchbookSandboxEntitiesParams extends PitchbookBaseParams {
  entityType: string
}

export interface PitchbookLookupTablesParams extends PitchbookBaseParams {
  tableNames: string
}

export interface PitchbookSharedSearchParams extends PitchbookBaseParams {
  entityType: string
  searchId: string
  hash: string
  page?: number
  perPage?: number
}

export interface PitchbookEntityNewsWindowParams extends PitchbookProfileParams {
  sinceDate?: string
  trailingRange?: number
}

export interface PitchbookCompanySocialAnalyticsParams extends PitchbookProfileParams {
  /** Peer set to benchmark against: SIMILAR_COMPANIES, INDUSTRY, VERTICALS, or ALL_COMPANIES. */
  compare?: string
}
