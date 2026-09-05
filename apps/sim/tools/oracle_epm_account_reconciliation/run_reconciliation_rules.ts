import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmAccountReconciliationResponse,
  OracleEpmAccountReconciliationRunReconciliationRulesParams,
} from '@/tools/oracle_epm_account_reconciliation/types'
import { ARCS_JOB_OUTPUTS } from '@/tools/oracle_epm_account_reconciliation/types'
import { arcsAuthParamFields } from '@/tools/oracle_epm_account_reconciliation/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmAccountReconciliationRunReconciliationRulesTool: InternalToolConfig<
  OracleEpmAccountReconciliationRunReconciliationRulesParams,
  OracleEpmAccountReconciliationResponse
> = {
  id: 'oracle_epm_account_reconciliation_run_reconciliation_rules',
  name: 'Oracle EPM Account Reconciliation Run Reconciliation Rules',
  description: 'Run reconciliation rules for a period and optional public filter.',
  version: '1.0.0',
  params: {
    ...arcsAuthParamFields,
    period: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Reconciliation period name, not its internal ID',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name of a public filter; omit to process all applicable objects',
    },
    ruleTypes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Case-insensitive comma-separated rule types; omit to run all applicable rules',
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
