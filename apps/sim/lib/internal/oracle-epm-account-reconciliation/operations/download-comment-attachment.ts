import {
  arcsInputSchemas,
  executeArcsOperation,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import { downloadArcsAttachment } from '@/lib/internal/oracle-epm-account-reconciliation/files'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationDownloadCommentAttachmentParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/arcs_rest_view_reconciliation_comments.html */
export const executeOracleEpmAccountReconciliationDownloadCommentAttachmentOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationDownloadCommentAttachmentParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.download_comment_attachment,
    input,
    signal,
    context,
    (params, client, signal, context) => downloadArcsAttachment(client, params, context, signal)
  )
