import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsResponse, FccsWaitForJobParams } from '@/tools/oracle_epm_fccs/types'
import { FCCS_JOB_OUTPUTS } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/retrieve_job_status.html */
export const oracleEpmFccsWaitForJobTool: InternalToolConfig<FccsWaitForJobParams, FccsResponse> = {
  id: 'oracle_epm_fccs_wait_for_job',
  name: 'Oracle EPM FCCS Wait For Job',
  description:
    'Wait for an execution job through bounded, cancellable polling. Terminal failures retain job diagnostics.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
    jobId: fccsParamFields.jobId,
    maxWaitSeconds: { ...fccsParamFields.maxWaitSeconds, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...FCCS_JOB_OUTPUTS,
    attempts: { type: 'number', description: 'Number of status reads' },
  },
}
