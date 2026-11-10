import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { member, organization, subscription as subscriptionTable, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { and, eq, inArray, or } from 'drizzle-orm'
import {
  createOrganizationForTeamPlan,
  ensureOrganizationForTeamSubscription,
} from '@/lib/billing/organization'
import {
  OrganizationSlugInvalidError,
  OrganizationSlugTakenError,
} from '@/lib/billing/organizations/create-organization'
import { isOrgPlan } from '@/lib/billing/plan-helpers'
import { ENTITLED_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import { recordProjectedUseCaseAuditEntries } from '@/lib/core/application/authorized-workspace-use-case'
import {
  assertOperationPrincipal,
  defineOperation,
  type OperationUseCase,
} from '@/lib/core/application/operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  attachOwnedWorkspacesToOrganization,
  WorkspaceOrganizationMembershipConflictError,
} from '@/lib/workspaces/organization-workspaces'

const logger = createLogger('TeamOrganizations')

const teamOrganizationOperations = {
  // permission-group-exempt: lists the signed-in person's own administered teams; it reads no organization's resources
  listAdministered: defineOperation({
    id: 'organizations.team.list_administered',
    principalKinds: ['session'],
    capability: 'none',
  }),
  // permission-group-exempt: founds or recovers the team that the caller's own Team or Enterprise plan pays for; no group governs a team that does not exist yet
  create: defineOperation({
    id: 'organizations.team.create',
    principalKinds: ['session'],
    capability: 'none',
  }),
} as const

interface AdministeredTeamOrganizations {
  organizations: { id: string; name: string; role: string }[]
  isMemberOfAnyOrg: boolean
}

/** The teams the viewer owns or administers, and whether they belong to any team at all. */
export const listAdministeredTeamOrganizations: OperationUseCase<
  typeof teamOrganizationOperations.listAdministered,
  Record<string, never>,
  AdministeredTeamOrganizations
> = {
  operation: teamOrganizationOperations.listAdministered,
  async execute({ principal }) {
    assertOperationPrincipal(principal, teamOrganizationOperations.listAdministered)
    const organizations = await db
      .select({ id: organization.id, name: organization.name, role: member.role })
      .from(member)
      .innerJoin(organization, eq(member.organizationId, organization.id))
      .where(
        and(
          eq(member.userId, principal.userId),
          or(eq(member.role, 'owner'), eq(member.role, 'admin')),
          eq(organization.kind, 'team')
        )
      )

    /** A personal organization is no team membership: its owner may still start or join one. */
    const anyMembership = await db
      .select({ id: member.id })
      .from(member)
      .innerJoin(organization, eq(member.organizationId, organization.id))
      .where(and(eq(member.userId, principal.userId), eq(organization.kind, 'team')))
      .limit(1)

    return { organizations, isMemberOfAnyOrg: anyMembership.length > 0 }
  },
}

interface CreateTeamOrganizationInput {
  name?: string
  slug?: string
}

interface CreateTeamOrganizationResult {
  organizationId: string
  created: boolean
  organizationName: string | null
}

/**
 * Founds the team the caller's Team or Enterprise subscription pays for, or recovers the one they
 * already administer and re-homes the subscription and their owned workspaces onto it.
 *
 * Only a team membership counts against the caller: a personal organization becomes the new team in
 * place on Team start, so it neither blocks creation nor is recovered here.
 */
export const createTeamOrganization: OperationUseCase<
  typeof teamOrganizationOperations.create,
  CreateTeamOrganizationInput,
  CreateTeamOrganizationResult
> = {
  operation: teamOrganizationOperations.create,
  async execute({ principal, input, request }) {
    assertOperationPrincipal(principal, teamOrganizationOperations.create)
    const { userId } = principal

    const [existingMembership] = await db
      .select({ organizationId: member.organizationId, role: member.role })
      .from(member)
      .innerJoin(organization, eq(member.organizationId, organization.id))
      .where(and(eq(member.userId, userId), eq(organization.kind, 'team')))
      .limit(1)
    if (existingMembership && !isOrgAdminRole(existingMembership.role)) {
      throw new OrchestrationError(
        'conflict',
        'You are already a member of an organization. Leave your current organization before creating a new one.'
      )
    }
    const existingOrganizationId = existingMembership?.organizationId ?? null

    const activeSubscriptions = await db
      .select({
        id: subscriptionTable.id,
        plan: subscriptionTable.plan,
        referenceId: subscriptionTable.referenceId,
        status: subscriptionTable.status,
        seats: subscriptionTable.seats,
      })
      .from(subscriptionTable)
      .where(
        and(
          inArray(
            subscriptionTable.referenceId,
            existingOrganizationId ? [userId, existingOrganizationId] : [userId]
          ),
          inArray(subscriptionTable.status, ENTITLED_SUBSCRIPTION_STATUSES)
        )
      )
    const orgSubscriptions = activeSubscriptions.filter((sub) => isOrgPlan(sub.plan))
    const activeOrgSubscription =
      orgSubscriptions.find(
        (sub) => existingOrganizationId !== null && sub.referenceId === existingOrganizationId
      ) ??
      orgSubscriptions.find((sub) => sub.referenceId === userId) ??
      orgSubscriptions[0]
    if (!activeOrgSubscription) {
      throw new OrchestrationError(
        'forbidden',
        'Organization creation requires an active Team or Enterprise subscription.'
      )
    }

    try {
      if (existingOrganizationId) {
        if (activeOrgSubscription.referenceId === existingOrganizationId) {
          /**
           * Keeps the default `reject` policy: manual organization creation
           * surfaces a different-org collaborator as an explicit conflict (409
           * with actionable copy) rather than silently demoting them to an
           * external member. Safe alongside `includeArchived` because the attach
           * only enumerates collaborators of ACTIVE workspaces, so sweeping
           * archived rows cannot manufacture a conflict.
           */
          await attachOwnedWorkspacesToOrganization({
            ownerUserId: userId,
            organizationId: existingOrganizationId,
            includeArchived: true,
          })
        } else {
          await requireSubscriptionHomedOn(
            activeOrgSubscription,
            existingOrganizationId,
            'Organization recovery resolved to an unexpected subscription owner'
          )
        }
        return { organizationId: existingOrganizationId, created: false, organizationName: null }
      }

      const [owner] = await db
        .select({ name: user.name, email: user.email })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1)
      const organizationName = input.name || owner?.name || null
      const organizationId = await createOrganizationForTeamPlan(
        userId,
        organizationName || undefined,
        owner?.email,
        input.slug || undefined
      )
      await requireSubscriptionHomedOn(
        activeOrgSubscription,
        organizationId,
        'Failed to link the new organization to the active subscription'
      )

      recordProjectedUseCaseAuditEntries(
        teamOrganizationOperations.create,
        null,
        principal,
        request,
        [
          {
            action: AuditAction.ORGANIZATION_CREATED,
            resourceType: AuditResourceType.ORGANIZATION,
            resourceId: organizationId,
            resourceName: organizationName ?? undefined,
            description: `Created organization "${organizationName}"`,
            metadata: { organizationSlug: input.slug || undefined },
          },
        ]
      )
      return { organizationId, created: true, organizationName }
    } catch (error) {
      if (error instanceof OrganizationSlugInvalidError) {
        throw new OrchestrationError(
          'validation',
          'Organization slug can only contain lowercase letters, numbers, hyphens, and underscores.'
        )
      }
      if (error instanceof OrganizationSlugTakenError) {
        throw new OrchestrationError('validation', 'This slug is already taken')
      }
      if (error instanceof WorkspaceOrganizationMembershipConflictError) {
        throw new OrchestrationError(
          'conflict',
          'One or more members of your existing shared workspaces already belong to another organization. Remove them from those workspaces before converting them to organization-owned workspaces.'
        )
      }
      throw error
    }
  },
}

/** Re-homes the subscription onto the organization, failing when it resolves anywhere else. */
async function requireSubscriptionHomedOn(
  subscription: Parameters<typeof ensureOrganizationForTeamSubscription>[0],
  organizationId: string,
  failure: string
): Promise<void> {
  const resolved = await ensureOrganizationForTeamSubscription(subscription)
  if (resolved.referenceId === organizationId) return
  logger.error('Team subscription resolved to an unexpected organization', {
    expectedOrganizationId: organizationId,
    resolvedReferenceId: resolved.referenceId,
    subscriptionId: subscription.id,
  })
  throw new Error(failure)
}
