import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsImportJournalsParams, FccsResponse } from '@/tools/oracle_epm_fccs/types'
import { FCCS_JOB_OUTPUTS } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fccs_import_consolidation_journals.html */
export const oracleEpmFccsImportJournalsTool: InternalToolConfig<
  FccsImportJournalsParams,
  FccsResponse
> = {
  id: 'oracle_epm_fccs_import_journals',
  name: 'Oracle EPM FCCS Import Journals',
  description:
    'Submit a saved consolidation-journal import job with optional input and error filenames.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
    jobName: fccsParamFields.jobName,
    fileName: { ...fccsParamFields.fileName, required: false },
    errorFileName: { ...fccsParamFields.errorFileName, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: FCCS_JOB_OUTPUTS,
}
