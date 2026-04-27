import { db } from '@sim/db'
import { credential } from '@sim/db/schema'
import { toError } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { getCredentialActorContext } from '@/lib/credentials/access'

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

          const actor = await getCredentialActorContext(credentialId, context.userId)
          if (!actor.credential || !actor.hasWorkspaceAccess) {
            return { success: false, error: 'Credential not found' }
          }
          if (actor.credential.type !== 'oauth') {
            return {
              success: false,
              error: 'Only OAuth credentials can be managed with this tool.',
            }
          }
          if (!actor.canWriteWorkspace && !actor.isAdmin) {
            return { success: false, error: 'Write access required to rename this credential' }
          }

          await db
            .update(credential)
            .set({ displayName, updatedAt: new Date() })
            .where(eq(credential.id, credentialId))
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
            const actor = await getCredentialActorContext(id, context.userId)
            if (
              !actor.credential ||
              !actor.hasWorkspaceAccess ||
              actor.credential.type !== 'oauth'
            ) {
              failed.push(id)
              continue
            }
            if (!actor.canWriteWorkspace && !actor.isAdmin) {
              failed.push(id)
              continue
            }
            await db.delete(credential).where(eq(credential.id, id))
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
