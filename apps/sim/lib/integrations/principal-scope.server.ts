import { isUserCredentialPrincipal, type Principal } from '@sim/auth/principal'
import { getAllowedIntegrationsFromEnv } from '@/lib/core/config/env-flags'
import { resolvePermissionGroupConfig } from '@/lib/permission-groups/config-scope.server'
import { intersectAccessControlAllowlists } from '@/lib/permission-groups/integration-allowlist'
import { getUserPermissionConfigForOrganization } from '@/lib/permission-groups/resolve.server'

/**
 * The workspace integration gate, shared by every catalog that projects
 * caller-specific integration availability.
 *
 * It exists as one module because it has two independent consumers — the
 * credential-provider catalog and the block/tool catalog — and the interesting
 * case is the one that is easy to get wrong twice: a workspace API key carries
 * no user, so there is no permission group to read, and the allowlist collapses
 * to the deployment's own. Two copies of that reasoning would disagree the
 * first time either changed, and the two endpoints describe the same
 * integrations.
 *
 * Server-only: `resolvePermissionGroupConfig` reads the database.
 */

/**
 * The human whose permission groups apply, or `undefined` when the principal is
 * not user-bearing.
 *
 * A workspace API key authorizes as the workspace itself, independently of who
 * created it, so there is deliberately no fallback to a key owner: substituting
 * one would apply a bystander's permission groups to every caller of that key.
 */
export function principalUserId(principal: Principal): string | undefined {
  if (principal.kind === 'session' || isUserCredentialPrincipal(principal)) {
    return principal.userId
  }
  if (principal.kind === 'delegated') return principal.subjectUserId
  return undefined
}

/**
 * Lowercased block types this principal may see in this workspace, or `null`
 * when nothing restricts them.
 *
 * The intersection of the caller's permission-group allowlist with the
 * deployment's `ALLOWED_INTEGRATIONS`. A principal with no user contributes no
 * permission-group half, leaving the deployment allowlist alone.
 *
 * Each half is successor-resolved *before* the intersection, so a group naming
 * `slack_v2` and a deployment naming `slack` still meet. Callers resolve the
 * type they test the same way.
 */
export async function allowedIntegrationTypes(
  principal: Principal,
  workspaceId: string
): Promise<ReadonlySet<string> | null> {
  const userId = principalUserId(principal)
  const permissionConfig = userId
    ? await resolvePermissionGroupConfig(userId, workspaceId, undefined)
    : null
  return intersectAccessControlAllowlists(
    permissionConfig?.allowedIntegrations ?? null,
    getAllowedIntegrationsFromEnv()
  )
}

/** Organization catalogs apply the organization's policy without resolving any workspace. */
export async function allowedOrganizationIntegrationTypes(
  organizationId: string
): Promise<ReadonlySet<string> | null> {
  const config = await getUserPermissionConfigForOrganization(organizationId)
  return intersectAccessControlAllowlists(
    config?.allowedIntegrations ?? null,
    getAllowedIntegrationsFromEnv()
  )
}
