import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { CbInsightsOrgFundingsParams } from '@/tools/cbinsights/get_org_fundings'
import {
  asArray,
  cbInsightsRequest,
  clampLimit,
  compactBody,
  pageInfo,
  parseOptionalStringParam,
  requireOrgId,
} from '@/tools/cbinsights/utils'

export const executeCbinsightsGetOrgFundingsOperation: InternalToolOperationImplementation<
  CbInsightsOrgFundingsParams
> = async (params, signal) => {
  const orgId = requireOrgId(params.orgId)
  return cbInsightsRequest<{
    fundings?: unknown
    capTableHistory?: unknown
    nextPageToken?: unknown
    totalHits?: unknown
    totalHitsRelation?: unknown
  }>(
    params,
    {
      path: `/v2/organizations/${orgId}/financialtransactions/fundings`,
      body: compactBody({
        limit: clampLimit(params.limit),
        nextPageToken: parseOptionalStringParam(params.nextPageToken, 'nextPageToken'),
      }),
    },
    (data) => ({
      fundings: asArray(data.fundings),
      capTableHistory: asArray(data.capTableHistory),
      ...pageInfo(data),
    }),
    signal
  )
}
