import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmAccountReconciliationResponse,
  OracleEpmAccountReconciliationRunAutoMatchParams,
} from '@/tools/oracle_epm_account_reconciliation/types'
import { ARCS_JOB_OUTPUTS } from '@/tools/oracle_epm_account_reconciliation/types'
import { arcsAuthParamFields } from '@/tools/oracle_epm_account_reconciliation/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmAccountReconciliationRunAutoMatchTool: InternalToolConfig<
  OracleEpmAccountReconciliationRunAutoMatchParams,
  OracleEpmAccountReconciliationResponse
> = {
  id: 'oracle_epm_account_reconciliation_run_auto_match',
  name: 'Oracle EPM Account Reconciliation Run Auto Match',
  description: 'Run automatic matching for a Transaction Matching match type.',
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
