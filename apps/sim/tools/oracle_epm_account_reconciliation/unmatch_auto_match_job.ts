import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmAccountReconciliationResponse,
  OracleEpmAccountReconciliationUnmatchAutoMatchJobParams,
} from '@/tools/oracle_epm_account_reconciliation/types'
import { ARCS_MATCHING_OUTPUTS } from '@/tools/oracle_epm_account_reconciliation/types'
import { arcsAuthParamFields } from '@/tools/oracle_epm_account_reconciliation/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmAccountReconciliationUnmatchAutoMatchJobTool: InternalToolConfig<
  OracleEpmAccountReconciliationUnmatchAutoMatchJobParams,
  OracleEpmAccountReconciliationResponse
> = {
  id: 'oracle_epm_account_reconciliation_unmatch_auto_match_job',
  name: 'Oracle EPM Account Reconciliation Unmatch Auto Match Job',
  description: 'Unmatch all transactions matched by a specified auto-match job.',
  version: '1.0.0',
  params: {
    ...arcsAuthParamFields,
    autoMatchJobId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the auto-match or import-and-auto-match job',
    },
    createReverseAdjustment: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Create reverse adjustments for unmatched transactions',
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
  outputs: ARCS_MATCHING_OUTPUTS,
}
