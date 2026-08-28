import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { CbInsightsOrgParams } from '@/tools/cbinsights/types'
import { asRecord, cbInsightsRequest, requireOrgId } from '@/tools/cbinsights/utils'

export const executeCbinsightsGetOrgOutlookOperation: InternalToolOperationImplementation<
  CbInsightsOrgParams
> = async (params, signal) => {
  const orgId = requireOrgId(params.orgId)
  return cbInsightsRequest<{
    mosaicScore?: unknown
    commercialMaturity?: unknown
    exitProbability?: unknown
  }>(
    params,
    { path: `/v2/organizations/${orgId}/outlook` },
    (data) => ({
      mosaicScore: asRecord(data.mosaicScore),
      commercialMaturity: asRecord(data.commercialMaturity),
      exitProbability: asRecord(data.exitProbability),
    }),
    signal
  )
}
