import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsImportApplicationDataParams, FccsResponse } from '@/tools/oracle_epm_fccs/types'
import { FCCS_JOB_OUTPUTS } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/import_data.html */
export const oracleEpmFccsImportApplicationDataTool: InternalToolConfig<
  FccsImportApplicationDataParams,
  FccsResponse
> = {
  id: 'oracle_epm_fccs_import_application_data',
  name: 'Oracle EPM FCCS Import Application Data',
  description:
    'Submit a saved application-data import job using files already in the Oracle repository.',
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
