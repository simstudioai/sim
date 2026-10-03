import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningListJobDefinitionsParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_job_definitions.html */
export const oracleEpmPlanningListJobDefinitionsTool: InternalToolConfig<
  OracleEpmPlanningListJobDefinitionsParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_list_job_definitions',
  name: 'Oracle EPM Planning List Job Definitions',
  description:
    'List configured jobs, optionally filtered by job type. Discovery requires Service Administrator; manual job names remain usable.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    application: { ...oracleEpmPlanningParamFields.application, required: true },
    jobType: { ...oracleEpmPlanningParamFields.jobType, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    jobDefinitions: {
      type: 'array',
      description: 'Configured jobs',
      items: {
        type: 'object',
        properties: {
          jobName: {
            type: 'string',
            description: 'Job name',
          },
          jobType: {
            type: 'string',
            description: 'Oracle job type',
          },
        },
      },
    },
  },
}
