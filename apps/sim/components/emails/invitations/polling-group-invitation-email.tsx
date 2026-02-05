import { Link, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailLayout } from '@/components/emails/components'
import { getBrandConfig } from '@/ee/whitelabeling'

interface PollingGroupInvitationEmailProps {
  inviterName?: string
  organizationName?: string
  pollingGroupName?: string
  provider?: 'google-email' | 'outlook'
  inviteLink?: string
}

export function PollingGroupInvitationEmail({
  inviterName = 'A team member',
  organizationName = 'an organization',
  pollingGroupName = 'a polling group',
  provider = 'google-email',
  inviteLink = '',
}: PollingGroupInvitationEmailProps) {
  const brand = getBrandConfig()
  const providerName = provider === 'google-email' ? 'Gmail' : 'Outlook'

  return (
    <EmailLayout
      preview={`You've been invited to join ${pollingGroupName} on ${brand.name}`}
      showUnsubscribe={false}
    >
      <Text style={baseStyles.paragraph}>Hello,</Text>
      <Text style={baseStyles.paragraph}>
        <strong>{inviterName}</strong> from <strong>{organizationName}</strong> has invited you to
        join the polling group <strong>{pollingGroupName}</strong> on {brand.name}.
      </Text>

      <Text style={baseStyles.paragraph}>
        By accepting this invitation, your {providerName} account will be connected to enable email
        polling for automated workflows.
      </Text>

      <Link href={inviteLink} style={{ textDecoration: 'none' }}>
        <Text style={baseStyles.button}>Accept Invitation</Text>
      </Link>

      {/* Divider */}
      <div style={baseStyles.divider} />

      <Text style={{ ...baseStyles.footerText, textAlign: 'left' }}>
        This invitation expires in 7 days. If you weren't expecting this email, you can safely
        ignore it.
      </Text>
    </EmailLayout>
  )
}

export default PollingGroupInvitationEmail
