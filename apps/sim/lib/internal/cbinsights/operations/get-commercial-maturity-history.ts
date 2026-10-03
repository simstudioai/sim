import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { CbInsightsCommercialMaturityHistoryParams } from '@/tools/cbinsights/get_commercial_maturity_history'
import {
  asArray,
  cbInsightsRequest,
  compactBody,
  parseOptionalStringParam,
  requireOrgId,
} from '@/tools/cbinsights/utils'

export const executeCbinsightsGetCommercialMaturityHistoryOperation: InternalToolOperationImplementation<
  CbInsightsCommercialMaturityHistoryParams
> = async (params, signal) => {
  const orgId = requireOrgId(params.orgId)
  return cbInsightsRequest<{ commercialMaturityHistory?: unknown }>(
    params,
    {
      path: `/v2/organizations/${orgId}/commercialmaturityhistory`,
      body: compactBody({
        startDate: parseOptionalStringParam(params.startDate, 'startDate'),
        endDate: parseOptionalStringParam(params.endDate, 'endDate'),
      }),
    },
    (data) => ({ commercialMaturityHistory: asArray(data.commercialMaturityHistory) }),
    signal
  )
}
