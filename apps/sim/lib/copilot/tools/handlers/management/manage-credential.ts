import { db } from '@sim/db'
import { credential } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { toError } from '@/lib/core/utils/helpers'

export function executeManageCredential(
  rawParams: Record<string, unknown>,
  _context: ExecutionContext
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
      switch (operation) {
        case 'rename': {
          const credentialId = params.credentialId
          if (!credentialId) return { success: false, error: 'credentialId is required for rename' }
          if (!displayName) return { success: false, error: 'displayName is required for rename' }
          const [row] = await db
            .select({
              id: credential.id,
              type: credential.type,
              displayName: credential.displayName,
            })
            .from(credential)
            .where(eq(credential.id, credentialId))
            .limit(1)
          if (!row) return { success: false, error: 'Credential not found' }
          if (row.type !== 'oauth')
            return {
              success: false,
              error: 'Only OAuth credentials can be managed with this tool.',
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
            const [row] = await db
              .select({ id: credential.id, type: credential.type })
              .from(credential)
              .where(eq(credential.id, id))
              .limit(1)
            if (!row || row.type !== 'oauth') {
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
