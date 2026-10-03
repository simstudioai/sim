import { toStringOrNull } from '@sim/utils/coerce'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { CbInsightsListBusinessRelationshipsParams } from '@/tools/cbinsights/list_business_relationships'
import {
  asArray,
  cbInsightsRequest,
  compactBody,
  parseOptionalStringParam,
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
        nextPageToken: parseOptionalStringParam(params.nextPageToken, 'nextPageToken'),
      }),
    },
    (data) => ({ orgs: asArray(data.orgs), nextPageToken: toStringOrNull(data.nextPageToken) }),
    signal
  )
