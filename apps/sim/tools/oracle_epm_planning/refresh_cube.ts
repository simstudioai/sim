import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningRefreshCubeParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/cube_refresh.html */
export const oracleEpmPlanningRefreshCubeTool: InternalToolConfig<
  OracleEpmPlanningRefreshCubeParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_refresh_cube',
  name: 'Oracle EPM Planning Refresh Cube',
  description:
    'Run an existing Cube Refresh job. Optional parameters can log off users or terminate active requests; no administration changes are added implicitly.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    application: { ...oracleEpmPlanningParamFields.application, required: true },
    jobName: { ...oracleEpmPlanningParamFields.jobName, required: true },
    parameters: { ...oracleEpmPlanningParamFields.parameters, required: false },
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
            '-1 processing; 0 success; 1 error; 2 cancel pending; 3 cancelled; 4 invalid parameter; other values are not success',
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
