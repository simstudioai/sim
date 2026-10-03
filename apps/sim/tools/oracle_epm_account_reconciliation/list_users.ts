import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmAccountReconciliationListUsersParams,
  OracleEpmAccountReconciliationResponse,
} from '@/tools/oracle_epm_account_reconciliation/types'
import { ARCS_USERS_OUTPUTS } from '@/tools/oracle_epm_account_reconciliation/types'
import { arcsAuthParamFields } from '@/tools/oracle_epm_account_reconciliation/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmAccountReconciliationListUsersTool: InternalToolConfig<
  OracleEpmAccountReconciliationListUsersParams,
  OracleEpmAccountReconciliationResponse
> = {
  id: 'oracle_epm_account_reconciliation_list_users',
  name: 'Oracle EPM Account Reconciliation List Users',
  description: 'List environment users and optionally their groups and roles.',
  version: '1.0.0',
  params: {
    ...arcsAuthParamFields,
    userlogin: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by user login',
    },
    userattribute: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Case-insensitive search across user login, first name, last name, or email',
    },
    epmgroups: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include EPM groups',
    },
    idcsgroups: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include IDCS groups',
    },
    applicationroles: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include application roles',
    },
    granularroles: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include granular roles',
    },
    indirect: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include both direct and indirect memberships',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ARCS_USERS_OUTPUTS,
}
