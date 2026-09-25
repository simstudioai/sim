import { AuditAction, AuditResourceType } from '@sim/audit'
import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { workspaceBYOKKeys } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq } from 'drizzle-orm'
import { byokKeyOperations } from '@/lib/api-key/application/operations'
import { maskByokApiKey } from '@/lib/api-key/byok-display'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { decryptSecret } from '@/lib/core/security/encryption'
import { captureServerEvent } from '@/lib/posthog/server'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'
import type { BYOKProviderId } from '@/tools/types'

const logger = createLogger('WorkspaceByokKeys')
export class WorkspaceByokWorkspaceNotFoundError extends OrchestrationError {
  constructor() {
    super('not_found', 'Workspace not found')
  }
}
async function resolveByokWorkspace(workspaceId: string) {
  const context = await loadActiveWorkspaceApplicationContext(workspaceId)
  if (!context) throw new WorkspaceByokWorkspaceNotFoundError()
  return context
}
const authorizationOptions = { delegation: { audience: 'sim:settings', isWithinScope: () => true } }
interface WorkspaceInput {
  workspaceId: string
}
interface DeleteInput extends WorkspaceInput {
  providerId: BYOKProviderId
  keyId?: string
}

/** Reads only provider metadata and masked credential display under current workspace access. */
export const listWorkspaceByokKeys = defineAuthorizedWorkspaceUseCase({
  operation: byokKeyOperations.listWorkspace,
  resolveContext: ({ input }: { input: WorkspaceInput }) => resolveByokWorkspace(input.workspaceId),
  authorizationOptions,
  async execute({ context }) {
    const rows = await db
      .select({
        id: workspaceBYOKKeys.id,
        providerId: workspaceBYOKKeys.providerId,
        encryptedApiKey: workspaceBYOKKeys.encryptedApiKey,
        name: workspaceBYOKKeys.name,
        createdBy: workspaceBYOKKeys.createdBy,
        createdAt: workspaceBYOKKeys.createdAt,
        updatedAt: workspaceBYOKKeys.updatedAt,
      })
      .from(workspaceBYOKKeys)
      .where(eq(workspaceBYOKKeys.workspaceId, context.workspaceId))
      .orderBy(
        asc(workspaceBYOKKeys.providerId),
        asc(workspaceBYOKKeys.createdAt),
        asc(workspaceBYOKKeys.id)
      )
    return {
      keys: await Promise.all(
        rows.map(async ({ encryptedApiKey, ...metadata }) => {
          let maskedKey = '••••••••'
          try {
            maskedKey = maskByokApiKey((await decryptSecret(encryptedApiKey)).decrypted)
          } catch (error) {
            logger.error('Failed to decrypt BYOK key for display', {
              error,
              keyId: metadata.id,
              providerId: metadata.providerId,
            })
          }
          return { ...metadata, maskedKey }
        })
      ),
    }
  },
})

/** Revokes only keys matching both canonical workspace and provider; cleanup needs no plan entitlement. */
export const deleteWorkspaceByokKey = defineAuthorizedWorkspaceUseCase({
  operation: byokKeyOperations.deleteWorkspace,
  resolveContext: ({ input }: { input: DeleteInput }) => resolveByokWorkspace(input.workspaceId),
  authorizationOptions,
  async execute({ context, input, principal }) {
    const scope = and(
      eq(workspaceBYOKKeys.workspaceId, context.workspaceId),
      eq(workspaceBYOKKeys.providerId, input.providerId)
    )
    const deleted = await db
      .delete(workspaceBYOKKeys)
      .where(input.keyId ? and(scope, eq(workspaceBYOKKeys.id, input.keyId)) : scope)
      .returning({ id: workspaceBYOKKeys.id })
    if (input.keyId && deleted.length === 0)
      throw new OrchestrationError('not_found', 'BYOK key not found')
    captureServerEvent(
      requirePrincipalSubjectUserId(principal),
      'byok_key_removed',
      { workspace_id: context.workspaceId, provider_id: input.providerId },
      { groups: { workspace: context.workspaceId } }
    )
    return { success: true as const, deletedKeyIds: deleted.map((key) => key.id) }
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.BYOK_KEY_DELETED,
    resourceType: AuditResourceType.BYOK_KEY,
    resourceName: input.providerId,
    description: `Removed BYOK key for ${input.providerId}`,
    metadata: { providerId: input.providerId, deletedKeyIds: result.deletedKeyIds },
  }),
})
