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
import { createLogger } from '@sim/logger'
import { baseStyles } from '@/components/emails/base-styles'
import EmailFooter from '@/components/emails/footer'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/core/utils/urls'

const logger = createLogger('WorkspaceInvitationEmail')

interface WorkspaceInvitationEmailProps {
  workspaceName?: string
  inviterName?: string
  invitationLink?: string
}

export const WorkspaceInvitationEmail = ({
  workspaceName = 'Workspace',
  inviterName = 'Someone',
  invitationLink = '',
}: WorkspaceInvitationEmailProps) => {
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
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>
          You've been invited to join the "{workspaceName}" workspace on {brand.name}!
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
              <strong>{inviterName}</strong> invited you to join the{' '}
              <strong>{workspaceName}</strong> workspace on {brand.name}.
            </Text>

            <Link href={enhancedLink} style={{ textDecoration: 'none' }}>
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

export default WorkspaceInvitationEmail
