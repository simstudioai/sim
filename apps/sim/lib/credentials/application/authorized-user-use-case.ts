import { type AuditActionType, type AuditResourceTypeValue, recordAudit } from '@sim/audit'
import { resolvePrincipalAuditAttribution, type SessionPrincipal } from '@sim/auth/principal'
import { getUserOrganization } from '@/lib/billing/organizations/membership'
import type { OperationUseCase } from '@/lib/core/application'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { CredentialUserOperation } from '@/lib/credentials/application/operations'
import { refuseCapability } from '@/lib/permission-groups/capabilities'
import { isOrganizationCapabilityWithheld } from '@/lib/permission-groups/capability-assertions'

export interface CredentialUserAuditEntry {
  workspaceId: string | null
  action: AuditActionType
  resourceType: AuditResourceTypeValue
  resourceId?: string
  resourceName?: string
  description?: string
  metadata?: Record<string, unknown>
}

interface CredentialUserUseCaseDefinition<O extends CredentialUserOperation, I, R> {
  operation: O
  execute(args: {
    principal: SessionPrincipal
    input: I
    request?: OrchestrationRequestContext
  }): Promise<R>
  projectAudit?(args: {
    principal: SessionPrincipal
    input: I
    result: R
  }): CredentialUserAuditEntry | CredentialUserAuditEntry[]
  projectErrorAudit?(args: {
    principal: SessionPrincipal
    input: I
    error: unknown
  }): CredentialUserAuditEntry | CredentialUserAuditEntry[] | undefined
  afterSuccess?(args: { principal: SessionPrincipal; input: I; result: R }): void | Promise<void>
  afterError?(args: { principal: SessionPrincipal; input: I; error: unknown }): void | Promise<void>
}

function recordCredentialUserAudit(
  principal: SessionPrincipal,
  operation: CredentialUserOperation,
  projected: CredentialUserAuditEntry | CredentialUserAuditEntry[] | undefined,
  request?: OrchestrationRequestContext
): void {
  if (!projected) return
  const attribution = resolvePrincipalAuditAttribution(principal)
  const entries = Array.isArray(projected) ? projected : [projected]
  for (const entry of entries) {
    recordAudit({
      workspaceId: entry.workspaceId,
      actorId: attribution.actorId,
      actorName: attribution.actorName,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      resourceName: entry.resourceName,
      description: entry.description,
      metadata: {
        ...entry.metadata,
        operation: operation.id,
        actor: attribution.actor,
      },
      request,
    })
  }
}

/**
 * Refuses when the group governing the acting user withholds the operation's
 * capability.
 *
 * permission-group-enforced: integrations.manage — these operations have no
 * workspace, so `authorizeWorkspaceOperation` never sees them and the capability
 * is applied here instead, at the one place every current-user credential
 * operation passes through.
 *
 * The user's own OAuth connections belong to no workspace, so this resolves the
 * organization's default group — the same resolution personal API keys and
 * invitations use for an organization-level action. A no-op when the user is in
 * no organization or no group governs them, which is the personal-workspace and
 * non-enterprise case.
 *
 * Runs after the session-principal check above, never before: the principal kind
 * is this operation's whole access story, and answering the capability question
 * first would tell a caller who is not a session about the organization's
 * configuration.
 */
async function assertCurrentUserCapability(
  userId: string,
  operation: CredentialUserOperation
): Promise<void> {
  if (operation.capability === 'none') return
  const membership = await getUserOrganization(userId)
  if (!membership?.organizationId) return
  if (await isOrganizationCapabilityWithheld(membership.organizationId, operation.capability)) {
    refuseCapability(operation.capability)
  }
}

/** Defines a current-user credential operation that cannot borrow workspace identity. */
export function defineAuthorizedCredentialUserUseCase<
  const O extends CredentialUserOperation,
  I,
  R,
>(definition: CredentialUserUseCaseDefinition<O, I, R>): OperationUseCase<O, I, R> {
  return {
    operation: definition.operation,
    async execute({ principal, input, request }) {
      if (principal.kind !== 'session') {
        throw new OrchestrationError('forbidden', 'Session authentication required')
      }
      await assertCurrentUserCapability(principal.userId, definition.operation)
      try {
        const result = await definition.execute({ principal, input, request })
        recordCredentialUserAudit(
          principal,
          definition.operation,
          definition.projectAudit?.({ principal, input, result }),
          request
        )
        await definition.afterSuccess?.({ principal, input, result })
        return result
      } catch (error) {
        recordCredentialUserAudit(
          principal,
          definition.operation,
          definition.projectErrorAudit?.({ principal, input, error }),
          request
        )
        await definition.afterError?.({ principal, input, error })
        throw error
      }
    },
  }
}
