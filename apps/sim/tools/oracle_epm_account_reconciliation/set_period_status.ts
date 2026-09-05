import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmAccountReconciliationResponse,
  OracleEpmAccountReconciliationSetPeriodStatusParams,
} from '@/tools/oracle_epm_account_reconciliation/types'
import { ARCS_PERIOD_JOB_OUTPUTS } from '@/tools/oracle_epm_account_reconciliation/types'
import { arcsAuthParamFields } from '@/tools/oracle_epm_account_reconciliation/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmAccountReconciliationSetPeriodStatusTool: InternalToolConfig<
  OracleEpmAccountReconciliationSetPeriodStatusParams,
  OracleEpmAccountReconciliationResponse
> = {
  id: 'oracle_epm_account_reconciliation_set_period_status',
  name: 'Oracle EPM Account Reconciliation Set Period Status',
  description: 'Change a period status and optionally wait for its reconciliation-opening job.',
  version: '1.0.0',
  params: {
    ...arcsAuthParamFields,
    period: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Reconciliation period name, not its internal ID',
    },
    status: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New period status',
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
  outputs: ARCS_PERIOD_JOB_OUTPUTS,
}
