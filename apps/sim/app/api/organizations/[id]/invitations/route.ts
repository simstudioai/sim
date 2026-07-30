import { db } from '@sim/db'
import { invitation, member, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { organizationParamsSchema } from '@/lib/api/contracts/organization'
import { getValidationErrorMessage } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('OrganizationInvitations')

export const GET = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const paramsResult = organizationParamsSchema.safeParse(await params)
      if (!paramsResult.success) {
        return NextResponse.json(
          { error: getValidationErrorMessage(paramsResult.error, 'Invalid route parameters') },
          { status: 400 }
        )
      }

      const { id: organizationId } = paramsResult.data

      const [memberEntry] = await db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
        .limit(1)

      if (!memberEntry) {
        return NextResponse.json(
          { error: 'Forbidden - Not a member of this organization' },
          { status: 403 }
        )
      }

      const userRole = memberEntry.role
      if (!isOrgAdminRole(userRole)) {
        return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
      }

      const invitations = await db
        .select({
          id: invitation.id,
          email: invitation.email,
          kind: invitation.kind,
          role: invitation.role,
          status: invitation.status,
          expiresAt: invitation.expiresAt,
          createdAt: invitation.createdAt,
          inviterName: user.name,
          inviterEmail: user.email,
        })
        .from(invitation)
        .leftJoin(user, eq(invitation.inviterId, user.id))
        .where(eq(invitation.organizationId, organizationId))
        .orderBy(invitation.createdAt)

      return NextResponse.json({
        success: true,
        data: { invitations, userRole },
      })
    } catch (error) {
      logger.error('Failed to get organization invitations', { error })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
