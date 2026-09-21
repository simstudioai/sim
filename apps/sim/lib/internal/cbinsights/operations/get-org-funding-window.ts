import { toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toRecordOrNull } from '@sim/utils/object'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { CbInsightsOrgParams } from '@/tools/cbinsights/types'
import { cbInsightsRequest, requireOrgId } from '@/tools/cbinsights/utils'

export const executeCbinsightsGetOrgFundingWindowOperation: InternalToolOperationImplementation<
  CbInsightsOrgParams
> = async (params, signal) => {
  const orgId = requireOrgId(params.orgId)
  return cbInsightsRequest<{
    windowStart?: unknown
    windowEnd?: unknown
    cohortNextRoundRate?: unknown
    cohortCriteria?: unknown
    latestFunding?: unknown
  }>(
    params,
    { path: `/v2/organizations/${orgId}/fundingwindow` },
    (data) => ({
      windowStart: toStringOrNull(data.windowStart),
      windowEnd: toStringOrNull(data.windowEnd),
      cohortNextRoundRate: toNumberOrNull(data.cohortNextRoundRate),
      cohortCriteria: toRecordOrNull(data.cohortCriteria),
      latestFunding: toRecordOrNull(data.latestFunding),
    }),
    signal
  )
}
