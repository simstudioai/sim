import type { CbInsightsAuthParams, CbInsightsListResponse } from '@/tools/cbinsights/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export interface CbInsightsFirmographicsParams extends CbInsightsAuthParams {
  keyword?: string
  orgIds?: number[] | string
  orgNames?: string[] | string
  urls?: string[] | string
  tickers?: string[] | string
  marketIds?: number[] | string
  marketNames?: string[] | string
  industryIds?: number[] | string
  sectorIds?: number[] | string
  subindustryIds?: number[] | string
  businessModelIds?: number[] | string
  technologyIds?: number[] | string
  collectionIds?: number[] | string
  countryIds?: number[] | string
  stateProvinceIds?: number[] | string
  cityIds?: number[] | string
  continentIds?: number[] | string
  regionIds?: number[] | string
  orgStatusIds?: number[] | string
  investorOrgIds?: number[] | string
  investorTypeIds?: number[] | string
  fundingInvestorTypeIds?: number[] | string
  lastFundingRoundIds?: number[] | string
  lastFundingRoundCategoryIds?: number[] | string
  minCurrentHeadcount?: number | string
  maxCurrentHeadcount?: number | string
  minTotalFundingInMillions?: number | string
  maxTotalFundingInMillions?: number | string
  minValuationInMillions?: number | string
  maxValuationInMillions?: number | string
  minLastFundingDate?: string
  maxLastFundingDate?: string
  vcBacked?: boolean | string
  sortField?: string
  sortDirection?: string
  limit?: number | string
  nextPageToken?: string
}

/**
 * Reads the sort direction, defaulting to the API's own `desc` when unset.
 *
 * A value that is neither is rejected rather than folded into the default: a
 * mistyped `"ascending"` would silently reverse the page and hand back the
 * bottom of the result set as though it were the top, on a metered search.
 */
export function sortDirection(value: unknown): 'asc' | 'desc' {
  if (value === undefined || value === null) return 'desc'
  const normalized = String(value).trim().toLowerCase()
  if (normalized === '') return 'desc'
  if (normalized === 'asc' || normalized === 'desc') return normalized
  throw new Error(
    `CB Insights "sortDirection" must be "asc" or "desc" (received "${String(value)}")`
  )
}

export const cbinsightsSearchFirmographicsTool: InternalToolConfig<
  CbInsightsFirmographicsParams,
  CbInsightsListResponse
> = {
  id: 'cbinsights_search_firmographics',
  name: 'CB Insights Search Firmographics',
  description:
    'Search profiles of private companies, public companies, and investors by market, industry, geography, headcount, funding, and valuation. Each field is ANDed together; values within a field are ORed.',
  version: '1.0.0',

  params: {
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CB Insights API client ID, exchanged for a bearer token before each call',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CB Insights API client secret, exchanged for a bearer token before each call',
    },
    keyword: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search term matched against organization names, descriptions, and aliases',
    },
    orgIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'CB Insights organization IDs to return, e.g. [129410, 129411]',
    },
    orgNames: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Organization names to match exactly, e.g. ["CB Insights"]',
    },
    urls: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Organization websites to match, e.g. ["cbinsights.com"]',
    },
    tickers: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Stock tickers to match, each optionally suffixed with an exchange code after a colon',
    },
    marketIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'CB Insights market IDs to match, e.g. [6, 95, 106]',
    },
    marketNames: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'CB Insights market names to match. Partial matches count — "AI" returns every market whose name contains it.',
    },
    industryIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'CB Insights industry IDs to match (mid level of the taxonomy)',
    },
    sectorIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'CB Insights sector IDs to match (top level of the taxonomy)',
    },
    subindustryIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'CB Insights sub-industry IDs to match (lowest level of the taxonomy)',
    },
    businessModelIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'CB Insights business model IDs to match',
    },
    technologyIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'CB Insights technology landscape IDs to match',
    },
    collectionIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expert Collection IDs to search within',
    },
    countryIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'CB Insights country IDs to match',
    },
    stateProvinceIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'CB Insights state or province IDs to match',
    },
    cityIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'CB Insights city IDs to match',
    },
    continentIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'CB Insights continent IDs to match',
    },
    regionIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'CB Insights region IDs to match',
    },
    orgStatusIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'CB Insights organization status IDs to match (active, acquired, dead, IPO, merged)',
    },
    investorOrgIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return organizations these investor organization IDs have invested in',
    },
    investorTypeIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return investor organizations of these investor types',
    },
    fundingInvestorTypeIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return organizations funded by these investor types',
    },
    lastFundingRoundIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'CB Insights funding round IDs of the most recent round',
    },
    lastFundingRoundCategoryIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'CB Insights funding round category IDs of the most recent round',
    },
    minCurrentHeadcount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum current headcount',
    },
    maxCurrentHeadcount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum current headcount',
    },
    minTotalFundingInMillions: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum total funding raised, in millions of US dollars',
    },
    maxTotalFundingInMillions: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum total funding raised, in millions of US dollars',
    },
    minValuationInMillions: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum valuation, in millions of US dollars',
    },
    maxValuationInMillions: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum valuation, in millions of US dollars',
    },
    minLastFundingDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Earliest date of the most recent funding round, as YYYY-MM-DD',
    },
    maxLastFundingDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Latest date of the most recent funding round, as YYYY-MM-DD',
    },
    vcBacked: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict to organizations that have received venture funding',
    },
    sortField: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort field: orgName, orgId, lastUpdateTime, lastFundingDate, latestValuation, mosaicOverall, mosaicManagement, mosaicMarket, mosaicMomentum, mosaicMoney, headcountCurrent, headcount6MonthGrowth, headcount12MonthGrowth, or headcount24MonthGrowth',
    },
    sortDirection: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort direction, "asc" or "desc"',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Rows to return in a single response, 1-100',
    },
    nextPageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Continuation token from a previous response; omit for the first page',
    },
  },

  operation: {
    input: createInternalToolOperationInput,
  },

  outputs: {
    orgs: {
      type: 'json',
      description:
        'Matching profiles as [{orgId, summary, taxonomy, financials, headcount, identifiers, businessModels, competitors, expertCollections, parentOrgs, childOrgs}]',
    },
    nextPageToken: {
      type: 'string',
      nullable: true,
      description: 'Token for the next page, or null when there are no more results',
    },
    totalHits: {
      type: 'number',
      nullable: true,
      description: 'Total number of matching records',
    },
    totalHitsRelation: {
      type: 'string',
      nullable: true,
      description: "Whether totalHits is exact ('eq') or a floor ('gte', used above 10,000)",
    },
  },
}
