import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningExportApplicationDataParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/export_data.html */
export const oracleEpmPlanningExportApplicationDataTool: InternalToolConfig<
  OracleEpmPlanningExportApplicationDataParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_export_application_data',
  name: 'Oracle EPM Planning Export Application Data',
  description:
    'Submit an application data export to an Oracle repository ZIP. Use a configured job or provide cube and rowMembers, columnMembers, povMembers. Larger exports remain in Oracle.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    application: { ...oracleEpmPlanningParamFields.application, required: true },
    jobName: { ...oracleEpmPlanningParamFields.jobName, required: false },
    cube: { ...oracleEpmPlanningParamFields.cube, required: false },
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
