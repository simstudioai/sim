import { toError } from '@sim/utils/errors'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { performDeleteCredential, performUpdateCredential } from '@/lib/credentials/orchestration'

export function executeManageCredential(
  rawParams: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const params = rawParams as {
    operation: string
    credentialId?: string
    credentialIds?: string[]
    displayName?: string
  }
  const { operation, displayName } = params
  return (async () => {
    try {
      if (!context?.userId) {
        return { success: false, error: 'Authentication required' }
      }

      switch (operation) {
        case 'rename': {
          const credentialId = params.credentialId
          if (!credentialId) return { success: false, error: 'credentialId is required for rename' }
          if (!displayName) return { success: false, error: 'displayName is required for rename' }

          const result = await performUpdateCredential({
            credentialId,
            userId: context.userId,
            displayName,
            allowedTypes: ['oauth'],
          })
          if (!result.success) {
            return { success: false, error: result.error || 'Failed to rename credential' }
          }
          return { success: true, output: { credentialId, displayName } }
        }
        case 'delete': {
          const ids: string[] =
            params.credentialIds ?? (params.credentialId ? [params.credentialId] : [])
          if (ids.length === 0)
            return { success: false, error: 'credentialId or credentialIds is required for delete' }

          const deleted: string[] = []
          const failed: string[] = []

          for (const id of ids) {
            const result = await performDeleteCredential({
              credentialId: id,
              userId: context.userId,
              allowedTypes: ['oauth'],
              reason: 'copilot_delete',
            })
            if (!result.success) {
              failed.push(id)
              continue
            }
            deleted.push(id)
          }

          return {
            success: deleted.length > 0,
            output: { deleted, failed },
          }
        }
        default:
          return {
            success: false,
            error: `Unknown operation: ${operation}. Use "rename" or "delete".`,
          }
      }
    } catch (error) {
      return { success: false, error: toError(error).message }
    }
  })()
}
