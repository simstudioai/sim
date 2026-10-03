import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmAccountReconciliationResponse,
  OracleEpmAccountReconciliationRunAutoAlertParams,
} from '@/tools/oracle_epm_account_reconciliation/types'
import { ARCS_JOB_OUTPUTS } from '@/tools/oracle_epm_account_reconciliation/types'
import { arcsAuthParamFields } from '@/tools/oracle_epm_account_reconciliation/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmAccountReconciliationRunAutoAlertTool: InternalToolConfig<
  OracleEpmAccountReconciliationRunAutoAlertParams,
  OracleEpmAccountReconciliationResponse
> = {
  id: 'oracle_epm_account_reconciliation_run_auto_alert',
  name: 'Oracle EPM Account Reconciliation Run Auto Alert',
  description: 'Run automatic alerts for a Transaction Matching match type.',
  version: '1.0.0',
  params: {
    ...arcsAuthParamFields,
    matchTypeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Text ID of the Transaction Matching match type',
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
