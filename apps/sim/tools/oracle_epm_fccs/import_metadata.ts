import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsImportMetadataParams, FccsResponse } from '@/tools/oracle_epm_fccs/types'
import { FCCS_JOB_OUTPUTS } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/import_metadata.html */
export const oracleEpmFccsImportMetadataTool: InternalToolConfig<
  FccsImportMetadataParams,
  FccsResponse
> = {
  id: 'oracle_epm_fccs_import_metadata',
  name: 'Oracle EPM FCCS Import Metadata',
  description:
    'Submit a saved metadata import job with optional file, refresh, and error-report overrides.',
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
