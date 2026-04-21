import { db } from '@sim/db'
import { member, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { getSession } from '@/lib/auth'
import { setActiveOrganizationForCurrentSession } from '@/lib/auth/active-organization'
import {
  removeUserFromOrganization,
  transferOrganizationOwnership,
} from '@/lib/billing/organizations/membership'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('TransferOwnershipAPI')

const transferOwnershipSchema = z.object({
  newOwnerUserId: z.string().min(1),
  alsoLeave: z.boolean().optional().default(false),
})

export const POST = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { id: organizationId } = await params
      const body = await request.json().catch(() => ({}))
      const validation = transferOwnershipSchema.safeParse(body)
      if (!validation.success) {
        return NextResponse.json(
          { error: validation.error.errors[0]?.message ?? 'Invalid request' },
          { status: 400 }
        )
      }

      const { newOwnerUserId, alsoLeave } = validation.data

      if (newOwnerUserId === session.user.id) {
        return NextResponse.json(
          { error: 'New owner must differ from current owner' },
          { status: 400 }
        )
      }

      const [currentOwnerMember] = await db
        .select({ role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
        .limit(1)

      if (!currentOwnerMember) {
        return NextResponse.json(
          { error: 'You are not a member of this organization' },
          { status: 403 }
        )
      }

      if (currentOwnerMember.role !== 'owner') {
        return NextResponse.json(
          { error: 'Only the current owner can transfer ownership' },
          { status: 403 }
        )
      }

      const [targetMember] = await db
        .select({
          id: member.id,
          role: member.role,
          email: user.email,
          name: user.name,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, newOwnerUserId)))
        .limit(1)

      if (!targetMember) {
        return NextResponse.json(
          { error: 'Target user is not a member of this organization' },
          { status: 400 }
        )
      }

      const transferResult = await transferOrganizationOwnership({
        organizationId,
        currentOwnerUserId: session.user.id,
        newOwnerUserId,
      })

      if (!transferResult.success) {
        return NextResponse.json(
          { error: transferResult.error ?? 'Failed to transfer ownership' },
          { status: 500 }
        )
      }

      recordAudit({
        workspaceId: null,
        actorId: session.user.id,
        actorName: session.user.name ?? undefined,
        actorEmail: session.user.email ?? undefined,
        action: AuditAction.ORG_MEMBER_ROLE_CHANGED,
        resourceType: AuditResourceType.ORGANIZATION,
        resourceId: organizationId,
        description: `Transferred ownership to ${targetMember.email}`,
        metadata: {
          targetUserId: newOwnerUserId,
          targetEmail: targetMember.email ?? undefined,
          targetName: targetMember.name ?? undefined,
          workspacesReassigned: transferResult.workspacesReassigned,
          billedAccountReassigned: transferResult.billedAccountReassigned,
          overageMigrated: transferResult.overageMigrated,
          billingBlockInherited: transferResult.billingBlockInherited,
        },
        request,
      })

      if (!alsoLeave) {
        return NextResponse.json({
          success: true,
          transferred: true,
          left: false,
          details: {
            workspacesReassigned: transferResult.workspacesReassigned,
            billedAccountReassigned: transferResult.billedAccountReassigned,
            overageMigrated: transferResult.overageMigrated,
            billingBlockInherited: transferResult.billingBlockInherited,
          },
        })
      }

      const [selfMember] = await db
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
        .limit(1)

      if (!selfMember) {
        return NextResponse.json({
          success: true,
          transferred: true,
          left: true,
          details: {
            workspacesReassigned: transferResult.workspacesReassigned,
            billedAccountReassigned: transferResult.billedAccountReassigned,
            overageMigrated: transferResult.overageMigrated,
            billingBlockInherited: transferResult.billingBlockInherited,
          },
        })
      }

      const removeResult = await removeUserFromOrganization({
        userId: session.user.id,
        organizationId,
        memberId: selfMember.id,
      })

      if (!removeResult.success) {
        logger.error('Transfer succeeded but self-removal failed', {
          organizationId,
          userId: session.user.id,
          error: removeResult.error,
        })
        return NextResponse.json(
          {
            success: true,
            transferred: true,
            left: false,
            warning: removeResult.error ?? 'Failed to leave after transfer',
          },
          { status: 207 }
        )
      }

      try {
        await setActiveOrganizationForCurrentSession(null)
      } catch (clearError) {
        logger.warn('Failed to clear active organization after transfer-and-leave', {
          userId: session.user.id,
          organizationId,
          error: clearError,
        })
      }

      recordAudit({
        workspaceId: null,
        actorId: session.user.id,
        actorName: session.user.name ?? undefined,
        actorEmail: session.user.email ?? undefined,
        action: AuditAction.ORG_MEMBER_REMOVED,
        resourceType: AuditResourceType.ORGANIZATION,
        resourceId: organizationId,
        description: 'Left the organization after transferring ownership',
        metadata: {
          targetUserId: session.user.id,
          wasSelfRemoval: true,
          followedOwnershipTransfer: true,
        },
        request,
      })

      return NextResponse.json({
        success: true,
        transferred: true,
        left: true,
        details: {
          workspacesReassigned: transferResult.workspacesReassigned,
          billedAccountReassigned: transferResult.billedAccountReassigned,
          overageMigrated: transferResult.overageMigrated,
          billingBlockInherited: transferResult.billingBlockInherited,
          billingActions: removeResult.billingActions,
        },
      })
    } catch (error) {
      logger.error('Failed to transfer organization ownership', {
        organizationId: (await params).id,
        error,
      })
      return NextResponse.json({ error: 'Failed to transfer ownership' }, { status: 500 })
    }
  }
)
