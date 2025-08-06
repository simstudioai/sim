import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import { getBrandConfig } from '@/lib/branding/branding'

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
      return 'Team Admin (can manage team and billing)'
    case 'member':
      return 'Team Member (billing access only)'
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
      <Preview>
        You've been invited to join {organizationName}
        {hasWorkspaces ? ` and ${workspaceInvitations.length} workspace(s)` : ''}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={logoContainer}>
            <Img
              src={brand.logoUrl || 'https://sim.ai/logo.png'}
              width='120'
              height='36'
              alt={brand.name}
              style={logo}
            />
          </Section>

          <Heading style={h1}>You're invited to join {organizationName}!</Heading>

          <Text style={text}>
            <strong>{inviterName}</strong> has invited you to join{' '}
            <strong>{organizationName}</strong> on Sim.
          </Text>

          {/* Organization Invitation Details */}
          <Section style={invitationSection}>
            <Heading style={h2}>Team Access</Heading>
            <div style={roleCard}>
              <Text style={roleTitle}>Team Role: {getRoleLabel(organizationRole)}</Text>
              <Text style={roleDescription}>
                {organizationRole === 'admin'
                  ? "You'll be able to manage team members, billing, and workspace access."
                  : "You'll have access to shared team billing and can be invited to workspaces."}
              </Text>
            </div>
          </Section>

          {/* Workspace Invitations */}
          {hasWorkspaces && (
            <Section style={invitationSection}>
              <Heading style={h2}>
                Workspace Access ({workspaceInvitations.length} workspace
                {workspaceInvitations.length !== 1 ? 's' : ''})
              </Heading>
              <Text style={text}>You're also being invited to the following workspaces:</Text>

              {workspaceInvitations.map((ws, index) => (
                <div key={ws.workspaceId} style={workspaceCard}>
                  <Text style={workspaceName}>{ws.workspaceName}</Text>
                  <Text style={workspacePermission}>{getPermissionLabel(ws.permission)}</Text>
                </div>
              ))}
            </Section>
          )}

          <Section style={buttonContainer}>
            <Button style={button} href={acceptUrl}>
              Accept Invitation
            </Button>
          </Section>

          <Text style={text}>
            By accepting this invitation, you'll join {organizationName}
            {hasWorkspaces ? ` and gain access to ${workspaceInvitations.length} workspace(s)` : ''}
            .
          </Text>

          <Hr style={hr} />

          <Text style={footer}>
            If you have any questions, you can reach out to {inviterName} directly or contact our
            support team.
          </Text>

          <Text style={footer}>
            This invitation will expire in 7 days. If you didn't expect this invitation, you can
            safely ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export default BatchInvitationEmail

// Styles
const main = {
  backgroundColor: '#f6f9fc',
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
}

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '20px 0 48px',
  marginBottom: '64px',
}

const logoContainer = {
  margin: '32px 0',
  textAlign: 'center' as const,
}

const logo = {
  margin: '0 auto',
}

const h1 = {
  color: '#333',
  fontSize: '24px',
  fontWeight: 'bold',
  margin: '40px 0',
  padding: '0',
  textAlign: 'center' as const,
}

const h2 = {
  color: '#333',
  fontSize: '18px',
  fontWeight: 'bold',
  margin: '24px 0 16px 0',
  padding: '0',
}

const text = {
  color: '#333',
  fontSize: '16px',
  lineHeight: '26px',
  margin: '16px 0',
  padding: '0 40px',
}

const invitationSection = {
  margin: '32px 0',
  padding: '0 40px',
}

const roleCard = {
  backgroundColor: '#f8f9fa',
  border: '1px solid #e9ecef',
  borderRadius: '8px',
  padding: '16px',
  margin: '16px 0',
}

const roleTitle = {
  color: '#333',
  fontSize: '16px',
  fontWeight: 'bold',
  margin: '0 0 8px 0',
}

const roleDescription = {
  color: '#6c757d',
  fontSize: '14px',
  lineHeight: '20px',
  margin: '0',
}

const workspaceCard = {
  backgroundColor: '#f8f9fa',
  border: '1px solid #e9ecef',
  borderRadius: '6px',
  padding: '12px 16px',
  margin: '8px 0',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
}

const workspaceName = {
  color: '#333',
  fontSize: '15px',
  fontWeight: '500',
  margin: '0',
}

const workspacePermission = {
  color: '#6c757d',
  fontSize: '13px',
  margin: '0',
}

const buttonContainer = {
  margin: '32px 0',
  textAlign: 'center' as const,
}

const button = {
  backgroundColor: '#007bff',
  borderRadius: '6px',
  color: '#fff',
  fontSize: '16px',
  fontWeight: 'bold',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '12px 24px',
  margin: '0 auto',
}

const hr = {
  borderColor: '#e9ecef',
  margin: '32px 0',
}

const footer = {
  color: '#6c757d',
  fontSize: '14px',
  lineHeight: '20px',
  margin: '8px 0',
  padding: '0 40px',
}
