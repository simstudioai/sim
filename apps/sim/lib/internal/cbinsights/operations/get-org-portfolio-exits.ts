import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { CbInsightsOrgParams } from '@/tools/cbinsights/types'
import { asArray, cbInsightsRequest, requireOrgId } from '@/tools/cbinsights/utils'

export const executeCbinsightsGetOrgPortfolioExitsOperation: InternalToolOperationImplementation<
  CbInsightsOrgParams
> = async (params, signal) => {
  const orgId = requireOrgId(params.orgId)
  return cbInsightsRequest<{ portfolioExits?: unknown }>(
    params,
    { path: `/v2/organizations/${orgId}/financialtransactions/portfolioexits` },
    (data) => ({ portfolioExits: asArray(data.portfolioExits) }),
    signal
  )
}
