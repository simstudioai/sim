import { db } from '@sim/db'
import { credentialSet, credentialSetInvitation, member, organization, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getEmailSubject, renderPollingGroupInvitationEmail } from '@/components/emails'
import { getSession } from '@/lib/auth'
import { hasCredentialSetsAccess } from '@/lib/billing'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { sendEmail } from '@/lib/messaging/email/mailer'

const logger = createLogger('CredentialSetInviteResend')

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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; invitationId: string }> }
) {
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

  const { id, invitationId } = await params

  try {
    const result = await getCredentialSetWithAccess(id, session.user.id)

    if (!result) {
      return NextResponse.json({ error: 'Credential set not found' }, { status: 404 })
    }

    if (result.role !== 'admin' && result.role !== 'owner') {
      return NextResponse.json({ error: 'Admin or owner permissions required' }, { status: 403 })
    }

    const [invitation] = await db
      .select()
      .from(credentialSetInvitation)
      .where(
        and(
          eq(credentialSetInvitation.id, invitationId),
          eq(credentialSetInvitation.credentialSetId, id)
        )
      )
      .limit(1)

    if (!invitation) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
    }

    if (invitation.status !== 'pending') {
      return NextResponse.json({ error: 'Only pending invitations can be resent' }, { status: 400 })
    }

    // Update expiration
    const newExpiresAt = new Date()
    newExpiresAt.setDate(newExpiresAt.getDate() + 7)

    await db
      .update(credentialSetInvitation)
      .set({ expiresAt: newExpiresAt })
      .where(eq(credentialSetInvitation.id, invitationId))

    const inviteUrl = `${getBaseUrl()}/credential-account/${invitation.token}`

    // Send email if email address exists
    if (invitation.email) {
      try {
        const [inviter] = await db
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, session.user.id))
          .limit(1)

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
          to: invitation.email,
          subject: getEmailSubject('polling-group-invitation'),
          html: emailHtml,
          emailType: 'transactional',
        })

        if (!emailResult.success) {
          logger.warn('Failed to resend invitation email', {
            email: invitation.email,
            error: emailResult.message,
          })
          return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
        }
      } catch (emailError) {
        logger.error('Error sending invitation email', emailError)
        return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
      }
    }

    logger.info('Resent credential set invitation', {
      credentialSetId: id,
      invitationId,
      userId: session.user.id,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error resending invitation', error)
    return NextResponse.json({ error: 'Failed to resend invitation' }, { status: 500 })
  }
}
