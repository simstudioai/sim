import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { CbInsightsOrgInvestmentsParams } from '@/tools/cbinsights/get_org_investments'
import {
  asArray,
  cbInsightsRequest,
  clampLimit,
  compactBody,
  pageInfo,
  requireOrgId,
} from '@/tools/cbinsights/utils'

export const executeCbinsightsGetOrgInvestmentsOperation: InternalToolOperationImplementation<
  CbInsightsOrgInvestmentsParams
> = async (params, signal) => {
  const orgId = requireOrgId(params.orgId)
  return cbInsightsRequest<{
    investments?: unknown
    nextPageToken?: unknown
    totalHits?: unknown
    totalHitsRelation?: unknown
  }>(
    params,
    {
      path: `/v2/organizations/${orgId}/financialtransactions/investments`,
      body: compactBody({
        limit: clampLimit(params.limit),
        nextPageToken: params.nextPageToken?.trim(),
      }),
    },
    (data) => ({ investments: asArray(data.investments), ...pageInfo(data) }),
    signal
  )
}
