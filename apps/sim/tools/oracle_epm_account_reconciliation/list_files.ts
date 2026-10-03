import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmAccountReconciliationListFilesParams,
  OracleEpmAccountReconciliationResponse,
} from '@/tools/oracle_epm_account_reconciliation/types'
import { ARCS_FILES_OUTPUTS } from '@/tools/oracle_epm_account_reconciliation/types'
import { arcsAuthParamFields } from '@/tools/oracle_epm_account_reconciliation/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmAccountReconciliationListFilesTool: InternalToolConfig<
  OracleEpmAccountReconciliationListFilesParams,
  OracleEpmAccountReconciliationResponse
> = {
  id: 'oracle_epm_account_reconciliation_list_files',
  name: 'Oracle EPM Account Reconciliation List Files',
  description: 'List repository files and application snapshots.',
  version: '1.0.0',
  params: {
    ...arcsAuthParamFields,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ARCS_FILES_OUTPUTS,
}
