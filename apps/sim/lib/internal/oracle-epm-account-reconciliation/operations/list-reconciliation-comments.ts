import {
  arcsCommentsSchema,
  arcsInputSchemas,
  executeArcsOperation,
  parseArcsResponse,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import { arcsRoutes } from '@/lib/internal/oracle-epm-account-reconciliation/routes'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationListReconciliationCommentsParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/arcs_rest_view_reconciliation_comments.html */
export const executeOracleEpmAccountReconciliationListReconciliationCommentsOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationListReconciliationCommentsParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.list_reconciliation_comments,
    input,
    signal,
    context,
    async (params, client, signal) => {
      const comments = parseArcsResponse(
        arcsCommentsSchema,
        await client.request(arcsRoutes.comments, {
          pathParams: { period: params.period, accountId: params.accountId },
          signal,
        })
      )
      return {
        success: true,
        output: {
          comments: comments.map((comment) => ({
            commentId: comment.commentId,
            parentObjectId: comment.parentObjectId,
            commentText: comment.commentText,
            postedBy: comment.postedBy,
            postedDate: comment.postedDate,
            references: comment.references.map((reference) => ({
              referenceId: reference.referenceId,
              type: reference.type,
              name: reference.name,
              url: reference.url,
            })),
          })),
        },
      }
    }
  )
