import { NextRequest, NextResponse } from 'next/server'
import { render } from '@react-email/render'
import { randomUUID } from 'crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { Resend } from 'resend'
import { WorkspaceInvitationEmail } from '@/components/emails/workspace-invitation'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { user, workspace, workspaceInvitation, workspaceMember } from '@/db/schema'

// Initialize Resend for email sending
const resend = new Resend(process.env.RESEND_API_KEY)

// GET /api/workspaces/invitations - Get all invitations for the user's workspaces
export async function GET(req: NextRequest) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // First get all workspaces where the user is a member with owner role
    const userWorkspaces = await db
      .select({ id: workspace.id })
      .from(workspace)
      .innerJoin(
        workspaceMember,
        and(
          eq(workspaceMember.workspaceId, workspace.id),
          eq(workspaceMember.userId, session.user.id),
          eq(workspaceMember.role, 'owner')
        )
      )

    if (userWorkspaces.length === 0) {
      return NextResponse.json({ invitations: [] })
    }

    // Get all workspaceIds where the user is an owner
    const workspaceIds = userWorkspaces.map((w) => w.id)

    // Find all invitations for those workspaces
    const invitations = await db
      .select()
      .from(workspaceInvitation)
      .where(inArray(workspaceInvitation.workspaceId, workspaceIds))

    return NextResponse.json({ invitations })
  } catch (error) {
    console.error('Error fetching workspace invitations:', error)
    return NextResponse.json({ error: 'Failed to fetch invitations' }, { status: 500 })
  }
}

// POST /api/workspaces/invitations - Create a new invitation
export async function POST(req: NextRequest) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { workspaceId, email, role = 'member' } = await req.json()

    if (!workspaceId || !email) {
      return NextResponse.json({ error: 'Workspace ID and email are required' }, { status: 400 })
    }

    // Check if user is authorized to invite to this workspace (must be owner)
    const membership = await db
      .select()
      .from(workspaceMember)
      .where(
        and(
          eq(workspaceMember.workspaceId, workspaceId),
          eq(workspaceMember.userId, session.user.id)
        )
      )
      .then((rows) => rows[0])

    if (!membership || membership.role !== 'owner') {
      return NextResponse.json(
        { error: 'You are not authorized to invite to this workspace' },
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
      // Check if the user is already a member of this workspace
      const existingMembership = await db
        .select()
        .from(workspaceMember)
        .where(
          and(
            eq(workspaceMember.workspaceId, workspaceId),
            eq(workspaceMember.userId, existingUser.id)
          )
        )
        .then((rows) => rows[0])

      if (existingMembership) {
        return NextResponse.json(
          {
            error: `${email} is already a member of this workspace`,
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
          eq(workspaceInvitation.status, 'pending')
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
    const invitation = await db
      .insert(workspaceInvitation)
      .values({
        id: randomUUID(),
        workspaceId,
        email,
        inviterId: session.user.id,
        role,
        status: 'pending',
        token,
        expiresAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
      .then((rows) => rows[0])

    // Send the invitation email
    await sendInvitationEmail({
      to: email,
      inviterName: session.user.name || session.user.email || 'A user',
      workspaceName: workspaceDetails.name,
      token: token,
    })

    return NextResponse.json({ success: true, invitation })
  } catch (error) {
    console.error('Error creating workspace invitation:', error)
    return NextResponse.json({ error: 'Failed to create invitation' }, { status: 500 })
  }
}

// Helper function to send invitation email using the Resend API
async function sendInvitationEmail({
  to,
  inviterName,
  workspaceName,
  token,
}: {
  to: string
  inviterName: string
  workspaceName: string
  token: string
}) {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://simstudio.ai'
    // Always use the client-side invite route with token parameter
    const invitationLink = `${baseUrl}/invite/${token}?token=${token}`

    const emailHtml = await render(
      WorkspaceInvitationEmail({
        workspaceName,
        inviterName,
        invitationLink,
      })
    )

    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'noreply@simstudio.ai',
      to,
      subject: `You've been invited to join "${workspaceName}" on Sim Studio`,
      html: emailHtml,
    })

    console.log(`Invitation email sent to ${to}`)
  } catch (error) {
    console.error('Error sending invitation email:', error)
    // Continue even if email fails - the invitation is still created
  }
}
