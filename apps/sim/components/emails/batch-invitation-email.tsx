import {
  Body,
  Column,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from '@react-email/components'
import { getBrandConfig } from '@/lib/branding/branding'
import { env } from '@/lib/env'
import { baseStyles } from './base-styles'
import EmailFooter from './footer'

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

const baseUrl = env.NEXT_PUBLIC_APP_URL || 'https://sim.ai'

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
  const hasWorkspaces = workspaceInvitations.length > 0

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>
          You've been invited to join {organizationName}
          {hasWorkspaces ? ` and ${workspaceInvitations.length} workspace(s)` : ''}
        </Preview>
        <Container style={baseStyles.container}>
          <Section style={{ padding: '30px 0', textAlign: 'center' }}>
            <Row>
              <Column style={{ textAlign: 'center' }}>
                <Img
                  src={brand.logoUrl || '/logo/reverse/text/medium.png'}
                  width='114'
                  alt={brand.name}
                  style={{
                    margin: '0 auto',
                  }}
                />
              </Column>
            </Row>
          </Section>

          <Section style={baseStyles.sectionsBorders}>
            <Row>
              <Column style={baseStyles.sectionBorder} />
              <Column style={baseStyles.sectionCenter} />
              <Column style={baseStyles.sectionBorder} />
            </Row>
          </Section>

          <Section style={baseStyles.content}>
            <Text style={baseStyles.paragraph}>Hello,</Text>
            <Text style={baseStyles.paragraph}>
              <strong>{inviterName}</strong> has invited you to join{' '}
              <strong>{organizationName}</strong> on Sim.
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

            <Text style={baseStyles.paragraph}>
              By accepting this invitation, you'll join {organizationName}
              {hasWorkspaces
                ? ` and gain access to ${workspaceInvitations.length} workspace(s)`
                : ''}
              .
            </Text>

            <Text style={baseStyles.paragraph}>
              This invitation will expire in 7 days. If you didn't expect this invitation, you can
              safely ignore this email.
            </Text>

            <Text style={baseStyles.paragraph}>
              Best regards,
              <br />
              The Sim Team
            </Text>
          </Section>
        </Container>

        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default BatchInvitationEmail
