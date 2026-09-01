import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { CbInsightsListPortfolioExitsParams } from '@/tools/cbinsights/list_portfolio_exits'
import {
  asArray,
  cbInsightsRequest,
  clampLimit,
  compactBody,
  pageInfo,
  parseOptionalStringParam,
  requireOrgIds,
} from '@/tools/cbinsights/utils'

export const executeCbinsightsListPortfolioExitsOperation: InternalToolOperationImplementation<
  CbInsightsListPortfolioExitsParams
> = async (params, signal) =>
  cbInsightsRequest<{
    orgs?: unknown
    nextPageToken?: unknown
    totalHits?: unknown
    totalHitsRelation?: unknown
  }>(
    params,
    {
      path: '/v2/financialtransactions/portfolioexits',
      body: compactBody({
        orgIds: requireOrgIds(params.orgIds),
        limit: clampLimit(params.limit),
        nextPageToken: parseOptionalStringParam(params.nextPageToken, 'nextPageToken'),
      }),
    },
    (data) => ({ orgs: asArray(data.orgs), ...pageInfo(data) }),
    signal
  )
