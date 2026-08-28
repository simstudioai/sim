import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { CbInsightsExitProbabilityHistoryParams } from '@/tools/cbinsights/get_exit_probability_history'
import {
  asArray,
  asString,
  cbInsightsRequest,
  compactBody,
  requireOrgId,
} from '@/tools/cbinsights/utils'

export const executeCbinsightsGetExitProbabilityHistoryOperation: InternalToolOperationImplementation<
  CbInsightsExitProbabilityHistoryParams
> = async (params, signal) => {
  const orgId = requireOrgId(params.orgId)
  return cbInsightsRequest<{ ipo?: unknown; mna?: unknown; incompleteRoundType?: unknown }>(
    params,
    {
      path: `/v2/organizations/${orgId}/exitprobabilityhistory`,
      body: compactBody({
        startDate: params.startDate?.trim(),
        endDate: params.endDate?.trim(),
      }),
    },
    (data) => ({
      ipo: asArray(data.ipo),
      mna: asArray(data.mna),
      incompleteRoundType: asString(data.incompleteRoundType),
    }),
    signal
  )
}
