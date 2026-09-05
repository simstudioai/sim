import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsExportJournalsParams, FccsResponse } from '@/tools/oracle_epm_fccs/types'
import { FCCS_JOB_OUTPUTS } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fccs_export_consolidation_journals.html */
export const oracleEpmFccsExportJournalsTool: InternalToolConfig<
  FccsExportJournalsParams,
  FccsResponse
> = {
  id: 'oracle_epm_fccs_export_journals',
  name: 'Oracle EPM FCCS Export Journals',
  description:
    'Submit an Export Journal job for an existing export definition identified by its filename.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
    fileName: fccsParamFields.fileName,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: FCCS_JOB_OUTPUTS,
}
