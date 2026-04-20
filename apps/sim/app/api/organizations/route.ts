import { db } from '@sim/db'
import { member, organization, subscription as subscriptionTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, or } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { getSession } from '@/lib/auth'
import { setActiveOrganizationForCurrentSession } from '@/lib/auth/active-organization'
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
import {
  attachOwnedWorkspacesToOrganization,
  WorkspaceOrganizationMembershipConflictError,
} from '@/lib/workspaces/organization-workspaces'

const logger = createLogger('OrganizationsAPI')

export async function GET() {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userOrganizations = await db
      .select({
        id: organization.id,
        name: organization.name,
        role: member.role,
      })
      .from(member)
      .innerJoin(organization, eq(member.organizationId, organization.id))
      .where(
        and(
          eq(member.userId, session.user.id),
          or(eq(member.role, 'owner'), eq(member.role, 'admin'))
        )
      )

    const anyMembership = await db
      .select({ id: member.id })
      .from(member)
      .where(eq(member.userId, session.user.id))
      .limit(1)

    return NextResponse.json({
      organizations: userOrganizations,
      isMemberOfAnyOrg: anyMembership.length > 0,
    })
  } catch (error) {
    logger.error('Failed to fetch organizations', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    })

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized - no active session' }, { status: 401 })
    }

    const user = session.user

    // Parse request body for optional name and slug
    let organizationName = user.name
    let organizationSlug: string | undefined

    try {
      const body = await request.json()
      if (body.name && typeof body.name === 'string') {
        organizationName = body.name
      }
      if (body.slug && typeof body.slug === 'string') {
        organizationSlug = body.slug
      }
    } catch {
      // If no body or invalid JSON, use defaults
    }

    const existingOrgMembership = await db
      .select({
        organizationId: member.organizationId,
        role: member.role,
      })
      .from(member)
      .where(eq(member.userId, user.id))
      .limit(1)

    const existingAdminMembership =
      existingOrgMembership.length > 0 && ['owner', 'admin'].includes(existingOrgMembership[0].role)
        ? existingOrgMembership[0]
        : null

    if (existingOrgMembership.length > 0 && !existingAdminMembership) {
      return NextResponse.json(
        {
          error:
            'You are already a member of an organization. Leave your current organization before creating a new one.',
        },
        { status: 409 }
      )
    }

    const subscriptionReferenceIds = existingAdminMembership
      ? [user.id, existingAdminMembership.organizationId]
      : [user.id]

    const activeOrgSubscriptions = await db
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
          inArray(subscriptionTable.referenceId, subscriptionReferenceIds),
          inArray(subscriptionTable.status, ENTITLED_SUBSCRIPTION_STATUSES)
        )
      )

    const activeOrgSubscription =
      (existingAdminMembership
        ? activeOrgSubscriptions.find(
            (subscription) =>
              isOrgPlan(subscription.plan) &&
              subscription.referenceId === existingAdminMembership.organizationId
          )
        : undefined) ??
      activeOrgSubscriptions.find(
        (subscription) => isOrgPlan(subscription.plan) && subscription.referenceId === user.id
      ) ??
      activeOrgSubscriptions.find((subscription) => isOrgPlan(subscription.plan))

    if (!activeOrgSubscription) {
      return NextResponse.json(
        { error: 'Organization creation requires an active Team or Enterprise subscription.' },
        { status: 403 }
      )
    }

    logger.info('Creating organization for team plan', {
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      organizationName,
      organizationSlug,
      existingOrganizationId: existingAdminMembership?.organizationId ?? null,
      subscriptionReferenceId: activeOrgSubscription.referenceId,
    })

    let organizationId: string
    let createdOrganization = false

    if (existingAdminMembership) {
      organizationId = existingAdminMembership.organizationId

      if (activeOrgSubscription.referenceId === organizationId) {
        await attachOwnedWorkspacesToOrganization({
          ownerUserId: user.id,
          organizationId,
        })
      } else {
        const resolvedSubscription =
          await ensureOrganizationForTeamSubscription(activeOrgSubscription)

        if (resolvedSubscription.referenceId !== organizationId) {
          logger.error('Recovered organization did not match existing owner/admin membership', {
            userId: user.id,
            expectedOrganizationId: organizationId,
            resolvedReferenceId: resolvedSubscription.referenceId,
            subscriptionId: activeOrgSubscription.id,
          })
          throw new Error('Organization recovery resolved to an unexpected subscription owner')
        }
      }
    } else {
      createdOrganization = true
      organizationId = await createOrganizationForTeamPlan(
        user.id,
        organizationName || undefined,
        user.email,
        organizationSlug
      )

      const resolvedSubscription =
        await ensureOrganizationForTeamSubscription(activeOrgSubscription)

      if (resolvedSubscription.referenceId !== organizationId) {
        logger.error('Newly created organization was not attached to the active subscription', {
          userId: user.id,
          expectedOrganizationId: organizationId,
          resolvedReferenceId: resolvedSubscription.referenceId,
          subscriptionId: activeOrgSubscription.id,
        })
        throw new Error('Failed to link the new organization to the active subscription')
      }
    }

    try {
      await setActiveOrganizationForCurrentSession(organizationId)
    } catch (error) {
      logger.error('Failed to activate organization after creation', {
        organizationId,
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    logger.info('Successfully ensured organization for team plan', {
      userId: user.id,
      organizationId,
      createdOrganization,
    })

    if (createdOrganization) {
      recordAudit({
        workspaceId: null,
        actorId: user.id,
        action: AuditAction.ORGANIZATION_CREATED,
        resourceType: AuditResourceType.ORGANIZATION,
        resourceId: organizationId,
        actorName: user.name ?? undefined,
        actorEmail: user.email ?? undefined,
        resourceName: organizationName ?? undefined,
        description: `Created organization "${organizationName}"`,
        metadata: { organizationSlug },
        request,
      })
    }

    return NextResponse.json({
      success: true,
      organizationId,
      created: createdOrganization,
    })
  } catch (error) {
    if (error instanceof OrganizationSlugInvalidError) {
      return NextResponse.json(
        {
          error:
            'Organization slug can only contain lowercase letters, numbers, hyphens, and underscores.',
        },
        { status: 400 }
      )
    }

    if (error instanceof OrganizationSlugTakenError) {
      return NextResponse.json({ error: 'This slug is already taken' }, { status: 400 })
    }

    if (error instanceof WorkspaceOrganizationMembershipConflictError) {
      return NextResponse.json(
        {
          error:
            'One or more members of your existing shared workspaces already belong to another organization. Remove them from those workspaces before converting them to organization-owned workspaces.',
        },
        { status: 409 }
      )
    }

    logger.error('Failed to create organization for team plan', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    })

    return NextResponse.json(
      {
        error: 'Failed to create organization',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
