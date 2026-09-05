import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsResponse, FccsValidateMetadataParams } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fccs_validate_metadata.html */
export const oracleEpmFccsValidateMetadataTool: InternalToolConfig<
  FccsValidateMetadataParams,
  FccsResponse
> = {
  id: 'oracle_epm_fccs_validate_metadata',
  name: 'Oracle EPM FCCS Validate Metadata',
  description:
    'Validate FCCS metadata and return warning/error counts and the CSV report filename.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
    logFileName: { ...fccsParamFields.logFileName, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    numWarnings: {
      type: 'number',
      description: 'numWarnings',
    },
    numInfo: {
      type: 'number',
      description: 'numInfo',
    },
    numErrors: {
      type: 'number',
      description: 'numErrors',
    },
    outPutFileName: {
      type: 'string',
      description: 'CSV validation report name',
    },
    status: {
      type: 'string',
      description: 'Validation process status text; not an execution job ID',
    },
  },
}
