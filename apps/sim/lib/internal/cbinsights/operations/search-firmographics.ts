import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { CbInsightsFirmographicsParams } from '@/tools/cbinsights/search_firmographics'
import { sortDirection } from '@/tools/cbinsights/search_firmographics'
import {
  asArray,
  cbInsightsRequest,
  clampLimit,
  compactBody,
  pageInfo,
  parseBooleanParam,
  parseIdListParam,
  parseIntegerParam,
  parseNumberParam,
  parseStringListParam,
} from '@/tools/cbinsights/utils'

export const executeCbinsightsSearchFirmographicsOperation: InternalToolOperationImplementation<
  CbInsightsFirmographicsParams
> = async (params, signal) => {
  const filters = compactBody({
    keyword: params.keyword?.trim(),
    orgIds: parseIdListParam(params.orgIds, 'orgIds'),
    orgNames: parseStringListParam(params.orgNames, 'orgNames'),
    urls: parseStringListParam(params.urls, 'urls'),
    tickers: parseStringListParam(params.tickers, 'tickers'),
    marketIds: parseIdListParam(params.marketIds, 'marketIds'),
    marketNames: parseStringListParam(params.marketNames, 'marketNames'),
    industryIds: parseIdListParam(params.industryIds, 'industryIds'),
    sectorIds: parseIdListParam(params.sectorIds, 'sectorIds'),
    subindustryIds: parseIdListParam(params.subindustryIds, 'subindustryIds'),
    businessModelIds: parseIdListParam(params.businessModelIds, 'businessModelIds'),
    technologyIds: parseIdListParam(params.technologyIds, 'technologyIds'),
    collectionIds: parseIdListParam(params.collectionIds, 'collectionIds'),
    countryIds: parseIdListParam(params.countryIds, 'countryIds'),
    stateProvinceIds: parseIdListParam(params.stateProvinceIds, 'stateProvinceIds'),
    cityIds: parseIdListParam(params.cityIds, 'cityIds'),
    continentIds: parseIdListParam(params.continentIds, 'continentIds'),
    regionIds: parseIdListParam(params.regionIds, 'regionIds'),
    orgStatusIds: parseIdListParam(params.orgStatusIds, 'orgStatusIds'),
    investorOrgIds: parseIdListParam(params.investorOrgIds, 'investorOrgIds'),
    investorTypeIds: parseIdListParam(params.investorTypeIds, 'investorTypeIds'),
    fundingInvestorTypeIds: parseIdListParam(
      params.fundingInvestorTypeIds,
      'fundingInvestorTypeIds'
    ),
    lastFundingRoundIds: parseIdListParam(params.lastFundingRoundIds, 'lastFundingRoundIds'),
    lastFundingRoundCategoryIds: parseIdListParam(
      params.lastFundingRoundCategoryIds,
      'lastFundingRoundCategoryIds'
    ),
    minCurrentHeadcount: parseIntegerParam(params.minCurrentHeadcount, 'minCurrentHeadcount'),
    maxCurrentHeadcount: parseIntegerParam(params.maxCurrentHeadcount, 'maxCurrentHeadcount'),
    minTotalFundingInMillions: parseNumberParam(
      params.minTotalFundingInMillions,
      'minTotalFundingInMillions'
    ),
    maxTotalFundingInMillions: parseNumberParam(
      params.maxTotalFundingInMillions,
      'maxTotalFundingInMillions'
    ),
    minValuationInMillions: parseNumberParam(
      params.minValuationInMillions,
      'minValuationInMillions'
    ),
    maxValuationInMillions: parseNumberParam(
      params.maxValuationInMillions,
      'maxValuationInMillions'
    ),
    minLastFundingDate: params.minLastFundingDate?.trim(),
    maxLastFundingDate: params.maxLastFundingDate?.trim(),
    vcBacked: parseBooleanParam(params.vcBacked, 'vcBacked'),
  })

  /*
   * The guard has to measure the *filters* alone. Folding limit, the page
   * token, or the sort into the same object would let a request carrying only
   * paging past it — which is an unfiltered search over the whole database,
   * and it still spends credits.
   */
  if (Object.keys(filters).length === 0) {
    throw new Error('CB Insights firmographics search requires at least one search parameter')
  }

  const body: Record<string, unknown> = {
    ...filters,
    ...compactBody({
      limit: clampLimit(params.limit),
      nextPageToken: params.nextPageToken?.trim(),
    }),
  }

  /* The API takes one sort object; the block exposes it as two plain fields
       so neither has to be typed as JSON. */
  const sortField = params.sortField?.trim()
  if (sortField) {
    body.sort = { field: sortField, direction: sortDirection(params.sortDirection) }
  }

  return cbInsightsRequest<{
    orgs?: unknown
    nextPageToken?: unknown
    totalHits?: unknown
    totalHitsRelation?: unknown
  }>(
    params,
    { path: '/v2/firmographics', body },
    (data) => ({ orgs: asArray(data.orgs), ...pageInfo(data) }),
    signal
  )
}
