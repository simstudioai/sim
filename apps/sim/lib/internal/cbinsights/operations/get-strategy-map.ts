import { toStringOrNull } from '@sim/utils/coerce'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { CbInsightsOrgParams } from '@/tools/cbinsights/types'
import { asArray, cbInsightsRequest, requireOrgId } from '@/tools/cbinsights/utils'

export const executeCbinsightsGetStrategyMapOperation: InternalToolOperationImplementation<
  CbInsightsOrgParams
> = async (params, signal) => {
  const orgId = requireOrgId(params.orgId)
  return cbInsightsRequest<{ orgName?: unknown; logoUrl?: unknown; categories?: unknown }>(
    params,
    { path: `/v2/organizations/${orgId}/strategymap` },
    (data) => ({
      orgName: toStringOrNull(data.orgName),
      logoUrl: toStringOrNull(data.logoUrl),
      categories: asArray(data.categories),
    }),
    signal
  )
}
