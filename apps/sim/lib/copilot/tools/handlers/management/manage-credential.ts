import { messageForCopilotApplicationError } from '@/lib/copilot/application/error'
import { executeCopilotCredentialUseCase } from '@/lib/copilot/application/execute-credential-use-case'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { updateWorkspaceCredentialUseCase } from '@/lib/credentials/application/credential-crud'
import { deleteManyCredentialsUseCase } from '@/lib/credentials/application/delete-many-credentials'

export async function executeManageCredential(
  rawParams: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const operation = typeof rawParams.operation === 'string' ? rawParams.operation : ''
  const credentialId =
    typeof rawParams.credentialId === 'string' ? rawParams.credentialId : undefined
  const displayName = typeof rawParams.displayName === 'string' ? rawParams.displayName : undefined
  const rawCredentialIds = rawParams.credentialIds
  if (
    rawCredentialIds !== undefined &&
    (!Array.isArray(rawCredentialIds) || rawCredentialIds.some((id) => typeof id !== 'string'))
  ) {
    return { success: false, error: 'credentialIds must be an array of strings' }
  }
  const credentialIds = rawCredentialIds as string[] | undefined
  const workspaceId = context.workspaceId
  if (!workspaceId) return { success: false, error: 'workspaceId is required' }

  try {
    switch (operation) {
      case 'rename': {
        if (!credentialId) {
          return { success: false, error: 'credentialId is required for rename' }
        }
        if (!displayName) {
          return { success: false, error: 'displayName is required for rename' }
        }
        const result = await executeCopilotCredentialUseCase(
          context,
          updateWorkspaceCredentialUseCase,
          {
            credentialId,
            displayName,
          }
        )
        return {
          success: true,
          output: {
            credentialId: result.credential.id,
            previousDisplayName: result.previousDisplayName,
            displayName: result.credential.displayName,
          },
        }
      }
      case 'delete': {
        const ids = credentialIds ?? (credentialId ? [credentialId] : [])
        if (ids.length === 0) {
          return {
            success: false,
            error: 'credentialId or credentialIds is required for delete',
          }
        }
        const result = await executeCopilotCredentialUseCase(
          context,
          deleteManyCredentialsUseCase,
          { workspaceId, credentialIds: ids }
        )
        return {
          success: result.deleted.length > 0,
          output: { deleted: result.deleted, failed: result.failed },
        }
      }
      default:
        return {
          success: false,
          error: `Unknown operation: ${operation}. Use "rename" or "delete".`,
        }
    }
  } catch (error) {
    return {
      success: false,
      error: messageForCopilotApplicationError(error, 'Failed to manage credential'),
    }
  }
}
