import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmAccountReconciliationListReconciliationCommentsParams,
  OracleEpmAccountReconciliationResponse,
} from '@/tools/oracle_epm_account_reconciliation/types'
import { ARCS_COMMENTS_OUTPUTS } from '@/tools/oracle_epm_account_reconciliation/types'
import { arcsAuthParamFields } from '@/tools/oracle_epm_account_reconciliation/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmAccountReconciliationListReconciliationCommentsTool: InternalToolConfig<
  OracleEpmAccountReconciliationListReconciliationCommentsParams,
  OracleEpmAccountReconciliationResponse
> = {
  id: 'oracle_epm_account_reconciliation_list_reconciliation_comments',
  name: 'Oracle EPM Account Reconciliation List Reconciliation Comments',
  description: 'Read comments and attachment references for a reconciliation.',
  version: '1.0.0',
  params: {
    ...arcsAuthParamFields,
    period: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Reconciliation period name, not its internal ID',
    },
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Account ID of the reconciliation',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ARCS_COMMENTS_OUTPUTS,
}
