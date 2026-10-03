import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { CbInsightsOrgParams } from '@/tools/cbinsights/types'
import { asArray, cbInsightsRequest, requireOrgId } from '@/tools/cbinsights/utils'

export const executeCbinsightsGetOrgBusinessRelationshipsOperation: InternalToolOperationImplementation<
  CbInsightsOrgParams
> = async (params, signal) => {
  const orgId = requireOrgId(params.orgId)
  return cbInsightsRequest<{ businessRelationships?: unknown }>(
    params,
    { path: `/v2/organizations/${orgId}/businessrelationships` },
    (data) => ({ businessRelationships: asArray(data.businessRelationships) }),
    signal
  )
}
