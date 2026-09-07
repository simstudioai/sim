/**
 * Resolves the permission group governing a user, and its config.
 *
 * Lives here rather than in `ee/access-control` because the authorization
 * funnel reads it: `capability-assertions.ts` and `config-scope.server.ts` sit
 * under `@/lib/core/application`, which ~24 domain `operations.ts` modules
 * import. `ee/access-control/utils/permission-check.ts` also holds the model,
 * block and tool gates, and those reach the provider registry, the block
 * registry and the billing barrel — a graph no authorization decision should
 * load. Splitting resolution out is what keeps the funnel light;
 * `scripts/check-application-graph.ts` fails the build if the edge returns.
 *
 * `permission-check.ts` re-exports these, so the surfaces that read every
 * validator from one module are unaffected.
 */
import { db } from '@sim/db'
import { permissionGroup, permissionGroupMember, permissionGroupWorkspace } from '@sim/db/schema'
import { and, asc, eq, sql } from 'drizzle-orm'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import {
  getAllowedIntegrationsFromEnv,
  isAccessControlEnabled,
  isHosted,
} from '@/lib/core/config/env-flags'
import type { DbOrTx } from '@/lib/db/types'
import {
  DEFAULT_PERMISSION_GROUP_CONFIG,
  type PermissionGroupConfig,
  parsePermissionGroupConfig,
} from '@/lib/permission-groups/fields'
import { intersectIntegrationAllowlists } from '@/lib/permission-groups/integration-allowlist'
import { getWorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'

/**
 * Merges the env allowlist into a permission config.
 *
 * Returns null only when neither layer restricts anything. Otherwise the group's
 * own allowlist is intersected with the env one by
 * {@link intersectIntegrationAllowlists}, which canonicalizes both sides — case
 * *and* successor — before intersecting. Both matter here: a stored config
 * reaches this function straight off the wire, where the contract permits any
 * casing, and the two layers are written independently, so one can name a
 * retired id (`ALLOWED_INTEGRATIONS=slack`) while the other names its successor
 * (`slack_v2`). Intersecting those textually yields the empty allowlist, which
 * refuses an integration both layers allow. The result is therefore in the
 * resolved vocabulary, and callers must judge a block type through
 * `resolveAccessControlBlockType` before testing membership.
 */
export function mergeEnvAllowlist(
  config: PermissionGroupConfig | null
): PermissionGroupConfig | null {
  const envAllowlist = getAllowedIntegrationsFromEnv()
  if (config === null && envAllowlist === null) return null

  const base = config ?? DEFAULT_PERMISSION_GROUP_CONFIG
  return {
    ...base,
    allowedIntegrations: intersectIntegrationAllowlists(base.allowedIntegrations, envAllowlist),
  }
}

/**
 * The permission group that governs a user in a given context, with its parsed
 * config. Shared by the executor path and the `/api/permission-groups/user`
 * route so resolution never drifts between the two.
 */
export interface ResolvedPermissionGroup {
  permissionGroupId: string
  groupName: string
  resolution: 'explicit-member' | 'all-members' | 'default'
  config: PermissionGroupConfig
}

export interface UserAccessControlContext {
  organizationId: string | null
  entitled: boolean
  permissionGroup: {
    id: string
    name: string
    resolution: ResolvedPermissionGroup['resolution']
  } | null
  config: PermissionGroupConfig | null
}

function inactiveUserAccessControlContext(organizationId: string | null): UserAccessControlContext {
  return {
    organizationId,
    entitled: false,
    permissionGroup: null,
    config: mergeEnvAllowlist(null),
  }
}

/**
 * The organization's single default group (`isDefault`), or `null`.
 *
 * The executor is required, not defaulted: a caller that must read the group
 * under `acquirePermissionGroupOrgLock` has to read it on the transaction's own
 * connection, and a default would let that caller silently check out a second
 * pooled connection while advisory locks are held.
 */
async function resolveDefaultGroup(
  organizationId: string,
  executor: DbOrTx
): Promise<ResolvedPermissionGroup | null> {
  const [defaultGroup] = await executor
    .select({
      id: permissionGroup.id,
      name: permissionGroup.name,
      config: permissionGroup.config,
    })
    .from(permissionGroup)
    .where(
      and(eq(permissionGroup.organizationId, organizationId), eq(permissionGroup.isDefault, true))
    )
    .limit(1)

  if (!defaultGroup) {
    return null
  }

  return {
    permissionGroupId: defaultGroup.id,
    groupName: defaultGroup.name,
    resolution: 'default',
    config: parsePermissionGroupConfig(defaultGroup.config),
  }
}

/**
 * Resolve the group governing `userId` in `workspaceId` (which belongs to
 * `organizationId`). One effective group per workspace, by precedence:
 *   1. a non-default group targeting this workspace that `userId` is an explicit
 *      member of, else
 *   2. a non-default group in `inherit` mode targeting this workspace that has no
 *      explicit members — governs all members of the workspace, including
 *      external members, else
 *   3. the organization's default group (also governs external members), else
 *   4. `null` (unrestricted).
 *
 * Assignment-time conflict checks keep this unambiguous: at most one all-members
 * group per workspace, and a user is an explicit member of at most one group per
 * workspace. If an overlap nonetheless exists, the oldest group wins — rows are
 * ordered by `created_at` (then `id`).
 *
 * A group in `explicit` membership mode is excluded from step 2: it governs
 * exactly its member rows and therefore governs nobody when empty. Directory-
 * provisioned groups use that mode, so an identity provider removing the last
 * member narrows the group to nobody rather than silently widening it to
 * everyone in its workspaces.
 *
 * Callers gate on enterprise entitlement before invoking this and merge the env
 * allowlist afterwards.
 */
export async function resolveWorkspaceGroup(
  userId: string,
  organizationId: string,
  workspaceId: string
): Promise<ResolvedPermissionGroup | null> {
  const rows = await db
    .select({
      id: permissionGroup.id,
      name: permissionGroup.name,
      config: permissionGroup.config,
      isMember: sql<boolean>`exists (
        select 1 from ${permissionGroupMember}
        where ${permissionGroupMember.permissionGroupId} = ${permissionGroup.id}
          and ${permissionGroupMember.userId} = ${userId}
      )`,
      hasMembers: sql<boolean>`exists (
        select 1 from ${permissionGroupMember}
        where ${permissionGroupMember.permissionGroupId} = ${permissionGroup.id}
      )`,
      membershipMode: permissionGroup.membershipMode,
    })
    .from(permissionGroup)
    .innerJoin(
      permissionGroupWorkspace,
      and(
        eq(permissionGroupWorkspace.permissionGroupId, permissionGroup.id),
        eq(permissionGroupWorkspace.workspaceId, workspaceId)
      )
    )
    .where(
      and(eq(permissionGroup.organizationId, organizationId), eq(permissionGroup.isDefault, false))
    )
    .orderBy(asc(permissionGroup.createdAt), asc(permissionGroup.id))

  const explicitMemberGroup = rows.find((row) => row.isMember)
  const winner =
    explicitMemberGroup ?? rows.find((row) => !row.hasMembers && row.membershipMode === 'inherit')

  if (winner) {
    return {
      permissionGroupId: winner.id,
      groupName: winner.name,
      resolution: explicitMemberGroup ? 'explicit-member' : 'all-members',
      config: parsePermissionGroupConfig(winner.config),
    }
  }

  return resolveDefaultGroup(organizationId, db)
}

/**
 * Resolve the effective permission-group config for a user in the context of a
 * specific workspace. The workspace is mapped to its organization and the
 * governing group is resolved with specific-over-all precedence.
 *
 * Returns `null` (after env merge) when the workspace has no organization, the
 * organization isn't on an enterprise plan, or no group governs the user.
 *
 * The env-level integration allowlist is always merged last so self-hosted
 * deployments can constrain integrations without touching the DB.
 */
async function resolveUserAccessControlContextForOrganization(
  userId: string,
  workspaceId: string,
  organizationId: string | null
): Promise<UserAccessControlContext> {
  if (!organizationId) return inactiveUserAccessControlContext(null)

  /**
   * `'throw'` because an unentitled organization resolves to `config: null`,
   * and `null` is not a smaller permission set — it is *no* permission group at
   * all: every capability allowed, every allowlist off. Under the lenient
   * default a single subscription-read failure would be indistinguishable from
   * a genuine plan lapse and would turn the whole regime off for the request.
   * Throwing surfaces the outage as an error instead.
   */
  const isEnterprise = await isOrganizationOnEnterprisePlan(organizationId, 'throw')
  if (!isEnterprise) {
    return inactiveUserAccessControlContext(organizationId)
  }

  const resolved = await resolveWorkspaceGroup(userId, organizationId, workspaceId)
  return {
    organizationId,
    entitled: true,
    permissionGroup: resolved
      ? {
          id: resolved.permissionGroupId,
          name: resolved.groupName,
          resolution: resolved.resolution,
        }
      : null,
    config: mergeEnvAllowlist(resolved?.config ?? null),
  }
}

/**
 * Resolves Access Control from an organization ID obtained from an already
 * access-checked workspace. This function does not independently authorize the
 * user for the workspace; callers must establish that boundary first.
 */
export async function resolveVerifiedUserAccessControlContext(
  userId: string,
  workspaceId: string,
  organizationId: string | null
): Promise<UserAccessControlContext> {
  if (!isHosted && !isAccessControlEnabled) {
    return inactiveUserAccessControlContext(null)
  }
  return resolveUserAccessControlContextForOrganization(userId, workspaceId, organizationId)
}

/**
 * The unverified counterpart of {@link resolveVerifiedUserAccessControlContext}:
 * it loads the workspace itself to learn the owning organization.
 *
 * For the callers that have not already access-checked the workspace — a raw
 * route, typically. Everything else holds the organization id already and
 * should pass it, rather than paying for a second lookup of a value it has.
 */
export async function getUserPermissionConfig(
  userId: string,
  workspaceId: string
): Promise<PermissionGroupConfig | null> {
  if (!isHosted && !isAccessControlEnabled) {
    return mergeEnvAllowlist(null)
  }

  const workspace = await getWorkspaceWithOwner(workspaceId, { includeArchived: true })
  const context = await resolveUserAccessControlContextForOrganization(
    userId,
    workspaceId,
    workspace?.organizationId ?? null
  )
  return context.config
}

/**
 * Org-addressed variant of {@link getUserPermissionConfig}. Use when only the
 * organization is known (e.g. organization-level invitations). Non-default
 * groups target specific workspaces and never gate organization-level actions,
 * so this resolves the organization's default group — which governs everyone not
 * covered by a workspace group.
 */
export async function getUserPermissionConfigForOrganization(
  organizationId: string
): Promise<PermissionGroupConfig | null> {
  if (!(await isOrganizationPermissionRegimeActive(organizationId))) {
    return mergeEnvAllowlist(null)
  }
  return getEntitledOrganizationPermissionConfig(organizationId, db)
}

/**
 * Whether permission groups govern `organizationId` at all — the deployment
 * enables Access Control, and the organization holds the Enterprise entitlement
 * that turns the regime on.
 *
 * Split out of {@link getUserPermissionConfigForOrganization} so a caller that
 * must re-read the *group* under `acquirePermissionGroupOrgLock` can settle this
 * half BEFORE opening its transaction. The entitlement read cannot move into a
 * transaction: {@link isOrganizationOnEnterprisePlan} is `cache()`d on its
 * argument list, so it admits no executor, and giving it one would both miss the
 * memo on every call and — because an unentitled organization resolves to
 * `config: null`, meaning every capability ALLOWED — turn a read failure into a
 * fail-open. The lock never serialized this half either way: it guards
 * permission-group writes, not subscription changes.
 *
 * `'throw'` for the same reason as in
 * {@link resolveUserAccessControlContextForOrganization}.
 */
export async function isOrganizationPermissionRegimeActive(
  organizationId: string
): Promise<boolean> {
  if (!isHosted && !isAccessControlEnabled) return false
  return isOrganizationOnEnterprisePlan(organizationId, 'throw')
}

/**
 * The organization-level permission config for an organization already known to
 * be governed — the second half of {@link getUserPermissionConfigForOrganization},
 * callable on a transaction executor.
 *
 * Callers MUST have established {@link isOrganizationPermissionRegimeActive}
 * first; this function does not re-check entitlement, and reading it as though
 * it did would apply an unentitled organization's stale default group.
 */
export async function getEntitledOrganizationPermissionConfig(
  organizationId: string,
  executor: DbOrTx
): Promise<PermissionGroupConfig | null> {
  const resolved = await resolveDefaultGroup(organizationId, executor)
  return mergeEnvAllowlist(resolved?.config ?? null)
}
