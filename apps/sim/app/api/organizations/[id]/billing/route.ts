import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth-client'
import {
  getOrganizationBillingData,
  getOrganizationBillingSummary,
} from '@/lib/billing/core/organization-billing'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import * as schema from '@/db/schema'

const logger = createLogger('OrganizationBillingAPI')

/**
 * GET /api/organizations/[id]/billing
 * Get comprehensive organization billing data
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const organizationId = params.id

    // Verify user has access to this organization
    const member = await db
      .select()
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, organizationId),
          eq(schema.member.userId, session.user.id)
        )
      )
      .limit(1)

    if (member.length === 0) {
      return NextResponse.json(
        { error: 'Forbidden - Not a member of this organization' },
        { status: 403 }
      )
    }

    const userRole = member[0].role

    // Check if user has admin permissions for detailed billing data
    const hasAdminAccess = ['owner', 'admin'].includes(userRole)

    let billingData

    if (hasAdminAccess) {
      // Full billing data for admins
      billingData = await getOrganizationBillingData(organizationId)
    } else {
      // Summary data for regular members
      billingData = await getOrganizationBillingSummary(organizationId)

      // Remove sensitive member details for non-admins
      if (billingData) {
        ;(billingData as any).members = undefined
      }
    }

    if (!billingData) {
      return NextResponse.json({ error: 'Organization billing data not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      data: billingData,
      userRole,
      hasAdminAccess,
    })
  } catch (error) {
    logger.error('Failed to get organization billing data', {
      organizationId: params.id,
      error,
    })

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
