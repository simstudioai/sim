import { Link, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailLayout } from '@/components/emails/components'
import { getBrandConfig } from '@/ee/whitelabeling'

interface WorkspaceInvitationEmailProps {
  workspaceName?: string
  inviterName?: string
  invitationLink?: string
}

export function WorkspaceInvitationEmail({
  workspaceName = 'Workspace',
  inviterName = 'Someone',
  invitationLink = '',
}: WorkspaceInvitationEmailProps) {
  const brand = getBrandConfig()

  return (
    <EmailLayout
      preview={`You've been invited to join the "${workspaceName}" workspace on ${brand.name}!`}
      showUnsubscribe={false}
    >
      <Text style={baseStyles.paragraph}>Hello,</Text>
      <Text style={baseStyles.paragraph}>
        <strong>{inviterName}</strong> invited you to join the <strong>{workspaceName}</strong>{' '}
        workspace on {brand.name}.
      </Text>

      <Link href={invitationLink} style={{ textDecoration: 'none' }}>
        <Text style={baseStyles.button}>Accept Invitation</Text>
      </Link>

      <div style={baseStyles.divider} />

      <Text style={{ ...baseStyles.footerText, textAlign: 'left' }}>
        Invitation expires in 7 days. If unexpected, you can ignore this email.
      </Text>
    </EmailLayout>
  )
}

export default WorkspaceInvitationEmail
