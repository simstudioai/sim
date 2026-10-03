import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsGetJobParams, FccsResponse } from '@/tools/oracle_epm_fccs/types'
import { FCCS_JOB_OUTPUTS } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/retrieve_job_status.html */
export const oracleEpmFccsGetJobTool: InternalToolConfig<FccsGetJobParams, FccsResponse> = {
  id: 'oracle_epm_fccs_get_job',
  name: 'Oracle EPM FCCS Get Job',
  description: 'Read one execution job status, normalizing Oracle jobId/jobID to a string jobId.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
    jobId: fccsParamFields.jobId,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: FCCS_JOB_OUTPUTS,
}
