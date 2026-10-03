import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmAccountReconciliationImportReconciliationAttributesParams,
  OracleEpmAccountReconciliationResponse,
} from '@/tools/oracle_epm_account_reconciliation/types'
import { ARCS_JOB_OUTPUTS } from '@/tools/oracle_epm_account_reconciliation/types'
import { arcsAuthParamFields } from '@/tools/oracle_epm_account_reconciliation/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmAccountReconciliationImportReconciliationAttributesTool: InternalToolConfig<
  OracleEpmAccountReconciliationImportReconciliationAttributesParams,
  OracleEpmAccountReconciliationResponse
> = {
  id: 'oracle_epm_account_reconciliation_import_recon_attributes',
  name: 'Oracle EPM Account Reconciliation Import Reconciliation Attributes',
  description: 'Load attribute values from a staged file into existing reconciliations.',
  version: '1.0.0',
  params: {
    ...arcsAuthParamFields,
    fileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Exact name of a file already uploaded to the Oracle EPM repository',
    },
    period: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Reconciliation period name, not its internal ID',
    },
    rules: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated ALL, SET_ATTR_VAL, CRT_ALT, AUTO_APP, or AUTO_SUB; omit to run no rules',
    },
    reopen: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reopen changed reconciliations after import',
    },
    waitForCompletion: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Wait for the accepted job to finish (default false)',
    },
    maxWaitSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum wait in seconds (5–300; default 60)',
      default: 60,
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ARCS_JOB_OUTPUTS,
}
