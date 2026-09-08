import {
  isUserCredentialPrincipal,
  type OAuthAccessTokenPrincipal,
  type PersonalApiKeyPrincipal,
  type Principal,
} from '@sim/auth/principal'
import { db } from '@sim/db'
import { member } from '@sim/db/schema'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { and, eq } from 'drizzle-orm'
import type { OrganizationRole } from '@/lib/api/contracts/primitives'
import { organizationRoleSchema } from '@/lib/api/contracts/primitives'
import { SIM_CLI_CLIENT_ID } from '@/lib/auth/oauth-provider'
import { requireOAuthOperationScope } from '@/lib/core/application/oauth-authorization'
import type { OperationDeclarableCapability } from '@/lib/core/application/operation'
import type { OrganizationOperation } from '@/lib/core/application/organization-operation'
import { PrincipalKindAuthorizationError } from '@/lib/core/application/workspace-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { refuseCapability } from '@/lib/permission-groups/capabilities'
import { capabilityDeniedBy } from '@/lib/permission-groups/capability-assertions'
import { getUserPermissionConfigForOrganization } from '@/lib/permission-groups/resolve.server'

export interface OrganizationAuthorizationContext {
  organizationId: string
}

export interface OrganizationMembershipContext extends OrganizationAuthorizationContext {
  userId: string
  role: OrganizationRole
}

/** Rechecks routed organization membership; owning a workspace is irrelevant to this grant. */
export async function requireOrganizationMembership(
  principal: Principal,
  organizationId: string,
  minimumRole: 'member' | 'admin' = 'member',
  capability: OperationDeclarableCapability | 'none' = 'none'
): Promise<OrganizationMembershipContext> {
  if (principal.kind !== 'session' && !isUserCredentialPrincipal(principal)) {
    throw new PrincipalKindAuthorizationError(principal.kind, 'organization.membership')
  }
  return requireOrganizationSubjectMembership(
    principal.userId,
    organizationId,
    minimumRole,
    capability,
    isUserCredentialPrincipal(principal) ? principal : undefined
  )
}

async function requireOrganizationSubjectMembership(
  userId: string,
  organizationId: string,
  minimumRole: 'member' | 'admin',
  capability: OperationDeclarableCapability | 'none',
  userCredential?: PersonalApiKeyPrincipal | OAuthAccessTokenPrincipal
): Promise<OrganizationMembershipContext> {
  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1)
  const parsedRole = organizationRoleSchema.safeParse(membership?.role)
  if (!parsedRole.success) throw new OrchestrationError('not_found', 'Organization not found')
  if (minimumRole === 'admin' && !isOrgAdminRole(parsedRole.data)) {
    throw new OrchestrationError('forbidden', 'Organization administrator access is required')
  }
  const config = await getUserPermissionConfigForOrganization(organizationId)
  if (userCredential && capabilityDeniedBy('personal_api_key.use', config))
    refuseCapability('personal_api_key.use')
  if (userCredential?.kind === 'oauth_access_token') {
    /** permission-group-enforced: oauth_apps.use — organization reads recheck existing grants after membership. */
    if (capabilityDeniedBy('oauth_apps.use', config)) refuseCapability('oauth_apps.use')
    if (userCredential.clientId === SIM_CLI_CLIENT_ID && capabilityDeniedBy('cli.use', config))
      refuseCapability('cli.use')
  }
  if (capability !== 'none' && capabilityDeniedBy(capability, config)) refuseCapability(capability)
  return { organizationId, userId, role: parsedRole.data }
}

export async function authorizeOrganizationOperation(
  principal: Principal,
  operation: OrganizationOperation,
  context: OrganizationAuthorizationContext
): Promise<OrganizationMembershipContext> {
  if (!operation.principalKinds.some((kind) => kind === principal.kind)) {
    throw new PrincipalKindAuthorizationError(principal.kind, operation.id)
  }
  requireOAuthOperationScope(principal, operation)
  if (principal.kind === 'organization_delegated') {
    const now = Date.now()
    if (
      principal.organizationId !== context.organizationId ||
      principal.audience !== operation.delegationAudience ||
      !Number.isFinite(principal.issuedAt.getTime()) ||
      !Number.isFinite(principal.expiresAt.getTime()) ||
      principal.issuedAt.getTime() > now ||
      principal.expiresAt.getTime() <= now ||
      !principal.resourceScope.chatId
    ) {
      throw new OrchestrationError('forbidden', 'Organization delegation is no longer valid')
    }
    return requireOrganizationSubjectMembership(
      principal.subjectUserId,
      context.organizationId,
      operation.minimumRole,
      operation.capability
    )
  }
  return requireOrganizationMembership(
    principal,
    context.organizationId,
    operation.minimumRole,
    operation.capability
  )
}
