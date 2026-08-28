import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { CbInsightsMosaicHistoryParams } from '@/tools/cbinsights/get_mosaic_history'
import { asArray, cbInsightsRequest, compactBody, requireOrgId } from '@/tools/cbinsights/utils'

export const executeCbinsightsGetMosaicHistoryOperation: InternalToolOperationImplementation<
  CbInsightsMosaicHistoryParams
> = async (params, signal) => {
  const orgId = requireOrgId(params.orgId)
  return cbInsightsRequest<{
    overall?: unknown
    management?: unknown
    market?: unknown
    momentum?: unknown
    money?: unknown
  }>(
    params,
    {
      path: `/v2/organizations/${orgId}/mosaichistory`,
      body: compactBody({ startDate: params.startDate?.trim() }),
    },
    (data) => ({
      overall: asArray(data.overall),
      management: asArray(data.management),
      market: asArray(data.market),
      momentum: asArray(data.momentum),
      money: asArray(data.money),
    }),
    signal
  )
}
