import { db } from '@sim/db'
import { credentialSet, credentialSetInvitation, member, organization, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getEmailSubject, renderPollingGroupInvitationEmail } from '@/components/emails'
import { getSession } from '@/lib/auth'
import { hasCredentialSetsAccess } from '@/lib/billing'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { sendEmail } from '@/lib/messaging/email/mailer'

const logger = createLogger('CredentialSetInvite')

const createInviteSchema = z.object({
  email: z.string().email().optional(),
})

async function getCredentialSetWithAccess(credentialSetId: string, userId: string) {
  const [set] = await db
    .select({
      id: credentialSet.id,
      organizationId: credentialSet.organizationId,
      name: credentialSet.name,
      providerId: credentialSet.providerId,
    })
    .from(credentialSet)
    .where(eq(credentialSet.id, credentialSetId))
    .limit(1)

  if (!set) return null

  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, set.organizationId)))
    .limit(1)

  if (!membership) return null

  return { set, role: membership.role }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check plan access (team/enterprise) or env var override
  const hasAccess = await hasCredentialSetsAccess(session.user.id)
  if (!hasAccess) {
    return NextResponse.json(
      { error: 'Credential sets require a Team or Enterprise plan' },
      { status: 403 }
    )
  }

  const { id } = await params
  const result = await getCredentialSetWithAccess(id, session.user.id)

  if (!result) {
    return NextResponse.json({ error: 'Credential set not found' }, { status: 404 })
  }

  const invitations = await db
    .select()
    .from(credentialSetInvitation)
    .where(eq(credentialSetInvitation.credentialSetId, id))

  return NextResponse.json({ invitations })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check plan access (team/enterprise) or env var override
  const hasAccess = await hasCredentialSetsAccess(session.user.id)
  if (!hasAccess) {
    return NextResponse.json(
      { error: 'Credential sets require a Team or Enterprise plan' },
      { status: 403 }
    )
  }

  const { id } = await params

  try {
    const result = await getCredentialSetWithAccess(id, session.user.id)

    if (!result) {
      return NextResponse.json({ error: 'Credential set not found' }, { status: 404 })
    }

    if (result.role !== 'admin' && result.role !== 'owner') {
      return NextResponse.json({ error: 'Admin or owner permissions required' }, { status: 403 })
    }

    const body = await req.json()
    const { email } = createInviteSchema.parse(body)

    const token = crypto.randomUUID()
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)

    const invitation = {
      id: crypto.randomUUID(),
      credentialSetId: id,
      email: email || null,
      token,
      invitedBy: session.user.id,
      status: 'pending' as const,
      expiresAt,
      createdAt: new Date(),
    }

    await db.insert(credentialSetInvitation).values(invitation)

    const inviteUrl = `${getBaseUrl()}/credential-account/${token}`

    // Send email if email address was provided
    if (email) {
      try {
        // Get inviter name
        const [inviter] = await db
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, session.user.id))
          .limit(1)

        // Get organization name
        const [org] = await db
          .select({ name: organization.name })
          .from(organization)
          .where(eq(organization.id, result.set.organizationId))
          .limit(1)

        const provider = (result.set.providerId as 'google-email' | 'outlook') || 'google-email'
        const emailHtml = await renderPollingGroupInvitationEmail({
          inviterName: inviter?.name || 'A team member',
          organizationName: org?.name || 'your organization',
          pollingGroupName: result.set.name,
          provider,
          inviteLink: inviteUrl,
        })

        const emailResult = await sendEmail({
          to: email,
          subject: getEmailSubject('polling-group-invitation'),
          html: emailHtml,
          emailType: 'transactional',
        })

        if (!emailResult.success) {
          logger.warn('Failed to send invitation email', {
            email,
            error: emailResult.message,
          })
        }
      } catch (emailError) {
        logger.error('Error sending invitation email', emailError)
        // Don't fail the invitation creation if email fails
      }
    }

    logger.info('Created credential set invitation', {
      credentialSetId: id,
      invitationId: invitation.id,
      userId: session.user.id,
      emailSent: !!email,
    })

    return NextResponse.json({
      invitation: {
        ...invitation,
        inviteUrl,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    logger.error('Error creating invitation', error)
    return NextResponse.json({ error: 'Failed to create invitation' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check plan access (team/enterprise) or env var override
  const hasAccess = await hasCredentialSetsAccess(session.user.id)
  if (!hasAccess) {
    return NextResponse.json(
      { error: 'Credential sets require a Team or Enterprise plan' },
      { status: 403 }
    )
  }

  const { id } = await params
  const { searchParams } = new URL(req.url)
  const invitationId = searchParams.get('invitationId')

  if (!invitationId) {
    return NextResponse.json({ error: 'invitationId is required' }, { status: 400 })
  }

  try {
    const result = await getCredentialSetWithAccess(id, session.user.id)

    if (!result) {
      return NextResponse.json({ error: 'Credential set not found' }, { status: 404 })
    }

    if (result.role !== 'admin' && result.role !== 'owner') {
      return NextResponse.json({ error: 'Admin or owner permissions required' }, { status: 403 })
    }

    await db
      .update(credentialSetInvitation)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(credentialSetInvitation.id, invitationId),
          eq(credentialSetInvitation.credentialSetId, id)
        )
      )

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error cancelling invitation', error)
    return NextResponse.json({ error: 'Failed to cancel invitation' }, { status: 500 })
  }
}
