import { Link, Text } from '@react-email/components'
import { createLogger } from '@sim/logger'
import { baseStyles } from '@/components/emails/_styles'
import { EmailLayout } from '@/components/emails/components'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getBrandConfig } from '@/ee/whitelabeling'

const logger = createLogger('WorkspaceInvitationEmail')

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
  const baseUrl = getBaseUrl()

  let enhancedLink = invitationLink

  try {
    if (
      invitationLink.includes('/api/workspaces/invitations/accept') ||
      invitationLink.match(/\/api\/workspaces\/invitations\/[^?]+\?token=/)
    ) {
      const url = new URL(invitationLink)
      const token = url.searchParams.get('token')
      if (token) {
        enhancedLink = `${baseUrl}/invite/${token}?token=${token}`
      }
    }
  } catch (e) {
    logger.error('Error enhancing invitation link:', e)
  }

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

      <Link href={enhancedLink} style={{ textDecoration: 'none' }}>
        <Text style={baseStyles.button}>Accept Invitation</Text>
      </Link>

      {/* Divider */}
      <div style={baseStyles.divider} />

      <Text style={{ ...baseStyles.footerText, textAlign: 'left' }}>
        Invitation expires in 7 days. If unexpected, you can ignore this email.
      </Text>
    </EmailLayout>
  )
}

export default WorkspaceInvitationEmail
