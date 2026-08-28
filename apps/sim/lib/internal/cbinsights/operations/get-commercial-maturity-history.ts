import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { CbInsightsCommercialMaturityHistoryParams } from '@/tools/cbinsights/get_commercial_maturity_history'
import { asArray, cbInsightsRequest, compactBody, requireOrgId } from '@/tools/cbinsights/utils'

export const executeCbinsightsGetCommercialMaturityHistoryOperation: InternalToolOperationImplementation<
  CbInsightsCommercialMaturityHistoryParams
> = async (params, signal) => {
  const orgId = requireOrgId(params.orgId)
  return cbInsightsRequest<{ commercialMaturityHistory?: unknown }>(
    params,
    {
      path: `/v2/organizations/${orgId}/commercialmaturityhistory`,
      body: compactBody({
        startDate: params.startDate?.trim(),
        endDate: params.endDate?.trim(),
      }),
    },
    (data) => ({ commercialMaturityHistory: asArray(data.commercialMaturityHistory) }),
    signal
  )
}
