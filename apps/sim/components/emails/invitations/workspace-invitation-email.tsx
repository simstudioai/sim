import { Link, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailLayout } from '@/components/emails/components'
import { getBrandConfig } from '@/ee/whitelabeling'

interface WorkspaceInvitationEmailProps {
  /** One workspace name, or several when a single invitation grants access to multiple workspaces. */
  workspaceName?: string | string[]
  inviterName?: string
  invitationLink?: string
}

export function WorkspaceInvitationEmail({
  workspaceName = 'Workspace',
  inviterName = 'Someone',
  invitationLink = '',
}: WorkspaceInvitationEmailProps) {
  const brand = getBrandConfig()
  const workspaceNames = Array.isArray(workspaceName) ? workspaceName : [workspaceName]
  const isMultiple = workspaceNames.length > 1
  const preview = isMultiple
    ? `You've been invited to join ${workspaceNames.length} workspaces on ${brand.name}!`
    : `You've been invited to join the "${workspaceNames[0]}" workspace on ${brand.name}!`

  return (
    <EmailLayout preview={preview} showUnsubscribe={false}>
      <Text style={baseStyles.paragraph}>Hello,</Text>
      <Text style={baseStyles.paragraph}>
        <strong>{inviterName}</strong> invited you to join the{' '}
        {workspaceNames.map((name, index) => (
          <span key={`${name}-${index}`}>
            {index > 0 &&
              (index === workspaceNames.length - 1
                ? workspaceNames.length > 2
                  ? ', and '
                  : ' and '
                : ', ')}
            <strong>{name}</strong>
          </span>
        ))}{' '}
        {isMultiple ? 'workspaces' : 'workspace'} on {brand.name}.
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
