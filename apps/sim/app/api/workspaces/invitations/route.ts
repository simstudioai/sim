import { randomUUID } from 'crypto'
import { render } from '@react-email/render'
import { db } from '@sim/db'
import {
  permissions,
  type permissionTypeEnum,
  user,
  type WorkspaceInvitationStatus,
  workspace,
  workspaceInvitation,
} from '@sim/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { WorkspaceInvitationEmail } from '@/components/emails/workspace-invitation'
import { getSession } from '@/lib/auth'
import { sendEmail } from '@/lib/email/mailer'
import { getFromEmailAddress } from '@/lib/email/utils'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkspaceInvitationsAPI')

type PermissionType = (typeof permissionTypeEnum.enumValues)[number]

// Get all invitations for the user's workspaces
export async function GET(req: NextRequest) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Get all workspaces where the user has permissions
    const userWorkspaces = await db
      .select({ id: workspace.id })
      .from(workspace)
      .innerJoin(
        permissions,
        and(
          eq(permissions.entityId, workspace.id),
          eq(permissions.entityType, 'workspace'),
          eq(permissions.userId, session.user.id)
        )
      )

    if (userWorkspaces.length === 0) {
      return NextResponse.json({ invitations: [] })
    }

    // Get all workspaceIds where the user is a member
    const workspaceIds = userWorkspaces.map((w) => w.id)

    // Find all invitations for those workspaces
    const invitations = await db
      .select()
      .from(workspaceInvitation)
      .where(inArray(workspaceInvitation.workspaceId, workspaceIds))

    return NextResponse.json({ invitations })
  } catch (error) {
    logger.error('Error fetching workspace invitations:', error)
    return NextResponse.json({ error: 'Failed to fetch invitations' }, { status: 500 })
  }
}

// Create a new invitation
export async function POST(req: NextRequest) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { workspaceId, email, role = 'member', permission = 'read' } = await req.json()

    if (!workspaceId || !email) {
      return NextResponse.json({ error: 'Workspace ID and email are required' }, { status: 400 })
    }

    // Validate permission type
    const validPermissions: PermissionType[] = ['admin', 'write', 'read']
    if (!validPermissions.includes(permission)) {
      return NextResponse.json(
        { error: `Invalid permission: must be one of ${validPermissions.join(', ')}` },
        { status: 400 }
      )
    }

    // Check if user has admin permissions for this workspace
    const userPermission = await db
      .select()
      .from(permissions)
      .where(
        and(
          eq(permissions.entityId, workspaceId),
          eq(permissions.entityType, 'workspace'),
          eq(permissions.userId, session.user.id),
          eq(permissions.permissionType, 'admin')
        )
      )
      .then((rows) => rows[0])

    if (!userPermission) {
      return NextResponse.json(
        { error: 'You need admin permissions to invite users' },
        { status: 403 }
      )
    }

    // Get the workspace details for the email
    const workspaceDetails = await db
      .select()
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .then((rows) => rows[0])

    if (!workspaceDetails) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    // Check if the user is already a member
    // First find if a user with this email exists
    const existingUser = await db
      .select()
      .from(user)
      .where(eq(user.email, email))
      .then((rows) => rows[0])

    if (existingUser) {
      // Check if the user already has permissions for this workspace
      const existingPermission = await db
        .select()
        .from(permissions)
        .where(
          and(
            eq(permissions.entityId, workspaceId),
            eq(permissions.entityType, 'workspace'),
            eq(permissions.userId, existingUser.id)
          )
        )
        .then((rows) => rows[0])

      if (existingPermission) {
        return NextResponse.json(
          {
            error: `${email} already has access to this workspace`,
            email,
          },
          { status: 400 }
        )
      }
    }

    // Check if there's already a pending invitation
    const existingInvitation = await db
      .select()
      .from(workspaceInvitation)
      .where(
        and(
          eq(workspaceInvitation.workspaceId, workspaceId),
          eq(workspaceInvitation.email, email),
          eq(workspaceInvitation.status, 'pending' as WorkspaceInvitationStatus)
        )
      )
      .then((rows) => rows[0])

    if (existingInvitation) {
      return NextResponse.json(
        {
          error: `${email} has already been invited to this workspace`,
          email,
        },
        { status: 400 }
      )
    }

    // Generate a unique token and set expiry date (1 week from now)
    const token = randomUUID()
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7) // 7 days expiry

    // Create the invitation
    const invitationData = {
      id: randomUUID(),
      workspaceId,
      email,
      inviterId: session.user.id,
      role,
      status: 'pending' as WorkspaceInvitationStatus,
      token,
      permissions: permission,
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    // Create invitation
    await db.insert(workspaceInvitation).values(invitationData)

    // Send the invitation email
    await sendInvitationEmail({
      to: email,
      inviterName: session.user.name || session.user.email || 'A user',
      workspaceName: workspaceDetails.name,
      invitationId: invitationData.id,
      token: token,
    })

    return NextResponse.json({ success: true, invitation: invitationData })
  } catch (error) {
    logger.error('Error creating workspace invitation:', error)
    return NextResponse.json({ error: 'Failed to create invitation' }, { status: 500 })
  }
}

// Helper function to send invitation email using the Resend API
async function sendInvitationEmail({
  to,
  inviterName,
  workspaceName,
  invitationId,
  token,
}: {
  to: string
  inviterName: string
  workspaceName: string
  invitationId: string
  token: string
}) {
  try {
    const baseUrl = env.NEXT_PUBLIC_APP_URL || 'https://sim.ai'
    // Use invitation ID in path, token in query parameter for security
    const invitationLink = `${baseUrl}/invite/${invitationId}?token=${token}`

    const emailHtml = await render(
      WorkspaceInvitationEmail({
        workspaceName,
        inviterName,
        invitationLink,
      })
    )

    const fromAddress = getFromEmailAddress()

    logger.info(`Attempting to send email from ${fromAddress} to ${to}`)

    const result = await sendEmail({
      to,
      subject: `You've been invited to join "${workspaceName}" on Sim`,
      html: emailHtml,
      from: fromAddress,
      emailType: 'transactional',
    })

    if (result.success) {
      logger.info(`Invitation email sent successfully to ${to}`, { result })
    } else {
      logger.error(`Failed to send invitation email to ${to}`, { error: result.message })
    }
  } catch (error) {
    logger.error('Error sending invitation email:', error)
    // Continue even if email fails - the invitation is still created
  }
}
