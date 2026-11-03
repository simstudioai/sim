import { AuditAction, AuditResourceType } from '@sim/audit'
import type { z } from 'zod'
import { updateWorkspaceBodySchema } from '@/lib/api/contracts/workspaces'
import {
  defineAuthorizedWorkspaceUseCase,
  NoWorkspaceAccessError,
  type WorkspaceUseCaseAuditEntry,
} from '@/lib/core/application'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  loadActiveWorkspaceApplicationContext,
  resolveActiveWorkspaceApplicationContext,
} from '@/lib/workspaces/application/context'
import {
  applyWorkspaceUpdate,
  readWorkspaceIdentityRecord,
  type WorkspaceIdentity,
  type WorkspaceUpdatePatch,
  type WorkspaceUpdateResult,
} from '@/lib/workspaces/update'

export const workspaceUpdateOperations = {
  // permission-group-exempt: workspace administration has no module capability; the admin role is the gate, as it was before this operation existed
  update: defineWorkspaceOperation({
    id: 'workspaces.update',
    minimumRole: 'admin',
    capability: 'none',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  // permission-group-exempt: reading the workspace's own name and logo, which every member already sees in the workspace switcher
  readIdentity: defineWorkspaceOperation({
    id: 'workspaces.identity.read',
    minimumRole: 'read',
    capability: 'none',
    contentDelivery: 'none',
    workspaceApiKey: 'deny',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
  }),
  /**
   * Name and logo only. Billing payer and the personal-key policy stay on
   * {@link workspaceUpdateOperations.update}, which Copilot cannot reach.
   */
  // permission-group-exempt: same admin-role gate as the full workspace update, narrowed to presentation fields
  updateIdentity: defineWorkspaceOperation({
    id: 'workspaces.identity.update',
    minimumRole: 'admin',
    capability: 'none',
    contentDelivery: 'none',
    workspaceApiKey: 'deny',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
  }),
} as const

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
    const result = await applyWorkspaceUpdate(context.workspaceId, patch)
    return { ...result, patch, identity: presentIdentity(result.updated) }
  },
  projectAudit: ({ result }) => projectUpdateAudit(result.patch, result),
})
