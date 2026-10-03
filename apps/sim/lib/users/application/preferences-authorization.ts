import type { Principal } from '@sim/auth/principal'
import { ForbiddenOperationError } from '@/lib/core/application'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { requireCurrentHumanRole } from '@/lib/core/application/workspace-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { UserAccountOperation } from '@/lib/users/application/operations'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

/** Authorizes the account subject and rechecks the conversation's current membership grant. */
export async function authorizeAccountPreferences(
  principal: Principal,
  operation: UserAccountOperation
): Promise<string> {
  if (!operation.principalKinds.some((kind) => kind === principal.kind)) {
    throw new ForbiddenOperationError(
      'PRINCIPAL_KIND_NOT_PERMITTED',
      'This account operation requires its authenticated owner'
    )
  }
  if (principal.kind === 'session') return principal.userId
  if (principal.kind !== 'delegated' && principal.kind !== 'organization_delegated') {
    throw new ForbiddenOperationError(
      'PRINCIPAL_KIND_NOT_PERMITTED',
      'This account operation requires its authenticated owner'
    )
  }
  const now = Date.now()
  if (
    principal.serviceId !== 'copilot' ||
    principal.audience !== operation.delegationAudience ||
    !Number.isFinite(principal.issuedAt.getTime()) ||
    !Number.isFinite(principal.expiresAt.getTime()) ||
    principal.issuedAt.getTime() > now ||
    principal.expiresAt.getTime() <= now ||
    !principal.resourceScope?.chatId
  ) {
    throw new OrchestrationError('forbidden', 'Account settings delegation is no longer valid')
  }
  if (principal.kind === 'organization_delegated') {
    const context = await authorizeOrganizationOperation(
      principal,
      {
        ...operation,
        minimumRole: 'member',
        principalKinds: ['organization_delegated'],
        delegationAudience: operation.delegationAudience,
        delegatedServices: ['copilot'],
      },
      { organizationId: principal.organizationId }
    )
    return context.userId
  }
  const context = await resolveActiveWorkspaceApplicationContext(principal.workspaceId)
  await requireCurrentHumanRole(principal.subjectUserId, context, 'read')
  return principal.subjectUserId
}
