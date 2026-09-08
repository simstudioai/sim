import { cache } from 'react'
import { db } from '@sim/db'
import { member, organization } from '@sim/db/schema'
import { asc, count, eq } from 'drizzle-orm'
import type { OrganizationRole } from '@/lib/api/contracts/primitives'
import { isInvitationsDisabled } from '@/lib/core/config/env-flags'
import { isScopedCredentialGroupsAvailable } from '@/lib/credential-groups/scoped-availability'
import {
  type KnowledgeAccessAvailability,
  resolveKnowledgeAccessAvailability,
} from '@/lib/knowledge/access/availability'
import { getOrganizationSettingsAccess } from '@/lib/organizations/settings-access'
import { capabilityDeniedBy } from '@/lib/permission-groups/capability-assertions'
import { getUserPermissionConfigForOrganization } from '@/lib/permission-groups/resolve.server'

export interface OrganizationSurfaceOrganization {
  id: string
  name: string
  slug: string
  logo: string | null
  memberCount: number
}

interface OrganizationSurfaceViewer {
  role: OrganizationRole
  isAdmin: boolean
  canInviteMembers: boolean
  canUsePersonalApiKeys: boolean
}

/**
 * Everything the organization surface (`/o/[organizationId]`) needs before it renders:
 * the routed organization's identity and the viewer's standing in it. A `null`
 * result is an explicit access denial — the viewer is not a member, or there is no
 * such organization.
 */
export interface OrganizationSurfaceContext {
  organization: OrganizationSurfaceOrganization
  viewer: OrganizationSurfaceViewer
  connectedAccountsAvailable: boolean
  searchAccess: KnowledgeAccessAvailability
}

/**
 * Resolves the surface context from membership in the organization named by the
 * route. Session active-organization state is intentionally not consulted: it
 * describes the viewer's account, not the organization being viewed.
 */
async function resolveOrganizationSurfaceContext(
  organizationId: string,
  userId: string
): Promise<OrganizationSurfaceContext | null> {
  const access = await getOrganizationSettingsAccess(organizationId, userId)
  if (!access.isMember || access.role === null) return null

  const [row] = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      logo: organization.logo,
    })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)
  if (!row) return null

  const [config, [{ memberCount }]] = await Promise.all([
    getUserPermissionConfigForOrganization(organizationId),
    db
      .select({ memberCount: count() })
      .from(member)
      .where(eq(member.organizationId, organizationId)),
  ])
  return {
    organization: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      logo: row.logo ?? null,
      memberCount,
    },
    viewer: {
      role: access.role,
      isAdmin: access.isAdmin,
      canInviteMembers:
        access.isAdmin && !isInvitationsDisabled && !capabilityDeniedBy('invitations.send', config),
      canUsePersonalApiKeys:
        !capabilityDeniedBy('personal_api_key.use', config) &&
        !capabilityDeniedBy('api_keys.manage', config),
    },
    connectedAccountsAvailable: await isScopedCredentialGroupsAvailable({
      kind: 'organization',
      organizationId,
    }),
    searchAccess: await resolveKnowledgeAccessAvailability({ organizationId }),
  }
}

/**
 * Request-memoized surface context for nested Server Components, so the layout and
 * any page under it share one membership lookup.
 */
export const getOrganizationSurfaceContext = cache(resolveOrganizationSurfaceContext)

/**
 * Picks the organization `/o` lands on: the session's active organization when the
 * viewer belongs to it, otherwise the one they joined first. `null` when the viewer
 * belongs to no organization at all.
 */
export async function resolveOrganizationLanding(
  userId: string,
  activeOrganizationId: string | null
): Promise<string | null> {
  const memberships = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt))
  if (memberships.length === 0) return null

  const isActiveMember =
    activeOrganizationId !== null &&
    memberships.some((row) => row.organizationId === activeOrganizationId)
  return isActiveMember ? activeOrganizationId : memberships[0].organizationId
}
