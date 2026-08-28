import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { CbInsightsListFundingWindowParams } from '@/tools/cbinsights/list_funding_window'
import { asArray, cbInsightsRequest, compactBody, requireOrgIds } from '@/tools/cbinsights/utils'

export const executeCbinsightsListFundingWindowOperation: InternalToolOperationImplementation<
  CbInsightsListFundingWindowParams
> = async (params, signal) =>
  cbInsightsRequest<{ orgs?: unknown }>(
    params,
    {
      path: '/v2/outlook/fundingwindow',
      body: compactBody({
        orgIds: requireOrgIds(params.orgIds),
      }),
    },
    (data) => ({ orgs: asArray(data.orgs) }),
    signal
  )
