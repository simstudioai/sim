import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { CbInsightsOrgParams } from '@/tools/cbinsights/types'
import { asArray, asString, cbInsightsRequest, requireOrgId } from '@/tools/cbinsights/utils'

export const executeCbinsightsGetStrategyMapOperation: InternalToolOperationImplementation<
  CbInsightsOrgParams
> = async (params, signal) => {
  const orgId = requireOrgId(params.orgId)
  return cbInsightsRequest<{ orgName?: unknown; logoUrl?: unknown; categories?: unknown }>(
    params,
    { path: `/v2/organizations/${orgId}/strategymap` },
    (data) => ({
      orgName: asString(data.orgName),
      logoUrl: asString(data.logoUrl),
      categories: asArray(data.categories),
    }),
    signal
  )
}
