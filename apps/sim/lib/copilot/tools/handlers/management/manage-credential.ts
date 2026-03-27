import { db } from '@sim/db'
import { credential } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'

export function executeManageCredential(
  rawParams: Record<string, unknown>,
  _context: ExecutionContext
): Promise<ToolCallResult> {
  const params = rawParams as { operation: string; credentialId: string; displayName?: string }
  const { operation, credentialId, displayName } = params
  if (!credentialId) return Promise.resolve({ success: false, error: 'credentialId is required' })
  return (async () => {
    try {
      const [row] = await db
        .select({ id: credential.id, type: credential.type, displayName: credential.displayName })
        .from(credential)
        .where(eq(credential.id, credentialId))
        .limit(1)
      if (!row) return { success: false, error: 'Credential not found' }
      if (row.type !== 'oauth')
        return { success: false, error: 'Only OAuth credentials can be managed with this tool.' }
      switch (operation) {
        case 'rename':
          if (!displayName) return { success: false, error: 'displayName is required for rename' }
          await db
            .update(credential)
            .set({ displayName, updatedAt: new Date() })
            .where(eq(credential.id, credentialId))
          return { success: true, output: { credentialId, displayName } }
        case 'delete':
          await db.delete(credential).where(eq(credential.id, credentialId))
          return { success: true, output: { credentialId, deleted: true } }
        default:
          return {
            success: false,
            error: `Unknown operation: ${operation}. Use "rename" or "delete".`,
          }
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })()
}
