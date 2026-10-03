import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmAccountReconciliationDownloadCommentAttachmentParams,
  OracleEpmAccountReconciliationResponse,
} from '@/tools/oracle_epm_account_reconciliation/types'
import { ARCS_DOWNLOAD_OUTPUTS } from '@/tools/oracle_epm_account_reconciliation/types'
import { arcsAuthParamFields } from '@/tools/oracle_epm_account_reconciliation/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmAccountReconciliationDownloadCommentAttachmentTool: InternalToolConfig<
  OracleEpmAccountReconciliationDownloadCommentAttachmentParams,
  OracleEpmAccountReconciliationResponse
> = {
  id: 'oracle_epm_account_reconciliation_download_comment_attachment',
  name: 'Oracle EPM Account Reconciliation Download Comment Attachment',
  description: 'Download a FILE reference belonging to the specified reconciliation as a Sim file.',
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
    referenceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'FILE reference ID returned by List Reconciliation Comments',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ARCS_DOWNLOAD_OUTPUTS,
}
