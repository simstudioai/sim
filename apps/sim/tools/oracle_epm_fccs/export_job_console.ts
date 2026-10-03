import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsExportJobConsoleParams, FccsResponse } from '@/tools/oracle_epm_fccs/types'
import { FCCS_JOB_OUTPUTS } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/pbcs_export_job_console_job.html */
export const oracleEpmFccsExportJobConsoleTool: InternalToolConfig<
  FccsExportJobConsoleParams,
  FccsResponse
> = {
  id: 'oracle_epm_fccs_export_job_console',
  name: 'Oracle EPM FCCS Export Job Console',
  description:
    'Submit an export of the FCCS job console. Retrieve the resulting ZIP with repository file tools after completion.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
    jobName: { ...fccsParamFields.jobName, required: false },
    parameters: { ...fccsParamFields.parameters, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: FCCS_JOB_OUTPUTS,
}
