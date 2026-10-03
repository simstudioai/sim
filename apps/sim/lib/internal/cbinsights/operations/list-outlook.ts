import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { CbInsightsListOutlookParams } from '@/tools/cbinsights/list_outlook'
import { asArray, cbInsightsRequest, compactBody, requireOrgIds } from '@/tools/cbinsights/utils'

export const executeCbinsightsListOutlookOperation: InternalToolOperationImplementation<
  CbInsightsListOutlookParams
> = async (params, signal) =>
  cbInsightsRequest<{ orgs?: unknown }>(
    params,
    {
      path: '/v2/outlook',
      body: compactBody({
        orgIds: requireOrgIds(params.orgIds),
      }),
    },
    (data) => ({ orgs: asArray(data.orgs) }),
    signal
  )
