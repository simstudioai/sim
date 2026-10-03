import { toStringOrNull } from '@sim/utils/coerce'
import { toRecordOrNull } from '@sim/utils/object'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { CbInsightsOrgParams } from '@/tools/cbinsights/types'
import {
  cbInsightsRequest,
  requireOrgId,
  SCOUTING_REPORT_TIMEOUT_MS,
} from '@/tools/cbinsights/utils'

export const executeCbinsightsGetScoutingReportOperation: InternalToolOperationImplementation<
  CbInsightsOrgParams
> = async (params, signal) => {
  const orgId = requireOrgId(params.orgId)
  return cbInsightsRequest<{
    orgInfo?: unknown
    reportMarkdown?: unknown
    reportJson?: unknown
  }>(
    params,
    {
      path: `/v2/organizations/${orgId}/scoutingreport`,
      timeoutMs: SCOUTING_REPORT_TIMEOUT_MS,
    },
    (data) => ({
      orgInfo: toRecordOrNull(data.orgInfo),
      reportMarkdown: toStringOrNull(data.reportMarkdown),
      reportJson: toStringOrNull(data.reportJson),
    }),
    signal
  )
}
