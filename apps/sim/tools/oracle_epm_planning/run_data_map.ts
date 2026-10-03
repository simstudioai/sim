import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningResponse,
  OracleEpmPlanningRunDataMapParams,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/plan_type_map.html */
export const oracleEpmPlanningRunDataMapTool: InternalToolConfig<
  OracleEpmPlanningRunDataMapParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_run_data_map',
  name: 'Oracle EPM Planning Run Data Map',
  description:
    'Submit a configured data map once. Service Administrator required. Clearing the target is destructive; clearData must be explicit (Oracle defaults to true). Use Wait for Job separately.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    application: { ...oracleEpmPlanningParamFields.application, required: true },
    jobName: { ...oracleEpmPlanningParamFields.jobName, required: true },
    clearData: { ...oracleEpmPlanningParamFields.clearData, required: true },
    overrideMembersMap: { ...oracleEpmPlanningParamFields.overrideMembersMap, required: false },
    overrideExclusionMembersMap: {
      ...oracleEpmPlanningParamFields.overrideExclusionMembersMap,
      required: false,
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    job: {
      type: 'json',
      description: 'Planning job snapshot',
      properties: {
        jobId: {
          type: 'number',
          description: 'Job ID',
        },
        status: {
          type: 'number',
          description:
            'Planning status: -1 processing, 0 success, 2 cancel pending; other values are failures',
        },
        details: {
          type: 'string',
          description: 'Job details',
          nullable: true,
        },
        jobName: {
          type: 'string',
          description: 'Job name',
        },
        descriptiveStatus: {
          type: 'string',
          description: 'Human-readable status',
          nullable: true,
        },
        detailedStatus: {
          type: 'number',
          description: 'Detailed Oracle status',
          optional: true,
        },
      },
    },
  },
}
