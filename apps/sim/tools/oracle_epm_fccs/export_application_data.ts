import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsExportApplicationDataParams, FccsResponse } from '@/tools/oracle_epm_fccs/types'
import { FCCS_JOB_OUTPUTS } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/export_data.html */
export const oracleEpmFccsExportApplicationDataTool: InternalToolConfig<
  FccsExportApplicationDataParams,
  FccsResponse
> = {
  id: 'oracle_epm_fccs_export_application_data',
  name: 'Oracle EPM FCCS Export Application Data',
  description: 'Submit a saved application-data export job with optional documented overrides.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
    jobName: fccsParamFields.jobName,
    parameters: { ...fccsParamFields.parameters, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: FCCS_JOB_OUTPUTS,
}
