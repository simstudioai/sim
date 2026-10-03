import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningResponse,
  OracleEpmPlanningSetAdministrationModeParams,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/pbcs_admin_job.html */
export const oracleEpmPlanningSetAdministrationModeTool: InternalToolConfig<
  OracleEpmPlanningSetAdministrationModeParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_set_administration_mode',
  name: 'Oracle EPM Planning Set Administration Mode',
  description:
    'Change application login access. Administrators mode logs off Interactive Users and Planners when the job completes. Requires Service Administrator.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    application: { ...oracleEpmPlanningParamFields.application, required: true },
    loginLevel: { ...oracleEpmPlanningParamFields.loginLevel, required: true },
    jobName: { ...oracleEpmPlanningParamFields.jobName, required: false },
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
