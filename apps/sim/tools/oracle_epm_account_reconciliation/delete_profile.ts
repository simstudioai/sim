import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmAccountReconciliationDeleteProfileParams,
  OracleEpmAccountReconciliationResponse,
} from '@/tools/oracle_epm_account_reconciliation/types'
import { ARCS_JOB_OUTPUTS } from '@/tools/oracle_epm_account_reconciliation/types'
import { arcsAuthParamFields } from '@/tools/oracle_epm_account_reconciliation/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmAccountReconciliationDeleteProfileTool: InternalToolConfig<
  OracleEpmAccountReconciliationDeleteProfileParams,
  OracleEpmAccountReconciliationResponse
> = {
  id: 'oracle_epm_account_reconciliation_delete_profile',
  name: 'Oracle EPM Account Reconciliation Delete Profile',
  description: 'Delete the profile identified by its account ID.',
  version: '1.0.0',
  params: {
    ...arcsAuthParamFields,
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Account ID of the profile to delete',
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
