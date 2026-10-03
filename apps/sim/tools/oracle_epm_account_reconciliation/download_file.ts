import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmAccountReconciliationDownloadFileParams,
  OracleEpmAccountReconciliationResponse,
} from '@/tools/oracle_epm_account_reconciliation/types'
import { ARCS_DOWNLOAD_OUTPUTS } from '@/tools/oracle_epm_account_reconciliation/types'
import { arcsAuthParamFields } from '@/tools/oracle_epm_account_reconciliation/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmAccountReconciliationDownloadFileTool: InternalToolConfig<
  OracleEpmAccountReconciliationDownloadFileParams,
  OracleEpmAccountReconciliationResponse
> = {
  id: 'oracle_epm_account_reconciliation_download_file',
  name: 'Oracle EPM Account Reconciliation Download File',
  description: 'Download a repository file as a Sim file (maximum 100 MB).',
  version: '1.0.0',
  params: {
    ...arcsAuthParamFields,
    fileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Exact name of a file already uploaded to the Oracle EPM repository',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ARCS_DOWNLOAD_OUTPUTS,
}
