import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningResponse,
  OracleEpmPlanningGetInsightsParams,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_insigh.html */
export const oracleEpmPlanningGetInsightsTool: InternalToolConfig<
  OracleEpmPlanningGetInsightsParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_get_insights',
  name: 'Oracle EPM Planning Get Insights',
  description: 'Retrieve IPM insights using the insight-specific slice. Defaults to existing insights. Recomputing requires a calendar and Administrator or IPM Manage role. Results may be incomplete; Oracle documents no pagination input.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    application: { ...oracleEpmPlanningParamFields.application, required: true },
    cube: { ...oracleEpmPlanningParamFields.cube, required: true },
    insightSlice: { ...oracleEpmPlanningParamFields.insightSlice, required: true },
    retrievalMode: { ...oracleEpmPlanningParamFields.retrievalMode, required: false },
    calendar: { ...oracleEpmPlanningParamFields.calendar, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    insights: {
      type: 'array',
      description: 'IPM insights in this response; inspect hasMore before treating the results as complete',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Oracle numeric insight ID normalized to a string for summaries',
          },
          type: {
            type: 'string',
            description: 'Insight category',
          },
          accountName: {
            type: 'string',
            description: 'accountName',
            optional: true,
          },
          sourceAccountName: {
            type: 'string',
            description: 'sourceAccountName',
            optional: true,
          },
          planType: {
            type: 'string',
            description: 'planType',
            optional: true,
          },
          actualImpact: {
            type: 'string',
            description: 'actualImpact',
            optional: true,
          },
          percentImpact: {
            type: 'string',
            description: 'percentImpact',
            optional: true,
          },
          createdDate: {
            type: 'string',
            description: 'createdDate',
            optional: true,
          },
          description: {
            type: 'string',
            description: 'description',
            optional: true,
          },
          standardVariance: {
            type: 'string',
            description: 'standardVariance',
            optional: true,
          },
          priority: {
            type: 'string',
            description: 'priority',
            optional: true,
          },
          pov: {
            type: 'string',
            description: 'pov',
            optional: true,
          },
          percentageDiff: {
            type: 'string',
            description: 'percentageDiff',
            optional: true,
          },
          anomalyPeriod: {
            type: 'string',
            description: 'anomalyPeriod',
            optional: true,
          },
          percentageDiffFromAnomaly: {
            type: 'string',
            description: 'percentageDiffFromAnomaly',
            optional: true,
          },
          outlierValue: {
            type: 'number',
            description: 'Raw anomaly outlier',
            optional: true,
          },
          actualImpactValue: {
            type: 'number',
            description: 'Raw impact value',
            optional: true,
          },
        },
      },
    },
    totalResults: {
      type: 'number',
      description: 'Total insight count reported by Oracle',
    },
    hasMore: {
      type: 'boolean',
      description: 'Oracle reports incomplete results when true; no pagination request is documented',
    },
  },
}
