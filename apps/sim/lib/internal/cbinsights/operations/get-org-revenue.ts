import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { CbInsightsOrgParams } from '@/tools/cbinsights/types'
import {
  asArray,
  asNumber,
  asString,
  cbInsightsRequest,
  requireOrgId,
} from '@/tools/cbinsights/utils'

export const executeCbinsightsGetOrgRevenueOperation: InternalToolOperationImplementation<
  CbInsightsOrgParams
> = async (params, signal) => {
  const orgId = requireOrgId(params.orgId)
  return cbInsightsRequest<{
    orgId?: unknown
    orgName?: unknown
    orgUrl?: unknown
    revenue?: unknown
  }>(
    params,
    { path: `/v2/organizations/${orgId}/revenuebyyear` },
    (data) => ({
      orgId: asNumber(data.orgId),
      orgName: asString(data.orgName),
      orgUrl: asString(data.orgUrl),
      revenue: asArray(data.revenue),
    }),
    signal
  )
}
