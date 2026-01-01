import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import { baseStyles } from '@/components/emails/base-styles'
import EmailFooter from '@/components/emails/footer'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/core/utils/urls'

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

export const BatchInvitationEmail = ({
  inviterName = 'Someone',
  organizationName = 'the team',
  organizationRole = 'member',
  workspaceInvitations = [],
  acceptUrl,
}: BatchInvitationEmailProps) => {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()
  const hasWorkspaces = workspaceInvitations.length > 0

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>
          You've been invited to join {organizationName}
          {hasWorkspaces ? ` and ${workspaceInvitations.length} workspace(s)` : ''}
        </Preview>

        {/* Main card container */}
        <Container style={baseStyles.container}>
          {/* Header with logo */}
          <Section style={baseStyles.header}>
            <Img
              src={brand.logoUrl || `${baseUrl}/brand/color/email/type.png`}
              width='70'
              alt={brand.name}
              style={{ display: 'block' }}
            />
          </Section>

          {/* Content */}
          <Section style={baseStyles.content}>
            <Text style={baseStyles.paragraph}>Hello,</Text>
            <Text style={baseStyles.paragraph}>
              <strong>{inviterName}</strong> has invited you to join{' '}
              <strong>{organizationName}</strong> on {brand.name}.
            </Text>

            {/* Team Role Information */}
            <Text style={baseStyles.paragraph}>
              <strong>Team Role:</strong> {getRoleLabel(organizationRole)}
            </Text>
            <Text style={baseStyles.paragraph}>
              {organizationRole === 'admin'
                ? "As a Team Admin, you'll be able to manage team members, billing, and workspace access."
                : "As a Team Member, you'll have access to shared team billing and can be invited to workspaces."}
            </Text>

            {/* Workspace Invitations */}
            {hasWorkspaces && (
              <>
                <Text style={baseStyles.paragraph}>
                  <strong>
                    Workspace Access ({workspaceInvitations.length} workspace
                    {workspaceInvitations.length !== 1 ? 's' : ''}):
                  </strong>
                </Text>
                {workspaceInvitations.map((ws) => (
                  <Text
                    key={ws.workspaceId}
                    style={{ ...baseStyles.paragraph, marginLeft: '20px' }}
                  >
                    • <strong>{ws.workspaceName}</strong> - {getPermissionLabel(ws.permission)}
                  </Text>
                ))}
              </>
            )}

            <Link href={acceptUrl} style={{ textDecoration: 'none' }}>
              <Text style={baseStyles.button}>Accept Invitation</Text>
            </Link>

            {/* Divider */}
            <div style={baseStyles.divider} />

            <Text style={{ ...baseStyles.footerText, textAlign: 'left' }}>
              Invitation expires in 7 days. If unexpected, you can ignore this email.
            </Text>
          </Section>
        </Container>

        {/* Footer in gray section */}
        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default BatchInvitationEmail
