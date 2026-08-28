import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { CbInsightsOrgParams } from '@/tools/cbinsights/types'
import {
  asNumber,
  asRecord,
  asString,
  cbInsightsRequest,
  requireOrgId,
} from '@/tools/cbinsights/utils'

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
      windowStart: asString(data.windowStart),
      windowEnd: asString(data.windowEnd),
      cohortNextRoundRate: asNumber(data.cohortNextRoundRate),
      cohortCriteria: asRecord(data.cohortCriteria),
      latestFunding: asRecord(data.latestFunding),
    }),
    signal
  )
}
