import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { CbInsightsListRevenueParams } from '@/tools/cbinsights/list_revenue'
import { asArray, cbInsightsRequest, compactBody, requireOrgIds } from '@/tools/cbinsights/utils'

export const executeCbinsightsListRevenueOperation: InternalToolOperationImplementation<
  CbInsightsListRevenueParams
> = async (params, signal) =>
  cbInsightsRequest<{ orgs?: unknown }>(
    params,
    {
      path: '/v2/revenuebyyear',
      body: compactBody({
        orgIds: requireOrgIds(params.orgIds),
      }),
    },
    (data) => ({ orgs: asArray(data.orgs) }),
    signal
  )
