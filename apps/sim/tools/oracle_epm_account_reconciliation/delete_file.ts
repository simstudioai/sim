import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmAccountReconciliationDeleteFileParams,
  OracleEpmAccountReconciliationResponse,
} from '@/tools/oracle_epm_account_reconciliation/types'
import { ARCS_DELETE_OUTPUTS } from '@/tools/oracle_epm_account_reconciliation/types'
import { arcsAuthParamFields } from '@/tools/oracle_epm_account_reconciliation/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmAccountReconciliationDeleteFileTool: InternalToolConfig<
  OracleEpmAccountReconciliationDeleteFileParams,
  OracleEpmAccountReconciliationResponse
> = {
  id: 'oracle_epm_account_reconciliation_delete_file',
  name: 'Oracle EPM Account Reconciliation Delete File',
  description: 'Delete the specified file from the EPM repository.',
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
  outputs: ARCS_DELETE_OUTPUTS,
}
