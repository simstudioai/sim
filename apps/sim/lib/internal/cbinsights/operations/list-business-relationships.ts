import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { CbInsightsListBusinessRelationshipsParams } from '@/tools/cbinsights/list_business_relationships'
import {
  asArray,
  asString,
  cbInsightsRequest,
  compactBody,
  requireOrgIds,
} from '@/tools/cbinsights/utils'

export const executeCbinsightsListBusinessRelationshipsOperation: InternalToolOperationImplementation<
  CbInsightsListBusinessRelationshipsParams
> = async (params, signal) =>
  cbInsightsRequest<{ orgs?: unknown; nextPageToken?: unknown }>(
    params,
    {
      path: '/v2/businessrelationships',
      body: compactBody({
        orgIds: requireOrgIds(params.orgIds),
        nextPageToken: params.nextPageToken?.trim(),
      }),
    },
    (data) => ({ orgs: asArray(data.orgs), nextPageToken: asString(data.nextPageToken) }),
    signal
  )
