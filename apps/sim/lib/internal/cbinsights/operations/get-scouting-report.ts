import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { CbInsightsOrgParams } from '@/tools/cbinsights/types'
import {
  asRecord,
  asString,
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
      orgInfo: asRecord(data.orgInfo),
      reportMarkdown: asString(data.reportMarkdown),
      reportJson: asString(data.reportJson),
    }),
    signal
  )
}
