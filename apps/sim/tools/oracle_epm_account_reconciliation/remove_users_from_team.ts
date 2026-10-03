import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmAccountReconciliationRemoveUsersFromTeamParams,
  OracleEpmAccountReconciliationResponse,
} from '@/tools/oracle_epm_account_reconciliation/types'
import { ARCS_JOB_OUTPUTS } from '@/tools/oracle_epm_account_reconciliation/types'
import { arcsAuthParamFields } from '@/tools/oracle_epm_account_reconciliation/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmAccountReconciliationRemoveUsersFromTeamTool: InternalToolConfig<
  OracleEpmAccountReconciliationRemoveUsersFromTeamParams,
  OracleEpmAccountReconciliationResponse
> = {
  id: 'oracle_epm_account_reconciliation_remove_users_from_team',
  name: 'Oracle EPM Account Reconciliation Remove Users from Team',
  description: 'Remove Users from Team using a staged CSV file and an existing team.',
  version: '1.0.0',
  params: {
    ...arcsAuthParamFields,
    fileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Exact name of a file already uploaded to the Oracle EPM repository',
    },
    teamName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of an existing Account Reconciliation team',
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
