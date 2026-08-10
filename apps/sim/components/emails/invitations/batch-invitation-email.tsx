import { Fragment } from 'react'
import { Section, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailButton, EmailLayout, EmailStrong } from '@/components/emails/components'
import { getBrandConfig } from '@/ee/whitelabeling'

interface WorkspaceInvitation {
  workspaceId: string
  workspaceName: string
  permission: 'admin' | 'write' | 'read'
}

interface BatchInvitationEmailProps {
  inviterName: string
  organizationName: string
  organizationRole: 'admin' | 'member'
  workspaceInvitations: WorkspaceInvitation[]
  acceptUrl: string
}

const getPermissionLabel = (permission: string) => {
  switch (permission) {
    case 'admin':
      return 'Admin (full access)'
    case 'write':
      return 'Editor (can edit workflows)'
    case 'read':
      return 'Viewer (read-only access)'
    default:
      return permission
  }
}

const getRoleLabel = (role: string) => {
  switch (role) {
    case 'admin':
      return 'Admin'
    case 'member':
      return 'Member'
    default:
      return role
  }
}

const EMPTY_INVITATIONS: WorkspaceInvitation[] = []

export function BatchInvitationEmail({
  inviterName = 'Someone',
  organizationName = 'the team',
  organizationRole = 'member',
  workspaceInvitations = EMPTY_INVITATIONS,
  acceptUrl,
}: BatchInvitationEmailProps) {
  const brand = getBrandConfig()
  const hasWorkspaces = workspaceInvitations.length > 0

  return (
    <EmailLayout
      preview={`You've been invited to join ${organizationName}${hasWorkspaces ? ` and ${workspaceInvitations.length} workspace(s)` : ''}`}
      showUnsubscribe={false}
    >
      <Text style={baseStyles.greeting}>Hello,</Text>
      <Text style={baseStyles.paragraph}>
        <EmailStrong>{inviterName}</EmailStrong> has invited you to join{' '}
        <EmailStrong>{organizationName}</EmailStrong> on {brand.name}.
      </Text>

      <Section style={baseStyles.infoBox}>
        <Text style={baseStyles.infoBoxTitle}>Team role</Text>
        <Text style={baseStyles.infoBoxList}>
          {getRoleLabel(organizationRole)} —{' '}
          {organizationRole === 'admin'
            ? 'you can manage team members, billing, and workspace access.'
            : 'you have access to shared team billing and can be invited to workspaces.'}
        </Text>
      </Section>

      {hasWorkspaces && (
        <Section style={baseStyles.infoBox}>
          <Text style={baseStyles.infoBoxTitle}>
            Workspace access ({workspaceInvitations.length} workspace
            {workspaceInvitations.length !== 1 ? 's' : ''})
          </Text>
          <Text style={baseStyles.infoBoxList}>
            {workspaceInvitations.map((ws, index) => (
              <Fragment key={ws.workspaceId}>
                {index > 0 && <br />}
                {ws.workspaceName} — {getPermissionLabel(ws.permission)}
              </Fragment>
            ))}
          </Text>
        </Section>
      )}

      <EmailButton href={acceptUrl}>Accept Invitation</EmailButton>

      <div style={baseStyles.divider} />

      <Text style={baseStyles.footnote}>
        Invitation expires in 7 days. If unexpected, you can ignore this email.
      </Text>
    </EmailLayout>
  )
}

export default BatchInvitationEmail
