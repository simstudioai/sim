import { Link, Text } from '@react-email/components'
import { createLogger } from '@sim/logger'
import { baseStyles } from '@/components/emails/_styles'
import { EmailLayout } from '@/components/emails/components'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getBrandConfig } from '@/ee/whitelabeling'

interface InvitationEmailProps {
  inviterName?: string
  organizationName?: string
  inviteLink?: string
}

const logger = createLogger('InvitationEmail')

export function InvitationEmail({
  inviterName = 'A team member',
  organizationName = 'an organization',
  inviteLink = '',
}: InvitationEmailProps) {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()

  let enhancedLink = inviteLink

  if (inviteLink && !inviteLink.includes('token=')) {
    try {
      const url = new URL(inviteLink)
      const invitationId = url.pathname.split('/').pop()
      if (invitationId) {
        enhancedLink = `${baseUrl}/invite/${invitationId}?token=${invitationId}`
      }
    } catch (e) {
      logger.error('Error parsing invite link:', e)
    }
  }

  return (
    <EmailLayout
      preview={`You've been invited to join ${organizationName} on ${brand.name}`}
      showUnsubscribe={false}
    >
      <Text style={baseStyles.paragraph}>Hello,</Text>
      <Text style={baseStyles.paragraph}>
        <strong>{inviterName}</strong> invited you to join <strong>{organizationName}</strong> on{' '}
        {brand.name}.
      </Text>

      <Link href={enhancedLink} style={{ textDecoration: 'none' }}>
        <Text style={baseStyles.button}>Accept Invitation</Text>
      </Link>

      {/* Divider */}
      <div style={baseStyles.divider} />

      <Text style={{ ...baseStyles.footerText, textAlign: 'left' }}>
        Invitation expires in 48 hours. If unexpected, you can ignore this email.
      </Text>
    </EmailLayout>
  )
}

export default InvitationEmail
