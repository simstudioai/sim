import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { CbInsightsListManagementAndBoardParams } from '@/tools/cbinsights/list_management_and_board'
import {
  asArray,
  cbInsightsRequest,
  compactBody,
  parseIdListParam,
  requireOrgIds,
} from '@/tools/cbinsights/utils'

export const executeCbinsightsListManagementAndBoardOperation: InternalToolOperationImplementation<
  CbInsightsListManagementAndBoardParams
> = async (params, signal) =>
  cbInsightsRequest<{ orgs?: unknown }>(
    params,
    {
      path: '/v2/managementandboard',
      body: compactBody({
        orgIds: requireOrgIds(params.orgIds),
        titleIds: parseIdListParam(params.titleIds, 'titleIds'),
      }),
    },
    (data) => ({ orgs: asArray(data.orgs) }),
    signal
  )
