import { AuditAction, AuditResourceType } from '@sim/audit'
import type { z } from 'zod'
import { updateWorkspaceBodySchema } from '@/lib/api/contracts/workspaces'
import {
  defineAuthorizedWorkspaceUseCase,
  NoWorkspaceAccessError,
  type WorkspaceUseCaseAuditEntry,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  loadActiveWorkspaceApplicationContext,
  resolveActiveWorkspaceApplicationContext,
} from '@/lib/workspaces/application/context'
import { workspaceUpdateOperations } from '@/lib/workspaces/application/operations'
import {
  countPublicWorkspaceMembers,
  type PublicWorkspaceDetail,
} from '@/lib/workspaces/public-queries'
import {
  applyWorkspaceUpdate,
  readWorkspaceIdentityRecord,
  type WorkspaceIdentity,
  type WorkspaceUpdatePatch,
  type WorkspaceUpdateResult,
} from '@/lib/workspaces/update'

export const workspaceIdentityPatchSchema = updateWorkspaceBodySchema
  .pick({ name: true, logoUrl: true })
  .strict()
type WorkspaceIdentityPatch = z.output<typeof workspaceIdentityPatchSchema>

function projectUpdateAudit(
  patch: WorkspaceUpdatePatch,
  { previous, updated }: WorkspaceUpdateResult
): WorkspaceUseCaseAuditEntry {
  const { name, logoUrl, allowPersonalApiKeys, billedAccountUserId } = patch
  return {
    action: AuditAction.WORKSPACE_UPDATED,
    resourceType: AuditResourceType.WORKSPACE,
    resourceId: updated.id,
    resourceName: updated.name,
    description: `Updated workspace "${updated.name}"`,
    metadata: {
      changes: {
        ...(name !== undefined && { name: { from: previous.name, to: name } }),
        ...(logoUrl !== undefined && { logoUrl: { from: previous.logoUrl, to: logoUrl } }),
        ...(allowPersonalApiKeys !== undefined && {
          allowPersonalApiKeys: { from: previous.allowPersonalApiKeys, to: allowPersonalApiKeys },
        }),
        ...(billedAccountUserId !== undefined && {
          billedAccountUserId: { from: previous.billedAccountUserId, to: billedAccountUserId },
        }),
      },
    },
  }
}

/**
 * The full workspace settings update: name, logo, personal-key policy and
 * billed account. An inactive or unreachable workspace is refused the same way
 * as a non-admin, so the caller cannot tell the two apart.
 */
export const updateWorkspace = defineAuthorizedWorkspaceUseCase({
  operation: workspaceUpdateOperations.update,
  resolveContext: async ({
    input,
  }: {
    input: { workspaceId: string; patch: WorkspaceUpdatePatch }
  }) => {
    const context = await loadActiveWorkspaceApplicationContext(input.workspaceId)
    if (!context) throw new NoWorkspaceAccessError()
    return context
  },
  authorizationOptions: {},
  execute: ({ context, input }) => applyWorkspaceUpdate(context.workspaceId, input.patch),
  projectAudit: ({ input, result }) => projectUpdateAudit(input.patch, result),
})

const identityDelegation = {
  delegation: { audience: 'sim:settings', isWithinScope: () => true },
}

function presentIdentity(row: WorkspaceIdentity): WorkspaceIdentity {
  return { id: row.id, name: row.name, logoUrl: row.logoUrl }
}

export const readWorkspaceIdentity = defineAuthorizedWorkspaceUseCase({
  operation: workspaceUpdateOperations.readIdentity,
  resolveContext: ({ input }: { input: { workspaceId: string } }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: identityDelegation,
  execute: ({ context }) => readWorkspaceIdentityRecord(context.workspaceId),
})

export const updateWorkspaceIdentity = defineAuthorizedWorkspaceUseCase({
  operation: workspaceUpdateOperations.updateIdentity,
  resolveContext: ({ input }: { input: { workspaceId: string; patch: WorkspaceIdentityPatch } }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: identityDelegation,
  execute: async ({ context, input }) => {
    const parsed = workspaceIdentityPatchSchema.safeParse(input.patch)
    if (!parsed.success) throw new OrchestrationError('validation', parsed.error.issues[0].message)
    const patch = { name: parsed.data.name, logoUrl: parsed.data.logoUrl }
    // Counted before the write, never after or alongside it: a failed count
    // after the commit would report a persisted rename as failed and skip its
    // audit. A rename does not change membership, so the earlier count holds.
    const memberCount = await countPublicWorkspaceMembers({
      id: context.workspaceId,
      organizationId: context.workspaceOrganizationId,
    })
    const result = await applyWorkspaceUpdate(context.workspaceId, patch)
    const { id, name, color, logoUrl, createdAt, updatedAt } = result.updated
    return {
      ...result,
      patch,
      identity: presentIdentity(result.updated),
      workspace: {
        id,
        name,
        color,
        logoUrl,
        memberCount,
        createdAt,
        updatedAt,
      } satisfies PublicWorkspaceDetail,
    }
  },
  projectAudit: ({ result }) => projectUpdateAudit(result.patch, result),
})
