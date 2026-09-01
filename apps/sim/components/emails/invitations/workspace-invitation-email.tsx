import { Text } from 'react-email'
import { baseStyles } from '@/components/emails/_styles'
import { EmailButton, EmailLayout, EmailStrong } from '@/components/emails/components'
import { getBrandConfig } from '@/ee/whitelabeling'

interface WorkspaceInvitationEmailProps {
  /** Workspaces this invitation grants access to (one entry per workspace). */
  workspaceNames?: string[]
  inviterName?: string
  invitationLink?: string
}

export function WorkspaceInvitationEmail({
  workspaceNames = ['Workspace'],
  inviterName = 'Someone',
  invitationLink = '',
}: WorkspaceInvitationEmailProps) {
  const brand = getBrandConfig()
  const isMultiple = workspaceNames.length > 1
  const preview = isMultiple
    ? `You've been invited to join ${workspaceNames.length} workspaces on ${brand.name}!`
    : `You've been invited to join the "${workspaceNames[0]}" workspace on ${brand.name}!`

  return (
    <EmailLayout preview={preview} showUnsubscribe={false}>
      <Text style={baseStyles.greeting}>Hello,</Text>
      <Text style={baseStyles.paragraph}>
        <EmailStrong>{inviterName}</EmailStrong> invited you to join the{' '}
        {workspaceNames.map((name, index) => (
          <span key={`${name}-${index}`}>
            {index > 0 &&
              (index === workspaceNames.length - 1
                ? workspaceNames.length > 2
                  ? ', and '
                  : ' and '
                : ', ')}
            <EmailStrong>{name}</EmailStrong>
          </span>
        ))}{' '}
        {isMultiple ? 'workspaces' : 'workspace'} on {brand.name}.
      </Text>

      <EmailButton href={invitationLink}>Accept Invitation</EmailButton>

      <div style={baseStyles.divider} />

      <Text style={baseStyles.footnote}>
        Invitation expires in 7 days. If unexpected, you can ignore this email.
      </Text>
    </EmailLayout>
  )
}

export default WorkspaceInvitationEmail
