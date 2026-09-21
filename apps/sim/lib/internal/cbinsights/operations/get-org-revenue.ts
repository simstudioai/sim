import { toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { CbInsightsOrgParams } from '@/tools/cbinsights/types'
import { asArray, cbInsightsRequest, requireOrgId } from '@/tools/cbinsights/utils'

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
      orgId: toNumberOrNull(data.orgId),
      orgName: toStringOrNull(data.orgName),
      orgUrl: toStringOrNull(data.orgUrl),
      revenue: asArray(data.revenue),
    }),
    signal
  )
}
