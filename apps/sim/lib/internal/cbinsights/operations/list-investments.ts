import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { CbInsightsListInvestmentsParams } from '@/tools/cbinsights/list_investments'
import {
  asArray,
  cbInsightsRequest,
  clampLimit,
  compactBody,
  pageInfo,
  requireOrgIds,
} from '@/tools/cbinsights/utils'

export const executeCbinsightsListInvestmentsOperation: InternalToolOperationImplementation<
  CbInsightsListInvestmentsParams
> = async (params, signal) =>
  cbInsightsRequest<{
    orgs?: unknown
    nextPageToken?: unknown
    totalHits?: unknown
    totalHitsRelation?: unknown
  }>(
    params,
    {
      path: '/v2/financialtransactions/investments',
      body: compactBody({
        orgIds: requireOrgIds(params.orgIds),
        limit: clampLimit(params.limit),
        nextPageToken: params.nextPageToken?.trim(),
      }),
    },
    (data) => ({ orgs: asArray(data.orgs), ...pageInfo(data) }),
    signal
  )
