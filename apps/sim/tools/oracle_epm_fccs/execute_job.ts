import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsExecuteJobParams, FccsResponse } from '@/tools/oracle_epm_fccs/types'
import { FCCS_JOB_OUTPUTS } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/execute_a_job.html */
export const oracleEpmFccsExecuteJobTool: InternalToolConfig<FccsExecuteJobParams, FccsResponse> = {
  id: 'oracle_epm_fccs_execute_job',
  name: 'Oracle EPM FCCS Execute Job',
  description:
    'Submit a configured job within the approved FCCS families. Excludes environment administration and Data Integration.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
    jobType: fccsParamFields.jobType,
    jobName: fccsParamFields.jobName,
    parameters: { ...fccsParamFields.parameters, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: FCCS_JOB_OUTPUTS,
}
