import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { CbInsightsOrgManagementParams } from '@/tools/cbinsights/get_org_management_and_board'
import {
  asArray,
  asNumber,
  cbInsightsRequest,
  compactBody,
  parseIdListParam,
  requireOrgId,
} from '@/tools/cbinsights/utils'

export const executeCbinsightsGetOrgManagementAndBoardOperation: InternalToolOperationImplementation<
  CbInsightsOrgManagementParams
> = async (params, signal) => {
  const orgId = requireOrgId(params.orgId)
  return cbInsightsRequest<{ people?: unknown; mosaicManagement?: unknown }>(
    params,
    {
      path: `/v2/organizations/${orgId}/managementandboard`,
      body: compactBody({ titleIds: parseIdListParam(params.titleIds, 'titleIds') }),
    },
    (data) => ({
      people: asArray(data.people),
      mosaicManagement: asNumber(data.mosaicManagement),
    }),
    signal
  )
}
