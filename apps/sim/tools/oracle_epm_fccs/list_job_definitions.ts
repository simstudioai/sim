import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsListJobDefinitionsParams, FccsResponse } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_job_definitions.html */
export const oracleEpmFccsListJobDefinitionsTool: InternalToolConfig<
  FccsListJobDefinitionsParams,
  FccsResponse
> = {
  id: 'oracle_epm_fccs_list_job_definitions',
  name: 'Oracle EPM FCCS List Job Definitions',
  description:
    'List configured job definitions within supported FCCS job families; does not list execution instances.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
    jobType: { ...fccsParamFields.jobType, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    items: {
      type: 'array',
      description: 'Supported configured FCCS job definitions',
      items: {
        type: 'object',
        properties: {
          jobType: {
            type: 'string',
            description: 'Job type',
          },
          jobName: {
            type: 'string',
            description: 'Exact job name',
          },
        },
      },
    },
  },
}
