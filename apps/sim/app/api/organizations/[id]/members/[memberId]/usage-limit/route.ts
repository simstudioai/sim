import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  getOrganizationMemberUsageLimitContract,
  updateOrganizationMemberUsageLimitContract,
} from '@/lib/api/contracts/organization'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { isOrganizationOwnerOrAdmin } from '@/lib/billing/core/organization'
import { resolveBillingInterval } from '@/lib/billing/core/subscription'
import { creditsToDollars, dollarsToCredits } from '@/lib/billing/credits/conversion'
import {
  getOrgMemberUsageLimit,
  getOrgMemberWorkspaceUsage,
  setOrgMemberUsageLimit,
} from '@/lib/billing/organizations/member-limits'
import { isHosted } from '@/lib/core/config/env-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('OrgMemberUsageLimitAPI')

/**
 * GET /api/organizations/[id]/members/[memberId]/usage-limit
 *
 * Returns the member's current-period credits used inside the org's workspaces
 * and their per-member credit cap (both in credits). Owner/admin only and
 * hosted-only (the feature is meaningless where Sim does not own the DB/billing).
 * `memberId` is the target user id, so external members are supported.
 */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string; memberId: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!isHosted) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const parsed = await parseRequest(getOrganizationMemberUsageLimitContract, request, context)
    if (!parsed.success) return parsed.response

    const { id: organizationId, memberId } = parsed.data.params

    const hasAccess = await isOrganizationOwnerOrAdmin(session.user.id, organizationId)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
    }

    const [usage, limitDollars, orgSubscription] = await Promise.all([
      getOrgMemberWorkspaceUsage(organizationId, memberId),
      getOrgMemberUsageLimit(organizationId, memberId),
      getOrganizationSubscription(organizationId),
    ])

    return NextResponse.json({
      success: true,
      data: {
        creditsUsed: dollarsToCredits(usage),
        creditLimit: limitDollars === null ? null : dollarsToCredits(limitDollars),
        billingInterval: resolveBillingInterval(orgSubscription),
      },
    })
  }
)

/**
 * PUT /api/organizations/[id]/members/[memberId]/usage-limit
 *
 * Sets (or clears, when `creditLimit` is null) the member's per-org credit cap.
 * Owner/admin only and hosted-only. The target need not be an org `member` row,
 * so external members are supported.
 */
export const PUT = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string; memberId: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!isHosted) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const parsed = await parseRequest(updateOrganizationMemberUsageLimitContract, request, context)
    if (!parsed.success) return parsed.response

    const { id: organizationId, memberId } = parsed.data.params
    const { creditLimit } = parsed.data.body

    const hasAccess = await isOrganizationOwnerOrAdmin(session.user.id, organizationId)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
    }

    const limitDollars = creditLimit === null ? null : creditsToDollars(creditLimit)
    await setOrgMemberUsageLimit(organizationId, memberId, limitDollars, session.user.id)

    logger.info('Updated per-member usage limit', {
      organizationId,
      memberId,
      creditLimit,
      updatedBy: session.user.id,
    })

    recordAudit({
      workspaceId: null,
      actorId: session.user.id,
      action: AuditAction.ORG_MEMBER_USAGE_LIMIT_CHANGED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: organizationId,
      actorName: session.user.name ?? undefined,
      actorEmail: session.user.email ?? undefined,
      description:
        creditLimit === null
          ? `Cleared credit limit for member ${memberId}`
          : `Set credit limit for member ${memberId} to ${creditLimit} credits`,
      metadata: {
        targetUserId: memberId,
        creditLimit,
      },
      request,
    })

    return NextResponse.json({
      success: true,
      message: 'Member credit limit updated successfully',
      data: { creditLimit },
    })
  }
)
