import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsExportMetadataParams, FccsResponse } from '@/tools/oracle_epm_fccs/types'
import { FCCS_JOB_OUTPUTS } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/export_metadata.html */
export const oracleEpmFccsExportMetadataTool: InternalToolConfig<
  FccsExportMetadataParams,
  FccsResponse
> = {
  id: 'oracle_epm_fccs_export_metadata',
  name: 'Oracle EPM FCCS Export Metadata',
  description:
    'Submit a saved metadata export job; use job status and repository file tools to retrieve the ZIP.',
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
