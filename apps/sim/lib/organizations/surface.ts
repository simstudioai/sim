import { cache } from 'react'
import type { SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { member, type OrganizationKind, organization, session } from '@sim/db/schema'
import { and, asc, count, eq } from 'drizzle-orm'
import {
  getOrganizationSettingsFeatures,
  type OrganizationSettingsFeatures,
} from '@/components/settings/navigation'
import type { OrganizationRole } from '@/lib/api/contracts/primitives'
import type { DeploymentShape } from '@/lib/api/contracts/workspaces'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { getDeploymentShape } from '@/lib/core/config/deployment-shape'
import { isInvitationsDisabled } from '@/lib/core/config/env-flags'
import { isScopedCredentialGroupsAvailable } from '@/lib/credential-groups/scoped-availability'
import { resolveKnowledgeAccessAvailability } from '@/lib/knowledge/access/availability'
import {
  type OrganizationChatAccess,
  projectOrganizationChatAccess,
} from '@/lib/organizations/chat-access'
import { getOrganizationSettingsAccess } from '@/lib/organizations/settings-access'
import { capabilityDeniedBy } from '@/lib/permission-groups/capability-assertions'
import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'
import {
  getUserPermissionConfigForOrganization,
  isOrganizationPermissionRegimeActive,
} from '@/lib/permission-groups/resolve.server'

interface OrganizationSurfaceOrganization {
  id: string
  name: string
  slug: string
  logo: string | null
  /** A personal organization offers no team management or Enterprise configuration. */
  kind: OrganizationKind
}

interface OrganizationSurfaceViewer {
  /** The user this context was authorized for, known at first paint with no session read. */
  userId: string
  role: OrganizationRole
  isAdmin: boolean
  canInviteMembers: boolean
  canConnectSearchIntegrations: boolean
  canUsePersonalApiKeys: boolean
  canUseSearchMcp: boolean
}

/**
 * What deciding a page takes: the routed organization's identity, the viewer's standing in it, and
 * the server-resolved deployment shape. A `null` result is an explicit access denial: the viewer is
 * not a member, or there is no such organization.
 */
export interface OrganizationSurfaceGate extends OrganizationChatAccess {
  organization: OrganizationSurfaceOrganization
  viewer: OrganizationSurfaceViewer
  connectedAccountsAvailable: boolean
  deployment: DeploymentShape
}

/**
 * Everything the organization surface (`/o/[organizationId]`) hands its client: the
 * {@link OrganizationSurfaceGate} plus what only the shell draws, which pages reached by client
 * navigation have no use for. Read by the layout, not by each page.
 */
export interface OrganizationSurfaceContext extends Omit<OrganizationSurfaceGate, 'organization'> {
  organization: OrganizationSurfaceOrganization & { memberCount: number }
  settingsFeatures: OrganizationSettingsFeatures
}

export function canConnectSearchIntegrations(config: PermissionGroupConfig | null): boolean {
  return (
    !capabilityDeniedBy('integrations.manage', config) &&
    !capabilityDeniedBy('knowledge.use', config)
  )
}

/**
 * Resolves the gate from membership in the organization named by the route. Session
 * active-organization state is intentionally not consulted: it describes the viewer's account, not
 * the organization being viewed.
 */
async function resolveOrganizationSurfaceGate(
  organizationId: string,
  userId: string
): Promise<OrganizationSurfaceGate | null> {
  const [access, [row]] = await Promise.all([
    getOrganizationSettingsAccess(organizationId, userId),
    db
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        logo: organization.logo,
        kind: organization.kind,
      })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1),
  ])
  if (!access.isMember || access.role === null || !row) return null

  const [config, connectedAccountsAvailable, searchAccess] = await Promise.all([
    getUserPermissionConfigForOrganization(organizationId),
    isScopedCredentialGroupsAvailable({ kind: 'organization', organizationId }),
    resolveKnowledgeAccessAvailability({ organizationId }),
  ])
  return {
    organization: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      logo: row.logo ?? null,
      kind: row.kind,
    },
    viewer: {
      userId,
      role: access.role,
      isAdmin: access.isAdmin,
      canInviteMembers:
        access.isAdmin && !isInvitationsDisabled && !capabilityDeniedBy('invitations.send', config),
      canConnectSearchIntegrations: canConnectSearchIntegrations(config),
      canUsePersonalApiKeys:
        !capabilityDeniedBy('personal_api_key.use', config) &&
        !capabilityDeniedBy('api_keys.manage', config),
      canUseSearchMcp:
        !capabilityDeniedBy('personal_api_key.use', config) &&
        !capabilityDeniedBy('oauth_apps.use', config),
    },
    connectedAccountsAvailable,
    ...projectOrganizationChatAccess({ role: access.role, config, searchAccess }),
    deployment: getDeploymentShape(),
  }
}

/** Request-memoized gate, so a page and the layout above it share one membership lookup. */
export const getOrganizationSurfaceGate = cache(resolveOrganizationSurfaceGate)

async function resolveOrganizationSurfaceContext(
  organizationId: string,
  userId: string
): Promise<OrganizationSurfaceContext | null> {
  const gate = await getOrganizationSurfaceGate(organizationId, userId)
  if (!gate) return null

  const { deployment, viewer } = gate
  const [[{ memberCount }], hasEnterprisePlan, governanceActive] = await Promise.all([
    db
      .select({ memberCount: count() })
      .from(member)
      .where(eq(member.organizationId, organizationId)),
    deployment.hosted && viewer.isAdmin
      ? isOrganizationOnEnterprisePlan(organizationId)
      : Promise.resolve(false),
    /**
     * Access Control stays listed while a payment is failing, because its rules still apply.
     *
     * Resolved rather than rejected on a read failure: this value only decides whether a nav item
     * is drawn, and it is shared by every organization page — letting it throw would take home,
     * chat and search down with the billing table. The page and the management API read the same
     * regime and still fail closed, so a listed item cannot be used to reach anything.
     */
    deployment.hosted && viewer.isAdmin
      ? isOrganizationPermissionRegimeActive(organizationId).catch(() => false)
      : Promise.resolve(false),
  ])
  return {
    ...gate,
    organization: { ...gate.organization, memberCount },
    settingsFeatures: getOrganizationSettingsFeatures(
      hasEnterprisePlan,
      deployment,
      governanceActive,
      gate.organization.kind === 'personal'
    ),
  }
}

/** Request-memoized surface context for the layout, sharing its membership lookup with the page's gate. */
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

/**
 * {@link resolveOrganizationLanding} for a session known only by its principal, reading the
 * active organization stored on the session, so an API call lands where a page load would.
 */
export async function resolveSessionOrganizationLanding({
  userId,
  sessionId,
}: SessionPrincipal): Promise<string | null> {
  const [row] = await db
    .select({ activeOrganizationId: session.activeOrganizationId })
    .from(session)
    .where(and(eq(session.id, sessionId), eq(session.userId, userId)))
    .limit(1)
  return resolveOrganizationLanding(userId, row?.activeOrganizationId ?? null)
}
