import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningResponse,
  OracleEpmPlanningSummarizeInsightsParams,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/insigh_summ.html */
export const oracleEpmPlanningSummarizeInsightsTool: InternalToolConfig<
  OracleEpmPlanningSummarizeInsightsParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_summarize_insights',
  name: 'Oracle EPM Planning Summarize Insights',
  description: 'Return an IPM text summary by insight IDs or by slice. Slice mode requires a cube and insight slice. Defaults to existing insights; recomputing requires a calendar and Administrator or IPM Manage role.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    application: { ...oracleEpmPlanningParamFields.application, required: true },
    summaryInputMode: { ...oracleEpmPlanningParamFields.summaryInputMode, required: true },
    insightIds: { ...oracleEpmPlanningParamFields.insightIds, required: false },
    cube: { ...oracleEpmPlanningParamFields.cube, required: false },
    insightSlice: { ...oracleEpmPlanningParamFields.insightSlice, required: false },
    retrievalMode: { ...oracleEpmPlanningParamFields.retrievalMode, required: false },
    calendar: { ...oracleEpmPlanningParamFields.calendar, required: false },
    summarySize: { ...oracleEpmPlanningParamFields.summarySize, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    summary: {
      type: 'string',
      description: 'Oracle IPM summary in text format',
    },
  },
}
